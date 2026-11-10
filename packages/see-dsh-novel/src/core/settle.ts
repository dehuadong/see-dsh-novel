/**
 * 章节结算：应用 facts／hooks／摘要增量并校验整份运行时状态。
 *
 * 规则对齐源工程的 state reducer：章节前进、hooks 合并与终态保护、facts 的
 * 失效与同 key 替换、摘要按章号排序；重结算只做同章增量（章节基线快照是 D33）。
 */
import type { HookRecord, HooksState } from './hooks.js'
import { validateHooks } from './hooks.js'
import type { StateSnapshot } from './state.js'
import type { ChapterSummariesState, ChapterSummaryRow, CurrentStateFact, CurrentStateState } from './state-projections.js'

/** 一条待写入的事实。 */
export interface FactInput {
  subject: string
  predicate: string
  object: string
}

/** 一条要失效的事实的定位；省略 object 表示同 subject+predicate 全部失效。 */
export interface FactSelector {
  subject: string
  predicate: string
  object?: string
}

/** 一条新伏笔候选；id 由宿主分配。 */
export interface HookCandidateInput {
  type: string
  expectedPayoff: string
  notes: string
}

/** 一次结算的增量。 */
export interface SettlementDelta {
  chapter: number
  postSettlement: string
  factOps: { upsert: FactInput[], expire: FactSelector[] }
  hookOps: { upsert: HookRecord[], mention: string[], resolve: string[], defer: string[] }
  newHookCandidates: HookCandidateInput[]
  chapterSummary: Omit<ChapterSummaryRow, 'chapter'>
}

