/**
 * 删除最新章：章节文件进 `chapters/.trash/`，状态、索引、快照与检索回滚到上一章。
 *
 * 源工程只允许删最新章；删中间章要重编号并重放后续状态，本实现同样拒绝。
 */
import { access, mkdir, readFile, readdir, rename } from 'node:fs/promises'
import { join } from 'node:path'

import { buildChapterIndex, CHAPTER_INDEX_PATH, listChapterFiles } from './chapter-index.js'
import { commitFoundation } from './commit.js'
import { validateHooks } from './hooks.js'
import { STORY_ROOT } from './story-paths.js'
import { validateChapterSummaries } from './state.js'
import { readWork } from './work.js'

export interface DeleteChapterResult {
  deletedChapter: number
  title: string
  trashedFiles: string[]
  rolledBackTo: number
  discarded: number[]
}

const SNAPSHOT_FILES = [
  'current_state.md',
  'pending_hooks.md',
  'chapter_summaries.md',
  'state/manifest.json',
  'state/current_state.json',
  'state/hooks.json',
  'state/chapter_summaries.json',
] as const

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
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

/** 读上一章快照；七份文件必须齐全且状态可解析。 */
async function readSnapshot(root: string, target: number): Promise<Map<string, string>> {
  const dir = join(root, STORY_ROOT, 'snapshots', String(target))
  const files = new Map<string, string>()
  for (const file of SNAPSHOT_FILES) {
    try {
      files.set(file, await readFile(join(dir, file), 'utf8'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`不能删除：第 ${target} 章的状态快照缺失（story/snapshots/${target}/${file}）；未改动任何文件`)
      }
      throw error
    }
  }
  const manifest = JSON.parse(files.get('state/manifest.json') as string) as { lastAppliedChapter?: unknown }
  if (manifest.lastAppliedChapter !== target) {
    throw new Error(`不能删除：快照 ${target} 的 lastAppliedChapter 不是 ${target}`)
  }
  validateHooks(JSON.parse(files.get('state/hooks.json') as string))
  validateChapterSummaries(JSON.parse(files.get('state/chapter_summaries.json') as string))
  return files
}

/** 删除章号大于 target 的快照、运行时与草稿文件。 */
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
  await collect(join(STORY_ROOT, 'snapshots'), (name) => {
    const value = Number.parseInt(name, 10)
    return Number.isFinite(value) ? value : undefined
  })
  await collect(join(STORY_ROOT, 'runtime'), (name) => {
    const match = /^chapter-(\d+)\./u.exec(name)
    return match === null ? undefined : Number.parseInt(match[1] as string, 10)
  })
  await collect(join(STORY_ROOT, 'drafts'), (name) => {
    const match = /^(\d{4})_.*\.md$/u.exec(name)
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
 * @param chapter 要删除的章号；必须是当前最新章
 */
export async function deleteLatestChapter(root: string, chapter: number): Promise<DeleteChapterResult> {
  const files = await listChapterFiles(root)
  if (files.length === 0) throw new Error('作品没有可删除的章节')
  const latest = files[files.length - 1] as { chapter: number }
  if (chapter !== latest.chapter) {
    throw new Error(`只能删除最新章（第 ${latest.chapter} 章）；删第 ${chapter} 章需要重编号并重放后续状态`)
  }
  const work = await readWork(root)
  if (work === null) throw new Error('工作区没有 work.json')
  const target = chapter - 1
  const snapshot = await readSnapshot(root, target)

  const index = await buildChapterIndex(root, work.language)
  const discarded = index.filter((entry) => entry.number > target).map((entry) => entry.number)
  const kept = index.filter((entry) => entry.number <= target)

  const chaptersDir = join(root, 'source/chapters')
  const trashDir = join(chaptersDir, '.trash')
  await mkdir(trashDir, { recursive: true })
  const trashed: Array<{ from: string, to: string }> = []
  for (const file of files.filter((entry) => entry.chapter === chapter)) {
    const name = file.path.split('/').pop() as string
    const to = await availableName(trashDir, name)
    await rename(join(chaptersDir, name), join(trashDir, to))
    trashed.push({ from: join(chaptersDir, name), to: join(trashDir, to) })
  }

  const writes = [
    { relativePath: 'source/story/state/manifest.json', content: snapshot.get('state/manifest.json') as string },
    { relativePath: 'source/story/state/current_state.json', content: snapshot.get('state/current_state.json') as string },
    { relativePath: 'source/story/state/hooks.json', content: snapshot.get('state/hooks.json') as string },
    { relativePath: 'source/story/state/chapter_summaries.json', content: snapshot.get('state/chapter_summaries.json') as string },
    { relativePath: 'source/story/current_state.md', content: snapshot.get('current_state.md') as string },
    { relativePath: 'source/story/pending_hooks.md', content: snapshot.get('pending_hooks.md') as string },
    { relativePath: 'source/story/chapter_summaries.md', content: snapshot.get('chapter_summaries.md') as string },
    { relativePath: CHAPTER_INDEX_PATH, content: `${JSON.stringify(kept, null, 2)}\n` },
  ]
  try {
    await commitFoundation(root, {
      writes,
      deletes: [...files.filter((entry) => entry.chapter > chapter).map((entry) => entry.path), ...await staleDeletes(root, target)],
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

