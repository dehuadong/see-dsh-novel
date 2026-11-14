/**
 * 章节重开与版本恢复。
 *
 * 恢复只换正文并清掉该章运行时（保留 user-brief 与章纲），同时写索引人工编辑观察与
 * 复审 start；重开把状态从第 N-1 章快照回退，供 DSH 的阶段判定回到本章（重开回退
 * 与快照回退是机制等价，登记在 dsh-mapping.md）。
 */
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { chapterArtifactWrite, currentChapterArtifact } from './artifact-store.js'
import { chapterVersionsDir, readChapterVersion } from './chapter-versions.js'
import { commitFoundation } from './commit.js'
import {
  loadChapterDocument,
  roughChapterLength,
} from './chapter-document.js'
import {
  CHAPTER_INDEX_PATH,
  readChapterIndexStrict,
  type ChapterIndexEntry,
} from './chapter-index.js'
import { loadChapterReview } from './chapter-review.js'
import { chapterPlanPath } from './chapter-plan.js'
import {
  inspectState,
  readStateSnapshot,
  stateJsonWrites,
  stateProjectionWrites,
} from './state.js'
import type { StateSnapshot } from './state.js'
import { STORY_ROOT } from './story-paths.js'
import { readWork } from './work.js'
import {
  reviewStartWrites,
} from './workflow-start.js'

export interface RestoreResult {
  chapter: number
  versionId: string
  archived: string
  removed: string[]
  replacedStartChapter?: number
  startSkipped?: 'later-chapter' | 'state-unreadable'
}

export interface ReopenResult {
  chapter: number
  versionId: null
  archived: null
  removed: string[]
  stateRewoundTo: number
  replacedStartChapter?: number
}

/** 当前章号；状态缺失、损坏或 work.json 不可读时为 null。 */
async function readableCurrentChapter(root: string): Promise<number | null> {
  try {
    const work = await readWork(root)
    const read = await inspectState(root, [], work?.language ?? 'zh')
    if (read.missing.length > 0 || read.invalid.length > 0) return null
    return read.snapshot.currentState.chapter
  } catch {
    return null
  }
}

const RUNTIME_DIR = `${STORY_ROOT}/runtime`
const pad = (chapter: number): string => String(chapter).padStart(4, '0')

/**
 * 本章运行时文件：`chapter-NNNN.*`，保留 user-brief 与调用方指定的路径。
 * @param root 作品根
 * @param chapter 章号
 * @param keep 额外保留的作品根相对路径
 */
async function chapterRuntimePaths(
  root: string,
  chapter: number,
  keep: ReadonlyArray<string> = [],
): Promise<string[]> {
  const padded = pad(chapter)
  const prefix = `chapter-${padded}.`
  const keepPaths = new Set([`${RUNTIME_DIR}/chapter-${padded}.user-brief.md`, ...keep])
  let names: string[]
  try {
    names = await readdir(join(root, RUNTIME_DIR))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    names = []
  }
  return names
    .map((name) => `${RUNTIME_DIR}/${name}`)
    .filter((path) => path.startsWith(`${RUNTIME_DIR}/${prefix}`) && !keepPaths.has(path))
    .sort()
    .concat(existsSync(join(root, '.drafts', `chapter-${padded}.md`)) ? [`.drafts/chapter-${padded}.md`] : [])
}

