# Agent Note: plan.chapter —— planner 提示词注入与 plan 复用

Status: implemented

> 2026-11-14 由 [`2026-11-14-planner-instruction-reuse.md`](2026-11-14-planner-instruction-reuse.md) 修订：planner 读取作者附言；plan 工具按 author/system 覆盖或复用；上一章独立段已删除；hook id/技能归 AU-18。本 Note 的“不覆盖/无入参变化覆盖”已失效。

## Problem（D14／D15）

`plan.chapter` 只有阶段协议的工具顺序，没有源工程的 planner 提示；`story_plan_chapter` 遇到已存在 plan 直接拒绝，而源工程按持久 plan 复用（`loadPersistedPlan` 命中即返回）。

## Decision

`packages/see-dsh-novel/src/pipelines/long/stages/planner.ts` 的 `renderPlannerContract(root)`（同步读盘）：

- 当前章 = `current_state.chapter + 1`；
- 方法句（中英）：把 governed context 编译为 memo、不写正文、方法来自阶段提供的创作方法、保留用户方向与既成事实、只使用输入里存在的 hook id、提交一个具体目标与可读计划；
- 用户消息骨架：`# 第N章 memo 请求`／当前用户指令（brief、current_focus、author_intent 依次拼接）／权威上下文占位（由 `story_context_package` 填入）／上一章正文结尾（2000 字）／宿主字数遥测；
- 可用 hook id 列表；
- 空段省略。

`stages/index.ts` 在 `plan` 阶段把契约拼进 `story:stage`。

`story_plan_chapter` 改成源的缓存语义：该章已有 plan 时 `loadChapterPlan` 读回并返回 `{..., reused: true}`，不覆盖、不校验入参；没有 plan 时写入并返回 `reused: false`。输出 schema 增加 `reused`。

## Alternatives considered

**planner 提示写进技能。** 否掉：它是提示词契约，不是创作方法。

**保留「已存在即拒绝」。** 否掉：源工程是复用缓存；拒绝会让重试与恢复不可用。

**入参变化时覆盖。** 原否掉；2026-11-14 修订：源在 externalContext 非空时重跑 planner 并覆盖持久 plan，见 AU-22 续。

## Consequences

收益：plan 阶段每轮都有方法句、用户消息骨架、上一章结尾与 hook id；重复调用返回同一份 plan。

验证见 `test/planner-contract.test.mjs`（中文契约、英文、缺省省略）、`test/plan-tool.test.mjs`（首次写入、二次 `reused: true` 且文件不变）与 `test/stage-context.test.mjs`（plan 阶段含契约）。

代价与已知限制：

- plan 阶段上下文增加约 2–4KB；
- 调用方必须读 `reused` 才知道是否命中缓存；
- 上一章只取末尾 2000 字（源取全文），进度仍用 `current_state.chapter`。
