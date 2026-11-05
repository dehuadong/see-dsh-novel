/**
 * `story_telemetry`：把这一棵子代理树读成一份委派回执。
 *
 * 只读：数据全在会话里——父会话目录给出子会话，子会话的投影给出用量、耗时
 * 与最近一轮是否正常收尾。不写文件、不监听事件，作用域就是调用它的会话。
 */
import type {
  Disposer,
  ExecuteContext,
  JsonSchema,
  PluginContext,
  SessionObservationLike,
  SessionQueryLike,
  SubagentRowLike,
  SubagentsLike,
  ToolDefinition,
} from '../core/types.js'

/** 工具名；注册与测试共用。 */
export const TELEMETRY_NAME = 'story_telemetry'

/** 默认与上限：一次只回最近若干笔，避免会话树很大时把回执撑爆。 */
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 200

/** 一笔委派的四种可判定状态。 */
export type DelegationState = 'completed' | 'incomplete' | 'running' | 'unknown'

/** `tokenUsage` 投影的四个互不重叠的桶。 */
export interface UsageBuckets {
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

/** 一笔委派。 */
export interface Delegation {
  childSessionId: string
  label: string | null
  mode: string
  depth: number
  state: DelegationState
  durationMs: number | null
  usage: UsageBuckets | null
}

/** 一条目录诊断：这个分支读不通，不是一笔委派。 */
export interface Diagnostic {
  childSessionId: string
  reason: string
}

/** 回执：合计只覆盖返回的这些行。 */
export interface TelemetryResult {
  summary: {
    delegations: number
    incomplete: number
    diagnostics: number
    partial: number
    durationMs: number
    usage: UsageBuckets
  }
  delegations: Delegation[]
  diagnostics: Diagnostic[]
}

/** `tokenUsage` 投影在本行关心的形状。 */
interface TokenUsageProjection {
  uncachedInputTokens?: unknown
  outputTokens?: unknown
  cacheReadTokens?: unknown
  cacheWriteTokens?: unknown
}

/** `subagentTiming` 投影在本行关心的形状。 */
interface TimingProjection {
  settledMs?: unknown
  active?: { since?: unknown; through?: unknown } | undefined
  lastTurnCompleted?: unknown
}

const usageSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    uncachedInputTokens: { type: 'integer' },
    outputTokens: { type: 'integer' },
    cacheReadTokens: { type: 'integer' },
    cacheWriteTokens: { type: 'integer' },
  },
  required: ['uncachedInputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'],
}

const nullableUsage: JsonSchema = { oneOf: [usageSchema, { type: 'null' }] }

/** 参数：只暴露一个分页上限。 */
export const telemetryParameters: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    limit: { type: 'integer', description: `最近多少笔委派，默认 ${DEFAULT_LIMIT}，上限 ${MAX_LIMIT}` },
  },
  required: [],
}

/** 返回值结构。 */
export const telemetryOutput: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: {
      type: 'object',
      additionalProperties: false,
      properties: {
        delegations: { type: 'integer' },
        incomplete: { type: 'integer' },
        diagnostics: { type: 'integer' },
        partial: { type: 'integer' },
        durationMs: { type: 'integer' },
        usage: usageSchema,
      },
      required: ['delegations', 'incomplete', 'diagnostics', 'partial', 'durationMs', 'usage'],
    },
    delegations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          childSessionId: { type: 'string' },
          label: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          mode: { type: 'string' },
          depth: { type: 'integer' },
          state: { type: 'string', enum: ['completed', 'incomplete', 'running', 'unknown'] },
          durationMs: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
          usage: nullableUsage,
        },
        required: ['childSessionId', 'label', 'mode', 'depth', 'state', 'durationMs', 'usage'],
      },
    },
    diagnostics: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          childSessionId: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['childSessionId', 'reason'],
      },
    },
  },
  required: ['summary', 'delegations', 'diagnostics'],
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** 读四个桶；任一不是数字就当整份用量不可得。 */
function usageOf(value: unknown): UsageBuckets | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const projection = value as TokenUsageProjection
  const buckets = {
    uncachedInputTokens: finite(projection.uncachedInputTokens),
    outputTokens: finite(projection.outputTokens),
    cacheReadTokens: finite(projection.cacheReadTokens),
    cacheWriteTokens: finite(projection.cacheWriteTokens),
  }
  if (Object.values(buckets).some((bucket) => bucket === undefined)) return undefined
  return buckets as UsageBuckets
}

