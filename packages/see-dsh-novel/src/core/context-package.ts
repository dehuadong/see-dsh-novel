/**
 * 章前上下文：两次选择（planner／writer）、固定来源、分层与 trace。
 *
 * 选择由模型通过原生 `subagent` 工具完成；宿主只提供任务与候选、校验返回的 id、
 * 组装 `ContextPackage` 与 `ChapterTrace`，并持久化 planner／writer 包。
 */
import { readFile, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { chapterBody } from './chapter-document.js'
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

export interface Candidate {
  id: string
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
  outline: string[]
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

async function markdownFiles(dir: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const files: string[] = []
  for (const entry of entries) {
    if (entry.isDirectory()) files.push(...await markdownFiles(join(dir, entry.name)))
    else if (entry.name.endsWith('.md')) files.push(join(dir, entry.name))
  }
  return files
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
  return chapterBody(await readText(join(root, 'source/chapters', file))).slice(-2000)
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
    reason: 'Carry the planner chapter memo into governed context.',
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
    const promise = hook.expectedPayoff || '（未写明）'
    const seedBeat = seed === undefined ? (hook.notes || promise) : renderHookBeat(seed)
    const latestBeat = latest !== undefined && latest !== seed ? renderHookBeat(latest) : undefined
    entries.push({
      source: `runtime/referenced_hook#${hookId}`,
      reason: '章节备忘引用伏笔的可追溯历史。',
      excerpt: [
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
    [AUTHOR_INTENT_FILE, "User's long-term authorial intent and direction."],
    [STORY_STYLE_GUIDE_MD, 'User-approved style guidance for this Work.'],
    [STORY_PARENT_CANON_MD, 'Parent canon constraints.'],
    [STORY_FANFIC_CANON_MD, 'Extracted fanfic canon constraints.'],
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

async function memoryCandidates(root: string, query: string): Promise<Candidate[]> {
  const hits = await searchStory(root, query, { limit: 200 })
  const docs = (await storyDocuments(root)).filter((doc) => doc.kind === 'hook' || doc.kind === 'chapter-summary' || doc.kind === 'volume-summary')
  const hitScores = new Map(hits.map((hit) => [`memory:${hit.source}`, hit.score]))
  const candidates: Candidate[] = docs.map((doc) => ({
    id: `memory:${doc.source}`,
    kind: 'memory',
    source: doc.source,
    title: doc.title,
    excerpt: doc.body.slice(0, 1000),
    score: hitScores.get(`memory:${doc.source}`) ?? -1_000_000,
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
    for (const file of await markdownFiles(join(root, 'source/story/roles', tier))) {
      const source = relative(root, file).replaceAll('\\', '/')
      candidates.push({
        id: `role:${source}`,
        kind: 'role',
        source,
        title: file.split(/[\\/]/u).at(-1) ?? 'role',
        excerpt: (await readText(file)).slice(0, 4000),
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
      kind: 'outline',
      source,
      title: section.heading,
      excerpt: section.raw.slice(0, 4000),
      score: 0,
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
  options: { instruction?: string } = {},
): Promise<{ chapter: number, query: string, fixedEntries: ContextSource[], groups: SelectionGroup[] }> {
  const chapter = await nextChapter(root)
  const plan = purpose === 'writer' ? await loadChapterPlan(root, chapter) : null
  if (purpose === 'writer' && plan === null) throw new Error(`第 ${chapter} 章还没有章纲，不能做 writer 上下文选择`)
  const goal = purpose === 'planner' ? await plannerGoal(root, options.instruction) : ''
  const query = purpose === 'planner'
    ? goal
    : [plan?.intent.goal, plan?.memo.body, ...(plan?.memo.threadRefs ?? [])].filter(Boolean).join('\n')
  const fixed = await fixedContext(root, plan, purpose, goal)
  const groups: SelectionGroup[] = [
    { kind: 'memory', instruction: selectionInstruction('memory', chapter, query), candidates: await memoryCandidates(root, query) },
    { kind: 'role', instruction: selectionInstruction('role', chapter, query), candidates: await roleCandidates(root) },
    { kind: 'state', instruction: selectionInstruction('state', chapter, query), candidates: await stateCandidates(root) },
    { kind: 'outline', file: STORY_FRAME_FILE, instruction: selectionInstruction('outline', chapter, query, STORY_FRAME_FILE), candidates: await outlineCandidates(root, STORY_FRAME_FILE) },
    { kind: 'outline', file: STORY_VOLUME_MAP_FILE, instruction: selectionInstruction('outline', chapter, query, STORY_VOLUME_MAP_FILE), candidates: await outlineCandidates(root, STORY_VOLUME_MAP_FILE) },
  ]
  return { chapter: fixed.chapter, query, fixedEntries: fixed.entries, groups }
}

function completeAllowance(contextWindowTokens: number | undefined, reservedOutputTokens: number | undefined): number | undefined {
  if (contextWindowTokens === undefined || contextWindowTokens <= 0) return undefined
  return Math.floor((contextWindowTokens - Math.max(0, reservedOutputTokens ?? 0)) / 2)
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
  options: { instruction?: string, contextWindowTokens?: number, reservedOutputTokens?: number } = {},
): Promise<SelectionTasks & { fixedEntries: ContextSource[], groups: SelectionGroup[] }> {
  const built = await buildSelectionGroups(root, purpose, options)
  const allowance = completeAllowance(options.contextWindowTokens, options.reservedOutputTokens)
  const mode = completeFits(built.fixedEntries, built.groups, allowance) ? 'complete' : 'semantic'
  const tasks = mode === 'complete'
    ? []
    : built.groups.filter((group) => group.kind === 'memory' ? group.candidates.length >= 1 : group.candidates.length > 1)
      .map((group) => ({ kind: group.kind, ...(group.file === undefined ? {} : { file: group.file }), instruction: group.instruction, candidates: group.candidates }))
  return { ...built, mode, tasks }
}

function selectedIdsFor(group: SelectionGroup, selection: Selection, mode: 'semantic' | 'complete'): string[] {
  if (mode === 'complete') return group.candidates.map((candidate) => candidate.id)
  if (group.kind !== 'memory' && group.candidates.length === 1) return [group.candidates[0]!.id]
  return [...new Set(selection[group.kind])]
}

/** 组装 package 与 trace；selection 里的未知 id 丢弃并记 notes。 */
export function assembleContext(input: {
  chapter: number
  query: string
  fixedEntries: ReadonlyArray<ContextSource>
  groups: ReadonlyArray<SelectionGroup>
  selection: Selection
  mode: 'semantic' | 'complete'
  plannerInputs?: ReadonlyArray<string>
  composerInputs?: ReadonlyArray<string>
  contextWindowTokens?: number
  reservedOutputTokens?: number
  compression?: { text: string }
}): { package: ContextPackage, trace: ChapterTrace } {
  const notes: string[] = []
  const selected: ContextSource[] = [...input.fixedEntries]
  const memorySelected: string[] = []
  const selectedIds = new Set<string>()
  const knownByKind = new Map<SelectionKind, Set<string>>()
  for (const group of input.groups) {
    const known = knownByKind.get(group.kind) ?? new Set<string>()
    for (const candidate of group.candidates) known.add(candidate.id)
    knownByKind.set(group.kind, known)
  }
  for (const group of input.groups) {
    const selectedForGroup = selectedIdsFor(group, input.selection, input.mode)
    const byId = new Map(group.candidates.map((candidate) => [candidate.id, candidate]))
    for (const id of selectedForGroup) {
      if (!knownByKind.get(group.kind)?.has(id)) {
        notes.push(`丢弃未知 id: ${id}`)
        continue
      }
      const candidate = byId.get(id)
      if (candidate === undefined) continue
      if (selectedIds.has(id)) continue
      selectedIds.add(id)
      if (group.kind === 'memory') memorySelected.push(id)
      selected.push({
        source: candidate.source,
        reason: `composer ${group.kind}`,
        excerpt: candidate.excerpt,
        protection: group.kind === 'memory' ? 'compressible' : 'protected',
      })
    }
  }

  const protectedEntries = selected.filter((entry) => entry.protection === 'protected')
  const compressible = selected.filter((entry) => entry.protection === 'compressible')
  const protectedTokens = protectedEntries.reduce((sum, entry) => sum + contextTokens(entry), 0)
  let compressibleTokens = compressible.reduce((sum, entry) => sum + contextTokens(entry), 0)
  const totalTokens = protectedTokens + compressibleTokens
  const allowance = completeAllowance(input.contextWindowTokens, input.reservedOutputTokens)
  const budgetTokens = allowance === undefined ? undefined : allowance * 2
  let compressionTrace: ChapterTrace['compression']
  if (budgetTokens !== undefined && totalTokens > budgetTokens) {
    if (protectedTokens > budgetTokens) {
      throw new Error(`protected 层超过可用输入预算（${protectedTokens}/${budgetTokens} tokens），不压缩 protected`)
    }
    if (input.compression === undefined) {
      throw new Error(`上下文超预算 ${totalTokens - budgetTokens} tokens，需要先压缩可压缩层`)
    }
    const compiled = input.compression.text.trim()
    if (compiled === '') throw new Error('compressedText 不能为空')
    const compressedSources = compressible.map((entry) => entry.source)
    const protectedOnly = selected.filter((entry) => entry.protection === 'protected')
    compressionTrace = {
      compiledSource: compiled,
      protectedSources: protectedOnly.map((entry) => entry.source),
      compressedSources,
      protectedTokens,
      compressibleTokens: estimateTokens(compiled),
      budgetTokens,
    }
    compressibleTokens = estimateTokens(compiled)
    notes.push(`已压缩 ${compressedSources.length} 条可压缩来源`)
    selected.splice(0, selected.length, ...protectedOnly, {
      source: 'compiled:context',
      reason: '压缩后的可压缩层',
      excerpt: compiled,
      protection: 'compressible',
    })
  }

  const memoryCandidates = input.groups.filter((group) => group.kind === 'memory').flatMap((group) => group.candidates)
  return {
    package: { chapter: input.chapter, selectedContext: selected },
    trace: {
      chapter: input.chapter,
      plannerInputs: [...(input.plannerInputs ?? [])],
      composerInputs: [...(input.composerInputs ?? [])],
      selectedSources: selected.map((entry) => entry.source),
      contextTiers: {
        protectedSources: protectedEntries.map((entry) => entry.source),
        compressibleSources: compressible.map((entry) => entry.source),
      },
      tokenBudget: { protectedTokens, compressibleTokens, totalSelectedTokens: protectedTokens + compressibleTokens },
      retrieval: {
        engine: 'sqlite-fts5-bm25',
        query: input.query,
        selectionMode: input.mode,
        candidates: memoryCandidates.map((candidate) => ({ id: candidate.id, kind: candidate.kind, source: candidate.source, score: candidate.score })),
        semanticSelectedIds: input.mode === 'complete' ? [] : memorySelected,
      },
      notes,
      ...(compressionTrace === undefined ? {} : { compression: compressionTrace }),
    },
  }
}

/** 章节必须是当前章 + 1；当前章来自 current_state.json。 */
export async function nextChapter(root: string): Promise<number> {
  const value = await readJson(join(root, 'source/story/state/current_state.json'))
  if (value === undefined) return 1
  const chapter = (value as { chapter?: unknown }).chapter
  return typeof chapter === 'number' ? chapter + 1 : 1
}
