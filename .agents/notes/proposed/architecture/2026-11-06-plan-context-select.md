# Agent Note: plan.context-select —— 章前上下文：composer 子代理、分层与 trace

Status: proposed

## Problem

检索之后要把候选变成一份带层级、预算与 trace 的上下文包。源工程由 `ComposerAgent.selectTaskContext` 完成（`agents/composer.ts:591-981`）：固定来源（方向文档、风格指南、上一章）直接 protected；伏笔与摘要、角色卡、当前状态、大纲分四类交给同一个 agent 做语义选择；最后按 token 预算组装 `ContextPackage` 并写 `ChapterTrace`（七字段，`models/input-governance.ts:35-70`）。

复刻侧只有检索，没有选择、分层与 trace。选择在源工程里是**一个 agent 的行为**（system prompt + 结构化返回），不是四次裸 LLM 调用；因此 DSH 落点是 `subagents` + `systemPrompt.context()`，而不是自建 LLM 客户端或 prompt 拼装层（AGENTS.md 铁律 3）。

## Proposal

### 数据形状

`core/context-package.ts`：

```ts
interface ContextSource { source: string, reason: string, excerpt?: string, protection: 'protected' | 'compressible' }
interface ContextPackage { chapter: number, selectedContext: ContextSource[] }
interface ChapterTrace {
  chapter: number
  plannerInputs: string[]      // 规划实际读到的 source
  composerInputs: string[]     // 子代理读到的候选 source
  selectedSources: string[]
  contextTiers: { protectedSources: string[], compressibleSources: string[] }
  tokenBudget: { protectedTokens: number, compressibleTokens: number, totalSelectedTokens: number }
  retrieval: { engine: 'sqlite-fts5-bm25', query: string, selectionMode: 'semantic'|'complete', candidates: {id,kind,source,score}[], semanticSelectedIds: string[] }
  notes: string[]
}
```

### composer 子代理

`core/composer-agent.ts` 生成一次子代理任务：

- **指令**（system prompt）：复刻四个选择器的语义——memory（伏笔/摘要）、role（角色卡）、state（当前状态）、outline（大纲分节）——要求返回 JSON `{memory: string[], role: string[], state: string[], outline: string[]}`，只允许候选里出现的 id；
- **输入**（user message）：四类候选的 `{id, source, title, excerpt}` 列表，来自 `plan.retrieval` 的 `searchStory` 与固定来源；
- 通过 `ctx.get('subagents')` 派发一个任务（agent preset 用当前预设，profile 用默认），等待其结构化返回；`systemPrompt.context()` 只用于补充当前阶段与方向，不重复候选正文。

**失败语义**（不静默降级）：

- 子代理服务不可用、超时、返回非 JSON、缺四类键：工具失败并点名原因；
- 返回未知 id：丢弃该 id，在 trace `notes` 记录「丢弃未知 id: …」；
- 某一类返回空数组：该类 compressible 一个不收，`notes` 记录「选择器为空」。

### 组装与 trace

1. 固定层（protected）：`current_focus`、`author_intent`、`style_guide`（存在时）、`outline/story_frame`、`outline/volume_map`、上一章正文结尾（存在 `source/story/chapters/NNNN.md` 时取末尾 2000 字）；
2. 子代理选中的 id → 查候选表 → 条目进 compressible，`reason` 用候选的命中原因；
3. 组装顺序：protected 全收，compressible 按 memory→role→state→outline 顺序装入；
4. `tokenBudget`：CJK 字符 1 token、拉丁词按 4 字符 1 token 估算；超预算**不截断**，`notes` 记「超预算 N tokens」，交给 `plan.compression`；
5. `retrieval.selectionMode`：子代理可用时为 `semantic`；`semanticSelectedIds` 是子代理选中的 id 并集。

### 工具

`story_compile_context(chapter, instruction?)`：只读；章节号必须是 `当前章 + 1`；返回 `{ package, trace }`；`plan.chapter` 之后消费它，本行先用工具作为运行时消费者。

## Alternatives considered

**直接调 `ctx.llm` 发四次请求。** 少一层子代理。否掉：源工程的选择是一个 agent 的行为；裸 LLM 调用绕过 agent 循环，也违反「上下文注入走 `systemPrompt.context()`」的约定。

**不做语义选择，按检索分数 top-k。** 简单。否掉：那等于换算法，不是复刻。

**四个选择器各起一个子代理。** 更细。否掉：源工程是一个 ComposerAgent 在一次任务里做四类选择；拆四个子代理只会增加装配与失败面。

## Acceptance criteria

- 工具派发**一次** composer 子代理（假 subagents 计数为 1）；子代理收到四类候选与四段选择指令。
- 子代理返回的 id 经候选表校验后进入 package；未知 id 被丢弃且 `notes` 有记录；四类全空时 package 只含 protected 层。
- 子代理不可用、超时、返回非 JSON、缺键时工具失败并点名原因，不返回 top-k 结果。
- trace 七字段齐全；`tokenBudget` 与 `selectedContext` 的估算一致；`retrieval.engine` 是 `sqlite-fts5-bm25`；超预算只记 notes，不截断。
- protected 层含方向文档与大纲（存在时）与上一章结尾（存在时）；compressible 不含 `book_rules`。
- `story_compile_context` 对 `当前章 + 1` 以外的章号拒绝；返回结构符合 schema。
- 测试：`test/context-package.test.mjs`（一次派发、id 校验、未知 id、空类、失败语义、预算与 trace）、`test/host.test.mjs` 工具清单加 `story_compile_context`。
- 实现与证据：implementation `packages/see-dsh-novel/src/core/composer-agent.ts`；consumer `packages/see-dsh-novel/test/context-package.test.mjs`；工具在 `src/pipelines/long/context-tool.ts`；realRun `artifacts/real-runs/plan.context-select.json`。
- 真实运行：在已 `ready` 的工作区会话里调 `story_compile_context` 规划第 1 章，核对 package 分层、trace 七字段与子代理返回的 id；再用错误章号调一次确认拒绝。

## Risks

- 子代理的模型与温度不同于源工程的 ComposerAgent，选出的条目会不同；测试只锁派发次数、id 校验与结构。
- 子代理返回 JSON 的稳定性依赖指令约束；解析失败按失败处理，不做「猜」。
- token 估算是近似值，与源的精确计数有差距；trace 字段同名同形，数值误差记录在 Consequences。
- 超预算不压缩，交给下一行；这一行只保证不丢条目、不静默截断。
