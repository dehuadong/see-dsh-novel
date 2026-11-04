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
import type { CommandOutcome, SentinelInjected, SessionId, ViewInjected } from './types.js'

export const inject = ['slots', 'sessions'] as const

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
