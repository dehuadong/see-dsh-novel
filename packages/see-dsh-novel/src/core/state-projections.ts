/**
 * 状态投影：把四份 JSON 状态渲染成作者与模型读的 Markdown。
 *
 * 三份投影共用一条规则：排序显式给出、单元格转义、末尾一个换行；同一份状态
 * 必须得到同一份文本。
 */
import type { HooksState } from './hooks.js'

/** 一条当前事实；`validUntilChapter` 为 null 表示仍然有效。 */
export interface CurrentStateFact {
  subject: string
  predicate: string
  object: string
  validFromChapter: number
  sourceChapter: number
  validUntilChapter: number | null
}

/** `current_state.json` 的形状。 */
export interface CurrentStateState {
  chapter: number
  facts: CurrentStateFact[]
}

/** `chapter_summaries.json` 的一行。 */
export interface ChapterSummaryRow {
  chapter: number
  title: string
  characters: string
  events: string
  stateChanges: string
  hookActivity: string
  mood: string
  chapterType: string
}

/** `chapter_summaries.json` 的形状。 */
export interface ChapterSummariesState {
  rows: ChapterSummaryRow[]
}

/** 支持的语言；与 manifest 的 language 一致。 */
export type ProjectionLanguage = 'zh' | 'en'

/** 单元格里的竖线、换行会破坏表格；统一转义并去首尾空白。 */
function cell(value: string | number): string {
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>').trim()
}

/** 表格正文：标题、空行、表头、分隔行、数据行、末尾空行。 */
function table(title: string, headers: ReadonlyArray<string>, rows: ReadonlyArray<ReadonlyArray<string | number>>): string {
  return [
    title,
    '',
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
    '',
  ].join('\n')
}

/** 伏笔池投影；按起始章节 → 最近推进 → id 排序。 */
export function renderHooksProjection(state: HooksState, language: ProjectionLanguage = 'zh'): string {
  if (state === null || typeof state !== 'object' || !Array.isArray(state.hooks)) {
    throw new Error('hooks 状态必须是 { hooks: [...] }')
  }
  const title = language === 'en' ? '# Pending Hooks' : '# 伏笔池'
  const headers = language === 'en'
    ? ['hook_id', 'start_chapter', 'type', 'status', 'last_advanced_chapter', 'expected_payoff', 'notes']
    : ['hook_id', '起始章节', '类型', '状态', '最近推进', '预期回收', '备注']
  const rows = [...state.hooks]
    .sort((left, right) => (
      left.startChapter - right.startChapter
      || left.lastAdvancedChapter - right.lastAdvancedChapter
      || left.hookId.localeCompare(right.hookId)
    ))
    .map((hook) => [hook.hookId, hook.startChapter, hook.type, hook.status, hook.lastAdvancedChapter, hook.expectedPayoff, hook.notes])
  return table(title, headers, rows)
}

/** 章节摘要投影；按章节号排序。 */
export function renderChapterSummariesProjection(
  state: ChapterSummariesState,
  language: ProjectionLanguage = 'zh',
): string {
  if (state === null || typeof state !== 'object' || !Array.isArray(state.rows)) {
    throw new Error('章节摘要状态必须是 { rows: [...] }')
  }
  const title = language === 'en' ? '# Chapter Summaries' : '# 章节摘要'
  const headers = language === 'en'
    ? ['Chapter', 'Title', 'Characters', 'Key Events', 'State Changes', 'Hook Activity', 'Mood', 'Chapter Type']
    : ['章节', '标题', '出场人物', '关键事件', '状态变化', '伏笔动态', '情绪基调', '章节类型']
  const rows = [...state.rows]
    .sort((left, right) => left.chapter - right.chapter)
    .map((row) => [row.chapter, row.title, row.characters, row.events, row.stateChanges, row.hookActivity, row.mood, row.chapterType])
  return table(title, headers, rows)
}

/** 当前状态投影；先过滤已失效事实，再按主体 → 关系 → 事实排序。 */
export function renderCurrentStateProjection(
  state: CurrentStateState,
  language: ProjectionLanguage = 'zh',
): string {
  if (state === null || typeof state !== 'object' || !Array.isArray(state.facts) || typeof state.chapter !== 'number') {
    throw new Error('当前状态必须是 { chapter, facts: [...] }')
  }
  const title = language === 'en' ? '# Current State' : '# 当前状态'
  const chapterLabel = language === 'en' ? 'Current chapter' : '当前章节'
  const headers = language === 'en'
    ? ['Subject', 'Predicate', 'Object', 'Valid from', 'Source chapter']
    : ['主体', '关系 / 属性', '当前事实', '生效章节', '来源章节']
  const rows = state.facts
    .filter((fact) => fact.validUntilChapter === null || fact.validUntilChapter >= state.chapter)
    .sort((left, right) => (
      left.subject.localeCompare(right.subject)
      || left.predicate.localeCompare(right.predicate)
      || left.object.localeCompare(right.object)
    ))
    .map((fact) => [fact.subject, fact.predicate, fact.object, fact.validFromChapter, fact.sourceChapter])
  return [
    title,
    '',
    `> ${chapterLabel}: ${state.chapter}`,
    '',
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
    '',
  ].join('\n')
}
