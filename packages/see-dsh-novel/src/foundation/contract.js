/**
 * foundation 契约：路径规则与四段工具的 schema。
 *
 * schema 只用运行时支持的子集（单个 `type` 字符串、可空用 `oneOf`、
 * 不支持 type 数组与 minItems），越界会让 `tools.register` 抛错并拖垮整个
 * 预设装载。
 */

/** 角色级别 → 磁盘目录名。 */
const ROLE_DIRS = Object.freeze({ major: '主要角色', minor: '次要角色' })

/** Windows／POSIX 都不接受的文件名字符。 */
const UNSAFE_NAME = /[/\\:*?"<>|]/g

/**
 * 把作者给的角色名变成安全文件名。
 * @param {string} name
 * @returns {string}
 */
export function sanitizeRoleName(name) {
  const safe = String(name ?? '').replace(UNSAFE_NAME, '_').trim()
  if (!safe) throw new Error('角色名无法表示为安全的文件名')
  return safe
}

/**
 * 角色卡的仓库相对路径。
 * @param {'major' | 'minor'} tier
 * @param {string} name
 * @returns {string} 以 `/` 分隔的相对路径
 */
export function roleCardPath(tier, name) {
  const dir = ROLE_DIRS[tier]
  if (dir === undefined) throw new Error(`未知角色级别：${tier}`)
  return `source/story/roles/${dir}/${sanitizeRoleName(name)}.md`
}

const OBJECT = (properties, required) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  ...(required === undefined ? {} : { required }),
})

const STRING = (description) => (description === undefined ? { type: 'string' } : { type: 'string', description })
const STRING_ARRAY = (description) => ({ type: 'array', items: STRING(description) })

/** `story_foundation_outline` 的参数。 */
export const OUTLINE_PARAMETERS = OBJECT({
  storyFrame: STRING('前提、核心冲突、动机与因果收束，保持可读，不写角色卡与章节正文'),
  volumeMap: STRING('分卷与章方向的可读 Markdown，每章给因果节拍，不写场景草稿'),
}, ['storyFrame', 'volumeMap'])

const BOOK_RULES_DATA = OBJECT({
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
export const DETAILS_PARAMETERS = OBJECT({
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
export const CAST_INDEX_PARAMETERS = OBJECT({
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
 * @param {ReadonlyArray<{ tier: 'major' | 'minor', name: string }>} roles
 */
export function castDocumentsParameters(roles) {
  const cardFields = Object.fromEntries(roles.map((role, index) => [
    `role_${index + 1}_content`,
    STRING(`${role.name} 的角色卡：当下动机、已知信息、关系压力与能力边界`),
  ]))
  return OBJECT({
    ...cardFields,
    mode: { type: 'string', enum: ['init', 'revise'], description: 'revise 会删除本次未重写的角色卡' },
  }, roles.map((_, index) => `role_${index + 1}_content`))
}

/** 写入类工具的返回值结构。 */
export const COMMIT_OUTPUT = OBJECT({
  written: STRING_ARRAY(),
  deleted: STRING_ARRAY(),
}, ['written', 'deleted'])
