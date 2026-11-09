/**
 * `story_context_candidates`／`story_context_task`／`story_context_compression_task`／
 * `story_context_package`：候选与压缩分块走 task spool，主模型只拿句柄。
 */
import type { Disposer, ExecuteContext, JsonSchema, PluginContext, ToolDefinition } from '../../core/types.js'
import type { AgentLike, LlmLike } from '../../core/types.js'
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
import type { CompressionTaskSummary, SelectionTaskHandle } from '../../core/context-spool.js'
import {
  loadCompressionChunk,
  loadSelectionTask,
  saveCompressionSpool,
  saveSelectionSpool,
} from '../../core/context-spool.js'
import type { ContextBudget, ContextPackage, ContextPurpose, Selection, SelectionTask } from '../../core/context-package.js'
import { readWork } from '../../core/work.js'

export const CANDIDATES_NAME = 'story_context_candidates'
export const TASK_NAME = 'story_context_task'
export const COMPRESSION_TASK_NAME = 'story_context_compression_task'
export const PACKAGE_NAME = 'story_context_package'

const purposeSchema: JsonSchema = { type: 'string', enum: ['planner', 'writer'] }

const candidatesParameters: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    purpose: purposeSchema,
    instruction: { type: 'string', description: 'planner pass 的本轮作者指令；writer pass 可省略' },
  },
  required: ['purpose'],
}

const taskParameters: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    purpose: purposeSchema,
    taskId: { type: 'string' },
  },
  required: ['purpose', 'taskId'],
}

const compressionTaskParameters: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    purpose: purposeSchema,
    chunkId: { type: 'string' },
  },
  required: ['purpose', 'chunkId'],
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
        storyFrame: { type: 'array', items: { type: 'string' } },
        volumeMap: { type: 'array', items: { type: 'string' } },
      },
      required: ['memory', 'role', 'state', 'storyFrame', 'volumeMap'],
    },
    instruction: { type: 'string', description: 'planner pass 的本轮作者指令；必须与 story_context_candidates 相同' },
    compressedText: { type: 'string', description: 'compressionTask 的压缩结果；未超预算可省略' },
  },
  required: ['purpose', 'selection'],
}

export interface CandidatesResult {
  chapter: number
  query: string
  mode: 'semantic' | 'complete'
  tasks: SelectionTaskHandle[]
}

export interface TaskResult {
  taskId: string
  kind: SelectionTask['kind']
  file?: string
  instruction: string
  candidates: SelectionTask['candidates']
}

export interface PackageResult {
  package?: ContextPackage
  trace?: unknown
  compressionTask?: CompressionTaskSummary
}

function requestConfig(agent: AgentLike): { provider: string, model: string, maxTokens?: number } | undefined {
  const events = agent.session.snapshotEvents()
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'request/header') continue
    const header = (event.data as { header?: { config?: { provider?: unknown, model?: unknown, maxTokens?: unknown } } } | undefined)?.header
    const config = header?.config
    if (typeof config?.provider !== 'string' || typeof config.model !== 'string') return undefined
    return {
      provider: config.provider,
      model: config.model,
      ...(typeof config.maxTokens === 'number' ? { maxTokens: config.maxTokens } : {}),
    }
  }
  return undefined
}

async function deriveBudget(ctx: PluginContext, agent: AgentLike): Promise<ContextBudget | undefined> {
  const config = requestConfig(agent)
  if (config === undefined) return undefined
  const llm = ctx.get('llm') as LlmLike | undefined
  if (llm === undefined || typeof llm.resolveModelInfo !== 'function') return undefined
  try {
    const info = await llm.resolveModelInfo(config.provider, config.model)
    const contextWindowTokens = info.context?.contextWindow
    if (typeof contextWindowTokens !== 'number' || !Number.isInteger(contextWindowTokens) || contextWindowTokens <= 0) return undefined
    return { contextWindowTokens, reservedOutputTokens: Math.max(0, config.maxTokens ?? 0) }
  } catch {
    return undefined
  }
}

