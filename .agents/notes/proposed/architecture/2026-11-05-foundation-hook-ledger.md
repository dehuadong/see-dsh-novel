# Agent Note: foundation.hook-ledger —— 两个字段与严格校验

Status: proposed

## Problem

源工程的伏笔记录比复刻多两个可选字段，并且整条记录是严格的：

- `HookRecordSchema` 带 `dependsOn: string[]`（每个元素非空）与 `paysOffInArc?: string`，整条记录 `.strict()`（`models/runtime-state.ts:18-29`）；
- 这两个字段**不由任何动作写入**：六动作（新建／提及／推进／回收／延后／撤回）的合并实现 `mergeHookRecord` 只覆盖 `startChapter`／`type`／`status`／`lastAdvancedChapter`／`expectedPayoff`／`notes`（`state/state-reducer.ts:124-142`），从 incoming 复制这两个字段会丢；源工程里它们只可能出现在外部写入的 `hooks.json`（手改、导入或未来的结算扩展）中。

复刻的 `HookRecord` 只有七个基本字段，`validateHooks` 也不拒绝未知字段；带这两个字段的记录会被静默接受但字段丢失，带未知字段的记录同样会被放过。严格性缺口会在 P4 读状态时暴露。

## Proposal

### 字段与严格校验

`core/hooks.ts` 的 `HookRecord` 增加两个可选字段，并让 `validateHooks` 对齐源 schema：

- `dependsOn?: string[]`：出现时必须是数组，每个元素非空字符串（不 trim、不唯一化）；
- `paysOffInArc?: string`：出现时必须是任意字符串（允许空串）；
- 记录上出现这两个之外的未知字段一律拒绝，报错点名 `hookId` 与字段（源 schema `.strict()`）；
- 其余字段按源 schema 的类型要求：`hookId`／`type` 是非空字符串（长度 ≥ 1，不 trim——纯空白在源里合法），`expectedPayoff`／`notes` 是任意字符串（可为空），章节号是 ≥ 0 的整数；源 schema 没有「最近推进不得早于起始章」的约束，本行也不加；
- 伏笔投影仍是七列，不含这两个字段（源投影同样不展示）；`story_hooks` 的 counts 不受影响。

本行不实现六动作的生命周期语义：那是结算的输入格式与合并规则（源 `utils/hook-arbiter.ts`／`state/state-reducer.ts`），当前没有任何 DSH 消费者——authoring 侧的 `transitionHook` 不是它的调用方，也不能拿纯函数测试冒充运行时证据。六动作整体挪到 P4 的 `chapter.settle`（并入该行，不另立债行），由那一行提供工具入口与会话证据；届时要照源实现逐字段对齐（含 `startChapter` 取 min、`type`／`expectedPayoff`／`notes` 的 trim 与空值回退、`resolved` 粘滞、两个新字段不从 incoming 复制、提及与延后不推进、撤回需 notes 等）。

### 字段的可见性

两个字段随 `hooks.json` 持久化，`story_hooks` 读取时经 `validateHooks` 校验；投影与工具回执都不展示它们，与源工程一致。

## Alternatives considered

**现在就实现六动作合并。** 覆盖更多源行为。否掉：本行没有 DSH 消费者，只能靠脚本或单元测试证明；这违反「实现—消费者—真实运行」的证据链，而且等 P4 接上时还要再改一轮。六动作挪到结算行，与它唯一的调用方同时落地。

**把六动作注册成 `story_hook_update` 工具。** 更早可交互。否掉：源工程没有这个工具，六动作是结算输入；提前开入口会把结算职责漏到 P1。

**`dependsOn` 只接受已知 hookId。** 更严格。否掉：源 schema 只要求非空字符串；引用完整性留给结算调用方。

**校验时 trim `dependsOn` 元素。** 更干净。否掉：源 schema 是 `z.string().min(1)`，只拒绝空串，不改写作者原文。

## Acceptance criteria

- `validateHooks` 接受带 `dependsOn`（非空字符串数组）与 `paysOffInArc`（任意字符串）的记录；拒绝空串元素、非数组、非字符串。
- 记录上的未知字段被拒绝，错误里带 `hookId` 与字段名。
- `story_hooks` 对含这两个字段的 `hooks.json` 正常返回 counts 与七列投影，投影里不出现两个字段名。
- 合法记录经 `JSON.stringify` 往返后字段保留；`hooks.json` 的格式化与现在一致。
- 类型校验对齐源 schema：`type` 为纯空白时接受（长度 ≥ 1），`notes`／`expectedPayoff` 缺失或非字符串时拒绝，`lastAdvancedChapter < startChapter` 不再额外拒绝。
- `test/hooks.test.mjs` 补字段校验、未知字段与「纯空白 type 合法」用例；不含六动作相关断言。
- `capabilities.yaml` 的 `chapter.settle` 行标题补「伏笔六动作合并（提及与延后不推进）」，`docs/scope.md` 的 P4 说明同步；本行标题只讲字段与校验。
- 旧笔记 `implemented/architecture/2026-11-04-foundation-hooks.md` 的字段表同批更新：`lastAdvancedChapter` 改为「非负整数；不校验与起始章的先后（与源 schema 一致）」，因为同一批次的代码会删掉这条额外约束。
- 实现与证据：implementation `packages/see-dsh-novel/src/core/hooks.ts`；consumer `packages/see-dsh-novel/test/hooks.test.mjs`；realRun `artifacts/real-runs/foundation.hook-ledger.json`。
- 真实运行：在真实工作区手写一份带 `dependsOn`／`paysOffInArc` 的 `hooks.json`，调 `story_hooks` 确认成功且投影仍七列；再把记录加一个未知字段，调用报错并点名字段。

## Risks

- 两个字段在 P4 之前没有生产者：只有手改或导入的 `hooks.json` 会带它们；这是源工程同样存在的状态。
- 六动作挪到 P4 意味着本行不改变任何生命周期行为；`transitionHook` 的语义与源实现的差异继续存在，随 `chapter.settle` 一并处理（那里的计划会取代它）。
- 严格校验会让带历史未知字段的 `hooks.json` 读不出来；源工程同样拒绝，作者需要先清理文件。
