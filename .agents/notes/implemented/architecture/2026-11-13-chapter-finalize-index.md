# Agent Note: 定稿只更新本章索引行

Status: implemented

## Problem

`chapter.finalize` 曾用 `buildChapterIndex` 重建整份章节索引：每章的 `updatedAt` 都被置为当前时间，`observations`／`title`／`wordCount` 全部重算；索引缺失时按章节文件静默重建，索引校验也只查 `number`／`title`。这与源工程的章节保存不一致：

- 源 `pipeline/chapter-persistence.ts` 的 `persistChapterArtifacts` 只替换当前章的条目：已有条目保留 `createdAt`，新条目用当前时间；其余条目原样保留；条目写 `title`、`finalWordCount`、审稿观察与 `provenance: generated`。
- 源 `state/manager.ts:450-463` 的 `loadChapterIndex` 严格解析 `ChapterMetaSchema`，索引缺失而章节文件存在时直接报错。
- 源 `agents/writer.ts:440-448` 把 `chapters/index.json` 与章节、状态、快照一次提交；标题变化时删除被取代的章节文件属于 D35，不在本行。

追溯评审把「全量重建、缺索引重建、宽松校验」记为 D49。D45 的 revise 路径（修订不更新索引、后代无 `upstream-revision`、`provenance` 不写 `edited`）不在本行。

前置缺口（复刻没有建书初始索引）已由 [建书写初始章节索引](2026-11-13-initial-chapter-index.md) 独立交付；本行不再改 `foundation.architect`。

## Decision

### 范围与非目标

- 范围：定稿改为严格读取索引、只替换当前章条目、保留其余条目；索引缺失/不合法时拒绝。
- 非目标：不写 `lengthTelemetry`／`tokenUsage`（D35）；不清理标题变化产生的 superseded 文件（D35）；不合并结算与定稿的提交（D37）；不改修订路径的索引更新与后代标记（D45 保留）。

### 交付行为

- 定稿读取 `chapters/index.json`：索引缺失而章节文件存在、JSON 非法、条目缺字段/未知键/非法日期时，在写盘前拒绝。
- 定稿只更新当前章条目：已存在时保留 `createdAt`，`updatedAt` 用当前时间；不存在时追加并令 `createdAt = updatedAt = now`。其余条目逐字段不变（严格读取会为缺 `evidence` 的观察补 `[]`）。
- 条目写当前章标题、字数、本章审稿观察与 `provenance: generated`；`chapters` 计数取索引长度。
- 快照与 `work.json` 的写入与现在一致；重复定稿幂等（保留 `createdAt`，刷新 `updatedAt`）。

### 决定与未决问题

- 用 `chapter.move-delete` 已加的 `readChapterIndexStrict`，删除与定稿共享同一严格读取；不再用 `buildChapterIndex`。
- 索引顺序按源：已有条目原位替换、新条目追加，不按章号重排。
- 未决问题：无。

### 评审与批准证据

- Plan Review 第 1 轮：需修订（阻断：复刻没有建书初始索引，严格读取会让首章定稿必然失败）；已把初始索引拆为独立工作项。
- Plan Review 第 2 轮：需修订（AC8 没有测试归属；初始索引属于 `foundation.architect`，与铁律 1 的归属需裁决）；已拆出并完成前置（`7925d42`）。
- Plan Review 第 3 轮：通过，无未解决 blocker/major。
- Implementation Review（Standards / Spec）：首轮各报 7／7 条；标题改用 `chapterTitleOf`、补原位替换与非法索引用例、清理死代码后复核通过。
- 批准与执行授权：2026-11-13，作者批准 `implement chapter.finalize`。

## Design

### 严格读取与单行更新

`src/core/finalize.ts`：

- `const entries = await readChapterIndexStrict(root)`；缺失/不合法由该入口拒绝。
- 用当前正文文档的标题、`countChapterLength(正文, work.language)` 与 `review.observations` 组装本章条目：
  - `number`、`title`、`wordCount`、`observations`、`provenance: 'generated'`；
  - `updatedAt = now`；
  - 已有同章条目时 `createdAt` 取旧条目；否则 `createdAt = now`。
- 已有同章条目时原位替换；否则追加到数组末尾。其余条目不动。
- `chapters` 返回 `nextEntries.length`；写入仍是同一次 `commitFoundation`（快照 + 索引 + `work.json`）。

### 标题与字数来源

- 标题取 `document.heading` 经 `chapterTitleOf`（接受 `# 第N章：标题` 与空格形式，取不到回退文件名），不重新渲染。
- 字数按 `document.content` 与 `countChapterLength` 计算，与现状一致。

### 兼容与失败行为

- 旧索引只要通过严格校验就能继续定稿；缺 `evidence` 的观察按严格读取的默认补 `[]`（与源 schema 默认一致）。
- 索引缺失时不再按文件重建；修复索引后重试。新建作品由基础设定写 `[]`。
- 重复定稿刷新 `updatedAt` 但保留 `createdAt`；标题变化不会删除旧文件（D35）。
- 实现文件：`src/core/finalize.ts`、`src/core/chapter-index.ts`。

## Alternatives considered

- **继续 `buildChapterIndex`，只禁止改他章 `updatedAt`** — 改动小。否掉：它仍会重算他章 observations/title/wordCount，与源的「只替换当前条目」不一致。
- **缺索引时按文件重建并给出警告** — 容错好。否掉：源明确拒绝「索引缺失而章节文件存在」，重建会掩盖损坏。
- **把严格读取内联在定稿里** — 少一个依赖。否掉：删除路径已经需要同一份严格读取，内联会造出第二份。
- **顺便补 `lengthTelemetry`／`tokenUsage`** — 更完整。否掉：属于 D35，本行没有遥测来源，补空字段是伪造。
- **用修订路径的 `chapterTitleFromHeading` 取标题** — 复用现成函数。否掉：它只认「第N章+空白」，会把 `# 第N章：标题` 或导入文档头误拒；定稿需要 `titleOf` 的兼容与文件名兜底。

## Testing

- `test/chapter-finalize.test.mjs`（8 例）：快照七文件与状态一致；严格索引单行写入、其他条目逐字段不变；两章时定稿第 2 章不动第 1 章；已有条目保留 `createdAt`、`updatedAt` 刷新；新条目 `createdAt = updatedAt`，`chapters` 计数正确；冒号标题仍取到标题；缺索引/未知键/缺字段/非法日期/非数组在写盘前拒绝且 `work.json` 未写；`draft→active`。
- `test/chapter-delete.test.mjs`：fixture 补种空索引后既有用例全绿。
- `pnpm run verify` 全绿：422 tests；`artifacts/real-runs/chapter.finalize.json` 已按新行为重录。
- D49 已从 `docs/scope.md` 注销，审计判定同步。

## Consequences

- 严格索引会拒绝旧工作区里字段不全或带未知字段的索引；这是源行为，需要先修索引。
- 索引顺序变成插入顺序；若旧索引按章号排过，定稿不会重排。
- `observations` 来自本章审稿记录，其它章条目即使审稿变化也不会在定稿时更新；这是单行更新的预期。
- 替换本章条目不会保留旧的 `lengthTelemetry`／`tokenUsage`；源 `persistChapterArtifacts` 同样只写调用方传入的值，而本行没有遥测来源（D35）。
- 删除已无消费者的 `buildChapterIndex`／`listChapterFiles`；`readChapterIndex` 仍由导出使用。D37（拆分提交）与 D35 仍是本行的债。
