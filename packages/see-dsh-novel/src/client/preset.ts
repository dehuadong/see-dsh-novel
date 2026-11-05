/**
 * 面板与预设的固定名，以及「这个会话用的是哪个预设」的读取。
 *
 * 名字只在这里写一次：视图 id、宿主槽位名、预设 id 都从这里取。预设 id 与
 * `cordis.patch.yml` 里 `preset-see-dsh-novel` 的 config.id 必须一致。
 */
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'

import type { SessionId } from './types.js'

/** 本插件服务的预设 id，同时用作「作品」视图的注册 id。 */
export const PRESET_ID = 'see-dsh-novel'

/** 宿主提供的两个槽位。 */
export const VIEW_SLOT = 'conversation.view'
export const SENTINEL_SLOT = 'conversation.session.header.utilities'

/**
 * 运行时携带、但 0.2.2-rc.1 的客户端投影映射（`SessionProjectionMap` 只登记了
 * `inbox`）里没有 `agentPreset` 的那部分会话行。
 *
 * 宿主运行时把预设投影成 `string | null`（`null` 表示还没决定预设），客户端类型
 * 没有跟着声明，所以这里局部写出读取面并按 `??` 语义合并两处来源。等宿主把它
 * 登记进投影映射，这个接口与两处断言一起删掉。
 */
interface PresetCarrier {
  values?: { agentPreset?: string | null }
  projectionValues?: { agentPreset?: string | null }
}

/**
 * 读当前会话的预设 id。
 * @param state 会话列表快照
 * @param sessionId 目标会话
 * @returns 预设 id；没有决定预设或还没读到时是 undefined
 */
export function presetOf(state: SessionListState, sessionId: SessionId): string | undefined {
  const projected = (state.projectionsBySession?.[sessionId] as PresetCarrier | undefined)?.values?.agentPreset
  const retained = (state.byId[sessionId] as PresetCarrier | undefined)?.projectionValues?.agentPreset
  return projected ?? retained ?? undefined
}

/**
 * 给 `useSessions` 用的选择器；两个组件共用，避免各写一份读取逻辑。
 * @param sessionId 目标会话
 * @returns 选择器
 */
export function presetSelector(sessionId: SessionId): (state: SessionListState) => string | undefined {
  return (state) => presetOf(state, sessionId)
}