/** 耗时（可能为 null）与两个状态信号；状态判断不依赖耗时是否可读。 */
function timingOf(value: unknown): { durationMs: number | null, lastTurnCompleted: boolean | undefined, openTurn: boolean } | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const projection = value as TimingProjection
  const settled = finite(projection.settledMs)
  const since = finite(projection.active?.since)
  const through = finite(projection.active?.through)
  const openTurn = since !== undefined && through !== undefined && through >= since
  const completed = typeof projection.lastTurnCompleted === 'boolean' ? projection.lastTurnCompleted : undefined
  const durationMs = settled === undefined ? null : settled + (openTurn ? (through as number) - (since as number) : 0)
  return { durationMs, lastTurnCompleted: completed, openTurn }
}

/** 状态判定：驻留 + 未闭合轮次才算在跑；否则看最近一轮是否正常收尾。 */
function stateOf(row: SubagentRowLike, timing: ReturnType<typeof timingOf>): DelegationState {
  if (row.activity === 'running' && timing?.openTurn === true) return 'running'
  if (timing?.lastTurnCompleted === true) return 'completed'
  if (timing?.lastTurnCompleted === false) return 'incomplete'
  return 'unknown'
}

function limitOf(value: unknown): number {
  if (value === undefined) return DEFAULT_LIMIT
  const limit = finite(value)
  if (limit === undefined || !Number.isInteger(limit) || limit <= 0) {
    throw new Error(`limit 必须是正整数，实际是 ${JSON.stringify(value)}`)
  }
  return Math.min(limit, MAX_LIMIT)
}

/** 宿主把释放方法挂在 `[Symbol.dispose]` 上（`SessionObservation extends Disposable`）。 */
const SYMBOL_DISPOSE = (Symbol as unknown as { dispose?: symbol }).dispose

/** 释放一份观察；宿主只提供 `[Symbol.dispose]`，没有这个符号就什么都不做。 */
function release(observation: SessionObservationLike): void {
  if (SYMBOL_DISPOSE === undefined) return
  const dispose = (observation as Record<symbol, unknown>)[SYMBOL_DISPOSE]
  if (typeof dispose === 'function') (dispose as () => void).call(observation)
}

/**
 * 读出一棵子代理树的委派回执。
 * @param ctx 插件上下文：只用到可选服务
 * @param exec 本次调用；需要所属 agent 才能定位根会话
 * @param args 分页参数
 * @returns 回执
 */
