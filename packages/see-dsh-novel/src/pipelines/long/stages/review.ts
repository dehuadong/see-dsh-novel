/**
 * 审稿契约与编号来源：审稿要求 + 章节正文与章纲；
 * chapter-done 只复用编号来源，不带审稿要求。
 *
 * 章纲缺失或不可读时，审稿契约退化为「要求 + 章节正文」：已发布章的复审不因缺章纲
 * 被拒绝；草稿态仍由规划闸门保证有章纲。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { chapterBodyForChapter } from '../../../core/chapter-document.js'
import { loadChapterDraftSync } from '../../../core/chapter-draft.js'
import { chapterPlanPath } from '../../../core/chapter-plan.js'
import { numberSourceLines } from '../../../core/observation.js'
import type { WorkLanguage } from '../../../core/work.js'

function readText(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

function workLanguage(root: string): WorkLanguage {
  try {
    return (JSON.parse(readFileSync(join(root, 'work.json'), 'utf8')) as { language?: WorkLanguage }).language === 'en' ? 'en' : 'zh'
  } catch {
    return 'zh'
  }
}

/** 当前章的章节正文；没有章节文件时返回 undefined。 */
export function readCurrentChapterBody(root: string, chapter: number): string | undefined {
  const prefix = `${String(chapter).padStart(4, '0')}_`
  let files: string[]
  try {
    files = readdirSync(join(root, 'source/chapters'))
  } catch {
    files = []
  }
  const file = files.find((name) => name.startsWith(prefix) && name.endsWith('.md'))
  if (file !== undefined) {
    const raw = readText(join(root, 'source/chapters', file))
    if (raw !== undefined) return chapterBodyForChapter(raw, chapter)
  }
  return loadChapterDraftSync(root, chapter)?.content
}

/** 章纲 memo 正文；缺文件、解析失败或章号不符时返回 undefined。 */
function readPlanMemo(root: string, chapter: number): string | undefined {
  try {
    const parsed = JSON.parse(readFileSync(join(root, chapterPlanPath(chapter)), 'utf8')) as {
      version?: number
      intent?: { chapter?: number }
      memo?: { chapter?: number, body?: string }
    }
    if (parsed.version !== 2 || parsed.intent?.chapter !== chapter || parsed.memo?.chapter !== chapter) return undefined
    if (typeof parsed.memo.body !== 'string') return undefined
    return parsed.memo.body
  } catch {
    return undefined
  }
}

/** 章节正文的编号来源；缺正文时返回空串。 */
export function renderChapterSource(root: string, chapter: number, revisionContent?: string): string {
  const body = revisionContent ?? readCurrentChapterBody(root, chapter)
  if (body === undefined) return ''
  const language = workLanguage(root)
  const chapterLabel = language === 'en' ? `## Source chapter-${chapter}` : `## 来源 chapter-${chapter}`
  return [chapterLabel, numberSourceLines(body)].join('\n')
}

/** 章节正文与章纲的编号来源；缺正文或章纲时返回空串。 */
export function renderNumberedSources(root: string, chapter: number, revisionContent?: string): string {
  const chapterSource = renderChapterSource(root, chapter, revisionContent)
  if (chapterSource === '') return ''
  const memo = readPlanMemo(root, chapter)
  if (memo === undefined) return ''
  const language = workLanguage(root)
  const contextLabel = language === 'en' ? '## Source governed-context' : '## 来源 governed-context'
  return [chapterSource, '', contextLabel, numberSourceLines(memo)].join('\n')
}

/** 审稿要求 + 编号来源；缺正文时返回空串；缺章纲时只给正文并说明。 */
export function renderReviewContract(root: string, chapter: number, revisionContent?: string): string {
  const language = workLanguage(root)
  const chapterSource = renderChapterSource(root, chapter, revisionContent)
  if (chapterSource === '') return ''
  const requirement = language === 'en'
    ? [
        '## Review request',
        'Review this chapter using the supplied review method and governed context. Submit one observation per finding with code, assessment (issue/resolved/observation/unavailable), summary and sourceRefs. Evidence must come from the numbered sources below; cite sourceId with startLine/endLine or an exact quote. Do not estimate length; the host computes it. An empty observations array is valid. Use unavailable when comparison evidence is missing instead of calling it a prose defect.',
      ].join('\n')
    : [
        '## 审稿要求',
        '按随阶段提供的审稿方法和权威上下文审查本章。每条观察给出 code、assessment（issue／resolved／observation／unavailable）、summary 与 sourceRefs；证据只能来自下面的编号来源，用 sourceId 加 startLine／endLine 或逐字 quote 引用。不估算字数，字数由宿主计算。observations 可以为空；缺少对照证据时用 unavailable，不要写成正文缺陷。',
      ].join('\n')
  const memo = readPlanMemo(root, chapter)
  if (memo === undefined) {
    const note = language === 'en'
      ? ['## Missing chapter plan', 'The chapter plan is missing or unreadable: review the prose only, without governed-context.'].join('\n')
      : ['## 缺章纲', '本章章纲缺失或不可读：只按正文审稿，不引用 governed-context。'].join('\n')
    return [requirement, '', chapterSource, '', note].join('\n')
  }
  const contextLabel = language === 'en' ? '## Source governed-context' : '## 来源 governed-context'
  return [requirement, '', chapterSource, '', contextLabel, numberSourceLines(memo)].join('\n')
}
