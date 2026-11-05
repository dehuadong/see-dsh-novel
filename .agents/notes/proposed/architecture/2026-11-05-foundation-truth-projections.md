# Agent Note: foundation.truth-projections —— 三份 truth 投影

Status: proposed

## Problem

源工程每次保存运行状态都写七个文件：四份 JSON（`manifest`／`current_state`／`hooks`／`chapter_summaries`）加三份由它们渲染的 Markdown 投影（`story/current_state.md`、`story/pending_hooks.md`、`story/chapter_summaries.md`），一次原子提交（`state/runtime-state-store.ts:152-170`）。投影不是缓存，是给作者与模型读的事实视图：规划与上下文读 `.md`，`isBookFoundationComplete` 也要求 `pending_hooks.md` 存在（`utils/outline-paths.ts:15-41`）。

复刻侧只写四份 JSON（`core/state.ts`），另有一份「给作者看的伏笔表」在 `pipelines/long/hooks.ts:24`，由 `story_hooks` 工具返回。那份渲染与源工程投影**已经分叉**：换行映射成空格而不是 `<br>`、单元格不 trim、没有末尾换行。因此现在有三种状态文件视图（JSON、工具卡片、缺失的投影），没有一个与源工程一致。

后果：作者看不到可读的状态与伏笔池；`foundation.ready-check` 无法按源工程判据落地（`pending_hooks.md` 永远不存在）；P3 读状态时只有 JSON。

## Proposal

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

`core/state.ts` 的 `defaultStateFiles(hooks, language)` 增加语言参数（默认 `zh`），返回七份写入项；`stateWritesIfMissing(root, hooks, language)` 只补缺失的 JSON 与缺失的投影，投影由**生效状态**渲染：

- 首次 details：七份文件在同一次 `commitFoundation` 里落盘；
- 投影被手删、JSON 还在：重跑 details 或自检按 JSON 重建，不覆盖 JSON；
- JSON 被推进过（章节、伏笔）：重跑 details 不覆盖它们，投影也只在缺失时补。

**语言显式传入**，不在 `core/state.ts` 里读 `work.json`：`story_foundation_details` 读 `work.json` 的 `language`（没有就 `zh`）后传给播种函数；自检路径不读 `work.json`（它可能坏掉），语言从已有 `manifest.json` 取，缺失则 `zh`。

### 自检只重建有源文件的投影

`runtime.recovery` 的索引集合扩到三份投影，但**投影只有在源 JSON 存在时才可重建**：

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

## Acceptance criteria

- `story_foundation_details` 一次写入 7 个文件：四份 `source/story/state/*.json` 与三份 `source/story/{current_state,pending_hooks,chapter_summaries}.md`；投影标题、表头、列序、空表、末尾换行与源工程一致。
- 中文作品（`work.json` 的 `language: "zh"` 或缺失）得到中文标题与表头；`language: "en"` 得到 `# Pending Hooks`／`# Current State`／`# Chapter Summaries`。
- 伏笔投影排序与转义：`|` → `\|`、换行 → `<br>`、单元格 trim；`story_hooks` 工具回执与落盘投影逐字一致（同一次调用）。
- 当前状态投影过滤 `validUntilChapter < chapter`，正文前有 `> 当前章节: N`；章节摘要按章节号排序、八列。
- 重跑 details：已有 JSON 与投影不覆盖；删掉某份投影后重跑只补缺失的那份、按 JSON 重建。
- 自检：删 `pending_hooks.md`（`hooks.json` 在）→ `state-missing` 可修，`apply` 补回且 JSON 不变；同时删 `hooks.json` 与 `pending_hooks.md` → `state-missing` 不可修，`apply` 不生成空投影；`pending_hooks.md` 在而 `hooks.json` 缺 → `projection-stale` 不可修。
- 既有测试同批更新：`test/foundation.test.mjs` 的文件数从 4 改为 7、`test/hooks.test.mjs` 的转义与末尾换行断言、`test/recovery.test.mjs` 的路径集合断言与「work.json 坏了仍能修 manifest」用例。
- 实现与证据：implementation `packages/see-dsh-novel/src/core/state-projections.ts`；consumer `packages/see-dsh-novel/test/state-projections.test.mjs`；播种、工具与自检改动在 `src/core/state.ts`、`src/pipelines/long/hooks.ts`、`src/core/recovery.ts`；realRun `artifacts/real-runs/foundation.truth-projections.json`。
- 真实运行：空工作区调 `story_foundation_details`，确认七份文件都在、`pending_hooks.md` 含表头与该次伏笔行、`story_hooks` 回执与文件一致；再删 `pending_hooks.md` 跑 `story_recover`（扫描 + `apply`）确认补回。

## Risks

- 投影是派生文件：手改投影不会回流 JSON，重建会被覆盖；与源工程一致（投影是只读视图）。
- 事实与摘要的字段（`subject`／`predicate`／`validUntilChapter`、八列摘要）现在没有生产者，投影只能显示空表；字段契约由 P4 结算行填充。
- 没有 `work.json` 的工作区按 `zh` 渲染。
- 自检把投影当索引修补时，作者手写过的投影会在重建时被覆盖。