export async function readTelemetry(
  ctx: PluginContext,
  exec: ExecuteContext,
  args: { limit?: unknown },
): Promise<TelemetryResult> {
  const subagents = ctx.get('subagents') as SubagentsLike | undefined
  if (subagents === undefined) throw new Error('story_telemetry 需要宿主的 subagents 服务')
  const sessionQuery = ctx.get('sessionQuery') as SessionQueryLike | undefined
  if (sessionQuery === undefined) throw new Error('story_telemetry 需要宿主的 sessionQuery 服务')
  const rootSessionId = exec.agent?.session.id
  if (rootSessionId === undefined) throw new Error('story_telemetry 需要所属 agent 会话')

  const limit = limitOf(args.limit)
  const rows = await subagents.listDescendants(rootSessionId, exec.signal)
  const children = rows.filter((row) => row.kind === 'child')
  const diagnostics: Diagnostic[] = rows
    .filter((row) => row.kind === 'diagnostic')
    .map((row) => ({
      childSessionId: row.id,
      // 宿主只会给三个值；缺省说明目录本身坏了，按「读不到」记。
      reason: typeof row.reason === 'string' ? row.reason : 'unavailable',
    }))
  const selected = children.slice(Math.max(0, children.length - limit))

  const delegations: Delegation[] = []
  for (const row of selected) {
    if (typeof row.mode !== 'string' || typeof row.depth !== 'number') {
      // 宿主的 child 行一定带 mode/depth；缺了说明这一行不完整，不猜默认值。
      diagnostics.push({ childSessionId: row.id, reason: 'unsupported' })
      continue
    }
    let usage: UsageBuckets | undefined
    let timing: ReturnType<typeof timingOf>
    try {
      const observation = await sessionQuery.observeSession(row.id, exec.signal === undefined ? undefined : { signal: exec.signal })
      try {
        usage = usageOf(observation.projections?.values?.tokenUsage)
        timing = timingOf(observation.projections?.values?.subagentTiming)
      } finally {
        release(observation)
      }
    } catch {
      // 没有本地会话（external）或会话读不出来：记一条诊断，行本身仍回（值为 null）。
      diagnostics.push({ childSessionId: row.id, reason: 'unavailable' })
      usage = undefined
      timing = undefined
    }
    delegations.push({
      childSessionId: row.id,
      label: typeof row.label === 'string' ? row.label : null,
      mode: row.mode,
      depth: row.depth,
      state: stateOf(row, timing),
      durationMs: timing?.durationMs ?? null,
      usage: usage ?? null,
    })
  }

  const usage = { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
  let incomplete = 0
  let partial = 0
  let durationMs = 0
  for (const row of delegations) {
    if (row.state === 'incomplete') incomplete += 1
    if (row.usage === null || row.durationMs === null) partial += 1
    durationMs += row.durationMs ?? 0
    if (row.usage !== null) {
      usage.uncachedInputTokens += row.usage.uncachedInputTokens
      usage.outputTokens += row.usage.outputTokens
      usage.cacheReadTokens += row.usage.cacheReadTokens
      usage.cacheWriteTokens += row.usage.cacheWriteTokens
    }
  }

  return {
    summary: {
      delegations: delegations.length,
      incomplete,
      diagnostics: diagnostics.length,
      partial,
      durationMs,
      usage,
    },
    delegations,
    diagnostics,
  }
}

/** 回执的一行文字摘要。 */
function renderTelemetry(_args: unknown, value: TelemetryResult): Array<{ type: 'text', text: string }> {
  const lines = [
    `委派 ${value.summary.delegations} 笔（incomplete ${value.summary.incomplete}，partial ${value.summary.partial}，`
      + `诊断 ${value.summary.diagnostics}）：耗时 ${value.summary.durationMs}ms，`
      + `用量 输入 ${value.summary.usage.uncachedInputTokens} / 输出 ${value.summary.usage.outputTokens}`
      + `（缓存读 ${value.summary.usage.cacheReadTokens}、写 ${value.summary.usage.cacheWriteTokens}）`,
  ]
  for (const row of value.delegations) {
    const name = row.label === null ? row.childSessionId : `${row.label}（${row.childSessionId}）`
    const duration = row.durationMs === null ? '耗时未知' : `${row.durationMs}ms`
    const usage = row.usage === null ? '用量未知' : `输入 ${row.usage.uncachedInputTokens} / 输出 ${row.usage.outputTokens}`
    lines.push(`- [${row.state}] ${name}：${duration}，${usage}`)
  }
  for (const diagnostic of value.diagnostics) {
    lines.push(`- [diagnostic] ${diagnostic.childSessionId}：${diagnostic.reason}`)
  }
  return [{ type: 'text', text: lines.join('\n') }]
}

/**
 * 注册委派回执工具。
 * @param ctx 插件上下文
 * @returns 注销函数
 */
export function installTelemetryTool(ctx: PluginContext): Disposer {
  return ctx.tools.register({
    name: TELEMETRY_NAME,
    description:
      'Read this session\'s delegation tree as a receipt: per child session its state, duration and token usage, '
      + 'summed from the session projections. Read-only.',
    parameters: telemetryParameters,
    output: { schema: telemetryOutput, render: renderTelemetry },
    execute: (args: { limit?: unknown }, exec: ExecuteContext): Promise<TelemetryResult> => readTelemetry(ctx, exec, args),
  } as ToolDefinition<{ limit?: unknown }, TelemetryResult>)
}
