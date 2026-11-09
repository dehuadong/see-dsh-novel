/**
 * `story_context_candidates` 与 `story_context_package`：planner／writer 两次 composer pass 的宿主入口。
 */
import type { Disposer, ExecuteContext, JsonSchema, PluginContext, ToolDefinition } from '../../core/types.js'
import {
  chapterIntentPath,
  loadChapterPlan,
  savePlannerContext,
  saveWriterContext,
} from '../../core/chapter-plan.js'
import {
  assembleContext,
  buildSelectionTasks,
} from '../../core/context-package.js'
import type { ContextPackage, ContextPurpose, Selection, SelectionTask } from '../../core/context-package.js'

export const CANDIDATES_NAME = 'story_context_candidates'
export const PACKAGE_NAME = 'story_context_package'

const purposeSchema: JsonSchema = { type: 'string', enum: ['planner', 'writer'] }

const candidatesParameters: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    purpose: purposeSchema,
    instruction: { type: 'string', description: 'planner pass 的本轮作者指令；writer pass 可省略' },
    contextWindowTokens: { type: 'integer', description: '模型上下文窗口 tokens；提供时可能走 complete' },
    reservedOutputTokens: { type: 'integer', description: '为输出预留的 tokens；默认 0' },
  },
  required: ['purpose'],
}

const packageParameters: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    purpose: purposeSchema,
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
    compressedText: { type: 'string', description: '超预算时由 composer 子代理给出的压缩文本；未超预算可省略' },
    contextWindowTokens: { type: 'integer', description: '模型上下文窗口 tokens；缺失则不压缩' },
    reservedOutputTokens: { type: 'integer', description: '为输出预留的 tokens；默认 0' },
  },
  required: ['purpose', 'selection'],
}

export interface CandidatesResult {
  chapter: number
  query: string
  mode: 'semantic' | 'complete'
  tasks: SelectionTask[]
}

export function installContextTools(ctx: PluginContext): Disposer {
  const candidates = ctx.tools.register({
    name: CANDIDATES_NAME,
    description: 'Build the planner or writer context-selection tasks. Pass each task to a subagent, then call story_context_package with the four id sets.',
    parameters: candidatesParameters,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          chapter: { type: 'integer' },
          query: { type: 'string' },
          mode: { type: 'string', enum: ['semantic', 'complete'] },
          tasks: { type: 'array', items: { type: 'object' } },
        },
        required: ['chapter', 'query', 'mode', 'tasks'],
      },
      render: (_args: unknown, value: CandidatesResult) => [{
        type: 'text' as const,
        text: [
          `第 ${value.chapter} 章 ${value.mode} 选择：${value.tasks.length} 个任务`,
          ...value.tasks.map((task) => `- ${task.kind}${task.file === undefined ? '' : `（${task.file}）`}：${task.candidates.length} 条候选`),
        ].join('\n'),
      }],
    },
    async execute(args: { purpose: ContextPurpose, instruction?: string, contextWindowTokens?: number, reservedOutputTokens?: number }, exec: ExecuteContext): Promise<CandidatesResult> {
      if (!exec?.agent) throw new Error('story_context_candidates 需要所属 agent 会话')
      const root = await ctx.workingDirectory.ensure(exec.agent)
      const built = await buildSelectionTasks(root, args.purpose, {
        ...(args.instruction === undefined ? {} : { instruction: args.instruction }),
        ...(args.contextWindowTokens === undefined ? {} : { contextWindowTokens: args.contextWindowTokens }),
        ...(args.reservedOutputTokens === undefined ? {} : { reservedOutputTokens: args.reservedOutputTokens }),
      })
      return { chapter: built.chapter, query: built.query, mode: built.mode, tasks: built.tasks }
    },
  } as ToolDefinition<{ purpose: ContextPurpose, instruction?: string, contextWindowTokens?: number, reservedOutputTokens?: number }, CandidatesResult>)

  const contextPackage = ctx.tools.register({
    name: PACKAGE_NAME,
    description: 'Validate the composer selection, assemble the context package and trace, and persist the planner or writer context artifact.',
    parameters: packageParameters,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          package: { type: 'object' },
          trace: { type: 'object' },
        },
        required: ['package', 'trace'],
      },
      render: (_args: unknown, value: { package: ContextPackage, trace: unknown }) => [{
        type: 'text' as const,
        text: [
          `第 ${value.package.chapter} 章上下文：${value.package.selectedContext.length} 条`,
          ...value.package.selectedContext.map((entry) => `${entry.protection} · ${entry.source}`),
          `trace: ${JSON.stringify(value.trace)}`,
        ].join('\n'),
      }],
    },
    async execute(args: {
      purpose: ContextPurpose
      selection: Selection
      compressedText?: string
      contextWindowTokens?: number
      reservedOutputTokens?: number
    }, exec: ExecuteContext): Promise<{ package: ContextPackage, trace: unknown }> {
      if (!exec?.agent) throw new Error('story_context_package 需要所属 agent 会话')
      const root = await ctx.workingDirectory.ensure(exec.agent)
      const built = await buildSelectionTasks(root, args.purpose, {
        ...(args.contextWindowTokens === undefined ? {} : { contextWindowTokens: args.contextWindowTokens }),
        ...(args.reservedOutputTokens === undefined ? {} : { reservedOutputTokens: args.reservedOutputTokens }),
      })
      const plan = args.purpose === 'writer' ? await loadChapterPlan(root, built.chapter) : null
      if (args.purpose === 'writer' && plan === null) throw new Error(`第 ${built.chapter} 章还没有章纲，不能组装 writer 上下文`)
      const assembled = assembleContext({
        chapter: built.chapter,
        query: built.query,
        fixedEntries: built.fixedEntries,
        groups: built.groups,
        selection: args.selection,
        mode: built.mode,
        ...(plan === null ? {} : { plannerInputs: plan.plannerInputs, composerInputs: [chapterIntentPath(built.chapter)] }),
        ...(args.compressedText === undefined ? {} : { compression: { text: args.compressedText } }),
        ...(args.contextWindowTokens === undefined ? {} : { contextWindowTokens: args.contextWindowTokens }),
        ...(args.reservedOutputTokens === undefined ? {} : { reservedOutputTokens: args.reservedOutputTokens }),
      })
      if (args.purpose === 'planner') {
        assembled.trace.plannerInputs = assembled.package.selectedContext.map((entry) => entry.source)
        await savePlannerContext(root, built.chapter, assembled.package)
      } else {
        await saveWriterContext(root, built.chapter, assembled.package, assembled.trace)
      }
      return assembled
    },
  } as ToolDefinition<{ purpose: ContextPurpose, selection: Selection }, { package: ContextPackage, trace: unknown }>)

  return (): void => {
    contextPackage()
    candidates()
  }
}
