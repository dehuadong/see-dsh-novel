/**
 * 章节长度默认值：中文按 3000 字、英文按 2000 词。
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
