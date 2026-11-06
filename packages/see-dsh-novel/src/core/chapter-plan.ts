/**
 * governed 章纲：`chapter-XXXX.plan.json`（version 2）与 `chapter-XXXX.intent.md` 投影。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { commitFoundation } from './commit.js'
import { STORY_ROOT } from './story-paths.js'

const STORY_RUNTIME_DIR = `${STORY_ROOT}/runtime`

export interface ChapterIntent { chapter: number, goal: string }
export interface ChapterMemo { chapter: number, goal: string, body: string, threadRefs: string[] }
export interface ChapterPlan {
  intent: ChapterIntent
  memo: ChapterMemo
  intentMarkdown: string
  plannerInputs: string[]
}

const pad = (chapter: number): string => String(chapter).padStart(4, '0')

export function chapterPlanPath(chapter: number): string {
  return `${STORY_RUNTIME_DIR}/chapter-${pad(chapter)}.plan.json`
}

export function chapterIntentPath(chapter: number): string {
  return `${STORY_RUNTIME_DIR}/chapter-${pad(chapter)}.intent.md`
}

/** 源格式的 intent 投影。 */
export function renderIntentMarkdown(intent: ChapterIntent, memo: ChapterMemo): string {
  const refs = memo.threadRefs.length > 0 ? memo.threadRefs.map((id) => `- ${id}`).join('\n') : '- (none)'
  return [
    '# Chapter Intent',
    '',
    '## Goal',
    intent.goal,
    '',
    '## Chapter Memo',
    '### Thread Refs',
    refs,
    '',
    '### Body',
    memo.body.trim(),
  ].join('\n')
}

export interface SaveChapterPlanInput {
  chapter: number
  goal: string
  body: string
  threadRefs: ReadonlyArray<string>
  plannerInputs?: ReadonlyArray<string>
}

/** 写入两个文件；返回作品根相对路径。调用方负责「只规划下一章」等前置校验。 */
export async function saveChapterPlan(root: string, input: SaveChapterPlanInput): Promise<{ planPath: string, intentPath: string }> {
  if (!Number.isInteger(input.chapter) || input.chapter < 1) throw new Error('chapter 必须是 ≥1 的整数')
  const goal = input.goal.trim()
  const body = input.body.trim()
  if (goal === '') throw new Error('goal 不能为空')
  if (body === '') throw new Error('body 不能为空')
  if (!Array.isArray(input.threadRefs) || input.threadRefs.some((id) => typeof id !== 'string')) {
    throw new Error('threadRefs 必须是字符串数组')
  }
  const intent: ChapterIntent = { chapter: input.chapter, goal }
  const memo: ChapterMemo = { chapter: input.chapter, goal, body, threadRefs: [...input.threadRefs] }
  const plannerInputs = [...(input.plannerInputs ?? [])]
  const planPath = chapterPlanPath(input.chapter)
  const intentPath = chapterIntentPath(input.chapter)
  const persisted = { version: 2, intent, memo, plannerInputs }
  await commitFoundation(root, {
    writes: [
      { relativePath: planPath, content: `${JSON.stringify(persisted, null, 2)}\n` },
      { relativePath: intentPath, content: `${renderIntentMarkdown(intent, memo)}\n` },
    ],
  })
  return { planPath, intentPath }
}

/** 读取章纲；identity 不一致报错，缺文件返回 null。 */
export async function loadChapterPlan(root: string, chapter: number): Promise<ChapterPlan | null> {
  let raw: string
  try {
    raw = await readFile(join(root, chapterPlanPath(chapter)), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  const persisted = JSON.parse(raw) as { version?: number, intent?: ChapterIntent, memo?: ChapterMemo, plannerInputs?: string[] }
  if (persisted.version !== 2) throw new Error(`plan version 必须是 2，实际是 ${String(persisted.version)}`)
  if (persisted.intent?.chapter !== chapter || persisted.memo?.chapter !== chapter) {
    throw new Error(`章纲章号与第 ${chapter} 章不一致`)
  }
  let intentMarkdown = persisted.memo.body
  try {
    intentMarkdown = await readFile(join(root, chapterIntentPath(chapter)), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  return {
    intent: persisted.intent,
    memo: persisted.memo,
    intentMarkdown,
    plannerInputs: persisted.plannerInputs ?? [],
  }
}
