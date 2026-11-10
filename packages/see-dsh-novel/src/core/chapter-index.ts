/**
 * `source/chapters/index.json`：章节元数据的可重建索引。
 *
 * 章节文件是正文权威；索引记录标题、字数、审稿观察与来源，定稿与删除都走
 * 同一个构建入口，避免两套章节清单。
 */
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { chapterBodyForChapter, countChapterLength } from './chapter-document.js'
import { loadChapterReview } from './chapter-review.js'
import type { Observation } from './observation.js'
import type { WorkLanguage } from './work.js'

export const CHAPTER_INDEX_PATH = 'source/chapters/index.json'

export interface ChapterIndexEntry {
  number: number
  title: string
  wordCount: number
  createdAt: string
  updatedAt: string
  observations: Observation[]
  provenance: 'generated' | 'imported' | 'edited'
}

const CHAPTER_FILE = /^(\d{4})_.*\.md$/u
const HEADING = /^#\s*(?:第\s*(\d+)\s*章|Chapter\s+(\d+)\b)[:：]?\s*(.*)$/u

/** 从章节文件头取标题；取不到就用文件名主体。 */
function titleOf(raw: string, file: string): string {
  const first = raw.replace(/\r\n/gu, '\n').split('\n').find((line) => line.trim() !== '') ?? ''
  const match = HEADING.exec(first.trim())
  if (match !== null && (match[3] ?? '').trim() !== '') return (match[3] as string).trim()
  return file.replace(/^\d{4}_/u, '').replace(/\.md$/u, '')
}

/** 列出 `chapters/` 下的章节文件；索引与版本/回收站目录不在其中。 */
export async function listChapterFiles(root: string): Promise<Array<{ chapter: number, path: string, raw: string }>> {
  let entries: string[]
  try {
    entries = await readdir(join(root, 'source/chapters'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const files: Array<{ chapter: number, path: string, raw: string }> = []
  for (const entry of entries) {
    const match = CHAPTER_FILE.exec(entry)
    if (match === null) continue
    files.push({
      chapter: Number(match[1]),
      path: `source/chapters/${entry}`,
      raw: await readFile(join(root, 'source/chapters', entry), 'utf8'),
    })
  }
  return files.sort((left, right) => left.chapter - right.chapter)
}

/** 读既有索引；缺失按空数组，坏掉拒绝覆盖。 */
export async function readChapterIndex(root: string): Promise<ChapterIndexEntry[]> {
  let raw: string
  try {
    raw = await readFile(join(root, CHAPTER_INDEX_PATH), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`${CHAPTER_INDEX_PATH} 不是合法 JSON，先修复再继续`)
  }
  if (!Array.isArray(parsed)) throw new Error(`${CHAPTER_INDEX_PATH} 必须是数组`)
  for (const [index, entry] of parsed.entries()) {
    if (entry === null || typeof entry !== 'object'
      || !Number.isInteger((entry as { number?: unknown }).number)
      || typeof (entry as { title?: unknown }).title !== 'string') {
      throw new Error(`${CHAPTER_INDEX_PATH} 第 ${index + 1} 条记录不合法`)
    }
  }
  return parsed as ChapterIndexEntry[]
}

/**
 * 按章节文件重建索引；已有记录的 createdAt 与 provenance 保留。
 * @param root 作品根目录
 * @param language 字数统计口径
 */
export async function buildChapterIndex(root: string, language: WorkLanguage): Promise<ChapterIndexEntry[]> {
  const existing = await readChapterIndex(root)
  const byChapter = new Map(existing.map((entry) => [entry.number, entry]))
  const now = new Date().toISOString()
  const entries: ChapterIndexEntry[] = []
  for (const file of await listChapterFiles(root)) {
    const body = chapterBodyForChapter(file.raw, file.chapter)
    const current = byChapter.get(file.chapter)
    entries.push({
      number: file.chapter,
      title: titleOf(file.raw, file.path.split('/').pop() ?? file.path),
      wordCount: countChapterLength(body, language),
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
      observations: (await loadChapterReview(root, file.chapter))?.observations ?? [],
      provenance: current?.provenance ?? 'generated',
    })
  }
  return entries
}