/** 结算后的结果：新快照与本次的说明。 */
export interface SettlementResult {
  snapshot: StateSnapshot
  postSettlement: string
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${field} 不能为空`)
  return value.trim()
}

function textValue(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`${field} 必须是字符串`)
  return value
}

/** 按章号排好的摘要表；重复章节在这里拒绝。 */
function applySummary(state: ChapterSummariesState, delta: SettlementDelta): ChapterSummariesState {
  const rows = state.rows.filter((row) => row.chapter !== delta.chapter)
  const summary = delta.chapterSummary
  rows.push({
    chapter: delta.chapter,
    title: requiredText(summary.title, 'chapterSummary.title'),
    characters: textValue(summary.characters, 'chapterSummary.characters'),
    events: textValue(summary.events, 'chapterSummary.events'),
    stateChanges: textValue(summary.stateChanges, 'chapterSummary.stateChanges'),
    hookActivity: textValue(summary.hookActivity, 'chapterSummary.hookActivity'),
    mood: textValue(summary.mood, 'chapterSummary.mood'),
    chapterType: textValue(summary.chapterType, 'chapterSummary.chapterType'),
  })
  return { rows: rows.sort((left, right) => left.chapter - right.chapter) }
}

/** 合并一条伏笔：superseded 需要 notes，resolved 历史不可撤回。 */
function mergeHook(existing: HookRecord, incoming: HookRecord): HookRecord {
  if (existing.status === 'superseded') return existing
  if (incoming.status === 'superseded') {
    if (existing.status === 'resolved') throw new Error(`不能撤回已回收的伏笔 ${existing.hookId}`)
    if (incoming.notes.trim() === '') throw new Error(`撤回伏笔 ${existing.hookId} 需要说明依据`)
    return { ...existing, status: 'superseded', notes: `${existing.notes}\n${incoming.notes.trim()}`.trim() }
  }
  return {
    ...existing,
    startChapter: Math.min(existing.startChapter, incoming.startChapter),
    type: incoming.type.trim() || existing.type,
    status: existing.status === 'resolved' ? 'resolved' : incoming.status,
    lastAdvancedChapter: Math.max(existing.lastAdvancedChapter, incoming.lastAdvancedChapter),
    expectedPayoff: incoming.expectedPayoff.trim() || existing.expectedPayoff,
    notes: incoming.notes.trim() || existing.notes,
  }
}

/** 去重并拒绝空 id；与源 arbiter 一致。 */
function hookIds(values: ReadonlyArray<string>, operation: string): string[] {
  const normalized = values.map((value) => value.trim())
  if (normalized.some((value) => value === '')) throw new Error(`hookOps.${operation} 含空 id`)
  if (new Set(normalized).size !== normalized.length) throw new Error(`hookOps.${operation} 含重复 id`)
  return normalized
}

function canonicalHookId(existing: ReadonlySet<string>): string {
  let next = 'hook'
  let suffix = 2
  while (existing.has(next)) {
    next = `hook-${suffix}`
    suffix += 1
  }
  return next
}

/** 合并候选伏笔：宿主分配稳定 id，start/lastAdvanced 为当前章。 */
function admitCandidates(
  hooks: Map<string, HookRecord>,
  candidates: ReadonlyArray<HookCandidateInput>,
  chapter: number,
): void {
  for (const candidate of candidates) {
    const type = requiredText(candidate.type, 'newHookCandidates.type')
    const expectedPayoff = requiredText(candidate.expectedPayoff, 'newHookCandidates.expectedPayoff')
    const hookId = canonicalHookId(new Set(hooks.keys()))
    hooks.set(hookId, {
      hookId,
      startChapter: chapter,
      type,
      status: 'open',
      lastAdvancedChapter: chapter,
      expectedPayoff,
      notes: textValue(candidate.notes, 'newHookCandidates.notes').trim(),
    })
  }
}

/** 应用 hooks 增量：upsert 合并、mention 不推进、resolve 推进、defer 不推进。 */
function applyHookOps(state: HooksState, delta: SettlementDelta): HooksState {
  const hooks = new Map(state.hooks.map((hook) => [hook.hookId, { ...hook }]))
  admitCandidates(hooks, delta.newHookCandidates, delta.chapter)

  for (const incoming of delta.hookOps.upsert) {
    const existing = hooks.get(incoming.hookId)
    if (existing === undefined) throw new Error(`upsert 引用了未知伏笔 ${incoming.hookId}；新伏笔请用 newHookCandidates`)
    hooks.set(existing.hookId, mergeHook(existing, incoming))
  }
  // 提及只做去重：不改状态、不推进。
  hookIds(delta.hookOps.mention, 'mention')
  for (const hookId of hookIds(delta.hookOps.resolve, 'resolve')) {
    const existing = hooks.get(hookId)
    if (existing === undefined) throw new Error(`不能回收未知伏笔 ${hookId}`)
    if (existing.status === 'superseded') throw new Error(`不能回收已撤回的伏笔 ${hookId}`)
    hooks.set(hookId, {
      ...existing,
      status: 'resolved',
      lastAdvancedChapter: Math.max(existing.lastAdvancedChapter, delta.chapter),
    })
  }
  for (const hookId of hookIds(delta.hookOps.defer, 'defer')) {
    const existing = hooks.get(hookId)
    if (existing === undefined) throw new Error(`不能延后未知伏笔 ${hookId}`)
    if (existing.status === 'superseded') throw new Error(`不能延后已撤回的伏笔 ${hookId}`)
    hooks.set(hookId, { ...existing, status: 'deferred' })
  }
  return {
    hooks: [...hooks.values()].sort((left, right) => (
      left.startChapter - right.startChapter
      || left.lastAdvancedChapter - right.lastAdvancedChapter
      || left.hookId.localeCompare(right.hookId)
    )),
  }
}

/** 应用 facts 增量：先失效、再插入；同 subject+predicate 的旧事实自动失效。 */
function applyFactOps(state: CurrentStateState, delta: SettlementDelta): CurrentStateState {
  const facts = state.facts.map((fact) => ({ ...fact }))
  const active = (fact: CurrentStateFact): boolean => fact.validUntilChapter === null || fact.validUntilChapter >= delta.chapter
  const sameKey = (
    fact: CurrentStateFact,
    selector: { subject: string, predicate: string, object?: string },
  ): boolean => fact.subject === selector.subject.trim()
    && fact.predicate === selector.predicate.trim()
    && (selector.object === undefined || fact.object === selector.object.trim())

  for (const selector of delta.factOps.expire) {
    const subject = requiredText(selector.subject, 'factOps.expire.subject')
    const predicate = requiredText(selector.predicate, 'factOps.expire.predicate')
    const object = selector.object === undefined ? undefined : requiredText(selector.object, 'factOps.expire.object')
    for (const fact of facts) {
      if (active(fact) && sameKey(fact, { subject, predicate, ...(object === undefined ? {} : { object }) })) {
        fact.validUntilChapter = Math.max(0, delta.chapter - 1)
      }
    }
  }

  for (const input of delta.factOps.upsert) {
    const fact = {
      subject: requiredText(input.subject, 'factOps.upsert.subject'),
      predicate: requiredText(input.predicate, 'factOps.upsert.predicate'),
      object: requiredText(input.object, 'factOps.upsert.object'),
    }
    if (facts.some((candidate) => active(candidate) && sameKey(candidate, fact))) continue
    for (const candidate of facts) {
      if (active(candidate) && candidate.subject === fact.subject && candidate.predicate === fact.predicate) {
        candidate.validUntilChapter = Math.max(0, delta.chapter - 1)
      }
    }
    facts.push({
      ...fact,
      validFromChapter: delta.chapter,
      validUntilChapter: null,
      sourceChapter: delta.chapter,
    })
  }

  return {
    chapter: delta.chapter,
    facts: facts.sort((left, right) => left.predicate.localeCompare(right.predicate) || left.object.localeCompare(right.object)),
  }
}

/**
 * 应用一次结算增量。
 * @param snapshot 当前快照
 * @param delta 结算增量
 * @param options `allowReapply` 允许同章增量重结算（v1 没有章节基线快照，D33）
 * @returns 新快照与 `postSettlement`
 */
export function applySettlement(
  snapshot: StateSnapshot,
  delta: SettlementDelta,
  options: { allowReapply?: boolean } = {},
): SettlementResult {
  if (!Number.isInteger(delta.chapter) || delta.chapter < 1) throw new Error('chapter 必须是 ≥1 的整数')
  textValue(delta.postSettlement, 'postSettlement')
  const last = snapshot.manifest.lastAppliedChapter
  const reapply = delta.chapter === last
  if (reapply && options.allowReapply !== true) throw new Error(`第 ${delta.chapter} 章已经结算过；重结算需要显式允许`)
  if (!reapply && delta.chapter < last) {
    throw new Error(`第 ${delta.chapter} 章早于已结算的第 ${last} 章；更早章节重结算需要章节快照（D33）`)
  }
  if (!reapply && delta.chapter !== last + 1) {
    throw new Error(`结算章号必须前进：当前已结算到第 ${last} 章，收到第 ${delta.chapter} 章`)
  }

  const hooks = applyHookOps(snapshot.hooks, delta)
  validateHooks(hooks)
  const currentState = applyFactOps(snapshot.currentState, delta)
  const chapterSummaries = applySummary(snapshot.chapterSummaries, delta)
  const next: StateSnapshot = {
    manifest: { ...snapshot.manifest, lastAppliedChapter: delta.chapter },
    currentState: { ...currentState, chapter: delta.chapter },
    hooks,
    chapterSummaries,
  }
  const chapters = new Set<number>()
  for (const row of next.chapterSummaries.rows) {
    if (chapters.has(row.chapter)) throw new Error(`章节摘要重复：第 ${row.chapter} 章`)
    chapters.add(row.chapter)
  }
  if (next.currentState.chapter > next.manifest.lastAppliedChapter) {
    throw new Error('current_state.chapter 超过 manifest.lastAppliedChapter')
  }
  return { snapshot: next, postSettlement: delta.postSettlement }
}
