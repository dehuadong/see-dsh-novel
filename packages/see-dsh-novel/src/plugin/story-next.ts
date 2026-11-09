/**
 * `story_next` 的行为契约。
 *
 * 纯函数：读盘的七项探针由调用方给（`core/work.ts` 的 `workProbes`），因此可以
 * 在任何运行时里直接做消费者测试。阶段按「命中即止」的顺序判定，四个值穷尽
 * 且互斥。
 */
import type { JsonSchema } from '../core/types.js'
import type { FoundationProbes } from '../core/work.js'

/** 本能力能报出的阶段。阶段随能力增加而扩展，不预先登记未实现的阶段。 */
export const PHASES = ['unbound', 'foundation', 'draft', 'ready'] as const

/** 角色卡由两步写入；缺卡时路牌指向第一步。 */
export const CAST_INDEX_STEP = 'story_foundation_cast_index'

/** 就绪清单：顺序即判定顺序。加一项只改这里。 */
const OUTLINE_PROBES = ['hasFrame', 'hasVolumeMap'] as const
const RULES_PROBES = ['hasRulesMd', 'hasRulesJson', 'hasPendingHooks'] as const
const ALL_PROBES = ['hasWork', ...OUTLINE_PROBES, ...RULES_PROBES, 'hasRoleCard'] as const

/** 每个阶段的基础下一步；`draft` 会按缺什么改用 `CAST_INDEX_STEP`。 */
export const NEXT_STEPS = {
  unbound: 'story_work_create',
  foundation: 'story_foundation_outline',
  draft: 'story_foundation_details',
  ready: 'panel.confirm',
} as const

/** 工具名，注册与测试共用同一个常量，避免两处字面量漂移。 */
export const STORY_NEXT_NAME = 'story_next'

/** 判定阶段所需的事实：七项探针，加上探得到的作品标题。 */
export interface StoryProbeState extends FoundationProbes {
  title: string | null
}

/** `story_next` 的返回值。 */
export interface StoryNext {
  work: string | null
  phase: (typeof PHASES)[number]
  next: string
}

/**
 * 按文件说真话：内容在、身份缺是合法状态。
 * @param state 七项探针与作品标题
 * @returns 阶段、下一步与作品标题
 */
export function storyNext(state: StoryProbeState): StoryNext {
  const work = state.hasWork ? state.title : null
  const missing = (keys: ReadonlyArray<keyof FoundationProbes>): boolean => keys.some((key) => !state[key])
  // 先判「什么都没有」：七项全假才是未立项。
  if (ALL_PROBES.every((key) => !state[key])) {
    return { work, phase: 'unbound', next: NEXT_STEPS.unbound }
  }
  // 大纲缺任一份：还停在 outline 段。
  if (missing(OUTLINE_PROBES)) {
    return { work, phase: 'foundation', next: NEXT_STEPS.foundation }
  }
  // 规则或伏笔池缺：补 details。
  if (missing(RULES_PROBES)) {
    return { work, phase: 'draft', next: NEXT_STEPS.draft }
  }
  // 只剩角色卡：指向 cast_index，不指 details（details 不写卡）。
  if (!state.hasRoleCard) {
    return { work, phase: 'draft', next: CAST_INDEX_STEP }
  }
  return { work, phase: 'ready', next: NEXT_STEPS.ready }
}

/** 无参工具：留出参数位，避免以后加参数时改变调用形态。 */
export const storyNextParameters: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {},
  required: [],
}

/** 返回值结构，同时用于注册契约与测试断言。 */
export const storyNextOutput: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    // 运行时的 schema 子集不接受 type 数组；可空用 oneOf 表达。
    work: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    phase: { type: 'string', enum: [...PHASES] },
    next: { type: 'string' },
  },
  required: ['work', 'phase', 'next'],
}

