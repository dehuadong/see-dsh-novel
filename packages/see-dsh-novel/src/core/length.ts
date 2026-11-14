/**
 * 章节长度默认值、字数口径与目标：与源长度治理模块同形的单一入口。
 */

export const DEFAULT_CHAPTER_LENGTH_ZH = 3000
export const DEFAULT_CHAPTER_LENGTH_EN = 2000

/**
 * 某语言的默认单章长度。
 * @param language 正文语言
 */
export function defaultChapterLength(language: 'zh' | 'en'): number {
  return language === 'en' ? DEFAULT_CHAPTER_LENGTH_EN : DEFAULT_CHAPTER_LENGTH_ZH
}

/** 语言对应的计数口径。 */
export function countingModeOf(language: 'zh' | 'en'): 'zh_chars' | 'en_words' {
  return language === 'en' ? 'en_words' : 'zh_chars'
}

/** 作品的目标字数：作品设置优先，否则按语言默认值。 */
export function lengthTargetOf(work: { language: 'zh' | 'en', metadata: { chapterWordCount?: number } }): number {
  return work.metadata.chapterWordCount ?? defaultChapterLength(work.language)
}

/** 去掉 frontmatter、代码围栏、标题行与分隔线；字数口径的公共前置。 */
function stripMarkdownMetadata(content: string): string {
  const lines = content.replace(/\r\n/gu, '\n').replace(/^\uFEFF/u, '').split('\n')
  const proseLines: string[] = []
  let index = 0
  if (lines[index]?.trim() === '---') {
    index += 1
    while (index < lines.length && lines[index]?.trim() !== '---') index += 1
    if (index < lines.length) index += 1
  }
  let inFence = false
  for (; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    const trimmed = line.trim()
    if (/^(```|~~~)/u.test(trimmed)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    if (/^#{1,6}\s+/u.test(trimmed)) continue
    if (trimmed === '---' || trimmed === '...') continue
    proseLines.push(line)
  }
  return proseLines.join('\n')
}

/** 按计数方式数正文：中文数全部非空白字符，英文按单词正则分词。 */
export function countChapterLengthByMode(content: string, countingMode: 'zh_chars' | 'en_words'): number {
  const normalized = stripMarkdownMetadata(content)
  if (countingMode === 'en_words') {
    const words = normalized.match(/[A-Za-z0-9]+(?:'[A-Za-z0-9]+)?/gu)
    return words?.length ?? 0
  }
  return normalized.replace(/\s+/gu, '').length
}

/** 中文字符数或英文词数。 */
export function countChapterLength(content: string, language: 'zh' | 'en'): number {
  return countChapterLengthByMode(content, countingModeOf(language))
}

/** 显式长度范围；target 只是近似值，min/max 才是硬校验。 */
export interface LengthSpec {
  target: number
  countingMode: 'zh_chars' | 'en_words'
  minChapterLength?: number
  maxChapterLength?: number
}

export interface LengthDeliveryIssue {
  code: 'CHAPTER_LENGTH_OUT_OF_RANGE'
  actual: number
  minimum?: number
  maximum?: number
}

export interface LengthDelivery {
  status: 'checks_passed' | 'needs_revision'
  measurements: { count: number, countingMode: 'zh_chars' | 'en_words' }
  target: LengthSpec
  issues: LengthDeliveryIssue[]
}

/** 按源形状构造长度 spec：target 近似、min/max 硬边界。 */
export function buildLengthSpec(
  target: number,
  language: 'zh' | 'en',
  bounds: { minChapterLength?: number, maxChapterLength?: number } = {},
): LengthSpec {
  return {
    target,
    countingMode: countingModeOf(language),
    ...(bounds.minChapterLength === undefined ? {} : { minChapterLength: bounds.minChapterLength }),
    ...(bounds.maxChapterLength === undefined ? {} : { maxChapterLength: bounds.maxChapterLength }),
  }
}

/** 从作品与章节条目解析唯一的长度 spec（target／口径／min/max）。 */
export function chapterLengthSpecOf(
  work: { language: 'zh' | 'en', metadata: { chapterWordCount?: number, minChapterLength?: number, maxChapterLength?: number } },
  entry?: { lengthTelemetry?: { target?: number, countingMode?: 'zh_chars' | 'en_words' } },
): LengthSpec {
  const target = entry?.lengthTelemetry?.target ?? lengthTargetOf(work)
  const countingMode = entry?.lengthTelemetry?.countingMode ?? countingModeOf(work.language)
  const spec = buildLengthSpec(target, work.language, {
    ...(work.metadata.minChapterLength === undefined ? {} : { minChapterLength: work.metadata.minChapterLength }),
    ...(work.metadata.maxChapterLength === undefined ? {} : { maxChapterLength: work.metadata.maxChapterLength }),
  })
  return { ...spec, countingMode }
}

/** 章节长度回执；没有显式 min/max 时返回 undefined，源也不伪造 delivery。 */
export function chapterLengthDelivery(count: number, spec: LengthSpec): LengthDelivery | undefined {
  if (spec.minChapterLength === undefined && spec.maxChapterLength === undefined) return undefined
  const issues: LengthDeliveryIssue[] = []
  if ((spec.minChapterLength !== undefined && count < spec.minChapterLength)
    || (spec.maxChapterLength !== undefined && count > spec.maxChapterLength)) {
    issues.push({
      code: 'CHAPTER_LENGTH_OUT_OF_RANGE',
      actual: count,
      ...(spec.minChapterLength === undefined ? {} : { minimum: spec.minChapterLength }),
      ...(spec.maxChapterLength === undefined ? {} : { maximum: spec.maxChapterLength }),
    })
  }
  return {
    status: issues.length > 0 ? 'needs_revision' : 'checks_passed',
    measurements: { count, countingMode: spec.countingMode },
    target: spec,
    issues,
  }
}

/** 硬长度校验；越界抛源错误码，message 带可重试的 delivery。 */
export interface LengthErrorContext {
  scope?: 'selected_ranges' | 'selected_text'
  source?: { length: number, unchangedByThisAttempt: boolean }
  replacementBudget?: ReturnType<typeof replacementBudgetOf>
  candidateCommitted?: false
  instruction?: string
}

export function assertChapterLength(content: string, spec?: LengthSpec, context: LengthErrorContext = {}): void {
  if (spec === undefined) return
  const count = countChapterLengthByMode(content, spec.countingMode)
  const delivery = chapterLengthDelivery(count, spec)
  if (delivery?.issues.length === 0 || delivery === undefined) return
  const error = new Error(JSON.stringify({
    code: 'CHAPTER_LENGTH_OUT_OF_RANGE',
    ...delivery,
    ...context,
    instruction: context.instruction ?? 'Revise the complete chapter into the explicit length range, preserving core events and causal continuity.',
  }))
  throw Object.assign(error, { code: 'CHAPTER_LENGTH_OUT_OF_RANGE', delivery, ...context })
}

/** spot-fix 固定文本预算；maximum<0 表示固定文本已超最大章长。 */
export function replacementBudgetOf(fixedLength: number, spec: LengthSpec): {
  countingMode: 'zh_chars' | 'en_words'
  fixedContentLength: number
  minimum: number
  maximum?: number
} {
  return {
    countingMode: spec.countingMode,
    fixedContentLength: fixedLength,
    minimum: Math.max(0, (spec.minChapterLength ?? 0) - fixedLength),
    ...(spec.maxChapterLength === undefined ? {} : { maximum: spec.maxChapterLength - fixedLength }),
  }
}
