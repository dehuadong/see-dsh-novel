/**
 * `story_summarize_chapter`：把 settler 子代理产出的七字段摘要落成章节摘要。
 */
import type { Disposer, ExecuteContext, JsonSchema, PluginContext, ToolDefinition } from '../../core/types.js'
import { SUMMARY_FIELDS, writeChapterSummary } from '../../core/chapter-summary.js'
import type { ChapterSummaryResult } from '../../core/chapter-summary.js'
import { withWorkAction } from '../../core/work-mutation.js'

export const SUMMARY_NAME = 'story_summarize_chapter'

const summaryParameters: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string', description: '本章标题（与章节文档头一致）' },
    characters: { type: 'string', description: '本章出场人物' },
    events: { type: 'string', description: '本章发生的事件' },
    stateChanges: { type: 'string', description: '本章改变了哪些状态' },
    hookActivity: { type: 'string', description: '伏笔的推进、提及或回收' },
    mood: { type: 'string', description: '本章情绪基调' },
    chapterType: { type: 'string', description: '章节类型（如 advancement／resolution）' },
  },
  required: ['title', ...SUMMARY_FIELDS],
}

const parameters: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    chapter: { type: 'integer', description: '章号；必须已有正文与审稿记录' },
    summary: summaryParameters,
  },
  required: ['chapter', 'summary'],
}

const output: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    chapter: { type: 'integer' },
    title: { type: 'string' },
    total: { type: 'integer' },
    path: { type: 'string' },
  },
  required: ['chapter', 'title', 'total', 'path'],
}

export function installSummaryTool(ctx: PluginContext): Disposer {
  return ctx.tools.register({
    name: SUMMARY_NAME,
    description: 'Persist one structured chapter summary (title, characters, events, stateChanges, hookActivity, mood, chapterType) into source/story/state/chapter_summaries.json and its Markdown projection. Requires the chapter and its review to exist; re-summarizing the same chapter replaces its row.',
    parameters,
    output: {
      schema: output,
      render: (_args: unknown, value: ChapterSummaryResult) => [{
        type: 'text' as const,
        text: `第 ${value.chapter} 章摘要已落盘：${value.title}（共 ${value.total} 条）`,
      }],
    },
    async execute(
      args: { chapter: number, summary: Record<string, string> },
      exec: ExecuteContext,
    ): Promise<ChapterSummaryResult> {
      if (!exec?.agent) throw new Error('story_summarize_chapter 需要所属 agent 会话')
      const root = await ctx.workingDirectory.ensure(exec.agent)
      return withWorkAction(root, async () => writeChapterSummary(root, {
        chapter: args.chapter,
        title: String(args.summary.title ?? ''),
        characters: String(args.summary.characters ?? ''),
        events: String(args.summary.events ?? ''),
        stateChanges: String(args.summary.stateChanges ?? ''),
        hookActivity: String(args.summary.hookActivity ?? ''),
        mood: String(args.summary.mood ?? ''),
        chapterType: String(args.summary.chapterType ?? ''),
      }))
    },
  } as ToolDefinition<{ chapter: number, summary: Record<string, string> }, ChapterSummaryResult>)
}
