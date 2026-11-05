# Agent Note: foundation.truth-projections —— 三份 truth 投影

Status: implemented

## Problem

源工程每次保存运行状态都写七个文件：四份 JSON（`manifest`／`current_state`／`hooks`／`chapter_summaries`）加三份由它们渲染的 Markdown 投影（`story/current_state.md`、`story/pending_hooks.md`、`story/chapter_summaries.md`），一次原子提交（`state/runtime-state-store.ts:152-170`）。投影不是缓存，是给作者与模型读的事实视图：规划与上下文读 `.md`，`isBookFoundationComplete` 也要求 `pending_hooks.md` 存在（`utils/outline-paths.ts:15-41`）。

复刻侧只写四份 JSON（`core/state.ts`），另有一份「给作者看的伏笔表」在 `pipelines/long/hooks.ts:24`，由 `story_hooks` 工具返回。那份渲染与源工程投影**已经分叉**：换行映射成空格而不是 `<br>`、单元格不 trim、没有末尾换行。因此现在有三种状态文件视图（JSON、工具卡片、缺失的投影），没有一个与源工程一致。

后果：作者看不到可读的状态与伏笔池；`foundation.ready-check` 无法按源工程判据落地（`pending_hooks.md` 永远不存在）；P3 读状态时只有 JSON。

## Decision

### 一份渲染，两处使用

把渲染函数收进 `packages/see-dsh-novel/src/core/state-projections.ts`，格式对齐 `state/state-projections.ts`：

```ts
export function renderCurrentStateProjection(state: CurrentStateState, language: 'zh' | 'en'): string
export function renderHooksProjection(state: HooksState, language: 'zh' | 'en'): string
export function renderChapterSummariesProjection(state: ChapterSummariesState, language: 'zh' | 'en'): string
```

- 标题与表头按语言切换；
- 单元格转义：`|` → `\|`，换行 → `<br>`，去首尾空白；
- 伏笔按 `startChapter` → `lastAdvancedChapter` → `hookId` 排序，七列；
- 当前状态先过滤 `validUntilChapter === null || >= chapter`，再按 `subject` → `predicate` → `object` 排序，五列，正文前输出 `> 当前章节: N`；
- 章节摘要按 `chapter` 排序，八列；
- 末尾一个换行。

`pipelines/long/hooks.ts` 的 `renderHooksProjection` 删除，`story_hooks` 改为调用 core 的实现。这一步会改 `test/hooks.test.mjs` 的现有断言（转义、末尾换行），同批更新——它是 `foundation.hooks` 的消费者。

### 保存：四份 JSON + 三份投影，一次提交

`core/state.ts` 导出 `defaultStateSnapshot(hooks, language)`、`stateJsonWrites(snapshot)`、`stateProjectionWrites(snapshot)` 与 `inspectState(root, hooks, language)`（返回生效快照与「存在但解析失败」的文件清单）；`stateWritesIfMissing(root, hooks, language)` 只补缺失的 JSON 与缺失的投影，投影由生效快照渲染：

- 首次 details：七份文件在同一次 `commitFoundation` 里落盘；
- 投影被手删、JSON 还在：重跑 details 或自检按 JSON 重建，不覆盖 JSON；
- JSON 被推进过（章节、伏笔）：重跑 details 不覆盖它们，投影也只在缺失时补。

**语言按「manifest → work.json → zh」解析，读取落在管线层**。`core/state.ts` 只读状态目录里的 `manifest.json`（导出 `readManifestLanguage`），不认识作品身份；作品语言由 `pipelines/long/language.ts` 的 `projectionLanguage(root)` 解析：

- `story_foundation_details` 与 `story_hooks` 都用 `projectionLanguage`：有 manifest 用它（与源工程 `saveRuntimeStateSnapshot` 一致，`runtime-state-store.ts:157`），否则读 `work.json`，再否则 `zh`；`work.json` 或 manifest 读不出来时退回 `zh`；
- 自检路径只用 `manifest.json`（缺失或损坏则 `zh`），不读 `work.json`——它可能已损坏（`test/recovery.test.mjs:109-122`）。

### 自检只重建有源文件的投影

`runtime.recovery` 的索引集合扩到三份投影，但**投影只有在源 JSON 存在且可读时才可重建**；状态 JSON 存在却解析失败时报 `state-invalid`（不可修），不拿默认值覆盖：

