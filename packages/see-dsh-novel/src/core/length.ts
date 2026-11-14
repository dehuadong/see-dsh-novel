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
