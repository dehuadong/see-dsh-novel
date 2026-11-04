/**
 * 空渲染的哨兵：只有它挂在页面上时才说明「当前会话」正在显示。
 *
 * 它把会话预设翻译成一次注册／注销，于是「作品」页只出现在该预设的会话里。
 */
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { useEffect } from 'react'

import { PRESET_ID, presetSelector } from './preset.js'
import type { SentinelInjected } from './types.js'

/**
 * 只上报预设是否匹配，什么都不渲染。
 * @param props header 槽位的标准会话 props 加上 `syncEligible`
 */
export function EligibilitySentinel(
  props: PropsRuntime<'conversation.session.header.utilities'> & InjectFace<SentinelInjected>,
): null {
  const { sessionId, useSessions, syncEligible } = props
  const preset = useSessions(presetSelector(sessionId))

  useEffect(() => {
    syncEligible(preset === PRESET_ID)
    return () => { syncEligible(false) }
  }, [preset, syncEligible])

  return null
}
