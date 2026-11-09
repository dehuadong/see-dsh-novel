/**
 * `story_search`：章前检索的只读入口。
 */
import type { Disposer, ExecuteContext, JsonSchema, PluginContext, ToolDefinition } from '../../core/types.js'
import { searchStory } from '../../core/story-index.js'

export const SEARCH_NAME = 'story_search'

export const searchParameters: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    query: { type: 'string', description: '检索词；按 FTS5 分词与短语匹配' },
    kinds: { type: 'array', items: { type: 'string' }, description: '可选：hook/chapter-summary/volume-summary/material' },
    limit: { type: 'integer', description: '最多返回条数，1..200，默认 24' },
  },
  required: ['query'],
}

export interface SearchResult {
  hits: Array<{ source: string, kind: string, title: string, excerpt: string, score: number }>
}

export const searchOutput: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    hits: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          source: { type: 'string' },
          kind: { type: 'string' },
          title: { type: 'string' },
          excerpt: { type: 'string' },
          score: { type: 'number' },
        },
        required: ['source', 'kind', 'title', 'excerpt', 'score'],
      },
    },
  },
  required: ['hits'],
}

export function installSearchTool(ctx: PluginContext): Disposer {
  return ctx.tools.register({
    name: SEARCH_NAME,
    description: 'Search this work\'s indexed story memory (hooks, chapter summaries, volume summaries) by BM25 relevance; materials are a transitional candidate.',
    parameters: searchParameters,
    output: {
      schema: searchOutput,
      render: (_args: unknown, value: SearchResult) => [{
        type: 'text' as const,
        text: value.hits.length === 0
          ? '没有命中。'
          : value.hits.map((hit) => `${hit.kind} · ${hit.source} · ${hit.title}`).join('\n'),
      }],
    },
    async execute(args: { query: string, kinds?: string[], limit?: number }, exec: ExecuteContext): Promise<SearchResult> {
      if (!exec?.agent) throw new Error('story_search 需要所属 agent 会话')
      if (typeof args.query !== 'string' || args.query.trim() === '') throw new Error('query 必须是非空字符串')
      const root = await ctx.workingDirectory.ensure(exec.agent)
      const hits = await searchStory(root, args.query, { kinds: args.kinds, limit: args.limit })
      return {
        hits: hits.map((hit) => ({
          source: hit.source,
          kind: hit.kind,
          title: hit.title,
          excerpt: hit.body.length > 200 ? `${hit.body.slice(0, 200)}…` : hit.body,
          score: hit.score,
        })),
      }
    },
  } as ToolDefinition<{ query: string, kinds?: string[], limit?: number }, SearchResult>)
}
