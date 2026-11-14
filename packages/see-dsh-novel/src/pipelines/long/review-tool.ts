/**
 * `story_review_chapter`：校验审稿观察并落盘审稿记录。
 */
import type { Disposer, ExecuteContext, JsonSchema, PluginContext, ToolDefinition } from '../../core/types.js'
import { reviewChapter } from '../../core/chapter-review.js'
import { withWorkAction } from '../../core/work-mutation.js'
import { workflowStarted, clearWorkflowStart } from '../../core/workflow-start.js'
import type { ObservationCounts, ObservationInput } from '../../core/observation.js'

export const REVIEW_NAME = 'story_review_chapter'

const parameters: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    chapter: { type: 'integer', description: '章号；草稿必须有正文与章纲，已发布章可无章纲（只按正文审）' },
    summary: { type: 'string', description: '本轮审稿的总结' },
    observations: {
      type: 'array',
      description: '每条观察：code、summary、assessment、category?、evidence?、sourceRefs?',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          code: { type: 'string' },
          summary: { type: 'string' },
          assessment: { type: 'string', enum: ['issue', 'resolved', 'unavailable', 'observation'] },
          category: { type: 'string', enum: ['quality', 'execution', 'scope'] },
          evidence: { type: 'array', items: { type: 'string' } },
          sourceRefs: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                sourceId: { type: 'string' },
                quote: { type: 'string' },
                startLine: { type: 'integer' },
                endLine: { type: 'integer' },
              },
              required: ['sourceId'],
            },
          },
        },
        required: ['code', 'summary', 'assessment'],
      },
    },
  },
  required: ['chapter', 'summary', 'observations'],
}

const output: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    chapter: { type: 'integer' },
    path: { type: 'string' },
    counts: { type: 'object' },
  },
  required: ['chapter', 'path', 'counts'],
}

export interface ReviewResult {
  chapter: number
  path: string
  counts: ObservationCounts
}

export function installReviewTool(ctx: PluginContext): Disposer {
  return ctx.tools.register({
    name: REVIEW_NAME,
    description: 'Validate evidence-backed review observations against the chapter and its plan, then persist source/story/runtime/chapter-XXXX.review.json. sourceRefs must be objects ({sourceId, quote?}, or {sourceId, startLine, endLine}) referring to the numbered sources. One review per chapter; a published chapter may be reviewed without a plan (prose only), a draft requires both prose and plan.',
    parameters,
    output: {
      schema: output,
      render: (_args: unknown, value: ReviewResult) => [{
        type: 'text' as const,
        text: `第 ${value.chapter} 章审稿已落盘：${value.path}（issue ${value.counts.issue}／resolved ${value.counts.resolved}／observation ${value.counts.observation}／unavailable ${value.counts.unavailable}）`,
      }],
    },
    async execute(args: { chapter: number, summary: string, observations: ObservationInput[] }, exec: ExecuteContext): Promise<ReviewResult> {
      if (!exec?.agent) throw new Error('story_review_chapter 需要所属 agent 会话')
      const root = await ctx.workingDirectory.ensure(exec.agent)
      return withWorkAction(root, async () => {
        if (!await workflowStarted(root, args.chapter)) throw new Error('这一章还没有作者确认的 workflow start；先由作者开始本章')
        const result = await reviewChapter(root, { chapter: args.chapter, summary: args.summary, observations: args.observations })
        try {
          await clearWorkflowStart(root)
        } catch (error) {
          return {
            chapter: args.chapter,
            path: result.path,
            counts: result.counts,
            warning: `审稿已落盘，但 workflow start 未清除：${error instanceof Error ? error.message : String(error)}`,
          } as ReviewResult & { warning: string }
        }
        return { chapter: args.chapter, path: result.path, counts: result.counts }
      })
    },
  } as ToolDefinition<{ chapter: number, summary: string, observations: ObservationInput[] }, ReviewResult>)
}
