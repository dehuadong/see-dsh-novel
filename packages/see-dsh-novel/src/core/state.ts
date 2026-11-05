/**
 * 状态文件播种：四份 JSON 与三份 Markdown 投影。
 *
 * 只在文件不存在时写入：后续能力会往这些文件里推进章节与事实，重跑 foundation
 * 不得覆盖它们。投影由生效快照渲染，因此「删掉投影、JSON 还在」可以补回。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { FileWrite } from './commit.js'
import type { HooksState } from './hooks.js'
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
import { readWork } from './work.js'

const STATE_DIR = 'source/story/state'

/** 三份投影的位置；与 JSON 的状态目录分开。 */
export const PROJECTION_PATHS = {
  currentState: 'source/story/current_state.md',
  pendingHooks: 'source/story/pending_hooks.md',
  chapterSummaries: 'source/story/chapter_summaries.md',
} as const

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

/** 读一份 JSON；不存在返回 `undefined`，存在但非法则报错。 */
async function readJsonIfPresent<T>(path: string): Promise<T | undefined> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  return JSON.parse(raw) as T
}

/**
 * 读现有快照；缺失的部分用默认值补，已有的部分保留。
 * @param root 作品根
 * @param hooks 只在 `hooks.json` 缺失时使用
 */
export async function readStateSnapshot(
  root: string,
  hooks: ReadonlyArray<PendingHook> = [],
  language: ProjectionLanguage = 'zh',
): Promise<StateSnapshot> {
  const [manifest, currentState, hooksState, chapterSummaries] = await Promise.all([
    readJsonIfPresent<StateManifest>(join(root, STATE_DIR, 'manifest.json')),
    readJsonIfPresent<CurrentStateState>(join(root, STATE_DIR, 'current_state.json')),
    readJsonIfPresent<HooksState>(join(root, STATE_DIR, 'hooks.json')),
    readJsonIfPresent<ChapterSummariesState>(join(root, STATE_DIR, 'chapter_summaries.json')),
  ])
  const fallback = defaultStateSnapshot(hooks, manifest?.language ?? language)
  return {
    manifest: manifest ?? fallback.manifest,
    currentState: currentState ?? fallback.currentState,
    hooks: hooksState ?? fallback.hooks,
    chapterSummaries: chapterSummaries ?? fallback.chapterSummaries,
  }
}

/**
 * 作品语言：已有 manifest 用它，否则读 `work.json`，再否则中文。
 * `work.json` 读不出来时退回中文，不让调用方失败。
 */
export async function stateLanguage(root: string): Promise<ProjectionLanguage> {
  const manifest = await readJsonIfPresent<StateManifest>(join(root, STATE_DIR, 'manifest.json'))
  if (manifest?.language === 'zh' || manifest?.language === 'en') return manifest.language
  try {
    const work = await readWork(root)
    if (work?.language === 'zh' || work?.language === 'en') return work.language
  } catch {
    // 坏掉的作品身份不阻断状态读取；语言退回中文。
  }
  return 'zh'
}

/** 生成「尚不存在」的状态写入项（JSON 与投影都补），交给同一次 commit 原子落盘。 */
export async function stateWritesIfMissing(
  root: string,
  hooks: ReadonlyArray<PendingHook>,
  language: ProjectionLanguage = 'zh',
): Promise<FileWrite[]> {
  const snapshot = await readStateSnapshot(root, hooks, language)
  const writes: FileWrite[] = []
  for (const write of [...stateJsonWrites(snapshot), ...stateProjectionWrites(snapshot)]) {
    if (await missing(join(root, write.relativePath))) writes.push(write)
  }
  return writes
}
