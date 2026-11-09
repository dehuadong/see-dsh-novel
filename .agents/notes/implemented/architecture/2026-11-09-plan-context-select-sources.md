# Agent Note: plan.context-select 的固定来源、两次选择与 trace

Status: implemented

## Problem

审计 D11／D12 写 `plan.context-select` 的固定来源缺 `style_guide`／上一章／chapter memo／canon，四类选择器被合并成一个 composer 任务。对照源后有两处审计修正：

- 上一章正文不是 composer 的固定来源，但源 planner 会把 `runtime/previous_chapter#<n>` 作为 protected 条目追加到 planner ContextPackage（`planner.ts`），因此它属于 `plannerInputs`。excerpt 与长度归 `plan.chapter` 的 D14／D15；本行 planner pass 负责把该条目追加到 planner-context，并计入 plannerInputs。
- 源 composer 有**两次**上下文选择：planner 先调 `ComposerAgent.selectTaskContext` 取 planner 包（无 memo），写 memo；之后 writer 前再调 `ComposerAgent.composeChapter` 取写作包（有 memo）。复刻当前只有第一次（`plan` 阶段先选上下文再写 memo），没有第二次，writer 也拿不到 `selectedContext`。

复刻现状：`core/context-package.ts` 的 `protectedContext` 只收 `current_focus`、`author_intent`、`story_frame`、`volume_map`（整份文件，且截 4000 字）；`buildComposerInstruction` 用一条指令让一个子代理同时选 memory／role／state／outline；`assembleContext` 把四类选择都记为 compressible；`collectCandidates` 只从故事索引取候选；`ChapterTrace.plannerInputs` 用 selected sources、`composerInputs` 用候选 source；`context-tool.ts` 不持久化 package。

早期的 composer 入口与分层决定保留在 [2026-11-06-plan-context-select.md](2026-11-06-plan-context-select.md)；本篇接管固定来源、四类选择与 trace 的现行决定。

## 源工程证据

- `PlannerAgent.planChapter`：`taskGoal` 由 externalContext／currentFocus／authorIntent／brief 组成；先调 `ComposerAgent.selectTaskContext` 取 planner 包；再把 `runtime/previous_chapter#<n>`（protected，excerpt 来自上一章结尾）追加进 planner 包；`plannerInputs = contextPackage.selectedContext.map(source)`；写 memo 与 `chapter-XXXX.intent.md`。
- `ComposerAgent.selectTaskContext`：用 synthetic plan（goal 同时作 memo body、threadRefs 为空）走 `collectSelectedContext`；有预算时先试 `completeContextWithinBudget`（全收，`selectionMode: "complete"`），否则语义选择。
- `ComposerAgent.composeChapter`：在已存在 plan 上调 `collectSelectedContext`，把写作包与 trace 写到 `story/runtime/chapter-XXXX.context.json`／`.trace.json`；writer 读取 `contextPackage`。
- `collectSelectedContext` 的固定来源：
  - `runtime/chapter_memo`（goal=… | body）、`story/current_focus.md`、`story/author_intent.md`、`story/style_guide.md`、`story/parent_canon.md`、`story/fanfic_canon.md`：整份，protected；
  - `runtime/current_state#<index>-<slug>`：facts 选择，protected；
  - `story/outline/story_frame.md#<anchor>`、`story/outline/volume_map.md#<anchor>`：分节后分别选择，protected；
  - `story/roles/<tier>/<file>`：角色卡选择，protected；
  - `runtime/referenced_hook#<hookId>`：memo `threadRefs`，protected；
  - memory：`story/chapter_summaries.md#<chapter>`、`story/pending_hooks.md#<hookId>`、`story/volume_summaries.md#<anchor>`，compressible。
- 选择调用：memory 一条提示；role／state／story-frame／volume-map 共用按 kind 参数化的提示，但**各自调用、各自候选、各自 `File:`**；`selectOutlineSections` 在候选 ≤1 时直接全选，不调模型；空候选跳过。
- `completeContextWithinBudget`：`(contextWindowTokens - reservedOutputTokens) / 2` 为 allowance；全收后 token 不超 allowance 则 `selectionMode: "complete"`、`semanticSelectedIds: []`、不调模型。
- `buildGovernedTrace`：`plannerInputs = plan.plannerInputs`；`composerInputs = [plan.runtimePath]`（intent.md）；selectedSources、tiers、tokenBudget（含 source＋reason＋excerpt）、compression、retrieval、notes。
- `references/reference-context.ts`：composer 还追加 book reference 选择；本行不实现，见 D24。

