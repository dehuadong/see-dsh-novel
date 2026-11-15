# Agent Note: panel.workbench —— 已结算章节的阶段投影

Status: proposed

> 2026-11-15 后续：本篇的 v7 投影由 [`2026-11-15-panel-draft-and-foundation-change.md`](./2026-11-15-panel-draft-and-foundation-change.md) 接管为 v8。已结算 + foundation `approved` 仍 `none/done`；`stale`/`rejected`/`none` 改用 `foundation-signoff/pending` 在顶部提示，六阶段 done 与根 `start-chapter` 不变。

## Problem

2026-11-15 的真实工作区里，第 1 章已结算发布（`work.status: active`、`currentChapter: 1`、`nextChapter: 2`），但 `source/story/runtime/panel.index.json` 仍把 `foundation` 标成 `current`，给出「确认基础设定 / 开始下一章 / 退回 / 查看待确认 / 稍后」；`settle` 永远 `locked`。作者看到的是「章节已写完，却还在要求确认基础设定」。

原因在 `packages/see-dsh-novel/src/core/panel-index.ts`：`foundation-ready` 一律映射为 foundation current，`confirmation` 也一律返回 foundation-signoff pending，`settle` 阶段硬编码为 locked。可 `foundation-ready` 有两种语义：基础设定刚写完、等待作者确认；以及某一章已结算、等待开始下一章。

源工程 Studio 的章节工作台（`inkos/packages/studio/src/components/ChapterWorkspacePanel.tsx:14-27`）显示已落盘章节的版本与修订动作；源没有这套阶段动作条，本行的「阶段动作条」在源行为里不可观测（检索范围：`studio/src/components/ChapterWorkspacePanel.tsx`、`ChapterReader.tsx`、`BookDetail.tsx`）。所以这是复刻自己的投影 bug，不改变与源的等价判定。

**本行只修投影，不加门禁、不定义结算动作。** 「开始下一章」保持可点；未确认时由 `/story-write` 返回错误（`foundation.approval` 行）。`chapter-done` 的动作保持不变（`settle` 阶段与结算按钮由后续 `chapter.settle` 工作项处理）。

既有工作台投影见 [`2026-11-10-panel-workbench-dialogue-first.md`](../../implemented/architecture/2026-11-10-panel-workbench-dialogue-first.md)，确认面板见 [`2026-11-09-panel-confirm.md`](../../implemented/architecture/2026-11-09-panel-confirm.md)。

## Proposal

### 范围与非目标

- 范围：`panel.index.json` 在「已结算章节」与「基础设定写作中」两种状态的阶段状态、confirmation、根动作与章节 artifact 归属；`PANEL_INDEX_VERSION` 升级；测试与真实工作区回执。
- 非目标：不改阶段判定（`detectStage`）；不改命令校验；不把「开始下一章」置灰；不新增阶段 id；不加第二套状态；不新增「结算本章」动作（归 `chapter.settle`）；不改 `chapter-done` 的动作；不处理修订待提交/扣下的恢复动作。
- 只改 `panel.workbench`，只读 `runtime.stage-context` 的 `StageFacts`，不改它。

### 产品行为与验收

- **基础设定写作中（`stage === 'foundation'`）**：proposal done、foundation current、plan/write/review/settle locked；主动作「开始基础设定」保持不变。
- **基础设定刚写完（`foundation-ready` 且 `currentChapter === 0`）**：foundation current；confirmation 为 `foundation-signoff, pending`；主动作「确认基础设定」；「开始下一章」保持可点（命令层会拦未确认）。
- **已结算过至少一章（`foundation-ready` 且 `currentChapter >= 1`）**：proposal/foundation/plan/write/review/settle 全部 `done`；基础设定 `approved` 时 confirmation 为 `none, done`（本章已结算）；`stale`/`rejected`/`none` 时改为 `foundation-signoff/pending` 的顶部提示（见后续篇）；根动作仍是「开始下一章」；不再出现确认基础设定/退回/查看待确认。
- **`chapter-done`**：保持现状（根动作「修订本章」；settle 仍 locked），不在本行加结算按钮。
- 已发布章节 artifact 同时出现在 `review` 与 `settle` 阶段的浏览列表（同一文件，不复制）。
- `PANEL_INDEX_VERSION` 从 6 升到 8（7 由后续篇接管为 8）；版本不等时由既有 `panel-projection.ts` 的 `indexStale` 机制在会话创建/下一次作品写动作时重建；`normalizeIndex` 不做版本迁移。
- 测试：`panel-index.test.mjs` 补「基础设定写作中」「基础设定待确认」「已结算」三态；`panel-projection.test.mjs` 补 v6→v7 重建；`workbench.test.mjs`／`client.test.mjs` 的索引夹具同步；真实工作区 `panel.index.json` 回执（第 1 章已结算，process-level 即可，`panel.workbench` 现行回执也是 process-level）。

### 决定与未决问题

- 决定：`foundation-ready` 按 `currentChapter` 区分「待确认」与「已结算待开下一章」；`settle` 不再硬编码 locked（已结算为 done，其余保持 locked）；按钮不置灰。
- 未决：`chapter-done` 的结算动作与修订/扣下恢复入口不在本行，归后续工作项。

### 评审与批准证据

- Plan Review：2026-11-15 两轮评审后，本版按「只投影、不加结算动作、补 foundation 写作态、版本 7」修订，待终评。
- 批准：待用户。
- 执行授权：待用户。
- 本 Note 是 planning 绑定的工作项，评审/批准证据归本 Note 的工作项部分；`docs/AGENTS.md` 的「当前任务/对话」在这里即本工作项，不构成第二处权威。

## Design

