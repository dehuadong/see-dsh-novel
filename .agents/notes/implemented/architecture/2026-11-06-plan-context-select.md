# Agent Note: plan.context-select —— 章前上下文：composer 子代理、分层与 trace

Status: implemented

## Problem

检索之后要把候选变成带层级、预算与 trace 的上下文包。源工程由 `ComposerAgent.selectTaskContext` 完成（`agents/composer.ts:591-981`）：固定来源 protected；伏笔与摘要、角色卡、当前状态、大纲分四类做语义选择；组装 `ContextPackage` 并写 `ChapterTrace`（七字段，`models/input-governance.ts:35-70`）。选择在源工程里是一个 agent 的行为，因此 DSH 落点是模型调用原生 `subagent` + 宿主校验，而不是自建 LLM 客户端或 prompt 拼装层。

## Decision

`packages/see-dsh-novel/src/core/context-package.ts`：

- `estimateTokens(text)`：CJK 逐字 1 token，拉丁词 4 字符 1 token；
- `buildComposerInstruction(chapter)`：四类选择语义、只允许候选 id、只返回 JSON 的指令；主编把这段与候选交给 `subagent`；
- `protectedContext(root)`：`current_focus`、`author_intent`、`outline/story_frame`、`outline/volume_map`（存在即收，protected）；
- `collectCandidates(root, query, limit)`：复用 `searchStory`，把 hook/summary 归为 memory，role/state/outline 各自成类，id 形如 `kind:source#title`；
- `assembleContext({chapter, query, protectedEntries, candidates, selection, maxChars})`：protected 全收；selection 的 id 经候选表校验，未知 id／类型不符丢弃并记 `notes`；compressible 按 memory→role→state→outline 装入；`tokenBudget` 三数相加一致；超预算只记「超预算 N tokens（不截断）」，预算来自 `contextWindowTokens - reservedOutputTokens`，缺失则不压缩；`retrieval.engine` 固定 `sqlite-fts5-bm25`，有选择时 `semantic`，否则 `complete`；
- `nextChapter(root)`：读 `current_state.json` 的 `chapter + 1`，缺文件按 1。

`src/pipelines/long/context-tool.ts` 注册两个工具：

- `story_context_candidates(query, instruction?, limit?)`：返回 `{chapter, instruction, candidates}`，供主编连同指令交给 `subagent`；
- `story_context_package(query, selection)`：校验子代理返回的 `{memory, role, state, outline}` 并组装 `{package, trace}`。

选择失败（子代理不可用、返回非 JSON、缺键）由主编在会话层处理；宿主不降级为 top-k，也不猜测。

## Alternatives considered

**直接调 `ctx.llm` 发四次请求。** 否掉：选择是一个 agent 的行为；裸 LLM 调用绕过 agent 循环，也违反「上下文注入走 `systemPrompt.context()`」。

**按检索分数 top-k，不做语义选择。** 否掉：等于换算法。

**插件代码直接派发子代理。** 否掉：DSH 的 `subagents` 服务只提供生命周期，派发只能由模型调用 `subagent` 工具。

## Consequences

收益：章前上下文有了完整链——检索候选、composer 指令、模型选择、宿主校验、package 与七字段 trace。protected 与 compressible 分层明确，未知 id 与超预算都留痕。

验证见 `test/context-package.test.mjs`（token 估算、指令、id 校验与未知 id、空选择、trace 一致性）与 `test/host.test.mjs`（两个工具注册）。

代价与已知限制：

- 选择质量取决于模型与指令；宿主只保证结构与 id 合法。
- 四个选择器合并成一次 composer 任务（源工程也是一个 ComposerAgent 做四类选择）。
- token 是估算值，与源精确计数有差距。
- 超预算不压缩，交给 `plan.compression`。
- 上一章正文结尾尚未纳入 protected；等 P3 的章节文件路径确定后补。
