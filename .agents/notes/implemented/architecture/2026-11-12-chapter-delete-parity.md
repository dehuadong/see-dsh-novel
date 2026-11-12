# Agent Note: 删除最新章与索引前置对齐

Status: implemented

## Problem

`chapter.move-delete` 的删除路径曾比源工程更严，也比源工程更松：

- 快照前置：复刻要求上一章快照七份文件齐全，还要读 `state/manifest.json` 校验 `lastAppliedChapter`、解析并校验 hooks／summaries；源只 stat `story/snapshots/<latest-1>/current_state.md` 与 `pending_hooks.md`，其余按快照里实际存在的文件恢复（`state/chapter-delete.ts:60-71`）。
- 最新章判据：复刻按 `chapters/*.md` 的章号定最新章，索引缺失时用 `buildChapterIndex` 重建；源用 `loadChapterIndex`，索引缺失而章节文件存在时直接报错（`state/manager.ts:450-463`），最新章取索引里的最大章号。
- 索引回写：复刻重建整份索引；源只保留 `number <= target` 的既有条目并原样写回（`state/manager.ts:622-631` 过滤、`:666-673` 写回），`observations`／`createdAt` 不被重算。

追溯评审把这几条记为 D52。删除后状态回滚的规则本身（trash、`rolledBackTo`／`discarded`、失败搬回）已经与源一致，本行只修前置、判据与回写。

## Decision

### 范围与非目标

- 范围：删除前置改为源的两份快照文件；最新章与保留项改从章节索引判定；索引缺失而章节文件存在时拒绝；索引按源严格解析并原样保留保留项。
- 非目标：不加面板删除动作（D40 是 `panel.workbench` 的独立工作项）；不改重开/重结算（D33／D36）；不做移章/重排（源没有）。
- 不改 trash 命名、失败搬回、`AggregateError`、检索库删除与初始快照行为。

### 交付行为

- 删除最新章时，只要上一章快照有 `current_state.md` 与 `pending_hooks.md`，且快照 `state/` 下至少一份文件，就能删除；不再要求 manifest 的 `lastAppliedChapter`、hooks 或 summaries 可解析。
- 快照缺 `chapter_summaries.md` 时，回滚后删除 `story/chapter_summaries.md`；快照里有哪些 `state/*` 文件就恢复哪些，活状态里多出的文件删除。
- 最新章取章节索引的最大章号；索引缺失而章节文件存在，或索引不合法时，在移动任何文件之前拒绝，并说明未改动任何文件。
- 保留项是索引里 `number <= target` 的条目，字段原样写回；`discarded` 是索引里 `number > target` 的章号。
- 中间章、无章节、快照 `state/` 为空时仍拒绝。
- 删除不读 `work.json`（源也不读）；坏身份文件不阻止删除。

### 决定与未决问题

- 索引解析放在 `chapter-index.ts` 的 `readChapterIndexStrict`，按源 `ChapterMetaSchema` 的字段与严格性校验；删除路径用它，定稿路径的索引收紧仍归 D49。
- 快照恢复按源 `prepareStateRestore` 的规则做：必要两份、`state/` 非空、`state/*` 动态恢复、summaries 可选。
- 未决问题：无。

### 评审与批准证据

- Plan Review 第 1 轮：需修订（源行号错、`ObservationSchema` 字段不全、`work.json` 行为与流程不一致、验收缺失败面、章节文件名口径未定）；已修正。
- Plan Review 第 2 轮：仍需修订（索引过滤/写回行号偏一行）；已按源码核对为 `manager.ts:622-631`／`:666-673`。
- Plan Review 第 3 轮：通过，无未解决 blocker/major。
- Implementation Review（Standards / Spec）：首轮各报 5／6 条，修正后复核通过。
- 批准与执行授权：2026-11-12，作者批准 `implement chapter.move-delete`。

## Design

### 严格索引读取

`src/core/chapter-index.ts` 的 `readChapterIndexStrict(root)`：

- `source/chapters/index.json` 缺失时，若 `chapters/` 下存在按 `^(\d+)_.*\.md$` 命中的章节文件则抛「索引缺失而章节文件存在」；没有章节文件返回空数组。错误都带「未改动任何文件」。
- JSON 必须是数组；每条按源 `ChapterMetaSchema` 校验：`number` 整数 ≥1、`title` 字符串、`wordCount` 整数、`createdAt`／`updatedAt` 为 RFC 3339（含闰年日历校验）、`provenance` 为 `generated|imported|edited`；`observations` 逐条校验 `code`／`summary`（非空）、`assessment` 枚举、`category` 枚举、`scope`／`targetHash` 字符串、`target`（`workId`／`artifactId`／`revisionId`，strict）、`evidence` 字符串数组（缺省补 `[]`，与源默认一致）、`sourceRefs`（`sourceId`／`quote` 非空，strict）；`lengthTelemetry`／`tokenUsage` 可选并按源 strict 校验。未知键一律拒绝。
- 校验失败抛索引路径与第几条记录，不写盘。