/** 已发布章节里的最大章号；没有时为 0。 */
async function latestPublishedChapter(root: string): Promise<number> {
  let names: string[]
  try {
    names = await readdir(join(root, 'source/chapters'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
    throw error
  }
  let latest = 0
  for (const name of names) {
    const match = /^(\d+)_[^/]*\.md$/u.exec(name)
    if (match === null) continue
    latest = Math.max(latest, Number.parseInt(match[1] as string, 10))
  }
  return latest
}

/**
 * 恢复某一章的归档版本：替换正文、归档当前正文、清运行时（保留 user-brief 与章纲）、
 * 写索引的 manual-edit-review 观察与复审 start；不改状态指针。
 * 只读取当前章号来决定是否写复审 start；状态不可读时跳过 start，恢复本身照常。
 * @param root 作品根目录
 * @param chapter 任意章号
 * @param versionId 归档版本 id
 */
export async function restoreChapter(root: string, chapter: number, versionId: string): Promise<RestoreResult> {
  const document = await loadChapterDocument(root, chapter)
  if (document === null) throw new Error(`第 ${chapter} 章还没有正文，无法恢复`)
  const previous = await readFile(join(root, document.path), 'utf8')
  const version = await readChapterVersion(root, chapter, versionId)
  const replacement = version.endsWith('\n') ? version : `${version}\n`
  if (replacement === previous) throw new Error('版本内容与当前正文相同，不需要恢复')

  const archived = `${chapterVersionsDir(chapter)}/${Date.now()}_restore_${randomUUID()}.md`
  const removed = await chapterRuntimePaths(root, chapter, [chapterPlanPath(chapter)])
  const artifact = await chapterArtifactWrite(root, {
    chapter,
    chapterPath: document.path,
    content: replacement,
    previousContent: previous,
  })
  const current = await readableCurrentChapter(root)
  const writes: Array<{ relativePath: string, content: string }> = [
    { relativePath: archived, content: previous },
    { relativePath: document.path, content: replacement },
    { relativePath: artifact.relativePath, content: artifact.content },
    artifact.snapshot,
    ...(artifact.backfill === undefined ? [] : [artifact.backfill]),
  ]
  let replacedStartChapter: number | undefined
  let startSkipped: RestoreResult['startSkipped']
  const index = await readChapterIndexStrict(root)
  const hasRow = index.some((entry) => entry.number === chapter)
  if (hasRow) {
    const now = new Date().toISOString()
    const wordCount = roughChapterLength(replacement)
    const next = index.map((entry) => entry.number === chapter
      ? {
          ...entry,
          updatedAt: now,
          wordCount,
          provenance: 'edited' as const,
          observations: [
            ...entry.observations.filter((observation) => observation.code !== 'manual-edit-review'),
            {
              code: 'manual-edit-review',
              summary: 'Chapter content was replaced by an explicit edit action.',
              evidence: [],
            },
          ],
        } satisfies ChapterIndexEntry
      : entry)
    writes.push({ relativePath: CHAPTER_INDEX_PATH, content: `${JSON.stringify(next, null, 2)}\n` })
  }
  if (current === null) {
    startSkipped = 'state-unreadable'
  } else if (chapter <= current + 1) {
    const start = await reviewStartWrites(root, chapter, `恢复第 ${chapter} 章后复审`)
    writes.push(...start.writes)
    replacedStartChapter = start.replacedStartChapter
  } else {
    startSkipped = 'later-chapter'
  }
  await commitFoundation(root, { writes, deletes: removed })
  return {
    chapter,
    versionId,
    archived,
    removed,
    ...(replacedStartChapter === undefined ? {} : { replacedStartChapter }),
    ...(startSkipped === undefined ? {} : { startSkipped }),
  }
}

/**
 * 重开最后已发布的一章：保留正文、从第 N-1 章快照回退状态、清运行时并重开 workflow。
 * @param root 作品根目录
 * @param chapter 章号，必须是当前最新已发布且最后已结算的一章
 */
export async function reopenChapter(root: string, chapter: number): Promise<ReopenResult> {
  const work = await readWork(root)
  if (work === null) throw new Error('工作区没有 work.json')
  const document = await loadChapterDocument(root, chapter)
  if (document === null) throw new Error(`第 ${chapter} 章还没有正文，无法重开`)
  const read = await inspectState(root, [], work.language)
  if (read.missing.length > 0) throw new Error(`状态文件缺失，先修复或重建再重开：${read.missing.join('、')}`)
  if (read.invalid.length > 0) throw new Error(`状态文件损坏，先修复再重开：${read.invalid.join('、')}`)
  const snapshot: StateSnapshot = read.snapshot
  if (snapshot.manifest.lastAppliedChapter !== chapter) {
    throw new Error(`只能重开最后已结算的一章：当前已结算到第 ${snapshot.manifest.lastAppliedChapter} 章；更早章节的重开不在支持范围`)
  }
  const latest = await latestPublishedChapter(root)
  if (latest !== chapter) {
    throw new Error(`只能重开最新已发布的一章：第 ${latest} 章已发布；先处理或删除更晚的章`)
  }
  const hasSnapshot = existsSync(join(root, 'source/story/snapshots', String(chapter), 'state/manifest.json'))
  let hasIndex = false
  let indexOk = true
  try {
    const index = await readChapterIndexStrict(root)
    hasIndex = index.some((entry) => entry.number === chapter)
  } catch {
    indexOk = false
  }
  let artifactOk = true
  const artifact = await currentChapterArtifact(root, chapter).catch(() => {
    artifactOk = false
    return null
  })
  const review = await loadChapterReview(root, chapter).catch(() => null)
  const recoverApplyPossible = review !== null && artifactOk && indexOk
  const missing: string[] = []
  if (!hasSnapshot) missing.push('状态快照')
  if (!hasIndex) missing.push('章节索引条目')
  if (artifact === null) missing.push('章节 artifact')
  if (missing.length > 0) {
    throw new Error(`第 ${chapter} 章缺${missing.join('、')}，不能重开；先运行 story_recover（${recoverApplyPossible ? '可 apply 补齐' : '需按它的人工步骤处理'}）`)
  }
  const baseline = await readStateSnapshot(root, chapter - 1)
  if (baseline.manifest.lastAppliedChapter !== chapter - 1) {
    throw new Error(`第 ${chapter - 1} 章快照不是该章结算后的状态（lastAppliedChapter=${baseline.manifest.lastAppliedChapter}），不能重开`)
  }

  const removed = await chapterRuntimePaths(root, chapter)
  const writes = [...stateJsonWrites(baseline), ...stateProjectionWrites(baseline)]
  const start = await reviewStartWrites(root, chapter, `重开第 ${chapter} 章`)
  writes.push(...start.writes)
  await commitFoundation(root, { writes, deletes: removed })
  return {
    chapter,
    versionId: null,
    archived: null,
    removed,
    stateRewoundTo: chapter - 1,
    ...(start.replacedStartChapter === undefined ? {} : { replacedStartChapter: start.replacedStartChapter }),
  }
}
