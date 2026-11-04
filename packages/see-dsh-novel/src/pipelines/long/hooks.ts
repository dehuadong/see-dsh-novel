/**
 * 伏笔投影：把状态渲染成作者可读的 Markdown 表格。
 *
 * 同一份状态必须得到同一份文本——排序显式给出，不依赖对象插入顺序。
 */
import type { HookRecord, HooksState } from '../../core/hooks.js'

const HEADERS = {
  zh: ['hook_id', '起始章节', '类型', '状态', '最近推进', '预期回收', '备注'],
  en: ['hook_id', 'start_chapter', 'type', 'status', 'last_advanced_chapter', 'expected_payoff', 'notes'],
}

const TITLES = { zh: '# 伏笔池', en: '# Pending Hooks' }

/** 单元格里的竖线与换行会破坏表格，统一转义。 */
function cell(value: string | number): string {
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

/**
 * @param state 已校验的伏笔状态
 * @param language 表头语言
 */
export function renderHooksProjection(state: HooksState, language: 'zh' | 'en' = 'zh'): string {
  const headers = HEADERS[language]
  const rows = [...state.hooks]
    .sort((left, right) => (
      left.startChapter - right.startChapter
      || left.lastAdvancedChapter - right.lastAdvancedChapter
      || left.hookId.localeCompare(right.hookId)
    ))
    .map((hook: HookRecord) => [hook.hookId, hook.startChapter, hook.type, hook.status, hook.lastAdvancedChapter, hook.expectedPayoff, hook.notes]
      .map(cell)
      .join(' | '))

  return [
    TITLES[language],
    '',
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row} |`),
  ].join('\n')
}
