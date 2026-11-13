/**
 * 章节重开与版本恢复。
 *
 * 恢复只换正文并清掉该章运行时文件，不动运行时状态；重开把状态指针退回上一章，
 * 供 DSH 的阶段判定回到本章（重开回退是机制等价）。
 */
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { chapterArtifactWrite } from './artifact-store.js'
import { chapterVersionsDir, readChapterVersion } from './chapter-versions.js'
import { commitFoundation } from './commit.js'
import { loadChapterDocument } from './chapter-document.js'
import { inspectState, stateJsonWrites, stateProjectionWrites } from './state.js'
import type { StateSnapshot } from './state.js'
import { STORY_ROOT } from './story-paths.js'
import { readWork } from './work.js'
import { readWorkflowStart, WORKFLOW_START_PATH } from './workflow-start.js'

export interface RestoreResult {
  chapter: number
  versionId: string
  archived: string
  removed: string[]
}

export interface ReopenResult {
  chapter: number
  versionId: null
  archived: null
  removed: string[]
}

const RUNTIME_DIR = `${STORY_ROOT}/runtime`

/** 本章的运行时文件：`chapter-NNNN.*`，保留 user-brief。 */
async function chapterRuntimePaths(root: string, chapter: number): Promise<string[]> {
  const padded = String(chapter).padStart(4, '0')
  const prefix = `chapter-${padded}.`
  const keep = `chapter-${padded}.user-brief.md`
  let names: string[]
  try {
    names = await readdir(join(root, RUNTIME_DIR))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    names = []
  }
  return names
    .filter((name) => name.startsWith(prefix) && name !== keep)
    .sort()
    .map((name) => `${RUNTIME_DIR}/${name}`)
    .concat(existsSync(join(root, '.drafts', `chapter-${padded}.md`)) ? [`.drafts/chapter-${padded}.md`] : [])
}

/**
 * 恢复某一章的归档版本：只替换正文、归档当前正文并清运行时；不读状态、不改指针。
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
  const removed = await chapterRuntimePaths(root, chapter)
  const artifact = await chapterArtifactWrite(root, {
    chapter,
    chapterPath: document.path,
    content: replacement,
    previousContent: previous,
  })
  await commitFoundation(root, {
    writes: [
      { relativePath: archived, content: previous },
      { relativePath: document.path, content: replacement },
      { relativePath: artifact.relativePath, content: artifact.content },
      artifact.snapshot,
      ...(artifact.backfill === undefined ? [] : [artifact.backfill]),
    ],
    deletes: removed,
  })
  return { chapter, versionId, archived, removed }
}

/**
 * 重开最后已结算的一章：保留正文、清运行时、重开 workflow 并把状态指针退回上一章。
 * @param root 作品根目录
 * @param chapter 章号，必须是当前已结算的最后一章
 */
export async function reopenChapter(root: string, chapter: number): Promise<ReopenResult> {
  const work = await readWork(root)
  if (work === null) throw new Error('工作区没有 work.json')
  const document = await loadChapterDocument(root, chapter)
  if (document === null) throw new Error(`第 ${chapter} 章还没有正文，无法重开`)
  const read = await inspectState(root, [], work.language)
  if (read.invalid.length > 0) throw new Error(`状态文件损坏，先修复再重开：${read.invalid.join('、')}`)
  const snapshot: StateSnapshot = read.snapshot
  if (snapshot.manifest.lastAppliedChapter !== chapter) {
    throw new Error(`只能重开最后已结算的一章：当前已结算到第 ${snapshot.manifest.lastAppliedChapter} 章；更早章节的重开不在支持范围`)
  }

  const removed = await chapterRuntimePaths(root, chapter)
  const writes: Array<{ relativePath: string, content: string }> = []
  if (await readWorkflowStart(root) === null) {
    writes.push({
      relativePath: WORKFLOW_START_PATH,
      content: `${JSON.stringify({
        version: 1,
        action: 'write_next',
        chapter,
        instruction: `重开第 ${chapter} 章`,
        createdAt: new Date().toISOString(),
      }, null, 2)}\n`,
    })
  }
  const next: StateSnapshot = {
    manifest: { ...snapshot.manifest, lastAppliedChapter: chapter - 1 },
    currentState: { ...snapshot.currentState, chapter: chapter - 1 },
    hooks: snapshot.hooks,
    chapterSummaries: { rows: snapshot.chapterSummaries.rows.filter((row) => row.chapter !== chapter) },
  }
  writes.push(...stateJsonWrites(next), ...stateProjectionWrites(next))

  await commitFoundation(root, { writes, deletes: removed })
  return { chapter, versionId: null, archived: null, removed }
}
