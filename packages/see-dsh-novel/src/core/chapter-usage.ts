/**
 * 按章用量文件：发布前记录 writer／review 的 tokenUsage，结算读取后写索引并删除。
 *
 * 它是运行时诊断，不是作品正文；文件缺失、JSON 坏或字段校验失败都按「无用量」处理，
 * 只有其它 I/O 错误会抛出。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { isTokenUsage } from './chapter-index.js'
import type { TokenUsage } from './chapter-index.js'
import { STORY_ROOT } from './story-paths.js'

const pad = (chapter: number): string => String(chapter).padStart(4, '0')

/** `source/story/runtime/chapter-NNNN.usage.json`。 */
export function chapterUsagePath(chapter: number): string {
  return `${STORY_ROOT}/runtime/chapter-${pad(chapter)}.usage.json`
}

export interface ChapterUsageFile {
  version: 1
  chapter: number
  childSessionIds: string[]
  tokenUsage: TokenUsage
  createdAt: string
}

function validFile(value: unknown, chapter: number): value is ChapterUsageFile {
  if (value === null || typeof value !== 'object') return false
  const file = value as Partial<ChapterUsageFile>
  return file.version === 1
    && file.chapter === chapter
    && Array.isArray(file.childSessionIds)
    && file.childSessionIds.length > 0
    && file.childSessionIds.every((id) => typeof id === 'string' && id !== '')
    && typeof file.createdAt === 'string'
    && isTokenUsage(file.tokenUsage)
}

/** 渲染 usage 文件内容。 */
export function renderChapterUsage(input: {
  chapter: number
  childSessionIds: ReadonlyArray<string>
  tokenUsage: TokenUsage
  createdAt: string
}): string {
  const file: ChapterUsageFile = {
    version: 1,
    chapter: input.chapter,
    childSessionIds: [...input.childSessionIds],
    tokenUsage: input.tokenUsage,
    createdAt: input.createdAt,
  }
  return `${JSON.stringify(file, null, 2)}\n`
}

/**
 * 读取本章用量；结果只用于发布时写索引。
 * @param root 作品根
 * @param chapter 章号
 * @returns 合法用量；文件缺失/坏 JSON/字段非法返回 null；其它 I/O 错误抛出
 */
export async function readChapterUsage(root: string, chapter: number): Promise<TokenUsage | null> {
  let raw: string
  try {
    raw = await readFile(join(root, chapterUsagePath(chapter)), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  return validFile(parsed, chapter) ? parsed.tokenUsage : null
}
