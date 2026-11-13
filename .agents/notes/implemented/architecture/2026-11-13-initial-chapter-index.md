# Agent Note: 建书写初始章节索引

Status: implemented

## Problem

复刻的作品初始化只写章节正文、状态、投影与快照，不写 `source/chapters/index.json`。全仓只有定稿与删除会写它，而且都要先有章节文件。源工程在书籍初始化时就写初始索引：

- `pipeline/runner.ts:511` 在 staging 目录 `saveChapterIndexAt(stagingBookDir, [])`，随后 `:514` 写初始快照；
- `pipeline/runner.ts:729-731` 的初始化路径先 `mkdir chapters`，再 `saveChapterIndex(book.id, [])`，再 `snapshotState(book.id, 0)`。

没有这一步，`chapter.finalize` 一旦改成严格读取索引，首章定稿就会因为「索引缺失而章节文件存在」被拒绝；新作品也就没有合法的索引创建路径。本工作项把初始索引补在 `story_foundation_details` 的初始快照同批，但只在「没有章节文件、且本次会写初始快照」时写，避免造出源明确拒绝的「空索引 + 章节文件」状态。

## Decision

### 范围与非目标

- 范围：`story_foundation_details` 在「`chapters/` 下没有章节文件、索引不存在、本次会写初始快照」时写入 `[]`，与初始快照同一次提交；已存在索引时不覆盖。
- 非目标：不改定稿的索引更新规则（另立 `chapter.finalize` 工作项）；不补 `lengthTelemetry`／`tokenUsage`（D35）；不改四段 schema、角色卡或状态播种；不迁移已有章节文件但缺索引的旧工作区。

### 交付行为

- 新工作区跑完 `story_foundation_details` 后，`source/chapters/index.json` 存在且内容为 `[]`（无末尾换行，与源 `saveChapterIndexAt` 一致）；`source/chapters/` 目录存在。
- 索引已存在（例如重跑基础设定）时，details 不写它，已有条目逐字节不变。
- `chapters/` 下已有章节文件、索引却缺失时，details 不写 `[]`：源 `saveChapterIndexAt` 明确拒绝空索引与章节文件并存；这种工作区要人工修索引，details 不制造非法状态。
- 本次状态损坏、原本就不写初始快照时，也不写索引：索引与初始快照同条件，避免留下「索引在、snapshots/0 缺」的源不会产生的状态。
- 写入与初始快照、状态、方向文档同一次 `commitFoundation`；失败整体回滚。

### 决定与未决问题

- 初始索引属于 `foundation.architect` 的 details 产物；`chapter.finalize` 的严格读取依赖它，两个工作项按能力行分开交付。
- 已有章节文件但缺索引的旧工作区不由 details 迁移：源拒绝「空索引 + 章节文件」，details 跳过；需要人工修复索引后再定稿。
- 未决问题：无。

### 评审与批准证据

- Plan Review 第 1 轮：需修订（有章节文件时写 `[]` 造出源拒绝的状态；finalize Note 仍把前置列入自己的范围并留待裁决；`[]` 字节形态不一致；状态损坏时索引/快照条件不一致）；已修正。
- Plan Review 第 2 轮：通过，无未解决 blocker/major。
- Implementation Review（Standards / Spec）：首轮各报 5／3 条；去掉注释中的源函数名、条件改为从 `initialSnapshot` 派生、拆分跳过用例并补回滚用例后复核通过。
- 批准与执行授权：2026-11-13，作者批准 `implement foundation.architect`。

## Design

### 写入位置与条件

`src/pipelines/long/tools.ts` 的 `story_foundation_details`：

- 抽一个 `hasChapterFiles(root)` 到 `core/chapter-index.ts`（文件名口径 `^(\d+)_.*\.md$`，与严格读取一致），details 与 `readChapterIndexStrict` 共用；它与只认 4 位的 `listChapterFiles` 是两种口径。
- 只有同时满足三个条件才加入 `{ relativePath: CHAPTER_INDEX_PATH, content: '[]' }`：
  1. 本次会写初始快照（`initialSnapshot.length > 0`）；
  2. `hasChapterFiles(root)` 为 false；
  3. `source/chapters/index.json` 不存在（`pathExists` 只把 ENOENT 当不存在）。
- 与 `bookRulesWrites`、`stateWrites`、`initialSnapshot`、`controlWrites` 一起交给同一次 `commitFoundation`。
- 已存在索引或已有章节文件时不加入写入，保持重跑幂等且不造出源拒绝的状态。

### 兼容与失败行为

- 已有章节文件但缺索引的旧工作区不由 details 迁移：源拒绝「空索引 + 章节文件」，details 跳过；需要人工修复索引后再定稿。
- 索引损坏但存在时 details 不覆盖；修复索引属于维护动作。
- 状态损坏、原本就不写初始快照时，索引也跳过；不制造「索引在、snapshots/0 缺」的状态。
- 实现文件：`src/core/chapter-index.ts`、`src/pipelines/long/tools.ts`。

## Alternatives considered

- **在 `/story-init` 命令里写索引** — 更贴近源的「建书」时点。否掉：命令只写身份与 brief，基础设定是后续阶段；把索引放进 details 能保证「初始快照与索引同批」，与源 `runner.ts:511-514` 的顺序一致。
- **首次定稿时自动创建索引** — 少一次初始化。否掉：那正是被 D49 判掉的「缺索引按文件重建」；源在建书时就有索引。
- **在写第一章时创建索引** — 分散到另一个能力行。否掉：源在写章节之前就有索引，且首章定稿前索引必须存在。
- **为初始索引新增独立工具** — 入口清晰。否掉：模型会多一个可忘记调用的步骤；details 已经是初始化的唯一入口。
- **有章节文件时也写 `[]`** — 能让旧工作区自动补索引。否掉：源 `saveChapterIndexAt` 明确拒绝空索引与章节文件并存，写了会造出导出/定稿误判的状态。

## Testing

- `test/foundation.test.mjs`（12 例）：details 写入集合含 `source/chapters/index.json`，内容为 `[]` 且无末尾换行，目录存在；重跑不覆盖已有索引；`chapters/` 已有章节文件时跳过且 details 不失败；状态损坏时索引与 `snapshots/0` 一起跳过；索引随同批提交失败回滚。
- `pnpm run verify` 全绿：418 tests；`artifacts/real-runs/foundation.architect.json` 已按新行为重录，审计同步。
- 与 `chapter.finalize` 的严格读取按能力行分开；后者仍需单独交付。

## Consequences

- 已有章节文件但缺索引的旧工作区无法靠重跑 details 修复；需要人工补索引，否则定稿/导出会拒绝。
- details 在状态损坏时同时跳过初始快照与索引；之后的恢复仍靠 `recovery`。
- 若已有索引损坏，details 不会修复；严格读取会拒绝，需要人工修复。
- `hasChapterFiles` 与 `listChapterFiles` 的文件名口径不同：前者任意位数前缀，后者 4 位；后续若统一口径需要单独决定。
