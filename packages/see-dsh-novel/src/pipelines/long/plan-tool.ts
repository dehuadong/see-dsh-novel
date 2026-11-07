/**
 * `story_plan_chapter`：把本章 memo 落成 governed plan。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { Disposer, ExecuteContext, JsonSchema, PluginContext, ToolDefinition } from '../../core/types.js'
import { chapterIntentPath, chapterPlanPath, loadChapterPlan, saveChapterPlan } from '../../core/chapter-plan.js'
import {
  STORY_CHAPTER_SUMMARIES_MD,
  STORY_CURRENT_STATE_MD,
  STORY_FRAME_FILE,
  STORY_PENDING_HOOKS,
  STORY_RULES_MD,
  STORY_VOLUME_MAP_FILE,
} from '../../core/story-paths.js'

export const PLAN_NAME = 'story_plan_chapter'

const REQUIRED_FILES = [
  STORY_FRAME_FILE,
  STORY_VOLUME_MAP_FILE,
  STORY_RULES_MD,
  STORY_CURRENT_STATE_MD,
  STORY_PENDING_HOOKS,
  STORY_CHAPTER_SUMMARIES_MD,
] as const

const parameters: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    chapter: { type: 'integer', description: '要规划的第几章；必须是当前章 + 1' },
    goal: { type: 'string', description: '一个具体的章目标' },
    body: { type: 'string', description: '可读的 Markdown 章纲' },
    threadRefs: { type: 'array', items: { type: 'string' }, description: '引用到的伏笔/摘要 id' },
    plannerInputs: { type: 'array', items: { type: 'string' }, description: '上下文里实际用到的 source 列表' },
  },
  required: ['chapter', 'goal', 'body', 'threadRefs'],
}

const output: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    chapter: { type: 'integer' },
    planPath: { type: 'string' },
    intentPath: { type: 'string' },
    plannerInputs: { type: 'array', items: { type: 'string' } },
    reused: { type: 'boolean' },
  },
  required: ['chapter', 'planPath', 'intentPath', 'plannerInputs', 'reused'],
}

async function readChapter(root: string): Promise<number> {
  try {
    const raw = await readFile(join(root, 'source/story/state/current_state.json'), 'utf8')
    return (JSON.parse(raw) as { chapter?: number }).chapter ?? 0
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
    throw error
  }
}

async function assertFoundation(root: string): Promise<void> {
  const missing: string[] = []
  for (const file of REQUIRED_FILES) {
    try {
      await readFile(join(root, file), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') missing.push(file)
      else throw error
    }
  }
  if (missing.length > 0) throw new Error(`基础设定不齐，缺少：${missing.join('、')}`)
}

export interface PlanResult {
  chapter: number
  planPath: string
  intentPath: string
  plannerInputs: string[]
  reused: boolean
}

export function installPlanTool(ctx: PluginContext): Disposer {
  return ctx.tools.register({
    name: PLAN_NAME,
    description: 'Persist one chapter memo as chapter-XXXX.plan.json plus its chapter-XXXX.intent.md projection. Only the next chapter, and only after foundation is complete.',
    parameters,
    output: {
      schema: output,
      render: (_args: unknown, value: PlanResult) => [{
        type: 'text' as const,
        text: `第 ${value.chapter} 章章纲已落盘：${value.planPath}、${value.intentPath}`,
      }],
    },
    async execute(args: { chapter: number, goal: string, body: string, threadRefs: string[], plannerInputs?: string[] }, exec: ExecuteContext): Promise<PlanResult> {
      if (!exec?.agent) throw new Error('story_plan_chapter 需要所属 agent 会话')
      const root = await ctx.workingDirectory.ensure(exec.agent)
      await assertFoundation(root)
      const current = await readChapter(root)
      if (args.chapter !== current + 1) throw new Error(`只能规划第 ${current + 1} 章（当前第 ${current} 章）`)
      const existing = await loadChapterPlan(root, args.chapter)
      if (existing !== null) {
        return {
          chapter: args.chapter,
          planPath: chapterPlanPath(args.chapter),
          intentPath: chapterIntentPath(args.chapter),
          plannerInputs: existing.plannerInputs,
          reused: true,
        }
      }
      const plannerInputs = [...(args.plannerInputs ?? [])]
      const { planPath, intentPath } = await saveChapterPlan(root, {
        chapter: args.chapter,
        goal: args.goal,
        body: args.body,
        threadRefs: args.threadRefs,
        plannerInputs,
      })
      return { chapter: args.chapter, planPath: chapterPlanPath(args.chapter), intentPath, plannerInputs, reused: false }
    },
  } as ToolDefinition<{ chapter: number, goal: string, body: string, threadRefs: string[], plannerInputs?: string[] }, PlanResult>)
}
