/**
 * `story_next` 的行为契约。
 *
 * 纯函数：读盘的三个探针由调用方给（`core/work.ts` 的 `workProbes`），因此可以
 * 在任何运行时里直接做消费者测试。阶段按「命中即止」的顺序判定，四个值穷尽
 * 且互斥。
 */
import type { JsonSchema } from '../core/types.js'

/** 本能力能报出的阶段。阶段随能力增加而扩展，不预先登记未实现的阶段。 */
export const PHASES = ['unbound', 'foundation', 'draft', 'ready'] as const

/** 每个阶段对应的下一步工具名；`runtime.commands` 再把它暴露成命令。 */
export const NEXT_STEPS = {
  unbound: 'story_work_create',
  foundation: 'story_foundation_outline',
  draft: 'story_foundation_details',
  ready: 'story_gate',
} as const

/** 工具名，注册与测试共用同一个常量，避免两处字面量漂移。 */
export const STORY_NEXT_NAME = 'story_next'

/** 判定阶段所需的事实：三个探针，加上探得到的作品标题。 */
export interface StoryProbeState {
  hasWork: boolean
  hasFrame: boolean
  hasState: boolean
  title: string | null
}

/** `story_next` 的返回值。 */
export interface StoryNext {
  work: string | null
  phase: (typeof PHASES)[number]
  next: string
}

/**
 * 按文件说真话：内容在、身份缺是合法状态（`ready` 且 `work` 为 null）。
 * @param state 三个探针与作品标题
 * @returns 阶段、下一步与作品标题
 */
export function storyNext(state: StoryProbeState): StoryNext {
  const work = state.hasWork ? state.title : null
  // 先判「什么都没有」再判「没有大纲」：details 段允许先播种状态清单再写大纲，
  // 状态在而大纲缺属于「基础设定没写完」，不该被说成「未立项」。
  if (!state.hasWork && !state.hasFrame && !state.hasState) {
    return { work, phase: 'unbound', next: NEXT_STEPS.unbound }
  }
  if (!state.hasFrame) {
    return { work, phase: 'foundation', next: NEXT_STEPS.foundation }
  }
  if (!state.hasState) {
    return { work, phase: 'draft', next: NEXT_STEPS.draft }
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
