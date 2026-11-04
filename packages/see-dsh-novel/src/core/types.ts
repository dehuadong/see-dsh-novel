/**
 * 运行时给插件的少量服务面。只声明本项目用到的部分，避免依赖 DSH 的类型包。
 */

/** 工具注册返回的注销函数。 */
export type Disposer = () => void

/** 运行时会传给 `execute` 的上下文。 */
export interface ExecuteContext {
  /** 所属 agent；没有归属的调用不允许写作品目录。 */
  agent?: unknown
}

/** 工具定义里 `output.render` 的入参形态：`(args, value)`。 */
export type Renderer<Value> = (args: unknown, value: Value) => Array<{ type: 'text', text: string }>

/** 运行时校验并展示的返回值结构。 */
export interface JsonSchema {
  type?: string | string[]
  oneOf?: JsonSchema[]
  properties?: Record<string, JsonSchema>
  required?: string[]
  additionalProperties?: boolean
  items?: JsonSchema
  enum?: unknown[]
  const?: unknown
  description?: string
  [key: string]: unknown
}

/** 一个工具的完整定义。 */
export interface ToolDefinition<Args = any, Value = unknown> {
  name: string
  description: string
  parameters: JsonSchema
  output: {
    schema: JsonSchema
    render: Renderer<Value>
  }
  execute(args: Args, exec: ExecuteContext): Promise<Value> | Value
}

/** 插件在 apply 里能拿到的服务。 */
export interface PluginContext {
  tools: { register(definition: ToolDefinition<any, any>): Disposer }
  workingDirectory: { ensure(agent: unknown): Promise<string> }
}

/** foundation 阶段产出的未解伏笔，播种进 hooks 状态。 */
export interface PendingHook {
  hookId: string
  type: string
  expectedPayoff: string
  notes: string
}
