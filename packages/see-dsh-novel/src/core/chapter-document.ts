/**
 * 章节文档：`source/chapters/NNNN_<Title>.md`，文件头是「# 第N章 标题」。
 */
import { randomUUID } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { commitFoundation } from './commit.js'
import { chapterArtifactWrite } from './artifact-store.js'
import { CHAPTER_INDEX_PATH, chapterTitleOf, readChapterIndexStrict, revisedChapterIndex } from './chapter-index.js'
import { changedRegion } from './revise.js'
import type { ChangedRegion } from './revise.js'
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

/** 去掉正文里自带的一级标题与首尾空白；用于不关心章号的通用读取。 */
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

function headingNumber(line: string): number | undefined {
  const match = /^#\s*第\s*(\d+)\s*章/u.exec(line) ?? /^#\s*Chapter\s+(\d+)\b/iu.exec(line)
  if (match === null) return undefined
  return Number(match[1])
}

/**
 * 只剥掉章号等于本章的一级标题；别的章号标题保留，避免把别章文件归一成本章。
 * @param content 章节文件原文
 * @param chapter 被读的章号
 * @returns 正文
 */
export function chapterBodyForChapter(content: string, chapter: number): string {
  const lines = content.replace(/\r\n/gu, '\n').split('\n')
  let index = 0
  while (index < lines.length) {
    while (index < lines.length && (lines[index] ?? '').trim() === '') index += 1
    const line = (lines[index] ?? '').trim()
    if (!line.startsWith('# ') || headingNumber(line) !== chapter) break
    index += 1
    while (index < lines.length && (lines[index] ?? '').trim() === '') index += 1
  }
  return lines.slice(index).join('\n').trim()
}

export function renderChapterDocument(input: { chapter: number, title: string, content: string, language: WorkLanguage }): string {
  return `${chapterHeading(input.chapter, input.title, input.language)}\n\n${chapterBodyForChapter(input.content, input.chapter)}\n`
}

/** 中文字符数或英文词数。 */
export function countChapterLength(content: string, language: WorkLanguage): number {
  if (language === 'en') return content.trim().split(/\s+/u).filter(Boolean).length
  return (content.match(/[\u3400-\u9FFF]/gu) ?? []).length
}

/**
 * 人工编辑字数口径：去 frontmatter、去标题行、去空白后取字符数。
 * 只用于恢复/替换后写章节索引的 `wordCount`。
 * @param content 恢复后的正文（可含标题行）
 */
export function roughChapterLength(content: string): number {
  return content
    .replace(/^---[\s\S]*?---\s*/m, '')
    .replace(/^#{1,6}\s+.*$/gm, '')
    .replace(/\s+/g, '')
    .length
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
  const body = chapterBodyForChapter(input.content, input.chapter)
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
  const document = renderChapterDocument({ ...input, content: body })
  const artifact = await chapterArtifactWrite(root, {
    chapter: input.chapter,
    chapterPath: relativePath,
    content: document,
  })
  await commitFoundation(root, {
    writes: [
      { relativePath, content: document },
      { relativePath: artifact.relativePath, content: artifact.content },
      artifact.snapshot,
    ],
  })
  return { path: relativePath, charCount: countChapterLength(body, input.language) }
}

/** 从现有文档头取回标题；取不到就拒绝修订，避免改坏章节头。 */
function chapterTitleFromHeading(heading: string, chapter: number): string {
  const zh = new RegExp(`^#\\s*第\\s*${chapter}\\s*章\\s+(.+)$`, 'u').exec(heading)
  if (zh?.[1] !== undefined && zh[1].trim() !== '') return zh[1].trim()
  const en = new RegExp(`^#\\s*Chapter\\s+${chapter}\\s*:\\s*(.+)$`, 'iu').exec(heading)
  if (en?.[1] !== undefined && en[1].trim() !== '') return en[1].trim()
  throw new Error(`第 ${chapter} 章的文档头里没有标题，无法修订`)
}

export interface ReviseChapterResult {
  path: string
  title: string
  charCount: number
  /** 旧正文的归档路径（`source/chapters/.versions/...`）；无改动时为空串。 */
  archivedPath: string
  revisionId: string
  changed: boolean
  changedRegion: ChangedRegion
}

/**
 * 修订已有章节：覆盖同一章节文件、归档旧正文、追加一个 artifact revision，并更新章节索引。
 * 正文未变时只刷新索引，不归档、不写 revision。
 * @param root 作品根目录
 * @param input 章号、修订后的正文、语言与同批删除项
 * @returns 落盘路径、标题、字数、归档路径、revision id 与改动区域
 */
export async function reviseChapterDocument(
  root: string,
  input: {
    chapter: number
    content: string
    language: WorkLanguage
    deletes?: ReadonlyArray<string>
    /** 与该次修订同批提交的额外写入（例如重新打开的 workflow start）。 */
    extraWrites?: ReadonlyArray<{ relativePath: string, content: string }>
  },
): Promise<ReviseChapterResult> {
  const existing = await loadChapterDocument(root, input.chapter)
  if (existing === null) throw new Error(`第 ${input.chapter} 章还没有正文，先写再修订`)
  const body = chapterBodyForChapter(input.content, input.chapter)
  if (body === '') throw new Error('content 不能为空')
  const title = chapterTitleFromHeading(existing.heading, input.chapter)
  const previous = await readFile(join(root, existing.path), 'utf8')
  const changed = body !== existing.content

  const entries = await readChapterIndexStrict(root)
  const now = new Date().toISOString()
  const wordCount = countChapterLength(body, input.language)
  const nextEntries = revisedChapterIndex(entries, {
    chapter: input.chapter,
    title: chapterTitleOf(existing.heading, existing.path.split('/').pop() ?? existing.path),
    wordCount,
    language: input.language,
    now,
  })

  const writes: Array<{ relativePath: string, content: string }> = [
    { relativePath: CHAPTER_INDEX_PATH, content: `${JSON.stringify(nextEntries, null, 2)}\n` },
  ]
  let archivedPath = ''
  let revisionId = ''
  if (changed) {
    const document = renderChapterDocument({ chapter: input.chapter, title, content: body, language: input.language })
    archivedPath = `source/chapters/.versions/${String(input.chapter).padStart(4, '0')}/${Date.now()}_revision_${randomUUID()}.md`
    const artifact = await chapterArtifactWrite(root, {
      chapter: input.chapter,
      chapterPath: existing.path,
      content: document,
      previousContent: previous,
    })
    writes.push(
      { relativePath: existing.path, content: document },
      { relativePath: archivedPath, content: previous },
      { relativePath: artifact.relativePath, content: artifact.content },
      artifact.snapshot,
      ...(artifact.backfill === undefined ? [] : [artifact.backfill]),
      ...(input.extraWrites ?? []),
    )
    revisionId = artifact.artifact.currentRevisionId ?? ''
  }
  await commitFoundation(root, {
    writes,
    deletes: changed ? (input.deletes ?? []) : [],
  })
  return {
    path: existing.path,
    title,
    charCount: countChapterLength(body, input.language),
    archivedPath,
    revisionId,
    changed,
    changedRegion: changedRegion(existing.content, body),
  }
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
  return { path: relativePath, heading: lines[0] ?? '', content: chapterBodyForChapter(raw, chapter) }
}
