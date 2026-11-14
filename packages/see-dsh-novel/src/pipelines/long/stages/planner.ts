/**
 * 规划阶段的 planner 契约：方法句、memo 请求骨架与可用 hook id。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { defaultChapterLength } from '../../../core/length.js'
import {
  AUTHOR_INTENT_FILE,
  CURRENT_FOCUS_FILE,
  STORY_EXTERNAL_BRIEF,
} from '../../../core/story-paths.js'
import type { WorkLanguage } from '../../../core/work.js'

function readText(path: string): string {
  try {
    return readFileSync(path, 'utf8').trim()
  } catch {
    return ''
  }
}

interface WorkLike {
  language?: WorkLanguage
  metadata?: { chapterWordCount?: number }
}

export function renderPlannerContract(root: string): string {
  const language: WorkLanguage = (() => {
    try {
      return (JSON.parse(readFileSync(join(root, 'work.json'), 'utf8')) as WorkLike).language === 'en' ? 'en' : 'zh'
    } catch {
      return 'zh'
    }
  })()
  const work = (() => {
    try {
      return JSON.parse(readFileSync(join(root, 'work.json'), 'utf8')) as WorkLike
    } catch {
      return {} as WorkLike
    }
  })()
  const chapter = (() => {
    try {
      return (JSON.parse(readFileSync(join(root, 'source/story/state/current_state.json'), 'utf8')) as { chapter?: number }).chapter ?? 0
    } catch {
      return 0
    }
  })()
  const next = chapter + 1
  const instruction = [STORY_EXTERNAL_BRIEF, CURRENT_FOCUS_FILE, AUTHOR_INTENT_FILE]
    .map((file) => readText(join(root, file)))
    .filter((text) => text !== '')
    .join('\n\n')
  const hooks = (() => {
    try {
      const state = JSON.parse(readFileSync(join(root, 'source/story/state/hooks.json'), 'utf8')) as { hooks?: Array<{ hookId?: string }> }
      return (state.hooks ?? []).map((hook) => hook.hookId ?? '').filter((id) => id !== '')
    } catch {
      return []
    }
  })()
  const target = work.metadata?.chapterWordCount ?? defaultChapterLength(language)

  const method = language === 'en'
    ? 'Compile the supplied governed context into one chapter memo. Do not write prose. Professional planning method comes only from the supplied craft guidance. Preserve user direction and established facts, use only supplied hook ids, and submit one concrete goal plus a readable Markdown plan.'
    : '把输入的 governed context 编译为一份章节 memo，不写正文。专业规划方法只来自随阶段提供的创作方法。保留用户方向和既成事实，只使用输入中存在的 hook id，并提交一个具体目标和完整可读的 Markdown 计划。'

  if (language === 'en') {
    const parts = ['## Planner contract', method, '', `# Chapter ${next} memo request`]
    if (instruction !== '') parts.push('', '## Current user instruction', instruction)
    parts.push('', '## Governed context', 'Use the selectedContext returned by story_context_package here.')
    parts.push('', '## Host length telemetry', `User target: ${target} words. Treat it as a creative constraint, not a host quality verdict.`)
    if (hooks.length > 0) parts.push('', '## Available hook ids', hooks.join(', '))
    return parts.join('\n')
  }
  const parts = ['## planner 契约', method, '', `# 第${next}章 memo 请求`]
  if (instruction !== '') parts.push('', '## 当前用户指令', instruction)
  parts.push('', '## 权威上下文', '把 story_context_package 返回的 selectedContext 放在这里。')
  parts.push('', '## 宿主字数遥测', `用户目标：${target} 字。这是创作约束，不是宿主质量判决。`)
  if (hooks.length > 0) parts.push('', '## 可用 hook id', hooks.join('、'))
  return parts.join('\n')
}
