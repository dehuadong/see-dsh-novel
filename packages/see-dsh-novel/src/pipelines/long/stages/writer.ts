/**
 * 写作阶段的 writer 契约：权威顺序、字数、人称、主角、规则与风格、本章章纲。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { chapterIntentPath, chapterPlanPath } from '../../../core/chapter-plan.js'
import { defaultChapterLength } from '../../../core/length.js'
import { STORY_RULES_MD, STORY_STYLE_GUIDE_MD } from '../../../core/story-paths.js'
import type { WorkLanguage } from '../../../core/work.js'

interface BookRulesLike {
  narrativePerson?: string
  protagonist?: { name: string, personalityLock: string[], behavioralConstraints: string[] }
  prohibitions?: string[]
}

interface WorkLike {
  title?: string
  language?: WorkLanguage
  metadata?: { genre?: string, platform?: string, targetChapters?: number, chapterWordCount?: number }
}

function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return undefined
  }
}

function readText(path: string): string {
  try {
    return readFileSync(path, 'utf8').trim()
  } catch {
    return ''
  }
}

function currentChapter(root: string): number {
  return readJson<{ chapter?: number }>(join(root, 'source/story/state/current_state.json'))?.chapter ?? 0
}

/** 六段 writer 契约；空段省略。 */
export function renderWriterContract(root: string): string {
  const work = readJson<WorkLike>(join(root, 'work.json')) ?? {}
  const language: WorkLanguage = work.language === 'en' ? 'en' : 'zh'
  const rules = readJson<BookRulesLike>(join(root, 'source/story/book_rules.json'))
  const chapter = currentChapter(root) + 1
  const plan = readJson<{ memo?: { goal?: string, body?: string } }>(join(root, chapterPlanPath(chapter)))
  const intent = readText(join(root, chapterIntentPath(chapter)))
  const bookRulesBody = readText(join(root, STORY_RULES_MD))
  const styleGuide = readText(join(root, STORY_STYLE_GUIDE_MD))
  const target = work.metadata?.chapterWordCount ?? defaultChapterLength(language)

  const sections: string[] = []
  if (language === 'en') {
    sections.push([
      '## Authority',
      'The current user instruction and chapter memo govern this chapter. Established facts, explicit prohibitions, selected context, and real hook ids remain binding. The outline is a fallback only when it does not conflict with higher authority. Satisfy every populated memo requirement in the prose; do not duplicate or rename an existing narrative promise.',
    ].join('\n'))
    sections.push(`## Length\nUser target: ${target} words. Preserve scene completeness instead of padding or cutting mechanically.`)
    if (rules?.narrativePerson) sections.push(`## Narrative person\n${rules.narrativePerson}; this durable constraint overrides model defaults.`)
    if (rules?.protagonist) {
      sections.push([
        '## Protagonist authority',
        `Name: ${rules.protagonist.name}`,
        `Personality: ${rules.protagonist.personalityLock.join(', ') || '(none)'}`,
        `Behavioral constraints: ${rules.protagonist.behavioralConstraints.join('; ') || '(none)'}`,
        `Book prohibitions: ${(rules.prohibitions ?? []).join('; ') || '(none)'}`,
      ].join('\n'))
    }
    if (bookRulesBody) sections.push(`## Book rules\n${bookRulesBody}`)
    if (styleGuide) sections.push(`## Style guide\n${styleGuide}`)
    if (plan?.memo?.body) sections.push(`## Chapter memo\n${intent || plan.memo.body}`)
  } else {
    sections.push([
      '## 权威顺序',
      '当前用户指令和 chapter memo 决定本章任务；既成事实、显式禁令、已选上下文和真实 hook id 必须保留。卷纲仅在无冲突时作为兜底。memo 已填写的每项要求都要在正文落地，不要为同一承诺重复开 hook，也不要改名既有叙事承诺。',
    ].join('\n'))
    sections.push(`## 字数\n用户目标：${target} 字。保持场景完整，不要机械注水或裁切。`)
    if (rules?.narrativePerson) sections.push(`## 叙事人称\n${rules.narrativePerson}；该持久约束优先于模型默认。`)
    if (rules?.protagonist) {
      sections.push([
        '## 主角权威',
        `名字：${rules.protagonist.name}`,
        `性格锁：${rules.protagonist.personalityLock.join('、') || '（无）'}`,
        `行为约束：${rules.protagonist.behavioralConstraints.join('；') || '（无）'}`,
        `本书禁忌：${(rules.prohibitions ?? []).join('；') || '（无）'}`,
      ].join('\n'))
    }
    if (bookRulesBody) sections.push(`## 本书规则\n${bookRulesBody}`)
    if (styleGuide) sections.push(`## 风格指南\n${styleGuide}`)
    if (plan?.memo?.body) sections.push(`## 本章章纲\n${intent || plan.memo.body}`)
  }
  return sections.join('\n\n')
}
