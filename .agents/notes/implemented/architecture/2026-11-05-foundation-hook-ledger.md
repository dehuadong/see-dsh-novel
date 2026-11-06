# Agent Note: foundation.hook-ledger —— 两个字段与严格校验

Status: implemented

## Problem

源工程的伏笔记录比复刻多两个可选字段，并且整条记录是严格的：

- `HookRecordSchema` 带 `dependsOn: string[]`（每个元素非空）与 `paysOffInArc?: string`，整条记录 `.strict()`（`models/runtime-state.ts:18-29`）；
- 这两个字段**不由任何动作写入**：六动作（新建／提及／推进／回收／延后／撤回）的合并实现 `mergeHookRecord` 只覆盖 `startChapter`／`type`／`status`／`lastAdvancedChapter`／`expectedPayoff`／`notes`（`state/state-reducer.ts:124-142`），从 incoming 复制这两个字段会丢；源工程里它们只可能出现在外部写入的 `hooks.json`（手改、导入或未来的结算扩展）中。

复刻的 `HookRecord` 只有七个基本字段，`validateHooks` 也不拒绝未知字段；带这两个字段的记录会被静默接受但字段丢失，带未知字段的记录同样会被放过。严格性缺口会在 P4 读状态时暴露。

## Decision

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

## Consequences

收益：伏笔记录现在与源 schema 同形——`dependsOn` 与 `paysOffInArc` 可存、可读、可往返；未知字段、空 id、非字符串的 `expectedPayoff`／`notes` 都会被拒绝，`story_hooks` 读到的就是源工程会接受的那一份；投影仍是七列，读的人不会看到两个内部字段。

落地：`packages/see-dsh-novel/src/core/hooks.ts`（两个字段、`HOOK_FIELDS`、严格校验、去掉「最近推进不得早于起始章」的额外约束）；旧笔记 `implemented/architecture/2026-11-04-foundation-hooks.md` 的字段表同批同步。

验证见 `test/hooks.test.mjs`：字段接受与 JSON 往返、`dependsOn` 空串／非数组拒绝、`paysOffInArc` 空串合法、`paysOffInArc`／`expectedPayoff`／`notes` 类型拒绝、记录与状态上的未知字段拒绝、非对象记录拒绝、纯空白 `type` 合法、章节先后的旧约束不再拒绝。

### 代价与已知限制

- 两个字段在 P4 之前没有生产者：六动作的合并实现不复制它们（源工程同样如此），只有手改或导入的 `hooks.json` 会带。
- 六动作的语义差异（`transitionHook` 与源 `state-reducer.ts` 不同）留给 P4 的 `chapter.settle`，那一行会带着工具入口与真实会话证据一起处理。
- 严格校验会让带历史未知字段的 `hooks.json` 读不出来；源工程同样拒绝，作者需要先清理文件。
- `dependsOn` 不做引用完整性；指向不存在的 id 合法，引用校验留给结算调用方。