| 情形 | 发现 | 可修 |
| --- | --- | --- |
| 投影缺失、源 JSON 在 | `state-missing` | 是（按 JSON 渲染补回） |
| 投影缺失、源 JSON 也缺 | `state-missing` | 否（伏笔池/状态已经丢了，不能拿空表冒充） |
| 投影在、源 JSON 缺 | `projection-stale` | 否（投影无法验证，留给作者判断） |

`hooks.json` 原本就不可重建（`src/core/recovery.ts:58,255-263`），这条保护措施保证它缺失时不会生成一份空的 `pending_hooks.md`、让 `foundation.ready-check` 误判完成。

## Alternatives considered

**在 `core` 里另写一套渲染，不动 `pipelines/long/hooks.ts`。** 少改一个已 verified 的行。否掉：两套渲染已经在转义与换行上分叉；源工程只有一份渲染同时喂工具回执与上下文，复刻也应如此，否则「作者看到的」与「文件里的」永远对不上。

**投影当缓存，按需渲染不落盘。** 少三份文件。否掉：源工程落盘，因为作者要直接读、外部工具要 grep、就绪判据也要看文件。

**自检无条件重建投影。** 简单。否掉：`hooks.json` 丢了之后重建一份空 `pending_hooks.md`，等于用空表冒充「没有伏笔」，还会让就绪判据通过。

**`core/state.ts` 自己读 `work.json` 决定语言。** 少一个参数。否掉：自检路径的 `work.json` 可能已损坏（`test/recovery.test.mjs:109-122` 就是这种用例），读它会 让 `apply` 失败。

**现在就把 `stateSnapshotWrites` 建好给 P4 用。** 提前抽象。否掉：本行没有消费者，且整份保存需要先校验（源工程 `saveRuntimeStateSnapshot` 先 validate 再写）；等 P4 结算行需要时一起做。

## Consequences

收益：状态不再只有 JSON。一次 details 写七份文件——四份 JSON 加三份投影，同一次原子提交；作者打开作品就能读到伏笔池、当前状态与章节摘要，下一行的就绪判据也终于能看到 `pending_hooks.md`。伏笔表只剩一份渲染：`story_hooks` 的回执与落盘投影逐字一致，换行转义成 `<br>`、单元格 trim、末尾一个换行，与源工程格式对齐。

落地：`packages/see-dsh-novel/src/core/state-projections.ts`（三个渲染函数与状态类型）、`src/core/state.ts`（`defaultStateSnapshot`、`stateJsonWrites`、`stateProjectionWrites`、`inspectState`、`readManifestLanguage`、`stateWritesIfMissing`）、`src/pipelines/long/language.ts`（`projectionLanguage`）、`src/plugin/agent.ts`（`story_hooks` 用 core 渲染与 `projectionLanguage`）、`src/core/recovery.ts`（投影纳入自检：源可读则重建，源缺失或损坏不可修，另报 `projection-stale`／`state-invalid`）、`src/pipelines/long/tools.ts`（details 传语言）。`pipelines/long/hooks.ts` 已删除，渲染只此一份。

验证见 `test/state-projections.test.mjs`（排序、转义与末尾换行、中英表头、事实按 `validUntilChapter` 过滤、八列摘要、空表仍带表头）、`test/foundation.test.mjs`（投影与 JSON 同批落盘，`pending_hooks.md` 带表头与该次伏笔行）、`test/hooks.test.mjs`（回执与投影同一渲染）、`test/recovery.test.mjs`（删投影可修、源缺失不可修、`projection-stale` 只报告）。

### 代价与已知限制

- 投影是派生文件：手改投影不会回流 JSON，重建时会被覆盖；与源工程一致（投影是只读视图）。
- 事实与摘要的字段（`subject`／`predicate`／`validUntilChapter`、八列摘要）现在没有生产者，投影只显示空表；字段契约由 P4 结算行填充。
- 没有 `work.json` 的工作区按 `zh` 渲染；`work.json` 读不出来时 `story_hooks` 退回 `zh`。
- 自检把投影当索引修补：作者手写过的投影会在重建时被覆盖。
- 删掉 `hooks.json` 同时保留投影时，投影只能报 `projection-stale`，没有自动修复路径。
