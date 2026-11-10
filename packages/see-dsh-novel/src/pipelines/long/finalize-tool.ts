/**
 * `story_finalize_chapter`：写逐章快照与章节索引，并把作品推进到 active。
 */
import type { Disposer, ExecuteContext, JsonSchema, PluginContext, ToolDefinition } from '../../core/types.js'
import { finalizeChapter } from '../../core/finalize.js'
import type { FinalizeResult } from '../../core/finalize.js'
import { withWorkAction } from '../../core/work-mutation.js'

export const FINALIZE_NAME = 'story_finalize_chapter'

const parameters: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    chapter: { type: 'integer', description: '章号；必须已结算且有审稿记录' },
  },
  required: ['chapter'],
}

const output: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    chapter: { type: 'integer' },
    snapshotPath: { type: 'string' },
    status: { type: 'string', enum: ['draft', 'active', 'archived'] },
    chapters: { type: 'integer' },
  },
  required: ['chapter', 'snapshotPath', 'status', 'chapters'],
}

export function installFinalizeTool(ctx: PluginContext): Disposer {
  return ctx.tools.register({
    name: FINALIZE_NAME,
    description: 'Finalize one settled chapter: write the per-chapter snapshot under source/story/snapshots/<chapter>/ (three projections plus four state JSON files), update source/chapters/index.json, and move the work from draft to active. Requires the chapter to be reviewed and settled.',
    parameters,
    output: {
      schema: output,
      render: (_args: unknown, value: FinalizeResult) => [{
        type: 'text' as const,
        text: `第 ${value.chapter} 章已定稿：${value.snapshotPath}（共 ${value.chapters} 章，作品 ${value.status}）`,
      }],
    },
    async execute(args: { chapter: number }, exec: ExecuteContext): Promise<FinalizeResult> {
      if (!exec?.agent) throw new Error('story_finalize_chapter 需要所属 agent 会话')
      const root = await ctx.workingDirectory.ensure(exec.agent)
      return withWorkAction(root, async () => finalizeChapter(root, args.chapter))
    },
  } as ToolDefinition<{ chapter: number }, FinalizeResult>)
}
