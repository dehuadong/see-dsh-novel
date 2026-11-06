/**
 * 故事索引：把伏笔、章节摘要、角色卡、素材与大纲装进检索库。
 */
import { readFile, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { readWork } from './work.js'
import { LocalSearchIndex } from './search-index.js'
import type { SearchDocument } from './search-index.js'
import {
  STORY_CHAPTER_SUMMARIES_MD,
  STORY_FRAME_FILE,
  STORY_PENDING_HOOKS,
  STORY_ROOT,
  STORY_VOLUME_MAP_FILE,
} from './story-paths.js'

export const INDEX_PATH = 'source/.index/retrieval.db'

interface HookRecord { hookId: string, type: string, expectedPayoff?: string, notes?: string }
interface SummaryRow { chapter: number, title?: string, events?: string }

/** 递归列出某目录下的 .md；目录不存在按空处理。 */
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
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...await markdownFiles(full))
    else if (entry.name.endsWith('.md')) files.push(full)
  }
  return files
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/** 按 Markdown 二级标题切节；没有标题时整份一段。 */
export function splitMarkdownSections(markdown: string): Array<{ heading: string, body: string }> {
  const lines = markdown.split(/\r?\n/u)
  const sections: Array<{ heading: string, body: string }> = []
  let heading: string | undefined
  let buffer: string[] = []
  const flush = (): void => {
    if (heading === undefined) return
    sections.push({ heading, body: buffer.join('\n').trim() })
    buffer = []
  }
  for (const line of lines) {
    if (line.startsWith('## ')) {
      flush()
      heading = line.slice(3).trim()
      continue
    }
    if (heading !== undefined) buffer.push(line)
  }
  flush()
  return sections
}

/** 重建整个故事的检索索引，返回文档数。 */
export async function rebuildStoryIndex(root: string): Promise<{ documents: number, scope: string }> {
  const work = await readWork(root)
  const scope = work?.id ?? 'work'
  const docs: Array<Omit<SearchDocument, 'scope'>> = []

  // 状态 JSON 是结构化来源；pending_hooks.md / chapter_summaries.md 只是投影，不参与索引。
  const hooksRaw = await readOptional(join(root, 'source/story/state/hooks.json'))
  if (hooksRaw !== undefined) {
    const hooks = (JSON.parse(hooksRaw) as { hooks?: HookRecord[] }).hooks ?? []
    for (const hook of hooks) {
      docs.push({
        id: `hook:${hook.hookId}`,
        kind: 'hook',
        source: 'source/story/state/hooks.json',
        title: `${hook.hookId} ${hook.type}`,
        body: [hook.expectedPayoff ?? '', hook.notes ?? ''].join('\n').trim(),
      })
    }
  }

  const summariesRaw = await readOptional(join(root, 'source/story/state/chapter_summaries.json'))
  if (summariesRaw !== undefined) {
    const rows = (JSON.parse(summariesRaw) as { rows?: SummaryRow[] }).rows ?? []
    for (const row of rows) {
      docs.push({
        id: `summary:${row.chapter}`,
        kind: 'summary',
        source: 'source/story/state/chapter_summaries.json',
        title: `第 ${row.chapter} 章 ${row.title ?? ''}`.trim(),
        body: row.events ?? '',
      })
    }
  }

  for (const file of await markdownFiles(join(root, STORY_ROOT, 'roles'))) {
    docs.push({
      id: `role:${relative(root, file).replaceAll('\\', '/')}`,
      kind: 'role',
      source: relative(root, file).replaceAll('\\', '/'),
      title: file.split(/[\\/]/u).at(-1) ?? 'role',
      body: (await readFile(file, 'utf8')).slice(0, 4000),
    })
  }

  for (const file of await markdownFiles(join(root, STORY_ROOT, 'materials'))) {
    docs.push({
      id: `material:${relative(root, file).replaceAll('\\', '/')}`,
      kind: 'material',
      source: relative(root, file).replaceAll('\\', '/'),
      title: file.split(/[\\/]/u).at(-1) ?? 'material',
      body: (await readFile(file, 'utf8')).slice(0, 4000),
    })
  }

  for (const [file, prefix] of [[STORY_FRAME_FILE, 'story_frame'], [STORY_VOLUME_MAP_FILE, 'volume_map']] as const) {
    const markdown = await readOptional(join(root, file))
    if (markdown === undefined) continue
    const sections = splitMarkdownSections(markdown)
    sections.forEach((section, index) => {
      docs.push({
        id: `outline:${prefix}:${index}`,
        kind: 'outline',
        source: file,
        title: section.heading,
        body: section.body,
      })
    })
  }

  const index = new LocalSearchIndex(join(root, INDEX_PATH))
  try {
    index.replaceScope(scope, docs)
  } finally {
    index.close()
  }
  return { documents: docs.length, scope }
}

/** 重建并检索；返回命中。 */
export async function searchStory(
  root: string,
  query: string,
  options: { kinds?: ReadonlyArray<string>, limit?: number } = {},
) {
  const { scope } = await rebuildStoryIndex(root)
  const index = new LocalSearchIndex(join(root, INDEX_PATH))
  try {
    return index.search(query, { scope, ...options })
  } finally {
    index.close()
  }
}
