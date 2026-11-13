/**
 * 删除最新章：章节文件进 `chapters/.trash/`，状态、索引、快照与检索回滚到上一章。
 *
 * 只要求上一章快照的两份投影；最新章与保留项取自章节索引。
 */
import { mkdir, readdir, readFile, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { CHAPTER_INDEX_PATH, readChapterIndexStrict } from './chapter-index.js'
import { commitFoundation } from './commit.js'
import { STORY_ROOT } from './story-paths.js'

export interface DeleteChapterResult {
  deletedChapter: number
  title: string
  trashedFiles: string[]
  rolledBackTo: number
  discarded: number[]
}

const REQUIRED_SNAPSHOT_FILES = ['current_state.md', 'pending_hooks.md'] as const
const STALE_CHAPTER_FILE = /^(\d+)_.*\.md$/u
const TRASH_CHAPTER_FILE = /^(\d+)[_-]?.*\.md$/u

interface SnapshotRestore {
  writes: Array<{ relativePath: string, content: string }>
  deletes: string[]
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/** 重名时挑 `name-2.ext`、`name-3.ext`…；与源的回收站命名一致。 */
async function availableName(dir: string, fileName: string): Promise<string> {
  const dot = fileName.lastIndexOf('.')
  const base = dot === -1 ? fileName : fileName.slice(0, dot)
  const ext = dot === -1 ? '' : fileName.slice(dot)
  let candidate = fileName
  for (let suffix = 2; await exists(join(dir, candidate)); suffix += 1) {
    candidate = `${base}-${suffix}${ext}`
  }
  return candidate
}

/**
 * 读上一章快照并给出恢复写入与删除集。
 *
 * 只有 `current_state.md` 与 `pending_hooks.md` 是必需的；`state/` 里有几份就恢复几份，
 * `chapter_summaries.md` 缺失时删除投影。活状态里多出的 `state/*` 文件一并删除。
 */
async function snapshotRestore(root: string, target: number): Promise<SnapshotRestore> {
  const dir = join(root, STORY_ROOT, 'snapshots', String(target))
  const writes: Array<{ relativePath: string, content: string }> = []
  const deletes: string[] = []
  for (const file of REQUIRED_SNAPSHOT_FILES) {
    try {
      writes.push({ relativePath: `${STORY_ROOT}/${file}`, content: await readFile(join(dir, file), 'utf8') })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`不能删除：第 ${target} 章的状态快照缺失（story/snapshots/${target}/${file}）；未改动任何文件`)
      }
      throw error
    }
  }
  let stateNames: string[]
  try {
    stateNames = await readdir(join(dir, 'state'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`不能删除：第 ${target} 章的快照没有 state 文件；未改动任何文件`)
    }
    throw error
  }
  if (stateNames.length === 0) {
    throw new Error(`不能删除：第 ${target} 章的快照没有 state 文件；未改动任何文件`)
  }
  for (const name of stateNames) {
    writes.push({ relativePath: `${STORY_ROOT}/state/${name}`, content: await readFile(join(dir, 'state', name), 'utf8') })
  }
  try {
    writes.push({
      relativePath: `${STORY_ROOT}/chapter_summaries.md`,
      content: await readFile(join(dir, 'chapter_summaries.md'), 'utf8'),
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    deletes.push(`${STORY_ROOT}/chapter_summaries.md`)
  }
  const snapshotState = new Set(stateNames)
  try {
    for (const name of await readdir(join(root, STORY_ROOT, 'state'))) {
      if (!snapshotState.has(name)) deletes.push(`${STORY_ROOT}/state/${name}`)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  return { writes, deletes }
}

/** 删除章号大于 target 的快照、运行时与草稿文件，以及检索库。 */
async function staleDeletes(root: string, target: number): Promise<string[]> {
  const deletes: string[] = []
  const collect = async (relativeDir: string, numberOf: (name: string) => number | undefined): Promise<void> => {
    let names: string[]
    try {
      names = await readdir(join(root, relativeDir))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    for (const name of names) {
      const number = numberOf(name)
      if (number !== undefined && number > target) deletes.push(`${relativeDir}/${name}`)
    }
  }
  await collect('source/chapters', (name) => {
    const match = STALE_CHAPTER_FILE.exec(name)
    return match === null ? undefined : Number.parseInt(match[1] as string, 10)
  })
  await collect(join(STORY_ROOT, 'snapshots'), (name) => {
    const value = Number.parseInt(name, 10)
    return Number.isFinite(value) ? value : undefined
  })
  await collect(join(STORY_ROOT, 'runtime'), (name) => {
    const match = /^chapter-(\d+)\./u.exec(name)
    return match === null ? undefined : Number.parseInt(match[1] as string, 10)
  })
  await collect(join(STORY_ROOT, 'drafts'), (name) => {
    const match = /^(\d+)_.*\.md$/u.exec(name)
    return match === null ? undefined : Number.parseInt(match[1] as string, 10)
  })
  for (const file of ['memory.db', 'memory.db-shm', 'memory.db-wal']) {
    if (await exists(join(root, STORY_ROOT, file))) deletes.push(`${STORY_ROOT}/${file}`)
  }
  return deletes
}

/**
 * 删除最新章并回滚到上一章。
 * @param root 作品根目录
 * @param chapter 要删除的章号；必须是索引里的最新章
 */
export async function deleteLatestChapter(root: string, chapter: number): Promise<DeleteChapterResult> {
  const index = await readChapterIndexStrict(root)
  if (index.length === 0) throw new Error('作品没有可删除的章节；未改动任何文件')
  const latest = index.reduce((max, entry) => Math.max(max, entry.number), 0)
  if (chapter !== latest) {
    throw new Error(`只能删除最新章（第 ${latest} 章）；删第 ${chapter} 章需要重编号并重放后续状态；未改动任何文件`)
  }
  const target = chapter - 1
  const restore = await snapshotRestore(root, target)

  const kept = index.filter((entry) => entry.number <= target)
  const discarded = index.filter((entry) => entry.number > target).map((entry) => entry.number)

  const chaptersDir = join(root, 'source/chapters')
  const trashDir = join(chaptersDir, '.trash')
  let entries: string[]
  try {
    entries = await readdir(chaptersDir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') entries = []
    else throw error
  }
  const chapterFiles = entries.filter((name) => {
    const match = TRASH_CHAPTER_FILE.exec(name)
    return match !== null && Number.parseInt(match[1] as string, 10) === chapter
  })
  const trashed: Array<{ from: string, to: string }> = []
  if (chapterFiles.length > 0) {
    await mkdir(trashDir, { recursive: true })
    for (const name of chapterFiles) {
      const to = await availableName(trashDir, name)
      await rename(join(chaptersDir, name), join(trashDir, to))
      trashed.push({ from: join(chaptersDir, name), to: join(trashDir, to) })
    }
  }

  try {
    await commitFoundation(root, {
      writes: [...restore.writes, { relativePath: CHAPTER_INDEX_PATH, content: `${JSON.stringify(kept, null, 2)}\n` }],
      deletes: [...restore.deletes, ...await staleDeletes(root, target), `.drafts/chapter-${String(chapter).padStart(4, '0')}.md`],
    })
  } catch (error) {
    const restoreErrors: unknown[] = []
    for (const item of trashed.reverse()) {
      try {
        await rename(item.to, item.from)
      } catch (restoreError) {
        restoreErrors.push(restoreError)
      }
    }
    if (restoreErrors.length > 0) {
      throw new AggregateError([error, ...restoreErrors], '删除回滚失败，且回收站里的原文未能全部搬回')
    }
    throw error
  }

  const title = index.find((entry) => entry.number === chapter)?.title ?? `第${chapter}章`
  return {
    deletedChapter: chapter,
    title,
    trashedFiles: trashed.map((item) => `chapters/.trash/${item.to.split(/[\\/]/u).pop() as string}`),
    rolledBackTo: target,
    discarded,
  }
}
