/**
 * 导出整本作品：txt／md／epub。
 *
 * 章节顺序以 `chapters/index.json` 为准；索引与章节文件不一致时拒绝导出。
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { readChapterIndex } from './chapter-index.js'
import { renderChapterDocument } from './chapter-document.js'
import { readWork } from './work.js'
import type { WorkLanguage } from './work.js'
import { buildZip } from './zip.js'
import type { ZipEntry } from './zip.js'

export const EXPORT_FORMATS = ['txt', 'md', 'epub'] as const
export type ExportFormat = (typeof EXPORT_FORMATS)[number]

export interface ExportSourceDetails {
  missingChapterNumbers: number[]
  duplicateChapterNumbers: number[]
  duplicateIndexNumbers: number[]
  unindexedFiles: string[]
}

export class ChapterExportSourceError extends Error {
  readonly code = 'CHAPTER_EXPORT_SOURCE_MISMATCH'
  constructor(readonly details: ExportSourceDetails) {
    super(`章节索引与章节文件不一致：${JSON.stringify(details)}。先修复索引或章节文件再导出。`)
    this.name = 'ChapterExportSourceError'
  }
}

export interface ExportResult {
  outputPath: string
  fileName: string
  chaptersExported: number
  totalWords: number
  format: ExportFormat
  byteLength: number
}

interface ChapterFile {
  chapter: number
  file: string
  raw: string
}

function chapterNumberOf(file: string): number | undefined {
  const match = /^(\d{4})_.*\.md$/u.exec(file)
  return match === null ? undefined : Number.parseInt(match[1] as string, 10)
}

/** 核对索引与文件，返回按索引顺序的章节文件。 */
async function lookupChapterFiles(root: string, indexed: ReadonlyArray<{ number: number }>): Promise<ChapterFile[]> {
  let entries: string[]
  try {
    entries = await readdir(join(root, 'source/chapters'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') entries = []
    else throw error
  }
  const indexedNumbers = new Set(indexed.map((chapter) => chapter.number))
  const duplicateIndexNumbers = [...indexedNumbers]
    .filter((number) => indexed.filter((chapter) => chapter.number === number).length > 1)
  const byNumber = new Map<number, string>()
  const duplicateChapterNumbers = new Set<number>()
  const unindexedFiles: string[] = []
  for (const file of entries.filter((name) => name.endsWith('.md')).sort()) {
    const chapter = chapterNumberOf(file)
    if (chapter === undefined || !indexedNumbers.has(chapter)) {
      unindexedFiles.push(file)
      continue
    }
    if (byNumber.has(chapter)) duplicateChapterNumbers.add(chapter)
    else byNumber.set(chapter, file)
  }
  const missingChapterNumbers = [...indexedNumbers].filter((number) => !byNumber.has(number)).sort((a, b) => a - b)
  const details: ExportSourceDetails = {
    missingChapterNumbers,
    duplicateChapterNumbers: [...duplicateChapterNumbers].sort((a, b) => a - b),
    duplicateIndexNumbers: [...new Set(duplicateIndexNumbers)].sort((a, b) => a - b),
    unindexedFiles,
  }
  if (Object.values(details).some((items) => items.length > 0)) throw new ChapterExportSourceError(details)
  const files: ChapterFile[] = []
  for (const chapter of indexed) {
    const file = byNumber.get(chapter.number) as string
    files.push({ chapter: chapter.number, file, raw: await readFile(join(root, 'source/chapters', file), 'utf8') })
  }
  return files
}

function escapeXml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

/** 把渲染后的章节文档转成 XHTML 段落；标题行不进正文。 */
function chapterHtml(document: string): string {
  return document
    .split(/\r?\n/u)
    .filter((line) => !line.startsWith('#'))
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeXml(line)}</p>`)
    .join('\n')
}

/** 渲染文档的一级标题；取不到时给一个缺省标题。 */
function renderedTitle(document: string): string {
  return /^#\s+(.+)/mu.exec(document)?.[1]?.trim() ?? 'Untitled Chapter'
}

function xhtml(title: string, body: string, lang: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE html>',
    `<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${lang}" lang="${lang}">`,
    `<head><meta charset="UTF-8"/><title>${escapeXml(title)}</title></head>`,
    '<body>',
    `<h1>${escapeXml(title)}</h1>`,
    body,
    '</body>',
    '</html>',
  ].join('\n')
}

interface RenderedChapter {
  number: number
  document: string
}

/** 导航页标题固定，不随作品语言变化。 */
const EPUB_TOC_TITLE = 'Table of Contents'

