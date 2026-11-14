/**
 * governed 章纲：`chapter-XXXX.plan.json`（version 2）与 `chapter-XXXX.intent.md` 投影。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { commitFoundation } from './commit.js'
import { STORY_ROOT } from './story-paths.js'
import type { ContextPackage } from './context-package.js'

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

export function chapterPlannerContextPath(chapter: number): string {
  return `${STORY_RUNTIME_DIR}/chapter-${pad(chapter)}.planner-context.json`
}

export function chapterContextPath(chapter: number): string {
  return `${STORY_RUNTIME_DIR}/chapter-${pad(chapter)}.context.json`
}

export function chapterTracePath(chapter: number): string {
  return `${STORY_RUNTIME_DIR}/chapter-${pad(chapter)}.trace.json`
}

/** 按源 ContextPackageSchema 校验；未知字段、缺失必填、错误类型都拒绝。 */
export function parseContextPackageText(raw: string, chapter: number, label: string): ContextPackage {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`${label} 不是合法 JSON`)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${label} 必须是对象`)
  const record = parsed as Record<string, unknown>
  const keys = Object.keys(record).sort()
  if (keys.join(',') !== 'chapter,selectedContext') throw new Error(`${label} 存在未知或缺失字段：${keys.join(',')}`)
  if (!Number.isInteger(record.chapter) || (record.chapter as number) < 1) throw new Error(`${label}.chapter 必须是 ≥1 的整数`)
  if (!Array.isArray(record.selectedContext)) throw new Error(`${label}.selectedContext 必须是数组`)
  for (const [index, entry] of record.selectedContext.entries()) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`${label}.selectedContext[${index}] 必须是对象`)
    const item = entry as Record<string, unknown>
    const itemKeys = Object.keys(item).sort()
    const allowed = ['protection', 'reason', 'source', ...(Object.hasOwn(item, 'excerpt') ? ['excerpt'] : [])].sort()
    if (itemKeys.join(',') !== allowed.join(',')) throw new Error(`${label}.selectedContext[${index}] 字段不合法：${itemKeys.join(',')}`)
    if (typeof item.source !== 'string' || item.source.length === 0) throw new Error(`${label}.selectedContext[${index}].source 必须是非空字符串`)
    if (typeof item.reason !== 'string' || item.reason.length === 0) throw new Error(`${label}.selectedContext[${index}].reason 必须是非空字符串`)
    if (item.excerpt !== undefined && typeof item.excerpt !== 'string') throw new Error(`${label}.selectedContext[${index}].excerpt 必须是字符串`)
    if (item.protection !== 'protected' && item.protection !== 'compressible') throw new Error(`${label}.selectedContext[${index}].protection 不合法`)
  }
  return parsed as ContextPackage
}

function parseContextPackage(raw: string, chapter: number, label: string): ContextPackage {
  const parsed = parseContextPackageText(raw, chapter, label)
  if (parsed.chapter !== chapter) throw new Error(`${label} 的章号不是 ${chapter}`)
  return parsed
}

/** 读取 planner pass 的上下文包；缺文件返回 null。 */
export async function loadPlannerContext(root: string, chapter: number): Promise<ContextPackage | null> {
  try {
    return parseContextPackage(await readFile(join(root, chapterPlannerContextPath(chapter)), 'utf8'), chapter, 'planner-context')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

/** 写入 planner pass 的上下文包。 */
export async function savePlannerContext(root: string, chapter: number, value: ContextPackage): Promise<string> {
  const relativePath = chapterPlannerContextPath(chapter)
  await commitFoundation(root, {
    writes: [{ relativePath, content: `${JSON.stringify(value, null, 2)}\n` }],
  })
  return relativePath
}

/** 读取 writer pass 的上下文包；缺文件返回 null。 */
export async function loadWriterContext(root: string, chapter: number): Promise<ContextPackage | null> {
  try {
    return parseContextPackage(await readFile(join(root, chapterContextPath(chapter)), 'utf8'), chapter, 'context')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

/** 写入 writer pass 的上下文包与 trace。 */
export async function saveWriterContext(
  root: string,
  chapter: number,
  value: ContextPackage,
  trace: unknown,
): Promise<{ contextPath: string, tracePath: string }> {
  const contextPath = chapterContextPath(chapter)
  const tracePath = chapterTracePath(chapter)
  await commitFoundation(root, {
    writes: [
      { relativePath: contextPath, content: `${JSON.stringify(value, null, 2)}\n` },
      { relativePath: tracePath, content: `${JSON.stringify(trace, null, 2)}\n` },
    ],
  })
  return { contextPath, tracePath }
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
  const goal = input.goal
  const body = input.body
  if (goal.length === 0) throw new Error('goal 不能为空')
  if (body.length === 0) throw new Error('body 不能为空')
  if (!Array.isArray(input.threadRefs) || input.threadRefs.some((id) => typeof id !== 'string' || id.length === 0)) {
    throw new Error('threadRefs 必须是非空字符串数组')
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
      { relativePath: intentPath, content: renderIntentMarkdown(intent, memo) },
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
