/**
 * 章节草稿：发布前的正文只存在于 `.drafts/chapter-NNNN.md`，不进入 `source/chapters/`。
 */
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { commitFile } from './commit.js'
import {
  chapterBodyForChapter,
  countChapterLength,
  loadChapterDocument,
  renderChapterDocument,
} from './chapter-document.js'
import { chapterTitleOf } from './chapter-index.js'
import type { WorkLanguage } from './work.js'

export const DRAFT_DIR = '.drafts'

const pad = (chapter: number): string => String(chapter).padStart(4, '0')

export function draftPath(chapter: number): string {
  return `${DRAFT_DIR}/chapter-${pad(chapter)}.md`
}

export interface ChapterDraft {
  path: string
  title: string
  content: string
  charCount: number
}

function draftOf(raw: string, chapter: number, language: WorkLanguage): ChapterDraft {
  const content = chapterBodyForChapter(raw, chapter)
  const firstLine = raw.replace(/\r\n/gu, '\n').split('\n').find((line) => line.trim().startsWith('# ')) ?? ''
  return {
    path: draftPath(chapter),
    title: chapterTitleOf(firstLine, draftPath(chapter).split('/').pop() ?? draftPath(chapter)),
    content,
    charCount: countChapterLength(content, language),
  }
}

/**
 * 读草稿。
 * @param root 作品根
 * @param chapter 章号
 * @param language 作品语言
 * @returns 草稿；不存在时为 null
 */
export async function loadChapterDraft(root: string, chapter: number, language: WorkLanguage = 'zh'): Promise<ChapterDraft | null> {
  try {
    return draftOf(await readFile(join(root, draftPath(chapter)), 'utf8'), chapter, language)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

/**
 * 同步读草稿；阶段上下文是同步的。
 * @param root 作品根
 * @param chapter 章号
 * @param language 作品语言
 * @returns 草稿；不存在时为 null
 */
export function loadChapterDraftSync(root: string, chapter: number, language: WorkLanguage = 'zh'): ChapterDraft | null {
  try {
    return draftOf(readFileSync(join(root, draftPath(chapter)), 'utf8'), chapter, language)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

/**
 * 写或覆盖草稿；单文件原子提交。
 * @param root 作品根
 * @param input 章号、标题、正文与语言
 * @returns 草稿路径、标题、正文与字数
 */
export async function writeChapterDraft(
  root: string,
  input: { chapter: number, title: string, content: string, language: WorkLanguage },
): Promise<ChapterDraft> {
  const body = chapterBodyForChapter(input.content, input.chapter)
  if (body === '') throw new Error('content 不能为空')
  const document = renderChapterDocument({ ...input, content: body })
  await commitFile(root, draftPath(input.chapter), document)
  return {
    path: draftPath(input.chapter),
    title: input.title,
    content: body,
    charCount: countChapterLength(body, input.language),
  }
}

/**
 * 读正文：已发布章节优先，草稿兜底。
 * @param root 作品根
 * @param chapter 章号
 * @param language 作品语言
 * @returns 正文与来源；都没有时为 null
 */
export async function readChapterText(
  root: string,
  chapter: number,
  language: WorkLanguage = 'zh',
): Promise<{ path: string, content: string, published: boolean } | null> {
  const document = await loadChapterDocument(root, chapter)
  if (document !== null) return { path: document.path, content: document.content, published: true }
  const draft = await loadChapterDraft(root, chapter, language)
  return draft === null ? null : { path: draft.path, content: draft.content, published: false }
}