function epub(work: { id: string, title: string, language: WorkLanguage }, chapters: ReadonlyArray<RenderedChapter>): Buffer {
  const lang = work.language === 'en' ? 'en' : 'zh-CN'
  const rendered = chapters.map((chapter) => ({
    number: chapter.number,
    title: renderedTitle(chapter.document),
    html: chapterHtml(chapter.document),
  }))
  const modified = new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z')
  const entries: ZipEntry[] = []
  entries.push({ name: 'mimetype', data: Buffer.from('application/epub+zip', 'utf8') })
  entries.push({
    name: 'META-INF/container.xml',
    data: Buffer.from([
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">',
      '  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>',
      '</container>',
    ].join('\n'), 'utf8'),
  })
  const manifest = chapters.map((chapter) => `    <item id="chapter-${chapter.number}" href="chapter-${chapter.number}.xhtml" media-type="application/xhtml+xml"/>`).join('\n')
  const spine = chapters.map((chapter) => `    <itemref idref="chapter-${chapter.number}"/>`).join('\n')
  entries.push({
    name: 'OEBPS/content.opf',
    data: Buffer.from([
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="' + lang + '">',
      '  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">',
      `    <dc:identifier id="bookid">see-dsh-novel-${escapeXml(work.id)}</dc:identifier>`,
      `    <dc:title>${escapeXml(work.title)}</dc:title>`,
      `    <dc:language>${lang}</dc:language>`,
      `    <meta property="dcterms:modified">${modified}</meta>`,
      '  </metadata>',
      '  <manifest>',
      '    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
      manifest,
      '  </manifest>',
      '  <spine>',
      spine,
      '  </spine>',
      '</package>',
    ].join('\n'), 'utf8'),
  })
  const toc = rendered.map((chapter) => `      <li><a href="chapter-${chapter.number}.xhtml">${escapeXml(chapter.title)}</a></li>`).join('\n')
  entries.push({
    name: 'OEBPS/nav.xhtml',
    data: Buffer.from([
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE html>',
      '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="' + lang + '" lang="' + lang + '">',
      `<head><meta charset="UTF-8"/><title>${escapeXml(work.title)}</title></head>`,
      '<body>',
      '  <nav epub:type="toc" id="toc">',
      `    <h1>${EPUB_TOC_TITLE}</h1>`,
      '    <ol>',
      toc,
      '    </ol>',
      '  </nav>',
      '</body>',
      '</html>',
    ].join('\n'), 'utf8'),
  })
  for (const chapter of rendered) {
    entries.push({
      name: `OEBPS/chapter-${chapter.number}.xhtml`,
      data: Buffer.from(xhtml(chapter.title, chapter.html, lang), 'utf8'),
    })
  }
  return buildZip(entries)
}

/**
 * 构建整本导出（不写盘）。
 * @param root 作品根目录
 * @param format 导出格式
 */
export async function buildWorkExport(root: string, format: ExportFormat = 'txt'): Promise<{
  work: { id: string, title: string, language: WorkLanguage }
  payload: Buffer
  chaptersExported: number
  totalWords: number
  fileName: string
}> {
  if (!EXPORT_FORMATS.includes(format)) throw new Error(`导出格式必须是 ${EXPORT_FORMATS.join('／')}`)
  const work = await readWork(root)
  if (work === null) throw new Error('工作区没有 work.json，无法导出')
  const index = await readChapterIndex(root)
  if (index.length === 0) throw new Error('没有可导出的章节')
  const files = await lookupChapterFiles(root, index)
  const rendered: RenderedChapter[] = []
  for (const entry of index) {
    const file = files.find((item) => item.chapter === entry.number) as ChapterFile
    const title = entry.title
    rendered.push({
      number: entry.number,
      document: renderChapterDocument({ chapter: entry.number, title, content: file.raw, language: work.language }),
    })
  }
  const totalWords = index.reduce((sum, chapter) => sum + chapter.wordCount, 0)
  const fileName = `${work.id}.${format}`
  if (format === 'epub') {
    return { work, payload: epub(work, rendered), chaptersExported: rendered.length, totalWords, fileName }
  }
  const head = format === 'md' ? `# ${work.title}` : work.title
  const payload = Buffer.from([head, ...rendered.map((chapter) => chapter.document)].join('\n\n'), 'utf8')
  return { work, payload, chaptersExported: rendered.length, totalWords, fileName }
}

/**
 * 构建并直写导出文件：父目录补齐后覆盖目标文件。
 * @param root 作品根目录
 * @param format 导出格式
 */
export async function writeWorkExport(root: string, format: ExportFormat = 'txt'): Promise<ExportResult> {
  const built = await buildWorkExport(root, format)
  const outputPath = join(root, built.fileName)
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, built.payload)
  return {
    outputPath: join(root, built.fileName),
    fileName: built.fileName,
    chaptersExported: built.chaptersExported,
    totalWords: built.totalWords,
    format,
    byteLength: built.payload.length,
  }
}