`buildPanelIndex` 已有 `stage`、`currentChapter`、`facts.revisionReviewed`／`facts.chapterPublished`（来自 `detectStage` 的 `StageFacts`）。新增判定：

- `foundationWriting = stage === 'foundation'`；
- `foundationAwaitingSignoff = stage === 'foundation-ready' && currentChapter === 0`；
- `chapterSettled = stage === 'foundation-ready' && currentChapter >= 1`（只认 `currentChapter`，不用 `latestChapter`）。

阶段状态：

- `proposal`：无作品 → current；有作品 → done。
- `foundation`：`foundationWriting` 或 `foundationAwaitingSignoff` → current；`chapterSettled` → done；`stage` 为 plan/write/review/chapter-done → done；否则 locked。
- `plan/write/review`：进行中 → current；后续 → done；`chapterSettled` → done；否则 locked。
- `settle`：`chapterSettled` → done；否则 locked（本行不把 settle 标 current）。

动作与 confirmation：

- `foundationWriting`：`stageAction('foundation')` 给「开始基础设定」；confirmation `none, pending`（保持现状）。
- `foundationAwaitingSignoff`：`stageAction('foundation')` 给「确认基础设定」；`secondary` 保持「开始下一章/退回/查看待确认/稍后」，按钮不置灰；confirmation `foundation-signoff, pending`。
- `chapterSettled`：六个阶段全 done；根 `action = { id: 'start-chapter', label: '开始下一章' }`；confirmation `none, done`；不出现 foundation 动作。
- `chapter-done`：保持现状（根 `action = revise-chapter`），本行不改。

`buildPanelArtifacts`：chapter 类文件在章节已发布时 `stages` 追加 `settle`（`review` 保留）；不复制文件。

版本与迁移：`PANEL_INDEX_VERSION = 8`（7 由后续篇接管）；`src/panel-types.ts` 与 `src/client/panel-types.ts` 的 `PanelStage.secondary` 注释（「只有 foundation-ready」）同步；`panel-projection.ts` 的 `indexStale` 按版本重建；`normalizeIndex` 不改。测试更新 `panel-index.test.mjs`、`panel-projection.test.mjs`、`workbench.test.mjs`、`client.test.mjs` 中硬编码的 7。

既有决定更新：本行部分取代 [`2026-11-10-panel-workbench-dialogue-first.md:84-94`](../../implemented/architecture/2026-11-10-panel-workbench-dialogue-first.md) 中「foundation-ready 动作常驻」与索引版本事实；已同批更新该篇的分叉动作表、根动作说明与版本号，并互链。`chapter-done` 的修订动作不变，所以 [`2026-11-10-chapter-revise.md:57`](../../implemented/architecture/2026-11-10-chapter-revise.md) 不改。

## Alternatives considered

- **保留现状，只把 `settle` 标成 done。** 否掉：foundation 仍会显示 confirm，作者看到的还是错误门禁；必须按 `currentChapter` 区分。
- **把 `foundation-ready` 拆成两个阶段 id。** 否掉：`detectStage` 的阶段是工作区状态判定；拆 id 会引入第二套阶段，和「阶段节点由工作区判定」冲突。
- **在面板置灰「开始下一章」。** 否掉：`/story-approve` 不写作品文件、不重建索引，置灰会在确认后仍不可点；既有面板决定也是保持前进入口常驻。
- **在本行同时加结算按钮。** 否掉（本轮）：结算按钮牵扯 `chapter.settle` 的意图/held/修订分支，会把这行拖成跨三行的改动；另立工作项。
- **按 artifact 是否存在推导阶段。** 否掉：已经由 `detectStage` 判定；面板只投影。

## Acceptance criteria

1. `foundation` 写作中：foundation current，主动作「开始基础设定」，其余 locked。
2. `foundation-ready` + `currentChapter=0`：foundation current，confirmation foundation-signoff pending，主动作确认基础设定，「开始下一章」可点。
3. `foundation-ready` + `currentChapter>=1`：六个阶段全 done，confirmation none/done，根动作只有「开始下一章」，无确认基础设定/退回/查看待确认。
4. `chapter-done`：保持现状（根动作修订本章），本行不改。
5. 已发布 chapter artifact 同时归属 review 与 settle，文件不复制。
6. `PANEL_INDEX_VERSION=8`（7 由后续篇接管），`panel-projection` 在版本不等时重建；旧索引测试更新。
7. 测试覆盖 1–5；真实工作区回执（第 1 章已结算）与面板展示一致。
8. 审计：`panel.workbench` 的 AU-31 按它自身缺失的动作仍开（本行只修投影，不关闭 AU-31）；重录 `artifacts/real-runs/panel.workbench.json`；`check-capabilities -- --write`。

## 待实测（batch）

- GUI 会话打开 `D:\workspace\see-dsh-novel-runtime`，确认磁盘上的 v6 `panel.index.json` 在会话创建/写动作后重建为 v7，面板显示六阶段完成、根动作「开始下一章」、不再显示「确认基础设定」。
- 当前已有真实工作区的 process-level 内存重建回执（v7、六阶段 done、根 `start-chapter`、confirmation none/done、章节 `write/review/settle`）；缺 GUI 目视/会话日志。

## Risks

- 面板状态是投影，真实来源仍是 `detectStage`；测试需以真实工作区 fixture 为准。
- 版本升级会让现有索引在会话创建/下一次写动作时重建；已打开的会话在重建前仍显示 v6。
- 已结算状态没有「当前阶段」，需要根动作承载「开始下一章」；根没有 secondary，不能把其它动作同时挂根。
- 结算按钮、修订/扣下恢复入口仍未解决；AU-31 不会因本行关闭。
