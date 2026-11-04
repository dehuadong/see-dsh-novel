/**
 * 命令结果到面板四态的映射。
 *
 * 结果的类型从宿主服务面推出来（`session.command` 的返回），不再手写一个
 * 形状——手写的那个会随宿主漂移。
 */
import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'

import type { CommandOutcome } from './types.js'

/** 一次斜杠命令提交的结果，取自宿主 `session.command` 的返回类型。 */
export type CommandResult = Awaited<ReturnType<SessionBinding['session']['command']>>

/**
 * 把宿主的结果折成面板能说清的四态之一。
 *
 * 结果形状不对时按失败处理：宁可说「提交失败」，也不要让「正在执行…」卡住。
 * @param result 命令提交结果
 * @returns 成功、命令不存在或失败（`unbound` 由调用方在拿不到会话时给出）
 */
export function outcomeOf(result: CommandResult | undefined): CommandOutcome {
  if (!result || result.ok !== true) return 'error'
  return result.value.matched === true ? 'ok' : 'unmatched'
}
