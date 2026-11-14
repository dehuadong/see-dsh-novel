/**
 * 状态文件播种：四份 JSON 与三份 Markdown 投影。
 *
 * 只在文件不存在时写入：后续能力会往这些文件里推进章节与事实，重跑 foundation
 * 不得覆盖它们。投影由生效快照渲染，因此「删掉投影、JSON 还在」可以补回。
 */
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

import type { FileWrite } from './commit.js'
import type { HooksState } from './hooks.js'
import { validateHooks } from './hooks.js'
import type { PendingHook } from './types.js'
import type {
  ChapterSummariesState,
  CurrentStateState,
  ProjectionLanguage,
} from './state-projections.js'
import {
  renderChapterSummariesProjection,
  renderCurrentStateProjection,
  renderHooksProjection,
} from './state-projections.js'

import { STATE_DIR, STORY_CHAPTER_SUMMARIES_MD, STORY_CURRENT_STATE_MD, STORY_PENDING_HOOKS, STORY_ROOT } from './story-paths.js'

/** 三份投影的位置；与 JSON 的状态目录分开。 */
export const PROJECTION_PATHS = {
  currentState: STORY_CURRENT_STATE_MD,
  pendingHooks: STORY_PENDING_HOOKS,
  chapterSummaries: STORY_CHAPTER_SUMMARIES_MD,
} as const

/** 每份投影的源 JSON；投影只有在源可读时才可重建。 */
export const PROJECTION_SOURCES: Readonly<Record<string, string>> = {
  [PROJECTION_PATHS.currentState]: `${STATE_DIR}/current_state.json`,
  [PROJECTION_PATHS.pendingHooks]: `${STATE_DIR}/hooks.json`,
  [PROJECTION_PATHS.chapterSummaries]: `${STATE_DIR}/chapter_summaries.json`,
}

/** `manifest.json` 的形状。 */
export interface StateManifest {
  schemaVersion: 2
  language: ProjectionLanguage
  lastAppliedChapter: number
  projectionVersion: 1
}

/** 一次播种所需的完整状态。 */
export interface StateSnapshot {
  manifest: StateManifest
  currentState: CurrentStateState
  hooks: HooksState
  chapterSummaries: ChapterSummariesState
}

interface HookRecord {
  hookId: string
  startChapter: number
  type: string
  status: 'deferred'
  lastAdvancedChapter: number
  expectedPayoff: string
  notes: string
}

function hookRecord(hook: PendingHook): HookRecord {
  return {
    hookId: String(hook.hookId).trim(),
    startChapter: 0,
    type: String(hook.type).trim(),
    status: 'deferred',
    lastAdvancedChapter: 0,
    expectedPayoff: String(hook.expectedPayoff).trim(),
    notes: String(hook.notes ?? '').trim(),
  }
}

/** 默认快照；语言按作品传入，缺省中文。 */
export function defaultStateSnapshot(hooks: ReadonlyArray<PendingHook>, language: ProjectionLanguage = 'zh'): StateSnapshot {
  return {
    manifest: { schemaVersion: 2, language, lastAppliedChapter: 0, projectionVersion: 1 },
    currentState: { chapter: 0, facts: [] },
    hooks: { hooks: hooks.map(hookRecord) },
    chapterSummaries: { rows: [] },
  }
}

