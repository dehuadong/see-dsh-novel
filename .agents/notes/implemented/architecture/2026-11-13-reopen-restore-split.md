# Agent Note: 重开与版本恢复分开

Status: implemented

> 后续更新（2026-11-14）：D36／D58 已由 [chapter.reopen —— 重开与恢复的闭环](2026-11-14-chapter-reopen-closure.md) 注销；恢复写索引观察与复审 start，重开从第 N-1 章快照回退。本文以下描述保留当时交付范围。

## Problem

`chapter.reopen` 曾把「恢复旧版本」和「重开本章」合成同一条路径，三处与源工程或已裁决行为不一致：

- 清运行时：复刻只删审稿与章纲；源 `interaction/edit-controller.ts:288-291` 的 `clearChapterRuntimeFiles` 删除该章 `story/runtime/chapter-NNNN.*` 的全部文件，只保留 `chapter-NNNN.user-brief.md`。复刻残留 `intent.md`／`planner-context.json`／`context.json`／`trace.json`，重规划时会被复用（D43）。
- 恢复范围：复刻以 `manifest.lastAppliedChapter === chapter` 拒绝非最后一章；源 `chapter-replace` 对任意章可用，只替换正文、清运行时并记索引观察，不动运行时状态（`edit-controller.ts:335-378`）。作者已裁决：恢复旧版与「重开回退」解耦（D44）。
- 重开后的整章重写：重开保留正文、重规划后 `detectStage` 判 `review`，`story_write_chapter` 拒绝覆盖已有正文，于是「退回重写」落到审旧稿（D55）。

D36（恢复不写 `provenance: edited` 与 `manual-edit-review` 观察）仍保留：那需要改索引写入与观察类型，本行不做。

## 源工程证据

- `inkos/packages/core/src/interaction/edit-controller.ts:335-378` 的 `executeChapterReplace`：对任意章可用；读当前正文、归档为指定来源（恢复走 `restore`）、写回替换文本、清该章运行时文件；随后 `recordManualEditObservation` 更新索引（`provenance: edited`、`manual-edit-review` 观察、字数）。
- `inkos/packages/core/src/interaction/edit-controller.ts:279-300` 的 `clearChapterRuntimeFiles`：删除 `story/runtime/chapter-NNNN.*` 全部文件，保留 `chapter-NNNN.user-brief.md`；返回被删相对路径。
- `inkos/packages/core/src/interaction/edit-controller.ts:99-106` 的 `requiresTruthRebuild`：替换/恢复后只标记该作品需要重建真值；仓内未见消费方，复刻也没有对应流程（并入 D33）。
- 源没有「重开后回退状态指针」的对应动作；复刻的指针回退是为 DSH 阶段判定保留的机制等价（已登记 `docs/dsh-mapping.md`）。

裁决：恢复只换正文并清运行时，不动运行时状态；重开回退仍限最后已结算章（scope D44 已记录该裁决）。

## Decision

### 范围与非目标

- 范围：恢复旧版对任意章可用且不动状态指针；两条路径都清该章全部运行时文件（保留 user-brief）；重开后整章重写走修订协议。
- 非目标：不写恢复的索引观察（D36）；不做 facts/hooks 基线回退（D33）；不改重结算（D34 已由 [D34：结算前的状态对账与 reconciliation](2026-11-14-chapter-settle-validation.md) 交付，本行不改它）；不加面板动作。
- 不改版本归档格式、相同内容拒绝、`AggregateError` 回滚。

### 交付行为

- `story_reopen_chapter({chapter, versionId})`：任意章可用；把当前正文归档为 `restore`、替换为版本正文；清该章全部 `chapter-NNNN.*` 运行时文件（保留 user-brief）；**不动** `manifest.lastAppliedChapter`、`current_state.chapter`、摘要行与 facts/hooks。工具返回提交后的真实阶段（`detectStage`）。
- `story_reopen_chapter({chapter})`：仍只对最后已结算章；保留正文、清同样范围的运行时文件、写或沿用 workflow start、把两个状态指针退回上一章、删除该章摘要行（登记在 reopen 偏差行）。
- 恢复非最后章后，该章的状态重建不在本行：源用 `requiresTruthRebuild` 标记，复刻没有对应重建流程；作者不能直接重审或结算该章，需等基线重算（并入 D33）。
- 恢复内容与当前相同仍拒绝；非最后章的「重开回退」仍以 D33 拒绝，但「恢复」不再受此限制。
- 重开后作者要整章重写时：先重新规划本章（章纲已被重开删除），规划落盘后停；作者要求重写时用 `story_revise_chapter`（rewrite／rework），不走首次写作入口。
- 可观察验收：运行时目录文件集合、状态指针、摘要行、版本归档、提交后阶段。

### 决定与未决问题

- 恢复与重开在工具内按 `versionId` 是否存在分流，不新增工具；两条分支都由工具在提交后调用 `detectStage` 返回真实阶段。
- 未决问题：无。

### 评审与批准证据

- Plan Review 第 1 轮：需修订（恢复返回阶段契约缺失；恢复更早已结算章后的状态重建未交代；摘要行删除未入偏差；缺源证据段；重开后 revise 需要先重新规划）；已修正。
- Plan Review 第 2 轮：仍需修订（旧的 stage 描述残留；恢复后不可达路径仍写成可选；D36 owner 不实；requiresTruthRebuild 消费方无证据；重开判据未定义）；已修正。
- Plan Review 第 3 轮：通过，无未解决 blocker/major。
- Implementation Review（Standards / Spec）：首轮各报 8／4 条；恢复 versions 协议、plan 条件指令、stage 单源、真实早章恢复、覆盖补齐后复核通过。
- 批准与执行授权：2026-11-13，作者批准 `implement chapter.reopen`。

