/**
 * 创意提案的校验与确认文案。
 *
 * 工具只负责把作者确认过的字段收齐、校验、拼成一张能一眼看清的卡；对话怎么收敛
 * 由技能负责，落盘由故事身份的原语负责。
 */
import { WORK_LANGUAGES } from './work.js'
import type { WorkLanguage } from './work.js'

/** 一份待确认的立项提案。 */
export interface ProposalDraft {
  title: string
  summary: string
  genre?: string
  platform?: string
  language: WorkLanguage
  targetChapters?: number
  chapterWordCount?: number
}

/** 工具参数；保持 `unknown`，校验都在这里做。 */
export interface ProposalInput {
  title?: unknown
  summary?: unknown
  genre?: unknown
  platform?: unknown
  language?: unknown
  chapters?: unknown
  chapterWords?: unknown
}

const LANGUAGE_LABEL: Record<WorkLanguage, string> = { zh: '中文', en: 'English' }

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} 必须是非空字符串`)
  }
  return value.trim()
}

function optionalText(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  return text(value, field)
}

function positiveInteger(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${field} 必须是正整数，实际是 ${JSON.stringify(value)}`)
  }
  return value
}

/**
 * 校验提案参数。
 * @param input 工具参数
 * @returns 规范化后的提案
 * @throws 字段缺失或非法时
 */
export function parseProposal(input: ProposalInput): ProposalDraft {
  const language = input.language ?? 'zh'
  if (typeof language !== 'string' || !(WORK_LANGUAGES as ReadonlyArray<string>).includes(language)) {
    throw new Error(`language 必须是 ${WORK_LANGUAGES.join('／')} 之一，实际是 ${JSON.stringify(input.language)}`)
  }
  return {
    title: text(input.title, 'title'),
    summary: text(input.summary, 'summary'),
    genre: optionalText(input.genre, 'genre'),
    platform: optionalText(input.platform, 'platform'),
    language: language as WorkLanguage,
    targetChapters: positiveInteger(input.chapters, 'chapters'),
    chapterWordCount: positiveInteger(input.chapterWords, 'chapterWords'),
  }
}

/**
 * 确认卡文案：标题、分类、语言、目标规模、摘要各一行内容，缺的字段不出现。
 * @param draft 提案
 * @returns 卡片文本
 */
export function proposalCard(draft: ProposalDraft): string {
  const scope = draft.targetChapters === undefined
    ? draft.chapterWordCount === undefined ? undefined : `单章 ${draft.chapterWordCount} 字`
    : draft.chapterWordCount === undefined
      ? `目标 ${draft.targetChapters} 章`
      : `目标 ${draft.targetChapters} 章 × 单章 ${draft.chapterWordCount} 字`
  const parts = [
    draft.genre,
    draft.platform,
    LANGUAGE_LABEL[draft.language],
    scope,
  ].filter((part): part is string => part !== undefined)
  // 标题已带书名号时不再包第二层（与 `describeWork` 同一规则）。
  const bracketed = draft.title.startsWith('《') && draft.title.endsWith('》')
  const title = bracketed ? draft.title : `《${draft.title}》`
  return `立项${title}｜${parts.join(' · ')}\n${draft.summary}`
}
