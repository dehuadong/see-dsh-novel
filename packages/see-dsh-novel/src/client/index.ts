/**
 * 浏览器半边：向 `conversation.view` 注册「作品」视图。
 *
 * 只在预设匹配的会话里注册：头部的哨兵上报「当前会话用的是不是 see-dsh-novel」，
 * 槽位声明由 `slots.inject` 上报；两者都成立才注册视图，失败即注销。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'

import { EligibilitySentinel } from './EligibilitySentinel.js'
import { outcomeOf } from './outcome.js'
import { PRESET_ID, SENTINEL_SLOT, VIEW_SLOT } from './preset.js'
import { StoryView } from './StoryView.js'
import { installStyles } from './styles.js'
import type { CommandOutcome, ResumeOutcome, SentinelInjected, SessionId, ViewInjected } from './types.js'

export const inject = ['slots', 'sessions'] as const

/**
 * 认可之后投回会话的那条消息。
 *
 * 不带摘要：面板拿不到摘要，门禁自己核对；消息只负责把会话叫醒。
 * 带时效声明：`queue` 在当前轮结束后才会跑，这期间基础设定若有改动，
 * agent 必须按门禁结论走，而不是相信这句话。
 */
export const RESUME_TEXT = '作者刚在面板确认了 foundation（若那之后基础设定有改动，以回执与摘要为准）。'
  + '请调用 story_gate 复核这一版是否已确认：确认成立就调用 story_foundation_signoff 定稿并继续下一步；'
  + '不成立就把原因告诉作者。不要再次请作者确认。'

/**
 * 注册面板：哨兵 + 条件注册的作品视图 + 样式。
 * @param ctx 客户端插件上下文
 */
export function apply(ctx: Context): void {
  ctx.effect(() => installStyles(), 'see-dsh-novel: panel styles')

  const viewInject = (): ViewInjected => ({
    canCommand: (sessionId: SessionId): boolean => ctx.sessions.binding(sessionId) !== undefined,
    runCommand: async (sessionId: SessionId, line: string): Promise<CommandOutcome> => {
      const binding = ctx.sessions.binding(sessionId)
      if (binding === undefined) return 'unbound'
      return outcomeOf(await binding.session.command(line))
    },
    resume: async (sessionId: SessionId): Promise<ResumeOutcome> => {
      const binding = ctx.sessions.binding(sessionId)
      if (binding === undefined) return 'failed'
      const result = await binding.session.prompt([{ type: 'text', text: RESUME_TEXT }], 'queue')
      return result.ok === true ? 'ok' : 'failed'
    },
  })

  let eligible = false
  let declared = false
  let viewDisposer: (() => void) | undefined

  /** 当前挂载的会话用的是这个预设、且槽位已声明时才注册「作品」页。 */
  function syncView(): void {
    if (eligible && declared && viewDisposer === undefined) {
      viewDisposer = ctx.slots.register(
        { name: VIEW_SLOT, id: PRESET_ID, order: 20, label: '作品', inject: viewInject },
        StoryView,
      )
      return
    }
    if ((!eligible || !declared) && viewDisposer !== undefined) {
      viewDisposer()
      viewDisposer = undefined
    }
  }

  const syncEligible = (value: boolean): void => {
    eligible = value
    syncView()
  }

  ctx.effect(() => () => {
    viewDisposer?.()
    viewDisposer = undefined
  }, 'see-dsh-novel: conditional work view')

  ctx.slots.inject(VIEW_SLOT, () => {
    declared = true
    syncView()
    return () => {
      declared = false
      syncView()
    }
  })

  const sentinelInject = (): SentinelInjected => ({ syncEligible })
  ctx.slots.inject(SENTINEL_SLOT, () => ctx.slots.register(
    { name: SENTINEL_SLOT, id: `${PRESET_ID}-eligibility`, order: 100, inject: sentinelInject },
    EligibilitySentinel,
  ))
}
