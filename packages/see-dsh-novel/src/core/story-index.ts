/**
 * 故事索引：故事记忆三类型（hook／chapter-summary／volume-summary），外加
 * 过渡期的角色/大纲/素材候选（D22）。
 */
import { readFile, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { validateHooks } from './hooks.js'
import type { HooksState } from './hooks.js'
import { validateChapterSummaries } from './state.js'
import type { ChapterSummariesState } from './state-projections.js'
import { LocalSearchIndex } from './search-index.js'
import type { SearchDocument } from './search-index.js'
import {
  STORY_CHAPTER_SUMMARIES_MD,
  STORY_PENDING_HOOKS,
  STORY_ROOT,
  STORY_VOLUME_SUMMARIES_MD,
} from './story-paths.js'

/** 故事记忆的索引文件；可重建投影。 */
export const INDEX_PATH = 'source/story/memory.db'
/** 故事记忆的 scope。 */
export const STORY_SCOPE = 'story-memory'

interface VolumeSummary { heading: string, content: string, anchor: string }

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

function slugifyAnchor(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    || 'volume-summary'
}

/** 按二级标题分节解析卷摘要；标题与正文都为空的分节丢弃。 */
function parseVolumeSummaries(markdown: string): VolumeSummary[] {
  if (!markdown.trim()) return []
  return markdown
    .split(/^##\s+/m)
    .map((section) => section.trim())
    .filter((section) => section !== '')
    .map((section) => {
      const [headingLine, ...bodyLines] = section.split('\n')
      const heading = headingLine?.trim() ?? ''
      const content = bodyLines.join('\n').trim()
      return { heading, content, anchor: slugifyAnchor(heading) }
    })
    .filter((section) => section.heading !== '' && section.content !== '')
}

/**
 * 构造故事检索文档，不写索引。
 * @param root 作品根
 * @returns 故事记忆三类型与过渡候选
 */
export async function storyDocuments(root: string): Promise<Array<Omit<SearchDocument, 'scope'>>> {
  const docs: Array<Omit<SearchDocument, 'scope'>> = []

  const hooksRaw = await readOptional(join(root, 'source/story/state/hooks.json'))
  if (hooksRaw !== undefined) {
    const state = validateHooks(JSON.parse(hooksRaw) as HooksState)
    for (const hook of state.hooks) {
      if (hook.status === 'resolved' || hook.status === 'superseded') continue
      docs.push({
        id: `hook:${hook.hookId}`,
        kind: 'hook',
        source: `${STORY_PENDING_HOOKS}#${hook.hookId}`,
        title: [hook.hookId, hook.type].filter(Boolean).join(' '),
        body: [hook.status, hook.expectedPayoff, hook.notes].filter(Boolean).join('\n'),
        metadata: { hookId: hook.hookId },
      })
    }
  }

  const summariesRaw = await readOptional(join(root, 'source/story/state/chapter_summaries.json'))
  if (summariesRaw !== undefined) {
    const state: ChapterSummariesState = validateChapterSummaries(JSON.parse(summariesRaw))
    for (const row of state.rows) {
      docs.push({
        id: `summary:${row.chapter}`,
        kind: 'chapter-summary',
        source: `${STORY_CHAPTER_SUMMARIES_MD}#${row.chapter}`,
        title: row.title.trim() || `Chapter ${row.chapter}`,
        body: [
          row.characters,
          row.events,
          row.stateChanges,
          row.hookActivity,
          row.mood,
          row.chapterType,
        ].filter(Boolean).join('\n'),
        metadata: { chapter: row.chapter },
      })
    }
  }

  const volumeRaw = await readOptional(join(root, STORY_VOLUME_SUMMARIES_MD))
  if (volumeRaw !== undefined) {
    for (const [index, summary] of parseVolumeSummaries(volumeRaw).entries()) {
      docs.push({
        id: `volume-summary:${index}`,
        kind: 'volume-summary',
        source: `${STORY_VOLUME_SUMMARIES_MD}#${summary.anchor}`,
        title: summary.heading,
        body: summary.content,
        metadata: { index },
      })
    }
  }

  // D22：素材仍是过渡候选，等 P6 的 materials 接管后删除。
  for (const file of await markdownFiles(join(root, STORY_ROOT, 'materials'))) {
    docs.push({
      id: `material:${relative(root, file).replaceAll('\\', '/')}`,
      kind: 'material',
      source: relative(root, file).replaceAll('\\', '/'),
      title: file.split(/[\\/]/u).at(-1) ?? 'material',
      body: (await readFile(file, 'utf8')).slice(0, 4000),
    })
  }

  return docs
}

/** 重建整个故事的检索索引，返回文档数。 */
export async function rebuildStoryIndex(root: string): Promise<{ documents: number, scope: string }> {
  const docs = await storyDocuments(root)
  const index = new LocalSearchIndex(join(root, INDEX_PATH))
  try {
    index.replaceScope(STORY_SCOPE, docs)
  } finally {
    index.close()
  }
  return { documents: docs.length, scope: STORY_SCOPE }
}

/** 重建并检索；返回命中。 */
export async function searchStory(
  root: string,
  query: string,
  options: { kinds?: ReadonlyArray<string>, limit?: number } = {},
) {
  await rebuildStoryIndex(root)
  const index = new LocalSearchIndex(join(root, INDEX_PATH))
  try {
    return index.search(query, { scope: STORY_SCOPE, ...options })
  } finally {
    index.close()
  }
}
