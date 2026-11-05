/**
 * 面板自己的语义类型。
 *
 * 宿主已经导出的东西（slot 的 owner props、注入面、`Context.sessions` 与
 * `useResource` 的声明）一律用 `@deepseek-ai/*` 的真类型；这里只放本视图
 * 自己定义、宿主不认识的那几个。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'

/**
 * 会话标识的品牌类型。
 *
 * 宿主定义在 `@deepseek-ai/dsh-session`，从 `sessions.binding` 的参数推出来就够用，
 * 不必为它单独装一个只有类型的包。
 */
export type SessionId = Parameters<Context['sessions']['binding']>[0]

/** 命令提交的结果；面板据此给出可见回执，而不是静默失败。 */
export type CommandOutcome = 'ok' | 'unbound' | 'unmatched' | 'error'

/** 投「继续」的结果：会话有没有被叫醒。 */
export type ResumeOutcome = 'ok' | 'failed'

/** 「作品」视图注册时注入的业务面。 */
export interface ViewInjected {
  /** 当前会话能不能提交命令（有绑定的会话面）。 */
  canCommand(sessionId: SessionId): boolean
  /** 提交一条斜杠命令，把结果折成面板能说清的四态。 */
  runCommand(sessionId: SessionId, line: string): Promise<CommandOutcome>
  /** 认可之后把「继续」投回会话，让 agent 复核回执再接着干。 */
  resume(sessionId: SessionId): Promise<ResumeOutcome>
}

/** 哨兵注册时注入的业务面。 */
export interface SentinelInjected {
  /** 上报当前会话是否是 see-dsh-novel 预设。 */
  syncEligible(eligible: boolean): void
}
