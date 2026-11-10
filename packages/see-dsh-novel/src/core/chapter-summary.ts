/**
 * 章节摘要：校验七字段并写入 `chapter_summaries.json` 与 Markdown 投影。
 *
 * 摘要属于章节完成后的状态；源工程把它放在结算事务里，本项目先单独交付写入，
 * 事实与伏笔结算由后续 `chapter.settle` 接回。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { commitFoundation } from './commit.js'
import { loadChapterDocument } from './chapter-document.js'
import { loadChapterReview } from './chapter-review.js'
import { readManifestLanguage, validateChapterSummaries } from './state.js'
import { renderChapterSummariesProjection } from './state-projections.js'
import type { ChapterSummaryRow } from './state-projections.js'
import { STATE_DIR, STORY_CHAPTER_SUMMARIES_MD } from './story-paths.js'

/** 摘要相对作品根的两处落点。 */
export const CHAPTER_SUMMARIES_JSON = `${STATE_DIR}/chapter_summaries.json`

/** 七个摘要字段；顺序即投影列顺序。 */
export const SUMMARY_FIELDS = ['characters', 'events', 'stateChanges', 'hookActivity', 'mood', 'chapterType'] as const

export interface ChapterSummaryInput {
  chapter: number
  title: string
  characters: string
  events: string
  stateChanges: string
  hookActivity: string
  mood: string
  chapterType: string
}

export interface ChapterSummaryResult {
  chapter: number
  title: string
  total: number
  path: string
}

/** 字符串字段；类型不对就抛错，不让坏行进状态。 */
function text(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`${field} 必须是字符串`)
  return value
}

/** 校验并规范化一行摘要。 */
function assertRow(input: ChapterSummaryInput): ChapterSummaryRow {
  if (!Number.isInteger(input.chapter) || input.chapter < 1) throw new Error('chapter 必须是 ≥1 的整数')
  const title = typeof input.title === 'string' ? input.title.trim() : ''
  if (title === '') throw new Error('title 不能为空')
  return {
    chapter: input.chapter,
    title,
    characters: text(input.characters, 'characters'),
    events: text(input.events, 'events'),
    stateChanges: text(input.stateChanges, 'stateChanges'),
    hookActivity: text(input.hookActivity, 'hookActivity'),
    mood: text(input.mood, 'mood'),
    chapterType: text(input.chapterType, 'chapterType'),
  }
}

/** 读现有摘要表；文件缺失按空表，内容非法直接拒绝（不覆盖坏状态）。 */
async function readExistingRows(root: string): Promise<ChapterSummariesRows> {
  let raw: string
  try {
    raw = await readFile(join(root, CHAPTER_SUMMARIES_JSON), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { rows: [] }
    throw error
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`${CHAPTER_SUMMARIES_JSON} 不是合法 JSON，先修复再写摘要`)
  }
  return validateChapterSummaries(parsed)
}

interface ChapterSummariesRows {
  rows: ChapterSummaryRow[]
}

/**
 * 写一条章节摘要：同章替换、按章号排序，JSON 与投影同一次提交。
 * @param root 作品根目录
 * @param input 章号与七字段
 * @returns 章号、标题、总行数与 JSON 路径
 */
export async function writeChapterSummary(root: string, input: ChapterSummaryInput): Promise<ChapterSummaryResult> {
  const row = assertRow(input)
  if (await loadChapterDocument(root, row.chapter) === null) {
    throw new Error(`第 ${row.chapter} 章还没有正文，先写再写摘要`)
  }
  if (await loadChapterReview(root, row.chapter) === null) {
    throw new Error(`第 ${row.chapter} 章还没有审稿记录，先审再写摘要`)
  }
  const existing = await readExistingRows(root)
  const rows = [...existing.rows.filter((item) => item.chapter !== row.chapter), row]
    .sort((left, right) => left.chapter - right.chapter)
  const language = await readManifestLanguage(root) ?? 'zh'
  await commitFoundation(root, {
    writes: [
      { relativePath: CHAPTER_SUMMARIES_JSON, content: `${JSON.stringify({ rows }, null, 2)}\n` },
      { relativePath: STORY_CHAPTER_SUMMARIES_MD, content: renderChapterSummariesProjection({ rows }, language) },
    ],
  })
  return { chapter: row.chapter, title: row.title, total: rows.length, path: CHAPTER_SUMMARIES_JSON }
}
