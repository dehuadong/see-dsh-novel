/**
 * 作品状态激活：源在 `outlining → active`；复刻的 `draft` 对应 `outlining`。
 *
 * 只映射激活，不扩 `WorkStatus` 的完整枚举；源其余状态见 AU-06。
 */
import type { Work } from './work.js'

/** 把 draft 激活为 active；其它状态原样返回。 */
export function activateWorkStatus(work: Work): Work['status'] {
  return work.status === 'draft' ? 'active' : work.status
}