## Decision

### 两次 pass

- `plan` 阶段（planner pass，memo 之前）：
  1. `story_context_candidates`（purpose=planner）读 `source/brief.md`／`current_focus.md`／`author_intent.md` 与可选的当前指令，形成 `taskGoal`；用 synthetic plan 生成五类任务；
  2. role／state／story-frame／volume-map 的候选 0 跳过、1 自动；memory 的候选 0 跳过、有候选派发 subagent；complete 模式不派发；
  3. `story_context_package`（purpose=planner）组装 planner 包，写 `source/story/runtime/chapter-XXXX.planner-context.json`；
  4. planner 用该包的 selectedContext 写 memo；`story_plan_chapter` 从 planner-context 文件读 `plannerInputs`，不再由模型传入。planner pass 还追加 `runtime/previous_chapter#<chapter-1>`（excerpt 由 `plan.chapter` 的 D14／D15 提供），与源的 plannerInputs 对齐。
- `write` 阶段（writer pass，plan 之后）：
  1. `story_context_candidates`（purpose=writer）读 `chapter-XXXX.plan.json` 的 memo／threadRefs，派生 query；
  2. 五类任务与 subagent 同上；
  3. `story_context_package`（purpose=writer）组装写作包，写 `chapter-XXXX.context.json`／`.trace.json`；
  4. `stages/writer.ts` 把 selectedContext 注入 writer 契约，writer 使用该包。

`story_context_candidates`／`story_context_package` 用 `purpose` 区分；writer purpose 在 plan 缺失或章节不匹配时失败，不回退用户 query。

### 固定来源与分层

- current_focus／author_intent／style_guide／parent_canon／fanfic_canon：整份内容，protected；不截 4000 字。
- chapter_memo：planner pass 用 goal 合成条目；writer pass 从 plan 读 `goal=… | body`；均 protected。
- runtime/previous_chapter：仅 planner pass，excerpt 由 `plan.chapter` 的 D14／D15 提供，protected。
- current_state facts：读 `source/story/state/current_state.json`，候选带 subject/predicate/object/validFrom/Until，protected。
- outline：story_frame／volume_map 按标题 1–6 分节，分别选择，protected。
- role cards：`source/story/roles/<tier>/*.md`，选择，protected。
- referenced hooks：memo threadRefs 对应伏笔，protected。
- memory：三类，compressible。

### 五类选择与 complete

- 任务为 memory、role、state、story-frame、volume-map 五类；role／state／story-frame／volume-map 用按 kind 参数化的提示，memory 用源提示。
- role／state／story-frame／volume-map：候选 0 跳过，候选 1 自动全选；memory：候选 0 跳过，有候选就派发 subagent（源的 memory selector 始终调模型）。
- 有 `contextWindowTokens` 且全收 token ≤ allowance 时：`selectionMode: "complete"`，不派发 subagent，全部候选入选；否则 semantic。
- memory 候选按预算分组（源 `groupMemoryCandidates`）未实现，记 D25；本行一次 memory 选择。

### trace

- `plannerInputs = plan.plannerInputs`（planner pass 的 selectedContext sources，含 `runtime/previous_chapter`，由宿主从 planner-context 文件推导）。
- `composerInputs = [chapterIntentPath(chapter)]`（源 plan.runtimePath 是 intent.md）。
- `selectedSources`、`contextTiers`、`tokenBudget` 按 package；token 估算含 source＋reason＋excerpt。
- `retrieval` 保留完整形状：`engine`／`query`／`selectionMode`／`candidates`／`semanticSelectedIds`，只描述 memory；complete 时 `semanticSelectedIds: []`。
- compression 与窗口仍归 D13；本行只做分层与预算输入。

### 相邻行与债务