function languageOf(work: Awaited<ReturnType<typeof readWork>>): 'zh' | 'en' {
  return work?.language === 'en' ? 'en' : 'zh'
}

export function installContextTools(ctx: PluginContext): Disposer {
  const candidates = ctx.tools.register({
    name: CANDIDATES_NAME,
    description: 'Build the planner or writer context-selection task spool. Returns task handles; call story_context_task to read one task at a time.',
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
          ...value.tasks.map((task) => `- ${task.taskId} · ${task.kind}${task.file === undefined ? '' : `（${task.file}）`}：${task.candidateCount} 条 / ~${task.estimatedTokens} tokens`),
        ].join('\n'),
      }],
    },
    async execute(args: { purpose: ContextPurpose, instruction?: string }, exec: ExecuteContext): Promise<CandidatesResult> {
      if (!exec?.agent) throw new Error('story_context_candidates 需要所属 agent 会话')
      const root = await ctx.workingDirectory.ensure(exec.agent)
      const { built } = await metadataFor(ctx, exec, root, args.purpose, args.instruction)
      const handles = built.mode === 'complete' ? [] : await saveSelectionSpool(root, built.chapter, args.purpose, built.tasks)
      return { chapter: built.chapter, query: built.query, mode: built.mode, tasks: handles }
    },
  } as ToolDefinition<{ purpose: ContextPurpose, instruction?: string }, CandidatesResult>)

  const task = ctx.tools.register({
    name: TASK_NAME,
    description: 'Read one context-selection task from the spool. Read one task at a time and pass it to a subagent.',
    parameters: taskParameters,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          taskId: { type: 'string' },
          kind: { type: 'string' },
          file: { type: 'string' },
          instruction: { type: 'string' },
          candidates: { type: 'array', items: { type: 'object' } },
        },
        required: ['taskId', 'kind', 'instruction', 'candidates'],
      },
      render: (_args: unknown, value: TaskResult) => [{
        type: 'text' as const,
        text: `${value.taskId} · ${value.kind}：${value.candidates.length} 条候选\n${value.instruction}`,
      }],
    },
    async execute(args: { purpose: ContextPurpose, taskId: string }, exec: ExecuteContext): Promise<TaskResult> {
      if (!exec?.agent) throw new Error('story_context_task 需要所属 agent 会话')
      const root = await ctx.workingDirectory.ensure(exec.agent)
      const selection = await loadSelectionTask(root, (await buildSelectionTasks(root, args.purpose)).chapter, args.purpose, args.taskId)
      return { taskId: args.taskId, kind: selection.kind, ...(selection.file === undefined ? {} : { file: selection.file }), instruction: selection.instruction, candidates: selection.candidates }
    },
  } as ToolDefinition<{ purpose: ContextPurpose, taskId: string }, TaskResult>)

  const compressionTask = ctx.tools.register({
    name: COMPRESSION_TASK_NAME,
    description: 'Read one compression chunk from the spool. Compress it to Markdown and merge chunks before calling story_context_package again.',
    parameters: compressionTaskParameters,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          chunkId: { type: 'string' },
          instruction: { type: 'string' },
          maxTokens: { type: 'integer' },
        },
        required: ['chunkId', 'instruction', 'maxTokens'],
      },
      render: (_args: unknown, value: { chunkId: string, instruction: string, maxTokens: number }) => [{
        type: 'text' as const,
        text: `${value.chunkId}：max ${value.maxTokens} tokens\n${value.instruction}`,
      }],
    },
    async execute(args: { purpose: ContextPurpose, chunkId: string }, exec: ExecuteContext) {
      if (!exec?.agent) throw new Error('story_context_compression_task 需要所属 agent 会话')
      const root = await ctx.workingDirectory.ensure(exec.agent)
      const chapter = (await buildSelectionTasks(root, args.purpose)).chapter
      return loadCompressionChunk(root, chapter, args.purpose, args.chunkId)
    },
  } as ToolDefinition<{ purpose: ContextPurpose, chunkId: string }, { chunkId: string, instruction: string, maxTokens: number }>)

  const contextPackage = ctx.tools.register({
    name: PACKAGE_NAME,
    description: 'Validate the composer selection, assemble the context package and trace, and persist the planner or writer context artifact. Returns compression chunk handles when the budget is exceeded.',
    parameters: packageParameters,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          package: { type: 'object' },
          trace: { type: 'object' },
          compressionTask: { type: 'object' },
        },
      },
      render: (_args: unknown, value: PackageResult) => [{
        type: 'text' as const,
        text: value.compressionTask === undefined
          ? [
              `第 ${value.package?.chapter} 章上下文：${value.package?.selectedContext.length} 条`,
              ...(value.package?.selectedContext ?? []).map((entry) => `${entry.protection} · ${entry.source}`),
              `trace: ${JSON.stringify(value.trace)}`,
            ].join('\n')
          : [
              `第 ${value.compressionTask.chapter} 章需要压缩：${value.compressionTask.chunks.length} 个分块`,
              `maxInputTokens: ${value.compressionTask.maxInputTokens}`,
              ...value.compressionTask.chunks.map((chunk) => `- ${chunk.chunkId}: ${chunk.maxTokens} tokens（${chunk.file}）`),
            ].join('\n'),
      }],
    },
    async execute(args: {
      purpose: ContextPurpose
      selection: Selection
      instruction?: string
      compressedText?: string
    }, exec: ExecuteContext): Promise<PackageResult> {
      if (!exec?.agent) throw new Error('story_context_package 需要所属 agent 会话')
      const root = await ctx.workingDirectory.ensure(exec.agent)
      const { built, plan, work, budget } = await metadataFor(ctx, exec, root, args.purpose, args.instruction)
      const assembled = assembleContext({
        chapter: built.chapter,
        query: built.query,
        fixedEntries: built.fixedEntries,
        groups: built.groups,
        selection: args.selection,
        mode: built.mode,
        ...(budget === undefined ? {} : { budget }),
        language: languageOf(work),
        ...(plan === null ? {} : { plannerInputs: plan.plannerInputs, composerInputs: [chapterIntentPath(built.chapter)] }),
        ...(args.compressedText === undefined ? {} : { compression: { text: args.compressedText } }),
      })
      if (assembled.compressionTask !== undefined) {
        const summary = await saveCompressionSpool(root, built.chapter, args.purpose, assembled.compressionTask)
        return { compressionTask: summary }
      }
      if (assembled.package === undefined || assembled.trace === undefined) throw new Error('上下文 package 与 trace 缺失')
      if (args.purpose === 'planner') {
        assembled.trace.plannerInputs = assembled.package.selectedContext.map((entry) => entry.source)
        await savePlannerContext(root, built.chapter, assembled.package)
      } else {
        await saveWriterContext(root, built.chapter, assembled.package, assembled.trace)
      }
      return { package: assembled.package, trace: assembled.trace }
    },
  } as ToolDefinition<{ purpose: ContextPurpose, selection: Selection, instruction?: string, compressedText?: string }, PackageResult>)

  return (): void => {
    contextPackage()
    candidates()
    task()
    compressionTask()
  }
}

async function metadataFor(
  ctx: PluginContext,
  exec: ExecuteContext,
  root: string,
  purpose: ContextPurpose,
  instruction?: string,
): Promise<{
  built: Awaited<ReturnType<typeof buildSelectionTasks>>
  plan: Awaited<ReturnType<typeof loadChapterPlan>>
  work: Awaited<ReturnType<typeof readWork>>
  budget: ContextBudget | undefined
}> {
  const budget = await deriveBudget(ctx, exec.agent!)
  const built = await buildSelectionTasks(root, purpose, {
    ...(instruction === undefined ? {} : { instruction }),
    ...(budget === undefined ? {} : { budget }),
  })
  const plan = purpose === 'writer' ? await loadChapterPlan(root, built.chapter) : null
  if (purpose === 'writer' && plan === null) throw new Error(`第 ${built.chapter} 章还没有章纲，不能做 writer 上下文选择`)
  const work = await readWork(root)
  return { built, plan, work, budget }
}
