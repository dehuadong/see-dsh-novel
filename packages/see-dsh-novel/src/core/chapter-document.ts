/**
 * 章节文档：`source/chapters/NNNN_<Title>.md`，文件头是「# 第N章 标题」。
 */
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { commitFoundation } from './commit.js'
import type { WorkLanguage } from './work.js'

const UNSAFE_TITLE = /[\u0000-\u001f/\\:*?"<>|]/g

/** 文件名安全的标题：去掉路径与非法字符，空白压成 `-`。 */
export function safeChapterTitle(title: string): string {
  const safe = title.replace(UNSAFE_TITLE, '').trim().replace(/\s+/gu, '-')
  if (safe === '') throw new Error('title 不能为空')
  return safe
}

export function chapterHeading(chapter: number, title: string, language: WorkLanguage): string {
  return language === 'en' ? `# Chapter ${chapter}: ${title}` : `# 第${chapter}章 ${title}`
}

/** 去掉正文里自带的一级标题与首尾空白。 */
export function chapterBody(content: string): string {
  const lines = content.replace(/\r\n/gu, '\n').split('\n')
  let index = 0
  while (index < lines.length && (lines[index] ?? '').trim() === '') index += 1
  if ((lines[index] ?? '').startsWith('# ')) {
    index += 1
    while (index < lines.length && (lines[index] ?? '').trim() === '') index += 1
  }
  return lines.slice(index).join('\n').trim()
}

export function renderChapterDocument(input: { chapter: number, title: string, content: string, language: WorkLanguage }): string {
  return `${chapterHeading(input.chapter, input.title, input.language)}\n\n${chapterBody(input.content)}\n`
}

/** 中文字符数或英文词数。 */
export function countChapterLength(content: string, language: WorkLanguage): number {
  if (language === 'en') return content.trim().split(/\s+/u).filter(Boolean).length
  return (content.match(/[\u3400-\u9FFF]/gu) ?? []).length
}

const pad = (chapter: number): string => String(chapter).padStart(4, '0')

export function chapterPrefix(chapter: number): string {
  return `${pad(chapter)}_`
}

export interface WriteChapterResult {
  path: string
  charCount: number
}

export async function writeChapterDocument(
  root: string,
  input: { chapter: number, title: string, content: string, language: WorkLanguage },
): Promise<WriteChapterResult> {
  const body = chapterBody(input.content)
  if (body === '') throw new Error('content 不能为空')
  const fileName = `${chapterPrefix(input.chapter)}${safeChapterTitle(input.title)}.md`
  const relativePath = `source/chapters/${fileName}`
  const entries = await readdir(join(root, 'source/chapters')).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [] as string[]
    throw error
  })
  if (entries.some((entry) => entry.startsWith(chapterPrefix(input.chapter)))) {
    throw new Error(`第 ${input.chapter} 章已经有正文，不覆盖`)
  }
  await commitFoundation(root, {
    writes: [{ relativePath, content: renderChapterDocument({ ...input, content: body }) }],
  })
  return { path: relativePath, charCount: countChapterLength(body, input.language) }
}

export interface ChapterDocument {
  path: string
  heading: string
  content: string
}

export async function loadChapterDocument(root: string, chapter: number): Promise<ChapterDocument | null> {
  let entries: string[]
  try {
    entries = await readdir(join(root, 'source/chapters'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  const file = entries.find((entry) => entry.startsWith(chapterPrefix(chapter)) && entry.endsWith('.md'))
  if (file === undefined) return null
  const relativePath = `source/chapters/${file}`
  const raw = await readFile(join(root, relativePath), 'utf8')
  const lines = raw.replace(/\r\n/gu, '\n').split('\n')
  return { path: relativePath, heading: lines[0] ?? '', content: lines.slice(1).join('\n').trim() }
}
