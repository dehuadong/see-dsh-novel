# 阶段一：提案（Proposal）深度分析报告

> **源工程**：`inkos/`  
> **核心源文件**：
> - `inkos/packages/core/src/agent/agent-tools.ts`
> - `inkos/packages/core/src/harness/explicit-action.ts`
> - `inkos/packages/core/src/interaction/action-envelope.ts`
> - `inkos/packages/core/src/interaction/session.ts`
> - `inkos/packages/core/src/harness/system-prompt.ts`
> - `inkos/packages/core/src/harness/contracts.ts`
> - `inkos/packages/core/src/models/book.ts`
> - `inkos/packages/core/src/__tests__/proposal-policy.flow.test.ts`
> - `inkos/packages/core/src/__tests__/creative-harness.flow.test.ts`

---

## 1. 阶段概述

提案阶段（Proposal）是 InkOS 创作周期的第一道关卡。它解决的是**创意从发散到结构化收敛、并获得作者显式法律级授权（Workflow Start Approval）**的问题。该阶段拒绝模型未经作者确认就擅自创建作品目录或写入设定，通过交互确认卡（Confirmation Card）将自然语言对话固化为具备完备执行参数的行动封套（`ActionEnvelope`），从而确保后续长篇流水线具备确定性的作品身份、类型预期与执行边界。

---

## 2. 执行主体与角色编排

- **人类作者（Author / Human）**：提供初步创意、回答澄清问题、并在最终确认卡上做出批准（Confirm）或拒绝（Reject）决定。
- **对话代理（Creative Assistant Agent）**：由 Studio 或预设驱动的主对话智能体，拥有 `propose_action` 工具，负责通过苏格拉底式提问引导作者收敛核心矛盾、世界观、卖点和篇幅，组装提案。
- **宿主系统（Host Runtime / Session Controller）**：管理对话会话（`creative` 会话），拦截未授权的高危动作；在收到有效的作者批准回执（Approval Receipt）后，负责执行工作区切换并触发对应的下游任务。

---

## 3. 输入契约与上下文来源

- **用户初始自然语言输入**：例如“我想写一本赛博朋克背景下的修仙长篇小说”。
- **会话上下文（Session History）**：多轮对话沉淀的题材探讨、角色灵感、受众定位。
- **内置预设与能力集（Built-in Profiles）**：`createBuiltInWorkProfileRegistry()` 声明当前会话可提议的 action 集合（长篇对应 `create_book`，短篇对应 `short_run` 等）。
- **附件路径（Attachment Paths）**：用户在界面上附加的设定文档或参考文件路径。

---

## 4. 输出产物与权威形态

1. **提案卡消息（Propose Action Result）**：
   - 面向用户的结构化富交互消息，包含动作标题、摘要说明与自包含指令文本。
2. **行动封套（ActionEnvelope / Proposed Action Payload）**：
   - 强类型数据封套，承载 `actionId`（`create_book`）、`actionPayload`（`CreateBookParams`）与 `targetSessionKind`（`book`）。
3. **提案执行简报（Execution Brief）**：
   - 用户确认后固化的 `instruction` 与规模参数（如 `targetWordCount`、`chapterWordCount`），持久化作为后续会话续跑的意图基线。

---

## 5. 核心流转机制与关键算法

### 5.1 创意对话与意图收敛
Agent 在接收到用户的粗糙想法后，按写作预设进行多轮对话，收敛以下要素：
- 书名（Title）与作品定位（Working Title）
- 题材类型（Genre，如玄幻、科幻、悬疑、都市等）
- 核心冲突（Core Conflict）与开篇悬念（Opening Hook）
- 语言设置（Language：`zh` | `en`）
- 篇幅与节奏参数（`chapterWordCount`，默认 3000 字左右；`targetWordCount`，如 100 万字）

### 5.2 `propose_action` 工具调用
当信息收敛充分后，Agent **不直接创建文件**，而是调用 `propose_action` 工具：
```typescript
// 源码位置: packages/core/src/agent/agent-tools.ts:633
const result = await proposeActionTool.execute(toolCallId, {
  action: "create_book",
  title: "《灵脉矩阵》长篇立项提案",
  summary: "赛博修仙题材长篇小说，主角通过算力筑基，探讨算法异化与长生执念。",
  instruction: "创建赛博修仙题材长篇小说《灵脉矩阵》，语言为中文，目标单章3000字，总字数100万字。",
  createBook: {
    title: "灵脉矩阵",
    genre: "赛博修仙",
    language: "zh",
    chapterWordCount: 3000,
    targetWordCount: 1000000,
    direction: "算力筑基，宗门垄断浮空城服务器",
  }
});
```

### 5.3 严格自包含性（Self-Contained Instruction）
`propose_action` 的 `instruction` 必须是**自包含的（Self-contained）**：
- 必须明确包含书名、故事方向、输出设定、目标篇幅。
- **原因**：当用户在 Studio 点击确认后，系统可能会切换会话甚至跨进程启动流水线；丢失上一轮对话记忆时不应影响流水线启动。

