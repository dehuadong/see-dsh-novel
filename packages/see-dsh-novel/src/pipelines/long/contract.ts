/**
 * foundation 契约：路径规则与四段工具的 schema。
 *
 * schema 只用运行时支持的子集（单个 `type` 字符串、可空用 `oneOf`、
 * 不支持 type 数组与 minItems），越界会让 `tools.register` 抛错并拖垮整个
 * 预设装载。
 */
import type { JsonSchema, PendingHook } from '../../core/types.js'

export type RoleTier = 'major' | 'minor'

export interface IndexedRole {
  tier: RoleTier
  name: string
}

export interface BookRulesData {
  protagonist?: {
    name: string
    personalityLock: string[]
    behavioralConstraints: string[]
  }
  genreLock?: { primary: string, forbidden: string[] }
  narrativePerson?: string
  prohibitions: string[]
  enableFullCastTracking: boolean
  fanficMode?: string
  allowedDeviations: string[]
}

export type { PendingHook }

/** 角色级别 → 磁盘目录名。读取方与写入方共用同一张表。 */
export const ROLE_DIRS: Record<RoleTier, string> = { major: '主要角色', minor: '次要角色' }

/** Windows／POSIX 都不接受的文件名字符。 */
const UNSAFE_NAME = /[/\\:*?"<>|]/g

/**
 * 把作者给的角色名变成安全文件名。
 * @throws 替换后为空时拒绝，而不是静默跳过
 */
export function sanitizeRoleName(name: string): string {
  const safe = String(name ?? '').replace(UNSAFE_NAME, '_').trim()
  if (!safe) throw new Error('角色名无法表示为安全的文件名')
  return safe
}

/** 角色卡的仓库相对路径，始终以 `/` 分隔。 */
export function roleCardPath(tier: RoleTier, name: string): string {
  const dir = ROLE_DIRS[tier]
  if (dir === undefined) throw new Error(`未知角色级别：${String(tier)}`)
  return `source/story/roles/${dir}/${sanitizeRoleName(name)}.md`
}

const OBJECT = (properties: Record<string, JsonSchema>, required?: string[]): JsonSchema => ({
  type: 'object',
  additionalProperties: false,
  properties,
  ...(required === undefined ? {} : { required }),
})

const STRING = (description?: string): JsonSchema =>
  description === undefined ? { type: 'string' } : { type: 'string', description }
const STRING_ARRAY = (): JsonSchema => ({ type: 'array', items: STRING() })

/** `story_foundation_outline` 的参数。 */
export const OUTLINE_PARAMETERS: JsonSchema = OBJECT({
  storyFrame: STRING('前提、核心冲突、动机与因果收束，保持可读，不写角色卡与章节正文'),
  volumeMap: STRING('分卷与章方向的可读 Markdown，每章给因果节拍，不写场景草稿'),
}, ['storyFrame', 'volumeMap'])

const BOOK_RULES_DATA: JsonSchema = OBJECT({
  protagonist: OBJECT({
    name: STRING(),
    personalityLock: STRING_ARRAY(),
    behavioralConstraints: STRING_ARRAY(),
  }),
  genreLock: OBJECT({
    primary: STRING(),
    forbidden: STRING_ARRAY(),
  }),
  narrativePerson: STRING('作者自己的表述，不做枚举'),
  prohibitions: STRING_ARRAY(),
  enableFullCastTracking: { type: 'boolean' },
  fanficMode: STRING(),
  allowedDeviations: STRING_ARRAY(),
}, ['prohibitions', 'enableFullCastTracking', 'allowedDeviations'])

/** `story_foundation_details` 的参数。 */
export const DETAILS_PARAMETERS: JsonSchema = OBJECT({
  bookRules: STRING('可读的本书规则 Markdown'),
  bookRulesData: BOOK_RULES_DATA,
  pendingHooks: {
    type: 'array',
    items: OBJECT({
      hookId: STRING(),
      type: STRING(),
      expectedPayoff: STRING(),
      notes: STRING(),
    }, ['hookId', 'type', 'expectedPayoff', 'notes']),
  },
}, ['bookRules', 'bookRulesData', 'pendingHooks'])

/** `story_foundation_cast_index` 的参数。 */
export const CAST_INDEX_PARAMETERS: JsonSchema = OBJECT({
  roles: {
    type: 'array',
    items: OBJECT({
      tier: { type: 'string', enum: ['major', 'minor'] },
      name: STRING('具名人物；不要把无名岗位群体拆成虚构人物'),
    }, ['tier', 'name']),
  },
}, ['roles'])

/**
 * `story_foundation_cast_documents` 的动态 schema：每个角色一个具名字段，
 * 让「每人一张卡」成为 schema 约束而不是提示词要求。
 */
export function castDocumentsParameters(roles: ReadonlyArray<IndexedRole>): JsonSchema {
  const cardFields: Record<string, JsonSchema> = {}
  for (const [index, role] of roles.entries()) {
    cardFields[`role_${index + 1}_content`] =
      STRING(`${role.name} 的角色卡：当下动机、已知信息、关系压力与能力边界`)
  }
  return OBJECT({
    ...cardFields,
    mode: { type: 'string', enum: ['init', 'revise'], description: 'revise 会删除本次未重写的角色卡' },
  }, roles.map((_, index) => `role_${index + 1}_content`))
}

/** 写入类工具的返回值结构。 */
export const COMMIT_OUTPUT: JsonSchema = OBJECT({
  written: STRING_ARRAY(),
  deleted: STRING_ARRAY(),
}, ['written', 'deleted'])

/** 本能力负责的唯一阶段；后续阶段各自登记自己的名字。 */
export const FOUNDATION_STAGE = 'foundation'

/** 角色档案作为 runtime context 的名字与位置：team identity 之后、harness source 之前。 */
export const CAST_CONTEXT_NAME = 'story:cast'
export const CAST_CONTEXT_ORDER = 130

/** 只读闸门工具，报告确认状态而不推进。 */
export const GATE_TOOL = 'story_gate'

/** 签核工具，把这一版基础设定标记为定稿。 */
export const SIGNOFF_TOOL = 'story_foundation_signoff'

/** 面板按钮执行的三个命令。 */
export const COMMAND_REVIEW = 'story-review'
export const COMMAND_APPROVE = 'story-approve'
export const COMMAND_REJECT = 'story-reject'

/** 无参工具的参数位；留出来，避免以后加参数时改变调用形态。 */
export const NO_PARAMETERS: JsonSchema = OBJECT({}, [])

/** `story_gate` 的返回值；可空字段用空串而不是 null，保持 schema 简单。 */
export const GATE_OUTPUT: JsonSchema = OBJECT({
  stage: STRING('本能力负责的阶段'),
  files: STRING_ARRAY(),
  digest: { type: 'string', description: '当前工件摘要；没有工件时为空串' },
  confirmed: { type: 'boolean', description: '当前摘要是否有一条仍然有效的作者确认' },
  decision: { type: 'string', enum: ['approve', 'reject', 'none'], description: '最近一次作者决定' },
  channel: { type: 'string', enum: ['receipt', 'approval', 'none'], description: '有效确认来自面板命令还是原生确认条' },
  receiptAt: { type: 'string', description: '最近一条确认的时间（ISO），没有时为空串' },
  policy: { type: 'string', enum: ['ask', 'never', 'unknown'], description: '会话的确认策略' },
  canPrompt: { type: 'boolean', description: '现在能否弹原生确认条' },
  hint: { type: 'string', description: '下一步该做什么' },
}, ['stage', 'files', 'digest', 'confirmed', 'decision', 'channel', 'receiptAt', 'policy', 'canPrompt', 'hint'])

/** `story_foundation_signoff` 成功时的返回值；拒绝以工具错误返回。 */
export const SIGNOFF_OUTPUT: JsonSchema = OBJECT({
  signed: { type: 'boolean' },
  channel: { type: 'string', enum: ['receipt', 'approval'], description: '确认来自面板命令还是原生确认条' },
  digest: { type: 'string' },
  files: STRING_ARRAY(),
}, ['signed', 'channel', 'digest', 'files'])
