/**
 * `story_next` 的行为契约。
 *
 * 纯函数：不读文件、不访问存储、不依赖宿主服务，因此可以在任何运行时里
 * 直接做消费者测试。作品绑定属于 runtime.session-binding，这里只描述
 * 「当前没有作品」这一种状态。
 */
import type { JsonSchema } from '../core/types.js'

/** 本能力能报出的阶段。阶段随能力增加而扩展，不预先登记未实现的阶段。 */
export const PHASES = ['unbound'] as const

/** 工具名，注册与测试共用同一个常量，避免两处字面量漂移。 */
export const STORY_NEXT_NAME = 'story_next'

/** `story_next` 的返回值。 */
export interface StoryNext {
  work: null
  phase: (typeof PHASES)[number]
  next: string
}

/** 当前没有绑定作品时的下一步。 */
export function storyNext(): StoryNext {
  return { work: null, phase: 'unbound', next: 'init' }
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
