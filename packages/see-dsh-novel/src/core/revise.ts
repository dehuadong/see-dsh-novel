/**
 * 章节修订：模式与局部改动的范围校验。
 *
 * spot-fix 由子代理选原文行范围并给出每段替换文本，宿主逐段替换构造正文；
 * 范围外正文逐字节不变，不依赖 diff 对齐。
 */
export type ReviseMode = 'polish' | 'rewrite' | 'rework' | 'anti-detect' | 'spot-fix'

/** 默认模式；与源工程一致。 */
export const DEFAULT_REVISE_MODE: ReviseMode = 'rewrite'

export const REVISE_MODES: ReadonlyArray<ReviseMode> = ['polish', 'rewrite', 'rework', 'anti-detect', 'spot-fix']

/** 每种模式一句协议；与源工程的 reviser 模式说明一致。 */
export const REVISE_MODE_GUIDE: Readonly<Record<ReviseMode, string>> = {
  polish: '只改文字表面，保持事实、事件、人物和因果。',
  rewrite: '重写受影响段落；只有要求跨越整章时才重写整章。',
  rework: '可在输入权威范围内重构场景与冲突。',
  'anti-detect': '只调整文字表面，保持剧情事实和因果。',
  'spot-fix': '先选择局部请求涉及的原文行范围，再替换这些范围，保留范围外正文。',
}

/** 一段 1 基、含端点的原文行范围。 */
export interface ReviseRange {
  startLine: number
  endLine: number
}

/** 一段范围与它的替换文本；按 startLine 升序。 */
export interface RangeEdit {
  range: ReviseRange
  replacement: string
}

/** 改动区域的一侧：原文或修订后的最小连续行区。 */
export interface ChangedRegionSide {
  startLine: number
  lineCount: number
  content: string
  truncated: boolean
}

/** 修订回执的最小连续改动区域。 */
export interface ChangedRegion {
  scope: 'contiguous_changed_region'
  before: ChangedRegionSide
  after: ChangedRegionSide
}

/** 物理行，保留行终止符。 */
function splitSourceLines(source: string): string[] {
  return source.match(/[^\n]*\n|[^\n]+$/g) ?? []
}

/**
 * 找出前后文本的最小连续改动行区。
 * @param before 修订前正文
 * @param after 修订后正文
 * @param maxChars 每侧保留的最大字符数
 */
export function changedRegion(before: string, after: string, maxChars = 2000): ChangedRegion {
  const oldLines = splitSourceLines(before)
  const newLines = splitSourceLines(after)
  let start = 0
  let oldEnd = oldLines.length
  let newEnd = newLines.length
  while (start < oldEnd && start < newEnd && oldLines[start] === newLines[start]) start += 1
  while (oldEnd > start && newEnd > start && oldLines[oldEnd - 1] === newLines[newEnd - 1]) {
    oldEnd -= 1
    newEnd -= 1
  }
  const side = (lines: string[], end: number): ChangedRegionSide => {
    const content = lines.slice(start, end).join('')
    return {
      startLine: start + 1,
      lineCount: end - start,
      content: content.slice(0, maxChars),
      truncated: content.length > maxChars,
    }
  }
  return { scope: 'contiguous_changed_region', before: side(oldLines, oldEnd), after: side(newLines, newEnd) }
}

/** 范围/替换参数非法的错误码。 */
export const RANGE_EDIT_ERROR = 'ARTIFACT_EDIT_RANGE_INVALID'

/** 构造范围错误。 */
export function rangeEditError(detail: string): Error {
  return new Error(`${RANGE_EDIT_ERROR}: ${detail}`)
}

/** 正文行；空串零行，其余按 `\n` 切分。 */
export function splitBodyLines(body: string): string[] {
  return body === '' ? [] : body.split('\n')
}

/**
 * 校验并配对范围与替换文本。
 * @param ranges 声明的原文行范围，可乱序
 * @param replacements 与 ranges 一一对应的替换文本
 * @param lineCount 原文行数
 * @returns 按 startLine 升序的范围与替换
 */
export function normalizeRangeEdits(
  ranges: ReadonlyArray<ReviseRange> | undefined,
  replacements: ReadonlyArray<string> | undefined,
  lineCount: number,
): RangeEdit[] {
  if (ranges === undefined || replacements === undefined) {
    throw rangeEditError('spot-fix 需要 ranges 与 replacements')
  }
  if (!Array.isArray(ranges) || !Array.isArray(replacements)) {
    throw rangeEditError('ranges 与 replacements 必须是数组')
  }
  if (ranges.length === 0) throw rangeEditError('至少需要一段范围')
  if (ranges.length !== replacements.length) {
    throw rangeEditError('ranges 与 replacements 数量不一致')
  }
  const edits: RangeEdit[] = ranges.map((range, index) => {
    const replacement = replacements[index]
    if (typeof replacement !== 'string') throw rangeEditError(`第 ${index + 1} 段替换文本不是字符串`)
    if (
      range === null
      || typeof range !== 'object'
      || !Number.isInteger(range.startLine)
      || !Number.isInteger(range.endLine)
      || range.startLine < 1
      || range.endLine < range.startLine
      || range.endLine > lineCount
    ) {
      throw rangeEditError(`第 ${index + 1} 段范围无效（行数 ${lineCount}）`)
    }
    return { range: { startLine: range.startLine, endLine: range.endLine }, replacement }
  })
  edits.sort((left, right) => left.range.startLine - right.range.startLine)
  for (let index = 1; index < edits.length; index += 1) {
    if (edits[index]!.range.startLine <= edits[index - 1]!.range.endLine) {
      throw rangeEditError('范围不能重叠')
    }
  }
  return edits
}

/**
 * 按范围与替换文本构造新正文；空替换删除该段所有行。
 * @param body 原文正文
 * @param edits 已排序、已校验的范围与替换
 */
export function applyRangeEdits(body: string, edits: ReadonlyArray<RangeEdit>): string {
  const lines = splitBodyLines(body)
  const output: string[] = []
  let cursor = 0
  for (const edit of edits) {
    output.push(...lines.slice(cursor, edit.range.startLine - 1))
    if (edit.replacement !== '') output.push(...edit.replacement.split('\n'))
    cursor = edit.range.endLine
  }
  output.push(...lines.slice(cursor))
  return output.join('\n')
}

/**
 * 校验 `targetText` 局部修订：片段必须唯一，且片段外逐字节不变。
 * @param original 原文正文
 * @param revised 修订后的正文
 * @param targetText 被替换的唯一原文片段
 */
export function assertTargetText(original: string, revised: string, targetText: string): void {
  const start = original.indexOf(targetText)
  if (targetText === '' || start < 0) {
    throw new Error('ARTIFACT_EDIT_TARGET_NOT_FOUND: targetText 不在原文中')
  }
  if (original.indexOf(targetText, start + 1) >= 0) {
    throw new Error('ARTIFACT_EDIT_TARGET_AMBIGUOUS: targetText 在原文中出现多次')
  }
  const prefix = original.slice(0, start)
  const suffix = original.slice(start + targetText.length)
  if (
    revised.length < prefix.length + suffix.length
    || !revised.startsWith(prefix)
    || !revised.endsWith(suffix)
  ) {
    throw new Error('CHAPTER_EDIT_SCOPE_CONFLICT: 改动超出 targetText 范围')
  }
}
