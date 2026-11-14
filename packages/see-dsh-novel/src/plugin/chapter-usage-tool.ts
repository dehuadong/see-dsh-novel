/**
 * `story_record_chapter_usage`：把本章 writer／review 直接子会话的用量记到运行时文件。
 *
 * 结算发布时读取它写索引 `tokenUsage` 并删除文件；本工具不写作品正文。
 */
import { commitFoundation } from '../core/commit.js'
import { chapterUsagePath, renderChapterUsage } from '../core/chapter-usage.js'
import { loadChapterDocument } from '../core/chapter-document.js'
import type { Disposer, ExecuteContext, JsonSchema, PluginContext, ToolDefinition } from '../core/types.js'
import { withWorkAction } from '../core/work-mutation.js'
import { readChildUsage } from './session-usage.js'
import type { TokenUsage } from '../core/chapter-index.js'

export const CHAPTER_USAGE_NAME = 'story_record_chapter_usage'

const parameters: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    chapter: { type: 'integer', description: '章号；必须是尚未发布的章' },
    childSessionIds: {
      type: 'array',
      description: '本章 writer／review 的直接子会话 id（从 story_telemetry 或委派回执取）',
      items: { type: 'string' },
    },
  },
  required: ['chapter', 'childSessionIds'],
}

const tokenUsageSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    promptTokens: { type: 'integer' },
    completionTokens: { type: 'integer' },
    totalTokens: { type: 'integer' },
  },
  required: ['promptTokens', 'completionTokens', 'totalTokens'],
}

const output: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    chapter: { type: 'integer' },
    childSessionIds: { type: 'array', items: { type: 'string' } },
    tokenUsage: tokenUsageSchema,
    path: { type: 'string' },
  },
  required: ['chapter', 'childSessionIds', 'tokenUsage', 'path'],
}

export interface ChapterUsageResult {
  chapter: number
  childSessionIds: string[]
  tokenUsage: TokenUsage
  path: string
}

export function installChapterUsageTool(ctx: PluginContext): Disposer {
  return ctx.tools.register({
    name: CHAPTER_USAGE_NAME,
    description: 'Record this chapter\'s model token usage before publishing. Pass the direct child session ids of this chapter\'s writer and review subagents (from story_telemetry); the tool sums their tokenUsage projections into prompt/completion/total, writes source/story/runtime/chapter-NNNN.usage.json, and the settlement writes the three fields into the chapter index and deletes the file.',
    parameters,
    output: {
      schema: output,
      render: (_args: unknown, value: ChapterUsageResult) => [{
        type: 'text' as const,
        text: `第 ${value.chapter} 章用量已记录：prompt ${value.tokenUsage.promptTokens}／completion ${value.tokenUsage.completionTokens}／total ${value.tokenUsage.totalTokens}（${value.childSessionIds.length} 个子会话，${value.path}）`,
      }],
    },
    async execute(args: { chapter: number, childSessionIds: string[] }, exec: ExecuteContext): Promise<ChapterUsageResult> {
      if (!exec?.agent) throw new Error('story_record_chapter_usage 需要所属 agent 会话')
      const root = await ctx.workingDirectory.ensure(exec.agent)
      return withWorkAction(root, async () => {
        if (!Number.isInteger(args.chapter) || args.chapter < 1) throw new Error('chapter 必须是 ≥1 的整数')
        const ids = args.childSessionIds
        if (!Array.isArray(ids) || ids.length === 0) throw new Error('childSessionIds 不能为空')
        if (ids.some((id) => typeof id !== 'string' || id === '')) throw new Error('childSessionIds 必须是非空字符串')
        if (new Set(ids).size !== ids.length) throw new Error('childSessionIds 不能重复')
        if (await loadChapterDocument(root, args.chapter) !== null) {
          throw new Error(`第 ${args.chapter} 章已发布；用量只在发布前记录`)
        }
        const tokenUsage = await readChildUsage(ctx, exec, ids)
        const path = chapterUsagePath(args.chapter)
        const content = renderChapterUsage({
          chapter: args.chapter,
          childSessionIds: ids,
          tokenUsage,
          createdAt: new Date().toISOString(),
        })
        await commitFoundation(root, { writes: [{ relativePath: path, content }] })
        return { chapter: args.chapter, childSessionIds: [...ids], tokenUsage, path }
      })
    },
  } as ToolDefinition<{ chapter: number, childSessionIds: string[] }, ChapterUsageResult>)
}