/** 四份 JSON 的写入项。 */
export function stateJsonWrites(snapshot: StateSnapshot): FileWrite[] {
  const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`
  const candidates: Array<[string, unknown]> = [
    ['manifest.json', snapshot.manifest],
    ['current_state.json', snapshot.currentState],
    ['hooks.json', snapshot.hooks],
    ['chapter_summaries.json', snapshot.chapterSummaries],
  ]
  return candidates.map(([name, value]) => ({ relativePath: `${STATE_DIR}/${name}`, content: json(value) }))
}

/** 三份 Markdown 投影的写入项。 */
export function stateProjectionWrites(snapshot: StateSnapshot): FileWrite[] {
  const language = snapshot.manifest.language
  return [
    { relativePath: PROJECTION_PATHS.currentState, content: renderCurrentStateProjection(snapshot.currentState, language) },
    { relativePath: PROJECTION_PATHS.pendingHooks, content: renderHooksProjection(snapshot.hooks, language) },
    { relativePath: PROJECTION_PATHS.chapterSummaries, content: renderChapterSummariesProjection(snapshot.chapterSummaries, language) },
  ]
}

async function missing(path: string): Promise<boolean> {
  try {
    await readFile(path)
    return false
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true
    throw error
  }
}

/** 形状校验；解析成功但形状不对与解析失败同样处理。 */
function shapeOk<T>(status: 'ok' | 'missing' | 'invalid', value: unknown, ok: (value: unknown) => value is T): value is T {
  return status === 'ok' && ok(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isManifest(value: unknown): value is StateManifest {
  return isRecord(value) && value.schemaVersion === 2 && (value.language === 'zh' || value.language === 'en')
    && typeof value.lastAppliedChapter === 'number' && value.projectionVersion === 1
}

function isFact(value: unknown): boolean {
  if (!isRecord(value)) return false
  return typeof value.subject === 'string' && typeof value.predicate === 'string' && typeof value.object === 'string'
    && typeof value.validFromChapter === 'number' && typeof value.sourceChapter === 'number'
    && (value.validUntilChapter === null || typeof value.validUntilChapter === 'number')
}

function isCurrentState(value: unknown): value is CurrentStateState {
  return isRecord(value) && typeof value.chapter === 'number'
    && Array.isArray(value.facts) && value.facts.every(isFact)
}

function isHooksState(value: unknown): value is HooksState {
  if (!isRecord(value) || !Array.isArray(value.hooks)) return false
  try {
    validateHooks(value as unknown as HooksState)
    return true
  } catch {
    return false
  }
}

const SUMMARY_FIELDS = ['title', 'characters', 'events', 'stateChanges', 'hookActivity', 'mood', 'chapterType'] as const

/**
 * 校验整份章节摘要状态；任何一条字段不合法就抛错。
 * @param value 待校验的值
 * @returns 校验通过的章节摘要状态
 */
export function validateChapterSummaries(value: unknown): ChapterSummariesState {
  if (!isRecord(value) || !Array.isArray(value.rows)) throw new Error('chapter_summaries 必须是带 rows 数组的对象')
  for (const [index, row] of value.rows.entries()) {
    if (!isRecord(row) || typeof row.chapter !== 'number' || SUMMARY_FIELDS.some((field) => typeof row[field] !== 'string')) {
      throw new Error(`第 ${index + 1} 条章节摘要字段不合法`)
    }
  }
  return value as unknown as ChapterSummariesState
}

function isChapterSummaries(value: unknown): value is ChapterSummariesState {
  try {
    validateChapterSummaries(value)
    return true
  } catch {
    return false
  }
}

/** 读一份 JSON 的三种结局：成功、缺失、内容坏了。 */
interface JsonStatus<T> {
  status: 'ok' | 'missing' | 'invalid'
  value?: T
}

async function readJsonStatus<T>(path: string): Promise<JsonStatus<T>> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    return { status: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'invalid' }
  }
  try {
    return { status: 'ok', value: JSON.parse(raw) as T }
  } catch {
    return { status: 'invalid' }
  }
}

/** 读 manifest 的语言；文件缺失或损坏时返回 undefined。 */
export async function readManifestLanguage(root: string): Promise<ProjectionLanguage | undefined> {
  const read = await readJsonStatus<StateManifest>(join(root, STATE_DIR, 'manifest.json'))
  return read.status === 'ok' && (read.value?.language === 'en' || read.value?.language === 'zh')
    ? read.value.language
    : undefined
}

/**
 * 读现有快照；缺失的部分用默认值补，已有的部分保留。
 * @param root 作品根
 * @param hooks 只在 `hooks.json` 缺失时使用
 */
export interface StateSnapshotRead {
  snapshot: StateSnapshot
  /** 缺失的状态文件（相对作品根）。 */
  missing: string[]
  /** 存在但解析失败的状态文件（相对作品根）。 */
  invalid: string[]
}

/**
 * 读现有快照：缺失的部分用默认值补，坏掉的文件记为 `invalid` 而不是抛错。
 * @param root 作品根
 * @param hooks 只在 `hooks.json` 缺失时使用
 * @param language 没有 manifest 时的语言
 */
export async function inspectState(
  root: string,
  hooks: ReadonlyArray<PendingHook> = [],
  language: ProjectionLanguage = 'zh',
): Promise<StateSnapshotRead> {
  const [manifest, currentState, hooksState, chapterSummaries] = await Promise.all([
    readJsonStatus<StateManifest>(join(root, STATE_DIR, 'manifest.json')),
    readJsonStatus<CurrentStateState>(join(root, STATE_DIR, 'current_state.json')),
    readJsonStatus<HooksState>(join(root, STATE_DIR, 'hooks.json')),
    readJsonStatus<ChapterSummariesState>(join(root, STATE_DIR, 'chapter_summaries.json')),
  ])
  const manifestValue = shapeOk(manifest.status, manifest.value, isManifest) ? manifest.value : undefined
  const currentValue = shapeOk(currentState.status, currentState.value, isCurrentState) ? currentState.value : undefined
  const hooksValue = shapeOk(hooksState.status, hooksState.value, isHooksState) ? hooksState.value : undefined
  const summariesValue = shapeOk(chapterSummaries.status, chapterSummaries.value, isChapterSummaries) ? chapterSummaries.value : undefined
  const fallback = defaultStateSnapshot(hooks, manifestValue?.language ?? language)
  const invalid = ([
    ['manifest.json', manifest.status, manifestValue],
    ['current_state.json', currentState.status, currentValue],
    ['hooks.json', hooksState.status, hooksValue],
    ['chapter_summaries.json', chapterSummaries.status, summariesValue],
  ] as const)
    .filter(([, status, value]) => status === 'invalid' || (status === 'ok' && value === undefined))
    .map(([name]) => `${STATE_DIR}/${name}`)
  const missing = ([
    ['manifest.json', manifest.status],
    ['current_state.json', currentState.status],
    ['hooks.json', hooksState.status],
    ['chapter_summaries.json', chapterSummaries.status],
  ] as const)
    .filter(([, status]) => status === 'missing')
    .map(([name]) => `${STATE_DIR}/${name}`)
  return {
    snapshot: {
      manifest: manifestValue ?? fallback.manifest,
      currentState: currentValue ?? fallback.currentState,
      hooks: hooksValue ?? fallback.hooks,
      chapterSummaries: summariesValue ?? fallback.chapterSummaries,
    },
    missing,
    invalid,
  }
}

/**
 * 状态快照的跨文件不变量问题；读取快照与结算前置共用。
 * @param snapshot 待检查的快照
 * @param prefix 路径前缀（快照读取用其在错误信息里点名文件）
 */
export function describeStateInconsistencies(snapshot: StateSnapshot, prefix = ''): string[] {
  const problems: string[] = []
  if (snapshot.currentState.chapter > snapshot.manifest.lastAppliedChapter) {
    problems.push(
      `${prefix}current_state.json 的 chapter ${snapshot.currentState.chapter} 大于 ${prefix}manifest.json 的 lastAppliedChapter ${snapshot.manifest.lastAppliedChapter}`,
    )
  }
  const chapters = new Set<number>()
  for (const row of snapshot.chapterSummaries.rows) {
    if (chapters.has(row.chapter)) problems.push(`${prefix}chapter_summaries.json 的章节摘要重复：第 ${row.chapter} 章`)
    chapters.add(row.chapter)
  }
  return problems
}

/**
 * 按章严格读快照：四份 JSON 齐全合法、跨文件不变量成立才返回。
 *
 * 与 `inspectState` 不同，这里不对当前状态回落，也不把问题降级成 missing/invalid。
 * @param root 作品根
 * @param chapter 快照章号
 * @returns 该章快照
 */
export async function readStateSnapshot(root: string, chapter: number): Promise<StateSnapshot> {
  const at = (name: string): string => `${STORY_ROOT}/snapshots/${chapter}/state/${name}`
  const [manifest, currentState, hooksState, chapterSummaries] = await Promise.all([
    readJsonStatus<StateManifest>(join(root, at('manifest.json'))),
    readJsonStatus<CurrentStateState>(join(root, at('current_state.json'))),
    readJsonStatus<HooksState>(join(root, at('hooks.json'))),
    readJsonStatus<ChapterSummariesState>(join(root, at('chapter_summaries.json'))),
  ])
  const manifestValue = shapeOk(manifest.status, manifest.value, isManifest) ? manifest.value : undefined
  const currentValue = shapeOk(currentState.status, currentState.value, isCurrentState) ? currentState.value : undefined
  const hooksValue = shapeOk(hooksState.status, hooksState.value, isHooksState) ? hooksState.value : undefined
  const summariesValue = shapeOk(chapterSummaries.status, chapterSummaries.value, isChapterSummaries) ? chapterSummaries.value : undefined
  const problems: string[] = []
  const entries: ReadonlyArray<[string, 'ok' | 'missing' | 'invalid', unknown]> = [
    [at('manifest.json'), manifest.status, manifestValue],
    [at('current_state.json'), currentState.status, currentValue],
    [at('hooks.json'), hooksState.status, hooksValue],
    [at('chapter_summaries.json'), chapterSummaries.status, summariesValue],
  ]
  for (const [path, status, value] of entries) {
    if (status === 'missing') problems.push(`${path} 缺失`)
    else if (status === 'invalid' || value === undefined) problems.push(`${path} 不合法`)
  }
  if (problems.length > 0) throw new Error(`第 ${chapter} 章快照不可用：${problems.join('；')}`)
  const snapshot: StateSnapshot = {
    manifest: manifestValue!,
    currentState: currentValue!,
    hooks: hooksValue!,
    chapterSummaries: summariesValue!,
  }
  problems.push(...describeStateInconsistencies(snapshot, `${STORY_ROOT}/snapshots/${chapter}/state/`))
  if (problems.length > 0) throw new Error(`第 ${chapter} 章快照不一致：${problems.join('；')}`)
  return snapshot
}

/**
 * 已有状态快照的最大章号；没有快照时为 0。
 * @param root 作品根
 * @returns 最大快照章号
 */
export async function latestSnapshotChapter(root: string): Promise<number> {
  let entries: string[]
  try {
    entries = await readdir(join(root, STORY_ROOT, 'snapshots'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
    throw error
  }
  let latest = 0
  for (const name of entries) {
    if (!/^\d+$/u.test(name)) continue
    const chapter = Number(name)
    if (!Number.isSafeInteger(chapter) || chapter <= latest) continue
    if (await missing(join(root, STORY_ROOT, 'snapshots', name, 'state', 'manifest.json'))) continue
    latest = chapter
  }
  return latest
}

/** 生成「尚不存在」的状态写入项（JSON 与投影都补），交给同一次 commit 原子落盘。 */
/**
 * 把整份状态复制成逐章快照（四份 JSON + 三份投影）。
 * @param snapshot 要复制的状态
 * @param chapter 快照章号（初始快照用 0）
 * @returns 相对作品根的写入项
 */
export function snapshotWrites(snapshot: StateSnapshot, chapter: number): FileWrite[] {
  const prefix = `${STORY_ROOT}/snapshots/${chapter}`
  return [...stateJsonWrites(snapshot), ...stateProjectionWrites(snapshot)].map((write) => ({
    relativePath: write.relativePath.replace(`${STORY_ROOT}/`, `${prefix}/`),
    content: write.content,
  }))
}
export async function stateWritesIfMissing(
  root: string,
  hooks: ReadonlyArray<PendingHook>,
  language: ProjectionLanguage = 'zh',
): Promise<FileWrite[]> {
  const read = await inspectState(root, hooks, language)
  const writes: FileWrite[] = []
  for (const write of [...stateJsonWrites(read.snapshot), ...stateProjectionWrites(read.snapshot)]) {
    // 源 JSON 坏掉时不渲染投影：宁可缺一份，也不拿默认值覆盖作者的数据。
    const source = PROJECTION_SOURCES[write.relativePath]
    if (source !== undefined && read.invalid.includes(source)) continue
    if (await missing(join(root, write.relativePath))) writes.push(write)
  }
  return writes
}
