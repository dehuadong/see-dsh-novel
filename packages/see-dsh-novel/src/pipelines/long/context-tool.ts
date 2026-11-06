/**
 * `story_context_candidates` 与 `story_context_package`：模型调用 subagent 前后的两个宿主入口。
 */
import type { Disposer, ExecuteContext, JsonSchema, PluginContext, ToolDefinition } from '../../core/types.js'
import {
  assembleContext,
  buildComposerInstruction,
  collectCandidates,
  nextChapter,
  protectedContext,
} from '../../core/context-package.js'
import type { Candidate, ContextPackage, Selection } from '../../core/context-package.js'

export const CANDIDATES_NAME = 'story_context_candidates'
export const PACKAGE_NAME = 'story_context_package'

const candidatesParameters: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    query: { type: 'string', description: '本章任务目标，用于检索候选' },
    instruction: { type: 'string', description: '作者本轮的额外指令；可空' },
    limit: { type: 'integer', description: '候选上限，默认 24' },
  },
  required: ['query'],
}

const packageParameters: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    query: { type: 'string', description: '与候选相同的检索词' },
    selection: {
      type: 'object',
      additionalProperties: false,
      properties: {
        memory: { type: 'array', items: { type: 'string' } },
        role: { type: 'array', items: { type: 'string' } },
        state: { type: 'array', items: { type: 'string' } },
        outline: { type: 'array', items: { type: 'string' } },
      },
      required: ['memory', 'role', 'state', 'outline'],
    },
  },
  required: ['query', 'selection'],
}

const packageOutput: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    package: { type: 'object' },
    trace: { type: 'object' },
  },
  required: ['package', 'trace'],
}

export interface CandidatesResult {
  chapter: number
  instruction: string
  candidates: Candidate[]
}

export function installContextTools(ctx: PluginContext): Disposer {
  const candidates = ctx.tools.register({
    name: CANDIDATES_NAME,
    description: 'Collect chapter-planning candidates and the composer instruction; pass both to a subagent, then call story_context_package with its selection.',
    parameters: candidatesParameters,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          chapter: { type: 'integer' },
          instruction: { type: 'string' },
          candidates: { type: 'array', items: { type: 'object' } },
        },
        required: ['chapter', 'instruction', 'candidates'],
      },
      render: (_args: unknown, value: CandidatesResult) => [{
        type: 'text' as const,
        text: `第 ${value.chapter} 章候选 ${value.candidates.length} 条\n${value.instruction}`,
      }],
    },
    async execute(args: { query: string, instruction?: string, limit?: number }, exec: ExecuteContext): Promise<CandidatesResult> {
      if (!exec?.agent) throw new Error('story_context_candidates 需要所属 agent 会话')
      const root = await ctx.workingDirectory.ensure(exec.agent)
      const chapter = await nextChapter(root)
      return { chapter, instruction: buildComposerInstruction(chapter), candidates: await collectCandidates(root, args.query, args.limit) }
    },
  } as ToolDefinition<{ query: string, instruction?: string, limit?: number }, CandidatesResult>)

  const contextPackage = ctx.tools.register({
    name: PACKAGE_NAME,
    description: 'Validate a composer subagent selection and assemble the chapter context package with its trace.',
    parameters: packageParameters,
    output: {
      schema: packageOutput,
      render: () => [{ type: 'text' as const, text: '上下文包已组装' }],
    },
    async execute(args: { query: string, selection: Selection }, exec: ExecuteContext): Promise<{ package: ContextPackage, trace: unknown }> {
      if (!exec?.agent) throw new Error('story_context_package 需要所属 agent 会话')
      const root = await ctx.workingDirectory.ensure(exec.agent)
      const chapter = await nextChapter(root)
      const [protectedEntries, candidates] = await Promise.all([protectedContext(root), collectCandidates(root, args.query)])
      return assembleContext({ chapter, query: args.query, protectedEntries, candidates, selection: args.selection })
    },
  } as ToolDefinition<{ query: string, selection: Selection }, { package: ContextPackage, trace: unknown }>)

  return (): void => {
    contextPackage()
    candidates()
  }
}
