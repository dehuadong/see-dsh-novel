/**
 * 章前上下文：两次选择（planner／writer）、固定来源、分层与 trace。
 *
 * 选择由模型通过原生 `subagent` 工具完成；宿主只提供任务与候选、校验返回的 id、
 * 组装 `ContextPackage` 与 `ChapterTrace`，并持久化 planner／writer 包。
 */
import { readFile, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { chapterBodyForChapter } from './chapter-document.js'
import { loadChapterPlan } from './chapter-plan.js'
import type { ChapterPlan } from './chapter-plan.js'
import { searchStory, storyDocuments } from './story-index.js'
import {
  AUTHOR_INTENT_FILE,
  CURRENT_FOCUS_FILE,
  ROLE_DIR_NAMES,
  STORY_EXTERNAL_BRIEF,
  STORY_FRAME_FILE,
  STORY_PARENT_CANON_MD,
  STORY_FANFIC_CANON_MD,
  STORY_STYLE_GUIDE_MD,
  STORY_VOLUME_MAP_FILE,
} from './story-paths.js'

export type Protection = 'protected' | 'compressible'
export type ContextPurpose = 'planner' | 'writer'
export type SelectionKind = 'memory' | 'role' | 'state' | 'outline'

export interface ContextSource {
  source: string
  reason: string
  excerpt?: string
  protection: Protection
}

export interface ContextPackage {
  chapter: number
  selectedContext: ContextSource[]
}

export interface ChapterTrace {
  chapter: number
  plannerInputs: string[]
  composerInputs: string[]
  selectedSources: string[]
  contextTiers: { protectedSources: string[], compressibleSources: string[] }
  tokenBudget: { protectedTokens: number, compressibleTokens: number, totalSelectedTokens: number }
  compression?: {
    compiledSource: string
    protectedSources: string[]
    compressedSources: string[]
    protectedTokens: number
    compressibleTokens: number
    budgetTokens: number
  }
  retrieval: {
    engine: 'sqlite-fts5-bm25'
    query: string
    selectionMode: 'semantic' | 'complete'
    candidates: Array<{ id: string, kind: string, source: string, score: number }>
    semanticSelectedIds: string[]
  }
  notes: string[]
}

export interface ContextBudget {
  contextWindowTokens: number
  reservedOutputTokens: number
}

export interface CompressionChunk {
  instruction: string
  fragments: ContextSource[]
  maxTokens: number
}

export interface CompressionTask {
  chapter: number
  goal: string
  language: 'zh' | 'en'
  maxInputTokens: number
  protectedSources: string[]
  compressibleEntries: ContextSource[]
  chunks: CompressionChunk[]
}

export interface Candidate {
  id: string
  /** semantic 选择必须包含的候选（源强制 N-1 摘要）。 */
  required?: boolean
  /** 选择理由；缺省按 kind 生成。 */
  reason?: string
  /** 同类候选的稳定顺序（summary 章号 / volume 索引 / hook 源序）。 */
  order?: number
  /** 子代理实际提交的 id；切块时是 `<id>:part-N`。 */
  selectionId: string
  kind: SelectionKind
  source: string
  title: string
  excerpt: string
  score: number
}

export interface Selection {
  memory: string[]
  role: string[]
  state: string[]
  storyFrame: string[]
  volumeMap: string[]
}

export interface SelectionGroup {
  kind: SelectionKind
  file?: string
  instruction: string
  candidates: Candidate[]
}

export interface SelectionTask {
  kind: SelectionKind
  file?: string
  instruction: string
  candidates: Candidate[]
}

export interface SelectionTasks {
  chapter: number
  query: string
  mode: 'semantic' | 'complete'
  tasks: SelectionTask[]
}

/** CJK 感知的 token 估算：CJK 逐字 1 token，拉丁词按 4 字符 1 token。 */
export function estimateTokens(text: string): number {
  const cjk = (text.match(/[\u3400-\u9FFF]/gu) ?? []).length
  const rest = text.replace(/[\u3400-\u9FFF]/gu, '')
  return cjk + Math.ceil(rest.length / 4)
}

function contextTokens(entry: ContextSource): number {
  return estimateTokens([entry.source, entry.reason, entry.excerpt].filter(Boolean).join('\n'))
}

function slugifyAnchor(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/gu, '-').replace(/^-+|-+$/gu, '') || 'section'
}

async function readText(path: string): Promise<string> {
  try {
    return (await readFile(path, 'utf8')).trim()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw error
  }
}