- D22：角色/大纲的固定来源落地后，`story-index` 删除 role／outline 过渡文档；`material` 保留到 P6。`plan.retrieval` 的 D22 缩小为素材。
- D24：book reference 上下文未实现（源 `reference-context.ts`）；偿还 P6 的 materials／search.unified。
- D25：memory 候选未按预算分组；偿还 `plan.compression`（窗口）或本行后续。
- 上一章：`plan.chapter` 的 D14／D15 提供 excerpt；本行 planner pass 把 `runtime/previous_chapter#<n>` 追加进 planner-context，并让它出现在 plannerInputs；D11 不再把它列为本行缺口。
- `plan.chapter` 的 plannerInputs 从模型传入改为宿主从 planner-context 推导；`plan.chapter` 的审计/realRun 同步。

### 文档、证据与测试

- `test/context-package.test.mjs`：固定来源齐全/缺失与整份内容、planner 的合成 chapter memo、writer 的真实 chapter memo、`runtime/previous_chapter`（planner pass 追加且计入 plannerInputs）、current_state、outline 两文件分节、role、referenced hooks、五类提示、role／state／outline 的 0/1 自动、memory 有候选即调模型、complete/semantic、protected／compressible、trace 的 plannerInputs／composerInputs／token／retrieval 完整形状。
- `test/story-index.test.mjs`：role／outline 删除，material 保留。
- `test/writer-contract.test.mjs`：writer pass 的 selectedContext 注入。
- `test/plan-tool.test.mjs`：plannerInputs 从 planner-context 读取。
- `test/host.test.mjs`／`stages`：plan 阶段 planner pass、write 阶段 writer pass。
- `pnpm run verify` 294 例通过。
- 更新 `docs/fidelity-audit.md`：`plan.context-select` D11／D12 偿还、D24／D25；`plan.retrieval` D22 缩小；`plan.chapter` 的 plannerInputs；`chapter.write` 的 ContextPackage 注入；`docs/scope.md` 同步。
- `capabilities.yaml` 的 realRun 重录；`artifacts/real-runs/plan.context-select.json` 与受影响的 `plan.chapter`／`chapter.write` 回执。

## Alternatives considered

- **只做一次选择（planner 前或 writer 后）** — 最强理由：工具调用少。否掉：源有 planner 与 writer 两次 composer；只做一次会缺 plannerInputs 或 writer 的 selectedContext。
- **保留一条 composer 指令** — 最强理由：现有真实运行已跑通。否掉：源对五类分别调用，候选、提示、预算独立；D12 正是这个差异。
- **把 outline 合成一个任务** — 最强理由：少一次 subagent。否掉：源对 story_frame 与 volume_map 分别选择，`File:` 与候选不同。
- **宿主直接调 LLM** — 最强理由：最接近源 selector。否掉：选择是 agent 行为，DSH 的 subagent 只能由模型派发。
- **本行顺带做 book references** — 最强理由：同一 composer。否掉：references 归 P6 materials／search.unified，记 D24。

## Testing

- planner pass：`story_context_candidates(purpose=planner)` 不需要 plan；package 的 chapter memo 是 goal 的合成条目，追加 `runtime/previous_chapter`；package 写 planner-context；`story_plan_chapter` 从它读 plannerInputs（含 previous_chapter）；memo 使用 package。
- writer pass：`story_context_candidates(purpose=writer)` 读 plan；package 的 chapter memo 是真实 memo；package 写 context／trace；`stages/writer.ts` 注入 selectedContext；plan 缺失时失败。
- 固定来源整份/选择与 protected 分层符合源；outline 两文件分别任务；role／state／outline 的 0/1 自动、memory 有候选即调模型；complete 模式不调 subagent 且 `selectionMode=complete`。
- trace 的 plannerInputs／composerInputs／token／retrieval 完整形状符合源；memory compressible，其余选中 protected。
- D22 role／outline 从 story-index 删除，material 保留；D24／D25 登记；审计/范围/账本/测试/realRun 同步；`pnpm run verify` 与 CI 双端通过。

## Consequences

- 两次 pass 会增加 plan/write 阶段的工具与 subagent 调用；阶段指令必须明确 purpose 与顺序。
- complete 模式的 allowance 依赖调用方窗口（D13）；缺窗口时走 semantic，不能把空选择当 complete。
- planner-context／context／trace 是新落盘文件；要纳入原子提交与旧索引不迁移的边界。
- D24／D25 必须随 P6／D13 偿还；D22 的 material 仍留到 P6。
- 固定来源整份内容可能很大；超预算由 D13 压缩，不在本行截断。
