/**
 * 章节修订：模式、局部改动的范围校验。
 *
 * 源工程的 spot-fix 先在原文里选行范围、再替换这些范围；DSH 这边由子代理整段
 * 返回修订正文，宿主用行级 diff 判断改动是否只有一段连续区间，保住范围外正文。
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

/** 一处连续改动：共同前缀、被替换的原文、替换文本、共同后缀。 */
export interface SingleEdit {
  prefix: string
  removed: string
  inserted: string
  suffix: string
}

/**
 * 用最长公共前缀/后缀取出一处连续改动；原文与修订一致时返回 `null`。
 * @param original 原文
 * @param revised 修订后的正文
 */
export function singleEdit(original: string, revised: string): SingleEdit | null {
  if (original === revised) return null
  let prefix = 0
  const max = Math.min(original.length, revised.length)
  while (prefix < max && original[prefix] === revised[prefix]) prefix += 1
  let suffix = 0
  while (
    suffix < original.length - prefix
    && suffix < revised.length - prefix
    && original[original.length - 1 - suffix] === revised[revised.length - 1 - suffix]
  ) {
    suffix += 1
  }
  return {
    prefix: original.slice(0, prefix),
    removed: original.slice(prefix, original.length - suffix),
    inserted: revised.slice(prefix, revised.length - suffix),
    suffix: original.slice(original.length - suffix),
  }
}

/** 行级 diff 的单元格上限；超过时不做多段判断，只保留 targetText 校验。 */
const MAX_DIFF_CELLS = 2_000_000

/**
 * 数出行级 diff 的改动块数；超过单元格上限时返回 `null`（不判断）。
 * @param originalLines 原文行
 * @param revisedLines 修订行
 */
export function changeHunks(originalLines: ReadonlyArray<string>, revisedLines: ReadonlyArray<string>): number | null {
  const n = originalLines.length
  const m = revisedLines.length
  if ((n + 1) * (m + 1) > MAX_DIFF_CELLS) return null
  const width = m + 1
  const dp = new Uint32Array((n + 1) * width)
  const cell = (index: number): number => dp[index] ?? 0
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i * width + j] = originalLines[i] === revisedLines[j]
        ? cell((i + 1) * width + j + 1) + 1
        : Math.max(cell((i + 1) * width + j), cell(i * width + j + 1))
    }
  }
  let i = 0
  let j = 0
  let hunks = 0
  let inHunk = false
  while (i < n && j < m) {
    if (originalLines[i] === revisedLines[j]) {
      inHunk = false
      i += 1
      j += 1
    } else if (cell((i + 1) * width + j) >= cell(i * width + j + 1)) {
      if (!inHunk) hunks += 1
      inHunk = true
      i += 1
    } else {
      if (!inHunk) hunks += 1
      inHunk = true
      j += 1
    }
  }
  if ((i < n || j < m) && !inHunk) hunks += 1
  return hunks
}

/**
 * 校验 spot-fix 的改动范围：只允许一段连续改动，`targetText` 必须唯一且覆盖改动。
 * @param original 原文正文
 * @param revised 修订后的正文
 * @param targetText 局部修订的原文片段；可选
 * @returns 这段连续改动
 */
export function assertSpotFix(original: string, revised: string, targetText?: string): SingleEdit {
  const edit = singleEdit(original, revised)
  if (edit === null) throw new Error('修订内容与原文一致，没有可落盘的改动')
  const lines = (text: string): string[] => text.split('\n')
  const hunks = changeHunks(lines(original), lines(revised))
  if (hunks !== null && hunks > 1) {
    throw new Error('CHAPTER_EDIT_SCOPE_CONFLICT: 局部修订出现多处改动，请只改目标段落')
  }
  if (targetText !== undefined) {
    const first = original.indexOf(targetText)
    if (first < 0) throw new Error('ARTIFACT_EDIT_TARGET_NOT_FOUND: targetText 不在原文中')
    if (original.indexOf(targetText, first + 1) >= 0) {
      throw new Error('ARTIFACT_EDIT_TARGET_AMBIGUOUS: targetText 在原文中出现多次')
    }
    const start = edit.prefix.length
    const end = original.length - edit.suffix.length
    // targetText 必须完整覆盖改动区间：片段外一个字节都不许动。
    if (first > start || first + targetText.length < end) {
      throw new Error('CHAPTER_EDIT_SCOPE_CONFLICT: 改动超出 targetText 范围')
    }
  }
  return edit
}