async function readJson(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

interface OutlineSection { heading: string, raw: string }

function splitOutlineSections(markdown: string): OutlineSection[] {
  const sections: OutlineSection[] = []
  let heading: string | undefined
  let lines: string[] = []
  const flush = (): void => {
    if (heading === undefined || lines.every((line) => line.trim() === '')) return
    sections.push({ heading, raw: lines.join('\n').trim() })
    lines = []
  }
  for (const line of markdown.split(/\r?\n/u)) {
    const match = /^(#{1,6})\s+(.+?)\s*$/u.exec(line)
    if (match !== null) {
      flush()
      heading = match[2]?.trim() ?? heading
      lines = [line]
      continue
    }
    if (heading !== undefined) lines.push(line)
  }
  flush()
  return sections
}

interface Fact { subject: string, predicate: string, object: string, validFromChapter: number, validUntilChapter: number | null }

async function currentStateFacts(root: string): Promise<Fact[]> {
  const value = await readJson(join(root, 'source/story/state/current_state.json'))
  if (value === undefined) return []
  if (typeof value !== 'object' || value === null || !Array.isArray((value as { facts?: unknown }).facts)) {
    throw new Error('current_state.json 必须带 facts 数组')
  }
  return ((value as { facts: unknown[] }).facts).map((fact, index) => {
    if (typeof fact !== 'object' || fact === null) throw new Error(`current_state 第 ${index + 1} 条事实不是对象`)
    const row = fact as Record<string, unknown>
    if (typeof row.subject !== 'string' || typeof row.predicate !== 'string' || typeof row.object !== 'string'
      || typeof row.validFromChapter !== 'number'
      || (row.validUntilChapter !== null && typeof row.validUntilChapter !== 'number')) {
      throw new Error(`current_state 第 ${index + 1} 条事实字段不合法`)
    }
    return {
      subject: row.subject,
      predicate: row.predicate,
      object: row.object,
      validFromChapter: row.validFromChapter,
      validUntilChapter: row.validUntilChapter,
    }
  })
}

async function previousChapterExcerpt(root: string, chapter: number): Promise<string> {
  if (chapter <= 1) return ''
  const prefix = `${String(chapter - 1).padStart(4, '0')}_`
  let files: string[]
  try {
    files = await readdir(join(root, 'source/chapters'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw error
  }
  const file = files.find((name) => name.startsWith(prefix) && name.endsWith('.md'))
  if (file === undefined) return ''
  return chapterBodyForChapter(await readText(join(root, 'source/chapters', file)), chapter - 1)
}

async function plannerGoal(root: string, instruction?: string): Promise<string> {
  const parts = await Promise.all([
    instruction === undefined ? '' : instruction.trim(),
    readText(join(root, CURRENT_FOCUS_FILE)),
    readText(join(root, AUTHOR_INTENT_FILE)),
    readText(join(root, STORY_EXTERNAL_BRIEF)),
  ])
  return parts.filter((part) => part !== '').join('\n\n') || '根据当前作品状态规划下一章。'
}

function chapterMemoEntry(plan: ChapterPlan | null, goal: string): ContextSource {
  const body = plan?.memo.body ?? goal
  return {
    source: 'runtime/chapter_memo',
    reason: "Carry the planner's chapter memo into governed writing.",
    excerpt: [`goal=${plan?.memo.goal ?? goal}`, body].filter(Boolean).join(' | '),
    protection: 'protected',
  }
}

interface HookRow { hookId: string, startChapter: number, type: string, status: string, lastAdvancedChapter: number, expectedPayoff: string, notes: string }
interface SummaryRow { chapter: number, title?: string, events?: string, stateChanges?: string, hookActivity?: string }

function summaryMentionsHook(summary: SummaryRow, hookId: string): boolean {
  return [summary.title, summary.events, summary.stateChanges, summary.hookActivity].some((text) => text !== undefined && text.includes(hookId))
}

function findHookSummary(summaries: SummaryRow[], hookId: string, chapter: number, mode: 'seed' | 'latest'): SummaryRow | undefined {
  const directChapterHit = summaries.find((summary) => summary.chapter === chapter)
  const hookMentions = summaries.filter((summary) => summaryMentionsHook(summary, hookId))
  if (mode === 'seed') return hookMentions.find((summary) => summary.chapter === chapter) ?? hookMentions.at(0) ?? directChapterHit
  return [...hookMentions].reverse().find((summary) => summary.chapter === chapter) ?? hookMentions.at(-1) ?? directChapterHit
}

function renderHookBeat(summary: SummaryRow): string {
  return `ch${summary.chapter} ${summary.title ?? ''} - ${summary.events || summary.hookActivity || summary.stateChanges || '(none)'}`
}

async function referencedHookEntries(root: string, plan: ChapterPlan): Promise<ContextSource[]> {
  if (plan.memo.threadRefs.length === 0) return []
  const work = await readJson(join(root, 'work.json')) as { language?: string } | undefined
  const english = work?.language === 'en'
  const hooksState = await readJson(join(root, 'source/story/state/hooks.json')) as { hooks?: HookRow[] } | undefined
  const summariesState = await readJson(join(root, 'source/story/state/chapter_summaries.json')) as { rows?: SummaryRow[] } | undefined
  const hooks = hooksState?.hooks ?? []
  const summaries = summariesState?.rows ?? []
  const entries: ContextSource[] = []
  for (const hookId of new Set(plan.memo.threadRefs)) {
    const hook = hooks.find((entry) => entry.hookId === hookId)
    if (hook === undefined) continue
    const seed = findHookSummary(summaries, hookId, hook.startChapter, 'seed')
    const latest = findHookSummary(summaries, hookId, hook.lastAdvancedChapter, 'latest')
    const promise = hook.expectedPayoff || (english ? '(unspecified)' : '（未写明）')
    const seedBeat = seed === undefined ? (hook.notes || promise) : renderHookBeat(seed)
    const latestBeat = latest !== undefined && latest !== seed ? renderHookBeat(latest) : undefined
    entries.push({
      source: `runtime/referenced_hook#${hookId}`,
      reason: english ? 'Traceable history for a hook referenced by the chapter memo.' : '章节备忘引用伏笔的可追溯历史。',
      excerpt: english
        ? [
            `${hookId} (${hook.type}, memo-referenced hook, status=${hook.status})`,
            `reader promise: ${promise}`,
            `original seed (ch${hook.startChapter}): ${seedBeat}`,
            latestBeat === undefined ? undefined : `latest turn (ch${hook.lastAdvancedChapter}): ${latestBeat}`,
          ].filter(Boolean).join(' | ')
        : [
            `${hookId}（${hook.type}，备忘引用伏笔，状态=${hook.status}）`,
            `读者承诺：${promise}`,
            `种于第${hook.startChapter}章：${seedBeat}`,
            latestBeat === undefined ? undefined : `推进于第${hook.lastAdvancedChapter}章：${latestBeat}`,
          ].filter(Boolean).join(' | '),
      protection: 'protected',
    })
  }
  return entries
}

async function fixedContext(root: string, plan: ChapterPlan | null, purpose: ContextPurpose, goal: string): Promise<{ entries: ContextSource[], chapter: number }> {
  const chapter = plan?.intent.chapter ?? await nextChapter(root)
  const entries: ContextSource[] = [chapterMemoEntry(plan, goal)]
  for (const [file, reason] of [
    [CURRENT_FOCUS_FILE, 'Current task focus for this chapter.'],
    [AUTHOR_INTENT_FILE, "User's long-term authorial intent and direction — binding, overrides model defaults."],
    [STORY_STYLE_GUIDE_MD, 'User-approved style guidance for this Work.'],
    [STORY_PARENT_CANON_MD, 'Preserve parent canon constraints for governed continuation or fanfic writing.'],
    [STORY_FANFIC_CANON_MD, 'Preserve extracted fanfic canon constraints for governed writing.'],
  ] as const) {
    const content = await readText(join(root, file))
    if (content !== '') entries.push({ source: file, reason, excerpt: content, protection: 'protected' })
  }
  if (purpose === 'planner') {
    const previous = await previousChapterExcerpt(root, chapter)
    if (previous !== '') {
      entries.push({
        source: `runtime/previous_chapter#${chapter - 1}`,
        reason: 'Previous chapter text required for chapter transition planning.',
        excerpt: previous,
        protection: 'protected',
      })
    }
  }
  if (plan !== null) entries.push(...await referencedHookEntries(root, plan))
  return { entries, chapter }
}

async function memoryCandidates(root: string, query: string, chapter: number): Promise<Candidate[]> {
  const hits = await searchStory(root, query, { limit: 200 })
  const docs = (await storyDocuments(root)).filter((doc) => doc.kind === 'hook' || doc.kind === 'chapter-summary' || doc.kind === 'volume-summary')
    .filter((doc) => doc.kind !== 'chapter-summary' || Number(doc.id.slice('summary:'.length)) < chapter)
  const hitScores = new Map(hits.map((hit) => [`memory:${hit.source}`, hit.score]))
  const candidates: Candidate[] = docs.map((doc, index) => ({
    id: `memory:${doc.source}`,
    selectionId: `memory:${doc.source}`,
    kind: 'memory',
    source: doc.source,
    title: doc.title,
    excerpt: doc.body,
    score: hitScores.get(`memory:${doc.source}`) ?? -1_000_000,
    order: doc.kind === 'chapter-summary'
      ? Number(doc.id.slice('summary:'.length))
      : doc.kind === 'volume-summary'
        ? 1_000_000 + Number(doc.id.slice('volume-summary:'.length))
        : 2_000_000 + index,
    reason: doc.kind === 'chapter-summary'
      ? 'Relevant episodic memory retrieved for the current chapter goal.'
      : doc.kind === 'volume-summary'
        ? 'Carry forward long-span arc memory compressed from earlier volumes.'
        : 'Carry forward unresolved hooks that match the chapter focus.',
    ...(doc.kind === 'chapter-summary' && doc.id === `summary:${chapter - 1}` ? { required: true } : {}),
  }))
  const hitOrder = new Map(hits.map((hit, index) => [`memory:${hit.source}`, index]))
  return candidates.sort((left, right) => {
    const leftHit = hitOrder.get(left.id)
    const rightHit = hitOrder.get(right.id)
    if (leftHit !== undefined && rightHit !== undefined) return leftHit - rightHit
    if (leftHit !== undefined) return -1
    if (rightHit !== undefined) return 1
    return left.source.localeCompare(right.source)
  })
}

async function roleCandidates(root: string): Promise<Candidate[]> {
  const candidates: Candidate[] = []
  for (const tier of Object.values(ROLE_DIR_NAMES)) {
    const dir = join(root, 'source/story/roles', tier)
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => entry.name)
      .sort()
    for (const name of files) {
      const file = join(dir, name)
      const source = relative(root, file).replaceAll('\\', '/')
      candidates.push({
        id: `role:${source}`,
        selectionId: `role:${source}`,
        kind: 'role',
        source,
        title: name,
        excerpt: await readText(file),
        score: 0,
      })
    }
  }
  return candidates
}

async function stateCandidates(root: string): Promise<Candidate[]> {
  const facts = await currentStateFacts(root)
  return facts.map((fact, index) => {
    const source = `runtime/current_state#${index + 1}-${slugifyAnchor(`${fact.subject}-${fact.predicate}`)}`
    return {
      id: `state:${source}`,
      selectionId: `state:${source}`,
      kind: 'state',
      source,
      title: `${fact.subject} / ${fact.predicate}`,
      excerpt: [
        `subject: ${fact.subject}`,
        `predicate: ${fact.predicate}`,
        `object: ${fact.object}`,
        `validFromChapter: ${fact.validFromChapter}`,
        fact.validUntilChapter === null ? 'validUntilChapter: current' : `validUntilChapter: ${fact.validUntilChapter}`,
      ].join('\n'),
      score: 0,
    }
  })
}

async function outlineCandidates(root: string, file: string): Promise<Candidate[]> {
  const markdown = await readText(join(root, file))
  if (markdown === '') return []
  const sections = splitOutlineSections(markdown)
  const rows = sections.length > 0 ? sections : [{ heading: file, raw: markdown }]
  return rows.map((section) => {
    const source = `${file}#${sections.length > 0 ? slugifyAnchor(section.heading) : 'document'}`
    return {
      id: `outline:${source}`,
      selectionId: `outline:${source}`,
      kind: 'outline',
      source,
      title: section.heading,
      excerpt: section.raw,
      score: 0,
      reason: file === STORY_FRAME_FILE
        ? 'Preserve canon constraints referenced by the active chapter brief or hard constraints.'
        : 'Anchor the default planning node for this chapter.',
    }
  })
}

function selectionInstruction(kind: SelectionKind, chapter: number, query: string, file?: string): string {
  if (kind === 'memory') {
    return [
      'Select story-memory candidates that materially help the current chapter task. Understand corrections, causality, aliases, and paraphrases. An empty selection is valid.',
      '',
      `Chapter: ${chapter}`,
      'Current task:',
      query,
    ].join('\n')
  }
  const label = kind === 'role' ? '角色卡' : kind === 'state' ? '当前状态事实' : '大纲分节'
  return [
    `选择当前章节需要的${label}。`,
    '',
    ...(file === undefined ? [] : [`File: ${file}`]),
    `Chapter: ${chapter}`,
    `Goal: ${query}`,
  ].join('\n')
}

/** 构造一次 pass 的固定来源与五类候选组；planner 不需要 plan，writer 必须有 plan。 */
export async function buildSelectionGroups(
  root: string,
  purpose: ContextPurpose,
  options: { instruction?: string, budget?: ContextBudget } = {},
): Promise<{ chapter: number, query: string, fixedEntries: ContextSource[], groups: SelectionGroup[] }> {
  const chapter = await nextChapter(root)
  const plan = purpose === 'writer' ? await loadChapterPlan(root, chapter) : null
  if (purpose === 'writer' && plan === null) throw new Error(`第 ${chapter} 章还没有章纲，不能做 writer 上下文选择`)
  const goal = purpose === 'planner' ? await plannerGoal(root, options.instruction) : ''
  const query = purpose === 'planner'
    ? goal
    : [plan?.intent.goal, plan?.memo.body, ...(plan?.memo.threadRefs ?? [])].filter(Boolean).join('\n')
  const fixed = await fixedContext(root, plan, purpose, goal)
  const memoryGroups = groupMemoryCandidates(
    await memoryCandidates(root, query, chapter),
    semanticInputBudget(options.budget),
  )
  const groups: SelectionGroup[] = [
    ...memoryGroups.map((candidates) => ({
      kind: 'memory' as const,
      instruction: selectionInstruction('memory', chapter, query),
      candidates,
    })),
    { kind: 'role', instruction: selectionInstruction('role', chapter, query), candidates: await roleCandidates(root) },
    { kind: 'state', instruction: selectionInstruction('state', chapter, query), candidates: await stateCandidates(root) },
    { kind: 'outline', file: STORY_FRAME_FILE, instruction: selectionInstruction('outline', chapter, query, STORY_FRAME_FILE), candidates: await outlineCandidates(root, STORY_FRAME_FILE) },
    { kind: 'outline', file: STORY_VOLUME_MAP_FILE, instruction: selectionInstruction('outline', chapter, query, STORY_VOLUME_MAP_FILE), candidates: await outlineCandidates(root, STORY_VOLUME_MAP_FILE) },
  ]
  return { chapter: fixed.chapter, query, fixedEntries: fixed.entries, groups }
}

function availableTokens(budget: ContextBudget | undefined): number | undefined {
  if (budget === undefined || budget.contextWindowTokens <= 0) return undefined
  return budget.contextWindowTokens - Math.max(0, budget.reservedOutputTokens)
}

function semanticInputBudget(budget: ContextBudget | undefined): number | undefined {
  const available = availableTokens(budget)
  return available === undefined ? undefined : Math.max(1, available - 3072)
}

/** 按 token 预算切分候选 excerpt 并分组；无预算时一组全收。 */
function groupMemoryCandidates(candidates: Candidate[], budgetTokens: number | undefined): Candidate[][] {
  if (candidates.length === 0) return []
  if (budgetTokens === undefined) return [candidates.map((candidate) => ({ ...candidate, selectionId: candidate.id }))]
  const chunks: Candidate[] = []
  for (const candidate of candidates) {
    const metadata = [candidate.id, candidate.kind, candidate.source, candidate.title].join('\n')
    const excerptBudget = Math.max(1, budgetTokens - estimateTokens(metadata) - 64)
    const parts = splitByEstimatedTokens(candidate.excerpt, excerptBudget)
    parts.forEach((part, index) => {
      chunks.push({
        ...candidate,
        selectionId: parts.length === 1 ? candidate.id : `${candidate.id}:part-${index + 1}`,
        excerpt: part,
      })
    })
  }
  const groups: Candidate[][] = []
  let current: Candidate[] = []
  let tokens = 0
  for (const chunk of chunks) {
    const size = estimateTokens([chunk.selectionId, chunk.kind, chunk.source, chunk.title, chunk.excerpt].join('\n'))
    if (current.length > 0 && tokens + size > budgetTokens) {
      groups.push(current)
      current = []
      tokens = 0
    }
    current.push(chunk)
    tokens += size
  }
  if (current.length > 0) groups.push(current)
  return groups
}

function splitByEstimatedTokens(text: string, budgetTokens: number): string[] {
  if (estimateTokens(text) <= budgetTokens) return [text]
  const lines = text.match(/[^\n]*\n|[^\n]+$/gu) ?? [text]
  const chunks: string[] = []
  let current = ''
  const flush = (): void => {
    if (current !== '') chunks.push(current)
    current = ''
  }
  for (const line of lines) {
    if (estimateTokens(line) > budgetTokens) {
      flush()
      const chars = [...line]
      let start = 0
      while (start < chars.length) {
        let low = start + 1
        let high = chars.length
        let end = low
        while (low <= high) {
          const mid = Math.floor((low + high) / 2)
          if (estimateTokens(chars.slice(start, mid).join('')) <= budgetTokens) {
            end = mid
            low = mid + 1
          } else {
            high = mid - 1
          }
        }
        chunks.push(chars.slice(start, end).join(''))
        start = end
      }
      continue
    }
    if (current !== '' && estimateTokens(current + line) > budgetTokens) flush()
    current += line
  }
  flush()
  return chunks.length > 0 ? chunks : [text]
}

function completeAllowance(budget: ContextBudget | undefined): number | undefined {
  const available = availableTokens(budget)
  return available === undefined ? undefined : Math.floor(available / 2)
}

function completeFits(fixed: ReadonlyArray<ContextSource>, groups: ReadonlyArray<SelectionGroup>, allowance: number | undefined): boolean {
  if (allowance === undefined) return false
  const fixedTokens = fixed.reduce((sum, entry) => sum + contextTokens(entry), 0)
  const candidateTokens = groups.flatMap((group) => group.candidates).reduce((sum, candidate) => (
    sum + estimateTokens([candidate.source, candidate.title, candidate.excerpt].filter(Boolean).join('\n'))
  ), 0)
  return fixedTokens + candidateTokens <= allowance
}

/** 构造给主编的任务；complete 时 tasks 为空，role/state/outline 单候选自动，memory 有候选即任务。 */
export async function buildSelectionTasks(
  root: string,
  purpose: ContextPurpose,
  options: { instruction?: string, budget?: ContextBudget } = {},
): Promise<SelectionTasks & { fixedEntries: ContextSource[], groups: SelectionGroup[] }> {
  const built = await buildSelectionGroups(root, purpose, options)
  const allowance = completeAllowance(options.budget)
  const mode = completeFits(built.fixedEntries, built.groups, allowance) ? 'complete' : 'semantic'
  const tasks = mode === 'complete'
    ? []
    : built.groups.filter((group) => group.kind === 'memory' ? group.candidates.length >= 1 : group.candidates.length > 1)
      .map((group) => ({ kind: group.kind, ...(group.file === undefined ? {} : { file: group.file }), instruction: group.instruction, candidates: group.candidates }))
  return { ...built, mode, tasks }
}

function contextOrder(source: string): number {
  if (source === 'runtime/chapter_memo') return 0
  if (source === CURRENT_FOCUS_FILE) return 1
  if (source === AUTHOR_INTENT_FILE) return 2
  if (source === STORY_STYLE_GUIDE_MD) return 3
  if (source.includes('current_state')) return 4
  if (source.includes('outline/')) return 5
  if (source.includes('canon')) return 6
  if (source.includes('roles/')) return 7
  if (source.includes('referenced_hook')) return 8
  if (source.includes('chapter_summaries')) return 9
  if (source.includes('volume_summaries')) return 10
  if (source.includes('pending_hooks')) return 11
  if (source.includes('previous_chapter')) return 12
  return 13
}

function selectedIdsFor(group: SelectionGroup, selection: Selection, mode: 'semantic' | 'complete'): string[] {
  if (mode === 'complete') return group.candidates.map((candidate) => candidate.selectionId)
  if (group.kind === 'memory') {
    const required = group.candidates.filter((candidate) => candidate.required === true).map((candidate) => candidate.selectionId)
    const byId = new Map(group.candidates.map((candidate) => [candidate.selectionId, candidate.order ?? 0]))
    return [...new Set([...required, ...selection.memory])].sort((left, right) => (byId.get(left) ?? 0) - (byId.get(right) ?? 0))
  }
  if (group.candidates.length === 1) return [group.candidates[0]!.selectionId]
  if (group.kind === 'outline') {
    return [...new Set(group.file === STORY_FRAME_FILE ? selection.storyFrame : selection.volumeMap)]
  }
  return [...new Set(selection[group.kind])]
}

/** 组装 package 与 trace；超预算且无压缩文本时返回 compressionTask。 */
export function assembleContext(input: {
  chapter: number
  query: string
  fixedEntries: ReadonlyArray<ContextSource>
  groups: ReadonlyArray<SelectionGroup>
  selection: Selection
  mode: 'semantic' | 'complete'
  budget?: ContextBudget
  language?: 'zh' | 'en'
  plannerInputs?: ReadonlyArray<string>
  composerInputs?: ReadonlyArray<string>
  compression?: { text: string }
}): { package?: ContextPackage, trace?: ChapterTrace, compressionTask?: CompressionTask } {
  const notes: string[] = []
  const selected: ContextSource[] = [...input.fixedEntries]
  const memorySelected: string[] = []
  const selectedIds = new Set<string>()
  for (const group of input.groups) {
    const selectedForGroup = selectedIdsFor(group, input.selection, input.mode)
    const byId = new Map(group.candidates.map((candidate) => [candidate.selectionId, candidate]))
    for (const id of selectedForGroup) {
      const candidate = byId.get(id)
      if (candidate === undefined) throw new Error(`未知的候选 id：${id}`)
      if (selectedIds.has(candidate.id)) continue
      selectedIds.add(candidate.id)
      if (group.kind === 'memory' && (candidate.required !== true || input.selection.memory.includes(candidate.selectionId))) memorySelected.push(candidate.id)
      selected.push({
        source: candidate.source,
        reason: candidate.reason ?? (group.kind === 'role' ? 'Role canon selected for the current chapter task.' : group.kind === 'state' ? 'Current-state fact selected for the current chapter task.' : group.kind === 'outline' ? 'Canon constraints selected for the current chapter task.' : 'Story memory selected for this chapter.'),
        excerpt: candidate.excerpt,
        protection: group.kind === 'memory' ? 'compressible' : 'protected',
      })
    }
  }

  selected.sort((left, right) => {
    const byClass = contextOrder(left.source) - contextOrder(right.source)
    if (byClass !== 0) return byClass
    const number = (source: string): number => {
      const match = /chapter_summaries\.md#(\d+)/u.exec(source)
      return match === null ? 0 : Number(match[1])
    }
    return number(left.source) - number(right.source)
  })
  const protectedEntries = selected.filter((entry) => entry.protection === 'protected')
  const compressible = selected.filter((entry) => entry.protection === 'compressible')
  const protectedTokens = protectedEntries.reduce((sum, entry) => sum + contextTokens(entry), 0)
  let compressibleTokens = compressible.reduce((sum, entry) => sum + contextTokens(entry), 0)
  const totalTokens = protectedTokens + compressibleTokens
  const budgetTokens = availableTokens(input.budget)
  if (budgetTokens !== undefined && totalTokens > budgetTokens) {
    if (protectedTokens > budgetTokens) {
      throw new Error(`protected 层超过可用输入预算（${protectedTokens}/${budgetTokens} tokens），不压缩 protected`)
    }
    if (compressible.length === 0) {
      notes.push('context-over-budget-no-compressible-entries')
    } else if (input.compression === undefined) {
      return { compressionTask: buildCompressionTask(input, protectedEntries, compressible, protectedTokens, budgetTokens) }
    } else {
      const maxInputTokens = Math.max(1, budgetTokens - protectedTokens)
      const compiled = input.compression.text.trim()
      if (compiled === '') throw new Error('compressedText 不能为空')
      if (estimateTokens(compiled) > maxInputTokens) {
        throw new Error(`压缩文本超过 maxInputTokens（${estimateTokens(compiled)}/${maxInputTokens} tokens）`)
      }
      const compressedSources = compressible.map((entry) => entry.source)
      const preCompressibleTokens = compressibleTokens
      selected.splice(0, selected.length, ...protectedEntries, {
        source: 'runtime/compiled-compressible-context',
        reason: 'Semantic compilation of lower-priority context after protected context exceeded the input budget.',
        excerpt: compiled,
        protection: 'compressible',
      })
      compressibleTokens = estimateTokens(compiled)
      notes.push('compiled-compressible-context')
      const trace = buildTrace(input, selected, memorySelected, notes, input.groups, {
        compiledSource: 'runtime/compiled-compressible-context',
        protectedSources: protectedEntries.map((entry) => entry.source),
        compressedSources,
        protectedTokens,
        compressibleTokens: preCompressibleTokens,
        budgetTokens: maxInputTokens,
      })
      return { package: { chapter: input.chapter, selectedContext: selected }, trace }
    }
  }

  const trace = buildTrace(input, selected, memorySelected, notes, input.groups)
  return { package: { chapter: input.chapter, selectedContext: selected }, trace }
}

function buildCompressionTask(
  input: {
    chapter: number
    query: string
    language?: 'zh' | 'en'
    budget?: ContextBudget
  },
  protectedEntries: ContextSource[],
  compressible: ContextSource[],
  protectedTokens: number,
  budgetTokens: number,
): CompressionTask {
  const maxInputTokens = Math.max(1, budgetTokens - protectedTokens)
  const language = input.language ?? 'zh'
  const semanticBudget = Math.max(1, (input.budget?.contextWindowTokens ?? budgetTokens) - Math.min(
    Math.max(0, input.budget?.reservedOutputTokens ?? 0),
    Math.max(1024, maxInputTokens),
  ) - 3072)
  const rendered = compressible.map((entry) => [`## ${entry.source}`, entry.reason, entry.excerpt].filter(Boolean).join('\n')).join('\n\n')
  const parts = splitByEstimatedTokens(rendered, semanticBudget)
  const perChunk = Math.max(512, Math.ceil(maxInputTokens / Math.max(1, parts.length)))
  const system = language === 'en'
    ? 'Compile only the supplied lower-priority context for the current task. Preserve exact entity ids, names, unresolved state, causal facts, constraints, and source pointers that remain relevant. Omit unrelated history. Return Markdown only.'
    : '只编译本次提供的低优先级上下文。围绕当前任务保留仍相关的精确实体 id、名称、未解状态、因果事实、约束和来源指针，省略无关历史。只返回 Markdown。'
  const chunks = parts.map((part, index) => ({
    instruction: [
      system,
      '',
      language === 'en' ? `Current intent:\n${input.query}` : `当前意图：\n${input.query}`,
      language === 'en' ? `Source chunk ${index + 1}/${parts.length}:` : `来源分块 ${index + 1}/${parts.length}：`,
      part,
    ].join('\n\n'),
    fragments: compressible,
    maxTokens: perChunk,
  }))
  return {
    chapter: input.chapter,
    goal: input.query,
    language,
    maxInputTokens,
    protectedSources: protectedEntries.map((entry) => entry.source),
    compressibleEntries: compressible,
    chunks,
  }
}

function buildTrace(
  input: { chapter: number, query: string, mode: 'semantic' | 'complete', plannerInputs?: ReadonlyArray<string>, composerInputs?: ReadonlyArray<string> },
  selected: ContextSource[],
  memorySelected: ReadonlyArray<string>,
  notes: ReadonlyArray<string>,
  groups: ReadonlyArray<SelectionGroup>,
  compression?: ChapterTrace['compression'],
): ChapterTrace {
  const memoryCandidates = groups.filter((group) => group.kind === 'memory').flatMap((group) => group.candidates)
  return {
    chapter: input.chapter,
    plannerInputs: [...(input.plannerInputs ?? [])],
    composerInputs: [...(input.composerInputs ?? [])],
    selectedSources: selected.map((entry) => entry.source),
    contextTiers: {
      protectedSources: selected.filter((entry) => entry.protection === 'protected').map((entry) => entry.source),
      compressibleSources: selected.filter((entry) => entry.protection === 'compressible').map((entry) => entry.source),
    },
    tokenBudget: {
      protectedTokens: selected.filter((entry) => entry.protection === 'protected').reduce((sum, entry) => sum + contextTokens(entry), 0),
      compressibleTokens: selected.filter((entry) => entry.protection === 'compressible').reduce((sum, entry) => sum + contextTokens(entry), 0),
      totalSelectedTokens: selected.reduce((sum, entry) => sum + contextTokens(entry), 0),
    },
    retrieval: {
      engine: 'sqlite-fts5-bm25',
      query: input.query,
      selectionMode: input.mode,
      candidates: memoryCandidates.map((candidate) => ({ id: candidate.id, kind: candidate.kind, source: candidate.source, score: candidate.score })),
      semanticSelectedIds: input.mode === 'complete' ? [] : [...memorySelected],
    },
    notes: [...notes],
    ...(compression === undefined ? {} : { compression }),
  }
}

/** 章节必须是当前章 + 1；当前章来自 current_state.json。 */
export async function nextChapter(root: string): Promise<number> {
  const value = await readJson(join(root, 'source/story/state/current_state.json'))
  if (value === undefined) return 1
  const chapter = (value as { chapter?: unknown }).chapter
  return typeof chapter === 'number' ? chapter + 1 : 1
}
