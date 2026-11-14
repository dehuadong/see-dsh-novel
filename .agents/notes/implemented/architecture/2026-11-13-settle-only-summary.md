# Agent Note: 摘要只随结算写入

Status: implemented

## Problem

复刻曾新增独立的 `story_summarize_chapter` 工具：它可以在结算之前把七字段摘要单独落盘。源工程没有这个入口：

- 摘要只在结算 schema 内由 settler 产出（`agents/settler-tool.ts:21-29,62`），随 `saveChapter` 与状态、快照同批写（`agents/writer.ts:364-437`）。
- 正常结算的 reducer 在章节号 `<= lastAppliedChapter` 时拒绝（`state/state-reducer.ts:37`），同章已有摘要行且非 `allowReapply` 时拒绝重复（`:45-51`）；只有 `allowReapply`（真值重建／同章重算路径）才过滤旧行再写（`:195-211`）。
- 复刻的结算已按同一语义门控章节号：`applySettlement` 只对同章重结算要求 `allowReapply`，`story_settle_chapter` 在 `chapter === lastAppliedChapter` 时传 `true`；缺口有两处：独立摘要入口能在结算前写摘要；`applySummary` 对已有摘要行无条件替换，旧工作区（曾被独立工具预写摘要）结算该章时会静默覆盖，而源在非 `allowReapply` 时拒绝重复。

追溯评审记为 D48，并已裁决收敛为「结算内唯一路径」。

## Decision

### 范围与非目标

- 范围：删除独立摘要工具与 `chapter-done` 的「只要摘要」步骤；摘要只由 `story_settle_chapter` 写入；结算的摘要写入按 `allowReapply` 门控，非重结算遇到已有同章行时拒绝。
- 非目标：不改章节号门控、facts/hooks 合并、D34 自动校验（已由 [D34：结算前的状态对账与 reconciliation](2026-11-14-chapter-settle-validation.md) 交付，本行不改它）；不改七字段 schema 与投影格式；不保留 `story_summarize_chapter` 兼容别名。

### 交付行为

- `story_summarize_chapter` 不再注册；`chapter-done` 协议不再提供「只要摘要」的独立步骤，摘要属于结算。
- `story_settle_chapter` 仍写七字段摘要行与 `chapter_summaries.md` 投影，按章号排序；字段校验与同章重结算语义不变。
- 旧工作区若已有该章摘要行且本次不是同章重结算，结算在写盘前拒绝；修复方式：从 `source/story/state/chapter_summaries.json` 的 rows 删除该章，下一次结算会重渲染投影。

### 决定与未决问题

- 结算侧只给 `applySummary` 补门控，不改章节号门控；避免把入口收敛扩大成 `chapter.settle` 的增量行为变更。
- 未决问题：无。

### 评审与批准证据

- Plan Review 第 1 轮：需修订（误判结算缺 `allowReapply`，提出不必要的重复拒绝并触碰 D33；删测试后排序/字段断言无替代；旧 Note 应加取代链接而非改写）；已收窄。
- Plan Review 第 2 轮：仍需修订（排序测试无检验点；旧工作区预写摘要行的替换条件不能整条注销；「无残留引用」不可判定）；已补摘要门控与预置乱序用例。
- Plan Review 第 3 轮：仍需修订（Note 自相矛盾、修复提示不可执行、「新章无旧行」与门控冲突）；已统一为「只补 `applySummary` 门控」并给出可执行修复路径。
- Plan Review 第 4 轮：仍需修订（`chapter.settle` 行为也变了，须同批重录 realRun）；已补。
- Plan Review 第 5 轮：通过，无未解决 blocker/major。
- Implementation Review（Standards / Spec）：首轮各报 3／3 条；补拒绝路径的四份状态/投影断言、同章重结算替换断言与可执行错误路径后复核通过。
- 批准与执行授权：2026-11-13，作者批准 `implement chapter.summary`。

## Design

