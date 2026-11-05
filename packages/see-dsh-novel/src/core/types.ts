/**
 * 运行时给插件的少量服务面。只声明本项目用到的部分，避免依赖 DSH 的类型包。
 */

/** 工具注册与命令注册返回的注销函数。 */
export type Disposer = () => void

/** 会话日志里的一条事件；插件只读自己关心的字段。 */
export interface SessionEventLike {
  type: string
  seq: number
  time: number
  data?: unknown
}

/** 插件在工具执行与命令处理里能读到的会话面。 */
export interface SessionLike {
  /** 会话标识；宿主 `Session` 上叫 `id`。 */
  readonly id?: string
  snapshotEvents(): ReadonlyArray<SessionEventLike>
}

/** 一个会话所属的 agent；原样传给宿主服务。 */
export interface AgentLike {
  session: SessionLike
}

/** 运行时会让工具看到的宿主 approval 结论。 */
export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

/** 宿主 approval 服务面；缺席时签核只能走面板命令。 */
export interface ApprovalService {
  /** 组合层给的默认策略；会话没有覆盖时用它。 */
  config?: { policy?: 'ask' | 'never' }
  overrideOf(session: SessionLike): 'ask' | 'never' | undefined
  request(request: {
    agent: AgentLike
    toolName: string
    callId?: string
    reason?: string
    signal?: AbortSignal
  }): Promise<ApprovalOutcome>
}

/** 运行时会传给 `execute` 的上下文。 */
export interface ExecuteContext {
  /** 所属 agent；没有归属的调用不允许写作品目录。 */
  agent?: AgentLike
  /** 本次工具调用的 id，用来把确认挂到具体调用上。 */
  callId?: string
  /** 调用方的取消信号；作者取消本轮时确认请求随之撤回。 */
  signal?: AbortSignal
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

/** 命令处理拿到的调用信息。 */
export interface CommandInvocationLike {
  agent: AgentLike
  /** 命令名之后的原始文本，含分隔空白。 */
  rawInput: string
  signal: AbortSignal
}

/** 命令的返回值；`error` 会以错误结果出现在会话里。 */
export interface CommandResultLike {
  kind: 'success' | 'error'
  text?: string
}

/** 一条斜杠命令的定义。 */
export interface CommandDefinitionLike {
  name: string
  description: string
  /** 声明这个命令接受自由文本输入；输入框据此先让作者补参数再派发。 */
  input?: { hint: string }
  handler(invocation: CommandInvocationLike): CommandResultLike | Promise<CommandResultLike>
}

/** 宿主 agentPresets 服务面：只需要判断一个 agent 用的是哪个预设。 */
export interface AgentPresetsLike {
  composedPreset(ctx: unknown): string | undefined
}

/** 一条技能的注册参数；只有本项目会写进去的字段。 */
export interface SkillRegistrationLike {
  name: string
  description: string
  content: string
  whenToUse?: string
  source?: string
  invocation?: { modelInvocable: boolean; userInvocable: boolean }
}

/** 宿主技能服务面：注册一条随包技能，作用域由调用方的层决定。 */
export interface SkillsLike {
  register(skill: SkillRegistrationLike): Disposer
}

/** 一次装配里能读到的运行时事实；`agent` 缺席时是诊断性装配。 */
export interface AssembleContextLike {
  agent?: AgentLike & { ctx?: unknown }
}

/** 一条 runtime context 贡献；文本在每次装配时求值。 */
export interface PromptContextLike {
  name: string
  order: number
  text: (context: AssembleContextLike) => string
  interpolate?: boolean
  required?: boolean
}

/** 插件在 apply 里能拿到的服务。 */
export interface PluginContext {
  tools: { register(definition: ToolDefinition<any, any>): Disposer }
  workingDirectory: {
    ensure(agent: AgentLike): Promise<string>
    /** 会话实际使用的目录；会话没有自己的目录时是宿主默认目录，因此总是非空。 */
    get(session: SessionLike): string
  }
  commands: { register(definition: CommandDefinitionLike): Disposer }
  skills: SkillsLike
  systemPrompt: { context(contribution: PromptContextLike): Disposer }
  /** 可选服务按名读取；用它可以避免整个插件等待一个不存在的服务。 */
  get(service: string): unknown
}

/** 会话查询返回的一份观察：一份不可变切面，用完通过 `[Symbol.dispose]` 释放。 */
export interface SessionObservationLike {
  readonly projections?: { values?: Record<string, unknown> }
}

/** 宿主的会话查询服务面：按 id 读一个会话的投影。 */
export interface SessionQueryLike {
  observeSession(sessionId: string, options?: { signal?: AbortSignal }): Promise<SessionObservationLike>
}

/** 子代理目录的一行；`child` 是真子会话，`diagnostic` 是读不通的分支。 */
export interface SubagentRowLike {
  readonly kind: 'child' | 'diagnostic'
  readonly id: string
  readonly parentId?: string
  readonly depth?: number
  readonly mode?: string
  readonly label?: string
  readonly activity?: 'running' | 'inactive'
  readonly reason?: string
  readonly hasChildren?: boolean
}

/** 宿主的子代理服务面：列出一棵会话子树。 */
export interface SubagentsLike {
  listDescendants(rootSessionId: string, signal?: AbortSignal): Promise<readonly SubagentRowLike[]>
}

/** foundation 阶段产出的未解伏笔，播种进 hooks 状态。 */
export interface PendingHook {
  hookId: string
  type: string
  expectedPayoff: string
  notes: string
}
