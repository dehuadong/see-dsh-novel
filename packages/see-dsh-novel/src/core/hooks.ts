/**
 * 伏笔条目的取值与迁移规则。
 *
 * 这些约束是任何流水线都要遵守的，所以落在 core；表格长什么样归各流水线。
 */

export const HOOK_STATUSES = ['open', 'progressing', 'deferred', 'resolved', 'superseded'] as const
export type HookStatus = (typeof HOOK_STATUSES)[number]

export interface HookRecord {
  hookId: string
  startChapter: number
  type: string
  status: HookStatus
  lastAdvancedChapter: number
  expectedPayoff: string
  notes: string
  /** 这条伏笔依赖的其它伏笔 id；元素非空，不 trim、不唯一化。 */
  dependsOn?: string[]
  /** 预期在哪个卷（弧）回收；自由字符串，可为空。 */
  paysOffInArc?: string
}

/** 记录允许出现的字段；类型标注让缺字段或多字段在编译期就暴露。 */
const HOOK_FIELDS: ReadonlyArray<keyof HookRecord> = [
  'hookId', 'startChapter', 'type', 'status', 'lastAdvancedChapter', 'expectedPayoff', 'notes', 'dependsOn', 'paysOffInArc',
]
const HOOK_FIELD_SET: ReadonlySet<string> = new Set(HOOK_FIELDS)

export interface HooksState {
  hooks: HookRecord[]
}

const TERMINAL: ReadonlySet<HookStatus> = new Set(['resolved', 'superseded'])

/** 允许的迁移；不在此表内的迁移一律拒绝。 */
const TRANSITIONS: Readonly<Record<string, ReadonlySet<HookStatus>>> = {
  deferred: new Set<HookStatus>(['progressing', 'superseded']),
  progressing: new Set<HookStatus>(['resolved', 'superseded']),
  open: new Set<HookStatus>(['progressing', 'superseded']),
  resolved: new Set<HookStatus>(),
  superseded: new Set<HookStatus>(),
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

/**
 * 校验整份伏笔状态；任何一条违反约束就抛错，不跳过不修复。
 * @throws 描述具体条目与原因的错误
 */
export function validateHooks(state: HooksState): HooksState {
  if (state === null || typeof state !== 'object' || !Array.isArray(state.hooks)) throw new Error('hooks 必须是数组')
  for (const key of Object.keys(state)) {
    if (key !== 'hooks') throw new Error(`状态上的未知字段：${key}`)
  }
  const seen = new Set<string>()
  for (const [index, hook] of state.hooks.entries()) {
    if (hook === null || typeof hook !== 'object' || Array.isArray(hook)) {
      throw new Error(`第 ${index + 1} 条伏笔必须是对象`)
    }
    if (typeof hook.hookId !== 'string' || hook.hookId.length === 0) {
      throw new Error(`第 ${index + 1} 条伏笔缺少 hookId`)
    }
    for (const key of Object.keys(hook)) {
      if (!HOOK_FIELD_SET.has(key)) {
        throw new Error(`${hook.hookId} 上的未知字段：${key}`)
      }
    }
    if (seen.has(hook.hookId)) throw new Error(`hookId 重复：${hook.hookId}`)
    seen.add(hook.hookId)
    if (!HOOK_STATUSES.includes(hook.status)) throw new Error(`${hook.hookId} 的 status 非法：${String(hook.status)}`)
    if (typeof hook.type !== 'string' || hook.type.length === 0) throw new Error(`${hook.hookId} 缺少 type`)
    if (typeof hook.expectedPayoff !== 'string') throw new Error(`${hook.hookId} 的 expectedPayoff 必须是字符串`)
    if (typeof hook.notes !== 'string') throw new Error(`${hook.hookId} 的 notes 必须是字符串`)
    if (!isNonNegativeInteger(hook.startChapter)) throw new Error(`${hook.hookId} 的 startChapter 非法`)
    if (!isNonNegativeInteger(hook.lastAdvancedChapter)) throw new Error(`${hook.hookId} 的 lastAdvancedChapter 非法`)
    if (hook.dependsOn !== undefined) {
      if (!Array.isArray(hook.dependsOn) || hook.dependsOn.some((id) => typeof id !== 'string' || id.length === 0)) {
        throw new Error(`${hook.hookId} 的 dependsOn 必须是非空字符串数组`)
      }
    }
    if (hook.paysOffInArc !== undefined && typeof hook.paysOffInArc !== 'string') {
      throw new Error(`${hook.hookId} 的 paysOffInArc 必须是字符串`)
    }
  }
  return state
}

/**
 * 推进一条伏笔到新状态，并记录推进章节。
 * @throws 迁移不在允许表内，或章节号倒退
 */
export function transitionHook(hook: HookRecord, status: HookStatus, chapter: number): HookRecord {
  if (TERMINAL.has(hook.status)) throw new Error(`${hook.hookId} 已是终态 ${hook.status}，不能再推进`)
  const allowed = TRANSITIONS[hook.status]
  if (allowed === undefined || !allowed.has(status)) {
    throw new Error(`${hook.hookId} 不允许从 ${hook.status} 迁移到 ${status}`)
  }
  if (!isNonNegativeInteger(chapter) || chapter < hook.lastAdvancedChapter) {
    throw new Error(`${hook.hookId} 的推进章节倒退：${chapter} < ${hook.lastAdvancedChapter}`)
  }
  return { ...hook, status, lastAdvancedChapter: chapter }
}

/** 按状态计数，键为状态名。 */
export function countHooks(state: HooksState): Record<HookStatus, number> {
  const counts = Object.fromEntries(HOOK_STATUSES.map((status) => [status, 0])) as Record<HookStatus, number>
  for (const hook of state.hooks) counts[hook.status] += 1
  return counts
}