### 5.4 授权门禁（Workflow Start Gate）
- 系统在 `system-prompt.ts` 中注入铁律：**涉及生成作品基础、批量写章等重操作，严禁在未确认提案前私自运行**。
- 确认动作必须在交互层留下不可伪造的授权回执（`ActionConfirmedReceipt`）。

---

## 6. 数据结构与 Schema 详述

### 6.1 `ProposeActionParams` Schema
```typescript
// packages/core/src/agent/agent-tools.ts:178
const ProposeActionParams = Type.Object({
  action: Type.Union([
    Type.Literal("create_book"),
    Type.Literal("short_run"),
    Type.Literal("play_start"),
    Type.Literal("generate_cover"),
    Type.Literal("fanfic_init"),
    Type.Literal("continuation_import"),
    Type.Literal("spinoff_create"),
    Type.Literal("style_imitation"),
    Type.Literal("script_create"),
    Type.Literal("storyboard_create"),
    Type.Literal("interactive_film_create"),
    Type.Literal("translation_create"),
    Type.Literal("draft_structure"),
    Type.Literal("connect_choice"),
    Type.Literal("remove_node"),
  ]),
  instruction: Type.String({ minLength: 1 }),
  title: Type.String({ minLength: 1 }),
  summary: Type.String({ minLength: 1 }),
  createBook: Type.Optional(Type.Object({
    title: Type.String({ minLength: 1 }),
    genre: Type.String({ minLength: 1 }),
    language: Type.Optional(Type.Union([Type.Literal("zh"), Type.Literal("en")])),
    chapterWordCount: Type.Optional(Type.Integer({ minimum: 500, maximum: 20000 })),
    targetWordCount: Type.Optional(Type.Integer({ minimum: 1000 })),
    direction: Type.Optional(Type.String()),
    platform: Type.Optional(Type.String()),
  })),
  // 其他类型的 action 参数...
});
```

### 6.2 `ActionEnvelope` 结构
```typescript
// packages/core/src/interaction/action-envelope.ts
export interface ActionEnvelope {
  readonly actionId: string;
  readonly targetSessionKind: "creative" | "book" | "short" | "play" | "script";
  readonly title: string;
  readonly summary: string;
  readonly instruction: string;
  readonly payload: unknown;
  readonly createdAt: string;
}
```

---

## 7. 质量门禁与强校验

1. **非空字符串断言**：
   - `title`、`summary` 与 `instruction` 必须 `trim()` 后长度大于 0，否则直接抛出 `Error("propose_action requires non-empty title, summary, and instruction.")`。
2. **Profile 作用域检查**：
   - 若当前 Profile 限制了 `allowedActions`（例如仅允许短篇），传入 `create_book` 会抛出 `ACTION_PROPOSAL_NOT_AVAILABLE`。
3. **可执行性断言（assertExecutableProposedAction）**：
   - 校验结构化 payload 是否满足对应 action 的最低可执行标准（例如 `createBook.title` 和 `genre` 必须合法）。
4. **拒绝绕过门禁**：
   - 核心写入工具只注册在特定授权上下文中，未授权会话无法调用底层写文件工具。

---

## 8. 一致性与因果链保障

- **确定性会话目标（Deterministic Target Session）**：
  `proposedActionSessionKind("create_book")` 确定性返回 `"book"`，指导宿主在确认后创建独立的作品会话，杜绝创意讨论污染正式长篇状态。
- **参数一次性冻结**：
  在提案被作者点击确认的一瞬间，所有核心参数（书名、题材、单章字数、语言）被封存，作为作品 `BookConfig` 的初始来源，后续阶段不得随意篡改基本事实。

---

## 9. 创作技能与方法论

在提案阶段，Agent 加载 `inkos-long-market-research` 与 `inkos-long-writing` 技能：
- **读者契约（Reader Contract）**：开篇前必须明确作品向读者承诺的核心看点（悬念、爽感、升级路线或情感体验）。
- **市场对齐**：通过 `market-rubric.md` 评估所选题材的主流篇幅、节奏偏好与平台受众特性，避免设定与篇幅预期严重脱节。

---

## 10. 测试覆盖与验证场景

核心测试位于 `inkos/packages/core/src/__tests__/proposal-policy.flow.test.ts` 与 `creative-harness.flow.test.ts`：
1. **测试提案成功组装**：断言 `propose_action` 返回的文本包含自包含指令，且结构化载荷完整匹配 `CreateBookParams`。
2. **测试未授权阻断**：断言在用户未发出 `confirm` 前，调用后续写入工具会被拒绝。
3. **测试参数缺失报错**：断言空 `title` 或空 `instruction` 会触发异常抛出。
4. **测试 Profile 权限限制**：断言在限制动作的 Profile 下无法提议非白名单操作。
