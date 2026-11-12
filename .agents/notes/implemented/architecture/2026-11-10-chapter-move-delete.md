# Agent Note: chapter.move-delete —— 删除最新章与状态回滚

Status: implemented

## Problem

`chapter.move-delete` 曾是 `missing`。已定稿的最后一章删不掉：正文、审稿、章纲、状态、快照与章节索引都没有“退回去”的入口；作者写坏一章只能重开再改，不能把这一章整个撤回。

源工程只支持**删除最新章**（删除中间章要重编号并重放后续状态，源明确拒绝）；删除时先把章节文件移到 `chapters/.trash/`（不硬删），再用上一章快照回滚状态、快照、运行时文件与章节索引，并删除检索库。能力标题里的“移章/重排”在源工程没有对应实现，行标题收窄为“删最新章与状态回滚（源无移章）”。

## 源工程证据

- `inkos/packages/core/src/state/chapter-delete.ts:33-115` 的 `deleteLatestChapter`：只允许删最新章；删前校验上一章快照 `story/snapshots/<latest-1>/current_state.md` 与 `pending_hooks.md` 存在（`:60-71`）；章节文件 `rename` 到 `chapters/.trash/`（重名时挑可用名 `-2`）；回滚失败把 trash 文件搬回；返回 `trashedFiles`／`rolledBackTo`／`discarded`。
- `inkos/packages/core/src/state/manager.ts:612-675` 的 `rollbackToChapter`：从 `story/snapshots/<target>/` 恢复状态与投影，删掉章节号大于 target 的章节文件、快照、`story/runtime/chapter-*`、`story/drafts`，删 `memory.db*`，并把 `chapters/index.json` 重写成保留项。
- `inkos/packages/core/src/agent/agent-tools.ts:2937-2950`：删除工具的描述与回执。
- `inkos/packages/core/src/pipeline/runner.ts:514`：建书阶段写 `story/snapshots/0/` 初始快照。

## Decision

### 前置：初始快照

`src/pipelines/long/tools.ts` 的 foundation details 在写状态文件的同时写 `source/story/snapshots/0/`（四份状态 JSON + 三份投影）；状态文件损坏时不写。`state.ts` 的 `snapshotWrites(snapshot, chapter)` 提供同一份复制逻辑。这样删除第 1 章时上一章快照存在。

### 删除与回滚

`src/core/delete-chapter.ts` 的 `deleteLatestChapter(root, chapter)`：

- 章号必须是当前最新章；否则拒绝（删中间章需要重编号并重放后续状态）。
- 上一章快照只要求 `current_state.md` 与 `pending_hooks.md`；缺失时在移动任何文件之前拒绝。
- 该章所有 `chapters/<数字>_*.md` 移到 `chapters/.trash/`，重名挑 `name-2.ext`；记录 `trashedFiles`。
- 按快照实际文件写回：两份必需投影 + `state/*`；`chapter_summaries.md` 缺失时删除投影，活状态里多出的 `state/*` 一并删除。
- 索引：严格读取 `chapters/index.json`，保留项原样写回；索引缺失而章节文件存在、JSON 非法或条目不合法时拒绝。
- 删除：更晚章的章节文件、快照目录、`story/runtime/chapter-*`、`story/drafts`、`memory.db`／`-shm`／`-wal`。
- 一次 `commitFoundation`；提交失败把 trash 搬回，搬回也失败时抛 `AggregateError`。
- 返回 `{ deletedChapter, title, trashedFiles, rolledBackTo, discarded }`。
- 删除后 `current_state.chapter` 回到 `chapter-1`，`detectStage` 回到 `foundation-ready`。

### 工具与阶段

- `src/pipelines/long/delete-tool.ts` 的 `story_delete_chapter({chapter})`，`withWorkAction` 内执行。
- `chapter-done` 协议增加删除一步；面板当前不加动作（源 Studio 有删除按钮与确认，`ChapterWorkspacePanel.tsx:132-163`）；作者裁决补面板动作，记 D40。
- 章节索引的读取与构建都在 `src/core/chapter-index.ts`；删除用严格读取，定稿用构建。

### 范围与非目标

- 只删最新章；**不做移章/重排**（源没有该能力）。
- 不做状态校验与 reconciliation（D34）；不重算历史章（D33 仍影响重结算，不影响删除）；前置与判据已按源对齐，D52 由 [删除索引前置对齐](2026-11-12-chapter-delete-parity.md) 注销。
- 检索同步只做源行为：删 `memory.db*`，下一次搜索重建索引。

## Alternatives considered

- **软删：只把章节标记为 deleted** — 可撤销。否掉：源用 `chapters/.trash/` 保留原文并在状态层回滚；标记删除会让阶段判定与索引看到“不存在但仍在”的章。
- **允许删中间章并重编号** — 功能更强。否掉：源明确拒绝（重编号要重放后续状态），自创会破坏状态与快照的章号对应。
- **删除时不回滚状态，只删文件** — 简单。否掉：源删除后状态回到上一章；不回滚会让当前状态领先于实际章节。
- **保留 memory.db，靠搜索过滤已删章** — 少删文件。否掉：源删库重建；保留会留下已删章的记忆条目。
- **把初始快照放到本行之外** — 更小的 diff。否掉：没有 snapshot 0 就删不了第 1 章，本行不可用；源也在建书时写它。

## Testing

- `test/chapter-delete.test.mjs`（16 例）：snapshot 七文件；删除最新章后原文进 trash、状态与投影回滚、索引清空、审稿/章纲/快照/`memory.db` 删除、阶段回 `foundation-ready`；最小快照（两份投影 + 任意 `state/*`）；缺快照/缺单份必需投影/`state/` 空拒绝；索引缺失/非法 JSON/非数组/未知键/嵌套未知键/非法日期/空 `sourceRefs` 拒绝；无章节、坏 `work.json` 不阻止；乱序索引取最大章、中间章拒绝、保留项原样写回；章号>target 与 `drafts` 删除；trash 重名 `-2`。
- `test/foundation.test.mjs`：details 写 `snapshots/0/` 七份文件且与活状态一致。
- `test/host.test.mjs`：工具清单包含 `story_delete_chapter`。
- `test/stage-context.test.mjs`：`chapter-done` 协议包含 `story_delete_chapter`。
- `pnpm run verify` 全绿；回执记录一次删除与回滚。

## Consequences

- 旧作品若没有 `snapshots/0/`，删除第 1 章会被“快照缺失”拒绝；这是源行为，不是缺陷。
- 删除以章节索引为最新章判据；索引缺失或不合法时拒绝，不按文件重建。
- trash 不参与阶段判定与检索；重复删除不会覆盖旧稿，只会加后缀。
- 删除不改变作品状态（`active` 保持），下一章仍需重新开始。
