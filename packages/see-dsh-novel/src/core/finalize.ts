import { join } from 'node:path'
/**
 * 章节定稿：写逐章快照与章节索引，并把作品推进到 active。
 *
 * 源工程在章节保存时一次写下这些产物；复刻按阶段把结算与定稿拆开，定稿负责
 * 快照、索引与作品状态，内容取当前状态，不重新结算。
 */
import { CHAPTER_INDEX_PATH, chapterTitleOf, readChapterIndexStrict } from './chapter-index.js'
import type { ChapterIndexEntry } from './chapter-index.js'
import { commitFoundation } from './commit.js'
import { chapterArtifactWrite, currentChapterArtifact } from './artifact-store.js'
import { countChapterLength, loadChapterDocument } from './chapter-document.js'
import { loadChapterReview } from './chapter-review.js'
import { inspectState, stateJsonWrites, stateProjectionWrites } from './state.js'
import type { StateSnapshot } from './state.js'
import { STORY_ROOT } from './story-paths.js'
import type { Work } from './work.js'
import { readWork } from './work.js'

export { CHAPTER_INDEX_PATH }
export type { ChapterIndexEntry } from './chapter-index.js'

export interface FinalizeResult {
  chapter: number
  snapshotPath: string
  status: Work['status']
  chapters: number
}

/**
 * 定稿一章：写快照、章节索引与作品状态。
 * @param root 作品根目录
 * @param chapter 章号
 * @returns 章号、快照目录、作品状态与章节数
 */
export async function finalizeChapter(root: string, chapter: number): Promise<FinalizeResult> {
  const document = await loadChapterDocument(root, chapter)
  if (document === null) throw new Error(`第 ${chapter} 章还没有正文，先写再定稿`)
  const review = await loadChapterReview(root, chapter)
  if (review === null) throw new Error(`第 ${chapter} 章还没有审稿记录，先审再定稿`)
  const work = await readWork(root)
  if (work === null) throw new Error('工作区没有 work.json')

  const read = await inspectState(root, [], work.language)
  if (read.invalid.length > 0) throw new Error(`状态文件损坏，先修复再定稿：${read.invalid.join('、')}`)
  const snapshot: StateSnapshot = read.snapshot
  if (snapshot.manifest.lastAppliedChapter !== chapter) {
    throw new Error(`第 ${chapter} 章还没有结算（已结算到第 ${snapshot.manifest.lastAppliedChapter} 章），先结算再定稿`)
  }
  if (!snapshot.chapterSummaries.rows.some((row) => row.chapter === chapter)) {
    throw new Error(`第 ${chapter} 章还没有摘要，先结算再定稿`)
  }

  const snapshotRoot = `${STORY_ROOT}/snapshots/${chapter}`
  const snapshotWrites = [...stateJsonWrites(snapshot), ...stateProjectionWrites(snapshot)].map((write) => ({
    relativePath: write.relativePath.replace(`${STORY_ROOT}/`, `${snapshotRoot}/`),
    content: write.content,
  }))

  const entries = await readChapterIndexStrict(root)
  const now = new Date().toISOString()
  const existingIndex = entries.findIndex((entry) => entry.number === chapter)
  const entry: ChapterIndexEntry = {
    number: chapter,
    title: chapterTitleOf(document.heading, document.path.split('/').pop() ?? document.path),
    wordCount: countChapterLength(document.content, work.language),
    createdAt: existingIndex >= 0 ? entries[existingIndex]!.createdAt : now,
    updatedAt: now,
    observations: [...review.observations],
    provenance: 'generated',
  }
  // 只补缺失：已有本章条目时不覆盖。
  const nextEntries = existingIndex >= 0 ? entries : [...entries, entry]
  const status: Work['status'] = work.status === 'draft' ? 'active' : work.status
  const nextWork: Work = { ...work, status, updatedAt: status === work.status ? work.updatedAt : now }
  const artifact = (await currentChapterArtifact(root, chapter)) === null
    ? await chapterArtifactWrite(root, { chapter, chapterPath: document.path, content: await (await import('node:fs/promises')).readFile(join(root, document.path), 'utf8') })
    : null
  await commitFoundation(root, {
    writes: [
      ...(artifact === null ? [] : [{ relativePath: artifact.relativePath, content: artifact.content }, artifact.snapshot]),
      ...snapshotWrites,
      { relativePath: CHAPTER_INDEX_PATH, content: `${JSON.stringify(nextEntries, null, 2)}\n` },
      { relativePath: 'work.json', content: `${JSON.stringify(nextWork, null, 2)}\n` },
    ],
  })
  return { chapter, snapshotPath: snapshotRoot, status, chapters: nextEntries.length }
}
