/**
 * 子会话用量读取：把会话投影里的四桶汇总成按章 tokenUsage。
 *
 * 只读会话投影；调用方负责把结果落盘。观察必须释放（宿主用 `[Symbol.dispose]`）。
 */
import type {
  ExecuteContext,
  PluginContext,
  SessionObservationLike,
  SessionQueryLike,
  SubagentRowLike,
  SubagentsLike,
} from '../core/types.js'

/** 四个互不重叠的用量桶。 */
export interface UsageBuckets {
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

import type { TokenUsage } from '../core/chapter-index.js'

interface TokenUsageProjection {
  uncachedInputTokens?: unknown
  outputTokens?: unknown
  cacheReadTokens?: unknown
  cacheWriteTokens?: unknown
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** 读四个桶；任一不是数字就当整份用量不可得。 */
export function usageOf(value: unknown): UsageBuckets | undefined {
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

/** 宿主把释放方法挂在 `[Symbol.dispose]` 上。 */
const SYMBOL_DISPOSE = (Symbol as unknown as { dispose?: symbol }).dispose

/** 释放一份观察；宿主只提供 `[Symbol.dispose]`，没有这个符号就什么都不做。 */
export function release(observation: SessionObservationLike): void {
  if (SYMBOL_DISPOSE === undefined) return
  const dispose = (observation as Record<symbol, unknown>)[SYMBOL_DISPOSE]
  if (typeof dispose === 'function') (dispose as () => void).call(observation)
}

/**
 * 把若干直接子会话的四桶汇总为按章三字段。
 * @param ctx 插件上下文（subagents + sessionQuery）
 * @param exec 当前调用（根会话与取消信号）
 * @param childIds 本章 writer／review 的直接子会话 id
 */
export async function readChildUsage(
  ctx: PluginContext,
  exec: ExecuteContext,
  childIds: ReadonlyArray<string>,
): Promise<TokenUsage> {
  const subagents = ctx.get('subagents') as SubagentsLike | undefined
  if (subagents === undefined) throw new Error('story_record_chapter_usage 需要宿主的 subagents 服务')
  const sessionQuery = ctx.get('sessionQuery') as SessionQueryLike | undefined
  if (sessionQuery === undefined) throw new Error('story_record_chapter_usage 需要宿主的 sessionQuery 服务')
  const rootSessionId = exec.agent?.session.id
  if (rootSessionId === undefined) throw new Error('story_record_chapter_usage 需要所属 agent 会话')

  const rows = await subagents.listDescendants(rootSessionId, exec.signal)
  const byId = new Map<string, SubagentRowLike>()
  for (const row of rows) {
    if (row.kind === 'child' && row.depth === 1) byId.set(row.id, row)
  }
  for (const id of childIds) {
    if (!byId.has(id)) {
      throw Object.assign(
        new Error(`子会话 ${id} 不是本会话的直接 child；只接受本章 writer／review 的直接子会话`),
        { code: 'CHAPTER_USAGE_SESSION_UNKNOWN', childSessionId: id },
      )
    }
  }

  const buckets = {
    uncachedInputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  }
  for (const id of childIds) {
    let usage: UsageBuckets | undefined
    try {
      const observation = await sessionQuery.observeSession(
        id,
        exec.signal === undefined ? undefined : { signal: exec.signal },
      )
      try {
        usage = usageOf(observation.projections?.values?.tokenUsage)
      } finally {
        release(observation)
      }
    } catch (error) {
      if (exec.signal?.aborted === true) throw error
      throw Object.assign(
        new Error(`子会话 ${id} 的 tokenUsage 不可用：${error instanceof Error ? error.message : String(error)}`),
        { code: 'CHAPTER_USAGE_UNAVAILABLE', childSessionId: id },
      )
    }
    if (usage === undefined) {
      throw Object.assign(
        new Error(`子会话 ${id} 的 tokenUsage 投影缺少四个桶`),
        { code: 'CHAPTER_USAGE_UNAVAILABLE', childSessionId: id },
      )
    }
    buckets.uncachedInputTokens += usage.uncachedInputTokens
    buckets.outputTokens += usage.outputTokens
    buckets.cacheReadTokens += usage.cacheReadTokens
    buckets.cacheWriteTokens += usage.cacheWriteTokens
  }

  const promptTokens = buckets.uncachedInputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens
  const completionTokens = buckets.outputTokens
  return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens }
}
