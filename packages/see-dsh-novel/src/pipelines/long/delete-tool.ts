/**
 * `story_delete_chapter`：删除最新章并回滚到上一章。
 */
import type { Disposer, ExecuteContext, JsonSchema, PluginContext, ToolDefinition } from '../../core/types.js'
import { deleteLatestChapter } from '../../core/delete-chapter.js'
import type { DeleteChapterResult } from '../../core/delete-chapter.js'
import { withWorkAction } from '../../core/work-mutation.js'

export const DELETE_NAME = 'story_delete_chapter'

const parameters: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    chapter: { type: 'integer', description: '要删除的章号；必须是当前最新章' },
  },
  required: ['chapter'],
}

const output: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    deletedChapter: { type: 'integer' },
    title: { type: 'string' },
    trashedFiles: { type: 'array', items: { type: 'string' } },
    rolledBackTo: { type: 'integer' },
    discarded: { type: 'array', items: { type: 'integer' } },
  },
  required: ['deletedChapter', 'title', 'trashedFiles', 'rolledBackTo', 'discarded'],
}

export function installDeleteTool(ctx: PluginContext): Disposer {
  return ctx.tools.register({
    name: DELETE_NAME,
    description: 'Delete only the latest chapter: preserve its manuscript under source/chapters/.trash/, restore story state, projections, snapshots and the chapter index from the previous chapter snapshot, and drop the search index. Middle chapters are rejected.',
    parameters,
    output: {
      schema: output,
      render: (_args: unknown, value: DeleteChapterResult) => [{
        type: 'text' as const,
        text: `第 ${value.deletedChapter} 章已删除（${value.title}）：原文在 ${value.trashedFiles.join('、')}，状态回滚到第 ${value.rolledBackTo} 章`,
      }],
    },
    async execute(args: { chapter: number }, exec: ExecuteContext): Promise<DeleteChapterResult> {
      if (!exec?.agent) throw new Error('story_delete_chapter 需要所属 agent 会话')
      const root = await ctx.workingDirectory.ensure(exec.agent)
      return withWorkAction(root, async () => deleteLatestChapter(root, args.chapter))
    },
  } as ToolDefinition<{ chapter: number }, DeleteChapterResult>)
}