## Design

### 分流

`src/core/reopen.ts`：

- `restoreChapter(root, chapter, versionId)`：不允许 `versionId` 为空；读版本、归一末尾换行、与当前正文相同则拒绝；归档当前正文为 `restore`；替换章节文件；清运行时；一次 `commitFoundation`。不读 `work.json`、不读状态、不改指针、不删摘要、不写索引（D36）。
- `reopenChapter(root, chapter)`：读状态并要求 `lastAppliedChapter === chapter`（D33）；保留正文；清运行时；写 workflow start（已有则沿用）；指针退回 `chapter-1`；摘要行过滤掉本章；一次提交。
- 工具 `story_reopen_chapter`：`versionId` 存在 → `restoreChapter`，否则 `reopenChapter`；两条分支提交后都调用 `detectStage` 得到真实阶段。

### 清运行时

`src/core/reopen.ts` 的内部 `chapterRuntimePaths(root, chapter)`：

- 读 `source/story/runtime/`，筛 `chapter-<4 位>.` 前缀且不等于 `chapter-<4 位>.user-brief.md`。
- 目录不存在返回空数组；其它错误照常抛。
- 这些路径作为 `commitFoundation` 的 `deletes`；`removed` 返回相对路径列表。

### 返回与阶段

- `restoreChapter` 返回 `{ chapter, versionId, archived, removed }`，不返回阶段。
- `reopenChapter` 返回 `{ chapter, versionId: null, archived: null, removed }`，不返回阶段。
- 工具统一在提交后调用 `detectStage(root)`，输出 schema 的 `stage` 是普通字符串；`versionId`／`archived` 只在恢复时出现。

### 偏差与债务

- `docs/dsh-mapping.md` 的 reopen 偏差行记录：恢复分支只换正文、不动状态；重开分支删摘要行并回退指针。源没有对应动作，保留机制等价说明。
- D33 扩为「恢复旧版后的状态重建」：源 `requiresTruthRebuild` 的复刻落点仍缺，恢复更早章后不能直接重审/结算。
- D36 的偿还位置改为 `chapter.revise` 的索引写入（D45 同批），仍保留。

### 阶段协议

- `plan` 协议补一句：本章正文已存在（重开保留了旧稿）时，规划落盘后停；作者要求整章重写时用 `story_revise_chapter`（rewrite／rework），不走首次写作入口。
- `review` 阶段无法区分重开旧稿与首版待审，不新增指令。
- `chapter-done` 的重开步骤说明恢复/重开区别，并保留「先调 `story_chapter_versions` 列归档」；不出现 `story_write_chapter` 字样。

### 兼容与失败行为

- 恢复非最后章不再要求状态指针匹配；索引、摘要、facts/hooks 保持现状。该章不能直接重审/结算，需等后续基线重算（D33）。
- 恢复最后一章也不再把指针退回；这是本次裁决的行为。
- 清运行时删除 intent/context/trace 后，重规划与重写都从干净状态开始。
- 运行时目录缺失时不报错；单文件删除失败由提交回滚。
- 实现文件：`src/core/reopen.ts`、`src/pipelines/long/reopen-tool.ts`、`src/pipelines/long/stages/index.ts`。

## Alternatives considered

- **保留「恢复即重开」的合成路径** — 改动最小。否掉：源 `chapter-replace` 不动运行时状态，作者已裁决恢复与重开解耦；合成会让恢复旧版把整章状态退回。
- **恢复后同时退指针、删摘要** — 看起来一致。否掉：恢复只换正文，状态回退是重开回退的职责；混在一起会丢已结算状态。
- **清运行时只删审稿与章纲** — 与现状一致。否掉：源清 `chapter-NNNN.*` 全集，残留 intent/context/trace 会被重规划复用。
- **允许 `story_write_chapter` 覆盖重开后的正文** — 少一次修订调用。否掉：首次写作与修订的契约不同，覆盖会绕过 artifact revision 与归档。
- **新增独立恢复工具** — 语义更清楚。否掉：`story_reopen_chapter` 已有 `versionId` 参数，分流即可，不增加模型入口。

## Testing

- `test/chapter-reopen.test.mjs`（7 例）：版本列表倒序与非法 id；重开清全部 `chapter-NNNN.*`（保留 user-brief）、指针回退、摘要删除、start 写入与沿用、阶段 `plan`；任意章恢复归档当前正文且不动状态/摘要/facts/hooks、返回真实阶段；更早章恢复；同内容拒绝且不写；非法版本 id。
- `test/stage-context.test.mjs`：`plan` 段的条件修订指令与 `chapter-done` 的两个重开工具。
- `test/host.test.mjs`：工具清单回归。
- `pnpm run verify` 全绿：424 tests；`artifacts/real-runs/chapter.reopen.json` 已按新行为重录。
- D43／D44／D55 已从 `docs/scope.md` 注销；D36／D33 保留并更新描述。

## Consequences

- 恢复旧版后正文与已结算状态不一致；该章需等后续基线重算（D33），本行不提供重审/重结算路径。
- 清运行时会把用户可能想保留的 intent/context 删掉；源同样清，保留 user-brief 作为作者输入。
- 重开后的整章重写依赖主编遵守 plan 段协议；工具层仍拒绝首次写作覆盖。
- 恢复任意章不更新索引（D36），索引字数/来源与正文可能不一致，直到修订索引工作落地。