### 删除独立入口

- 删除 `src/pipelines/long/summary-tool.ts`、`src/core/chapter-summary.ts`、`test/chapter-summary.test.mjs`。
- `src/plugin/agent.ts` 去掉 `installSummaryTool` 的安装与 import。
- `test/host.test.mjs` 的工具清单去掉 `story_summarize_chapter`。
- `src/pipelines/long/stages/index.ts` 的 `chapter-done` 删除「只要摘要」步骤，后续步骤重新编号；`test/stage-context.test.mjs` 改为断言不出现该工具。

### 结算的摘要门控

`src/core/settle.ts`：

- `applySummary(state, delta, allowReapply)`：`allowReapply` 为 false 且已有同章行时抛错（`第 N 章已有摘要行；删除 source/story/state/chapter_summaries.json 的 rows 中该章后再结算`）；为 true 时沿用「过滤旧行再写」。
- `applySettlement` 把已有的 `reapply`（`delta.chapter === lastAppliedChapter`）作为 `allowReapply` 传给 `applySummary`；常规新章没有旧行，同章重结算才允许替换。

### 测试覆盖迁移

`test/chapter-settle.test.mjs` 接替被删测试的实质断言：

- 预置第 2 章摘要行后结算第 1 章，rows 按章号升序；
- 预置同章摘要行且以非重结算路径结算时拒绝，四份状态 JSON 与投影逐字节不变；
- 空 `title` 在结算时被拒绝；
- 同章重结算替换摘要行（`mood` 更新）且仍保留 facts 的替换语义。

### 账本、审计与回执

- `capabilities.yaml` 的 `chapter.summary`：implementation 指向 `src/core/settle.ts`，consumer 指向 `test/chapter-settle.test.mjs`；`chapter.settle` 的 realRun 同批重录。
- `docs/fidelity-audit.md` 的 `chapter.summary` 段改为「摘要随结算写入，无独立入口」；`chapter.settle` 段补摘要门控；D48 注销。
- `artifacts/real-runs/chapter.summary.json` 与 `chapter.settle.json` 重录。
- 已实现 Note `2026-11-10-chapter-summary.md` 顶部加入取代链接，保留当时设计记录。

## Alternatives considered

- **保留工具但禁止结算前调用** — 兼容旧调用。否掉：源没有这个入口；保留等于继续提供「先摘要后结算」的时序。
- **保留工具但改成幂等替换** — 少改协议。否掉：工具本身就是源没有的入口，幂等不解决入口问题。
- **只删工具、不给 `applySummary` 补门控** — 改动最小。否掉：旧工作区被独立工具预写的摘要行会在结算时被静默覆盖，源在非 `allowReapply` 时拒绝重复。
- **连同写盘逻辑保留为内部工具** — 供面板/索引使用。否掉：摘要投影由状态快照渲染，索引与上下文读状态文件，没有其它消费者。

## Testing

- `test/chapter-settle.test.mjs`（10 例）：摘要按章号排序、非重结算重复行拒绝且不写、空 title 拒绝、同章重结算替换；原有状态/facts/hooks/跳章/缺失/损坏用例保持。
- `test/host.test.mjs`：工具清单不再包含 `story_summarize_chapter`。
- `test/stage-context.test.mjs`：`chapter-done` 不出现该工具，步骤重编号。
- `pnpm run verify` 全绿：422 tests。
- D48 已从 `docs/scope.md` 注销；`chapter.summary` 与 `chapter.settle` 回执已重录。

## Consequences

- 依赖 `story_summarize_chapter` 的旧会话或文档会失败；项目未承诺兼容别名。
- 旧工作区若被独立工具预写摘要行，结算会拒绝，需要手工删除该 state 行后再结算。
- 摘要校验只在结算路径；错误信息由 `applySettlement` 的字段校验给出。
- `chapter.settle` 的 realRun 因新增拒绝路径而同批重录；D33／D34 不变。