### 删除流程

`src/core/delete-chapter.ts` 的 `deleteLatestChapter(root, chapter)`：

1. `readChapterIndexStrict`；无条目时报「没有可删除的章节」；最新章取 `max(number)`；请求章号不等于最新章时拒绝。判断「索引缺失而章节文件存在」用源的文件名口径 `^(\d+)_.*\.md$`，不复用只认 4 位的建索引正则。
2. 前置只 stat `story/snapshots/<target>/current_state.md` 与 `pending_hooks.md`；缺任一在移动文件前拒绝。
3. 读取快照恢复集：必要两份 + `snapshot/state/` 下全部文件；`state/` 为空时拒绝。`chapter_summaries.md` 存在则加入写入，缺则加入删除；活 `state/` 中不在快照里的文件加入删除。
4. 该章 `chapters/<digits>_*.md` 移到 `chapters/.trash/`，重名挑 `-2` 后缀；记录 `trashedFiles`。
5. 一次 `commitFoundation` 写恢复集与 `chapters/index.json`（`kept` 原样），删除：活状态多余文件、缺省的 summaries 投影、章号大于 target 的章节文件／快照／`runtime`／`drafts`、`memory.db*`。
6. 提交失败把 trash 搬回；搬回也失败抛 `AggregateError`。
7. 返回 `{ deletedChapter, title, trashedFiles, rolledBackTo, discarded }`；`title` 取索引条目。

### 兼容与失败行为

- 旧快照只要有两份必要投影就能删除；这比现状更宽，不再因缺 manifest 或 summaries 拒绝。
- 索引缺失/不合法时不再重建，删除直接失败；需要修复索引后重试。
- 旧索引若含未知字段会被拒绝；修复方式是去掉未知字段。
- `chapter_summaries.md` 缺失时删除投影而不是写空文件。
- 实现文件：`src/core/chapter-index.ts`、`src/core/delete-chapter.ts`。

## Alternatives considered

- **保持七份快照前置** — 改动小。否掉：源只要求两份，更严的前置会拒绝源能删的作品；这是自创门槛。
- **索引缺失时继续按文件重建** — 容错好。否掉：源明确拒绝「索引缺失而章节文件存在」，重建会掩盖索引损坏并改变最新章判据。
- **只放宽前置，不改索引回写** — 少改一处。否掉：重建会重算他章 `observations`／`createdAt`，与源「保留项原样写回」不一致。
- **严格解析放在删除路径内联** — 少一个导出。否掉：定稿（D49）之后也要同一个严格读取，放 `chapter-index.ts` 可复用。

## Testing

- `test/chapter-delete.test.mjs`（16 例）：七份初始快照；最新章删除与状态回滚；只删最新章；缺快照、缺单份必需投影、`state/` 空拒绝且不建 trash；trash 重名 `-2`；最小快照（两份投影 + 任意 `state/*`）成功且缺省投影被删；索引缺失/非法 JSON/非数组/未知键/嵌套未知键/非法日期/空 `sourceRefs` 拒绝；严格读取接受 `finalize` 写出的 `category` 观察；无章节、坏 `work.json` 不阻止；索引乱序时取最大章、中间章拒绝、保留项原样写回；章号>target 与 `drafts` 删除。
- `test/foundation.test.mjs`：details 写 `snapshots/0/` 七份文件且与活状态一致。
- `test/host.test.mjs`、`test/stage-context.test.mjs`：工具清单与 `chapter-done` 协议回归。
- `pnpm run verify` 全绿：413 tests；`artifacts/real-runs/chapter.move-delete.json` 已按新行为重录。
- D52 已从 `docs/scope.md` 注销，审计判定改为等价。

## Consequences

- 严格索引会拒绝旧工作区里字段不全或带未知字段的索引；这是源行为，修复方式是修索引。
- 快照 `state/` 为空时删除失败；源同样拒绝（`prepareStateRestore` 返回 null）。
- 动态恢复 `state/*` 会让删除写入集随快照变化，测试要覆盖多文件与缺文件两种。
- 索引与章节文件不一致时以索引为准；损坏的工作区需要先修索引。
- 读取索引的严格校验和定稿的索引收紧是两处使用；D49 仍留给 `chapter.finalize`。
