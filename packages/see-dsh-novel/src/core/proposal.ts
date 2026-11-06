/**
 * 创意提案的校验与确认文案。
 *
 * 工具只负责把作者确认过的字段收齐、校验、拼成一张能一眼看清的卡；对话怎么收敛
 * 由技能负责，落盘由故事身份的原语负责。
 */
import { bracketedTitle, WORK_LANGUAGES } from './work.js'
import type { WorkLanguage } from './work.js'

/** 一份待确认的立项提案。 */
export interface ProposalDraft {
  title: string
  summary: string
  /** 作者确认后要执行的那句话；自包含，原文进卡片与建书时的外部上下文。 */
  instruction: string
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
  instruction?: unknown
  genre?: unknown
  platform?: unknown
  language?: unknown
  chapters?: unknown
  chapterWords?: unknown
}

const LANGUAGE_LABEL: Record<WorkLanguage, string> = { zh: '中文', en: 'English' }

/** 原样字符串：只校验去空白后非空，返回原文。 */
function verbatim(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} 必须是非空字符串`)
  }
  return value
}

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
    instruction: verbatim(input.instruction, 'instruction'),
    genre: optionalText(input.genre, 'genre'),
    platform: optionalText(input.platform, 'platform'),
    language: language as WorkLanguage,
    targetChapters: positiveInteger(input.chapters, 'chapters'),
    chapterWordCount: positiveInteger(input.chapterWords, 'chapterWords'),
  }
}

/**
 * 确认卡文案：标题与分类语言规模、摘要、instruction；作者没给的规模不出现。
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
  // 标题已带书名号时不再包第二层（与身份摘要同一条规则）。
  return `立项${bracketedTitle(draft.title)}｜${parts.join(' · ')}\n${draft.summary}\n\nInstruction: ${draft.instruction}`
}
