/**
 * 审稿契约：审稿要求 + 编号原文（章节正文与章纲）。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { chapterBody } from '../../../core/chapter-document.js'
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

function currentChapter(root: string): number {
  try {
    return (JSON.parse(readFileSync(join(root, 'source/story/state/current_state.json'), 'utf8')) as { chapter?: number }).chapter ?? 0
  } catch {
    return 0
  }
}

/** 当前章的章节正文；没有章节文件时返回 undefined。 */
export function readCurrentChapterBody(root: string, chapter: number): string | undefined {
  const prefix = `${String(chapter).padStart(4, '0')}_`
  let files: string[]
  try {
    files = readdirSync(join(root, 'source/chapters'))
  } catch {
    return undefined
  }
  const file = files.find((name) => name.startsWith(prefix) && name.endsWith('.md'))
  if (file === undefined) return undefined
  const raw = readText(join(root, 'source/chapters', file))
  return raw === undefined ? undefined : chapterBody(raw)
}

/** 审稿要求 + 两块编号来源；缺正文或章纲时返回空串。 */
export function renderReviewContract(root: string): string {
  const language: WorkLanguage = (() => {
    try {
      return (JSON.parse(readFileSync(join(root, 'work.json'), 'utf8')) as { language?: WorkLanguage }).language === 'en' ? 'en' : 'zh'
    } catch {
      return 'zh'
    }
  })()
  const chapter = currentChapter(root) + 1
  const body = readCurrentChapterBody(root, chapter)
  if (body === undefined) return ''
  let memo: string | undefined
  try {
    memo = (JSON.parse(readFileSync(join(root, chapterPlanPath(chapter)), 'utf8')) as { memo?: { body?: string } }).memo?.body
  } catch {
    return ''
  }
  if (memo === undefined || memo.trim() === '') return ''
  const requirement = language === 'en'
    ? [
        '## Review request',
        'Review this chapter using the supplied review method and governed context. Submit one observation per finding with code, assessment (issue/resolved/observation/unavailable), summary and sourceRefs. Evidence must come from the numbered sources below; cite sourceId with startLine/endLine or an exact quote. Do not estimate length; the host computes it. An empty observations array is valid. Use unavailable when comparison evidence is missing instead of calling it a prose defect.',
      ].join('\n')
    : [
        '## 审稿要求',
        '按随阶段提供的审稿方法和权威上下文审查本章。每条观察给出 code、assessment（issue／resolved／observation／unavailable）、summary 与 sourceRefs；证据只能来自下面的编号来源，用 sourceId 加 startLine／endLine 或逐字 quote 引用。不估算字数，字数由宿主计算。observations 可以为空；缺少对照证据时用 unavailable，不要写成正文缺陷。',
      ].join('\n')
  const chapterLabel = language === 'en' ? `## Source chapter-${chapter}` : `## 来源 chapter-${chapter}`
  const contextLabel = language === 'en' ? '## Source governed-context' : '## 来源 governed-context'
  return [requirement, '', chapterLabel, numberSourceLines(body), '', contextLabel, numberSourceLines(memo)].join('\n')
}
