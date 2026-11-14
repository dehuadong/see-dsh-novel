# Agent Note: chapter.settle —— 按基线快照重算（D33）

Status: implemented

## Problem

`chapter.settle` 的结算把增量直接应用到**当前**状态：`story_settle_chapter` 读 `source/story/state/` 的四份 JSON，同章重结算时把新 delta 叠加在已经吸收过上一版 delta 的状态上（`settle-tool.ts:177-189`）。已经失效的旧 facts、旧 hooks 与旧摘要行可能残留，重结算得到的不是「从上一章快照重来」，而是「在旧结果上再叠一次」。重开回退后更明显：`reopenChapter` 只把指针退回上一章并删摘要行，facts/hooks 不回退（`reopen.ts:121-126`），再结算本章会把旧事实继续叠上去。

`docs/scope.md` 的 D33 把这记成「结算与重开不按快照做基线重算」，并列出三个缺口：更早章节的重结算被拒绝、同章重结算按增量应用、恢复旧版后的状态重建（源 `requiresTruthRebuild`）没有等价流程。逐条核对源工程后，表述需要收窄：

- 源 reducer 同样拒绝倒退（`state/state-reducer.ts:37-39`），且源的重同步入口只允许**最新持久章**（`pipeline/runner.ts:1495-1498`）；「更早章节的通用重结算」在源里不存在。源在修订单章时确实会为早期章加载基线，但那只是用于计算与校验，不把活状态回退（`runner.ts:1120-1138`）。
- `requiresTruthRebuild` 与 `state-sync-required` 在源仓库里没有消费者（全仓检索只有 `interaction/edit-controller.ts:82-136` 的规划与 `runner.ts:1589` 的清理）；可观察的重建路径是手动 `resync_chapter_state`（代理工具、`inkos write sync`、Studio 的「同步状态」按钮）。
- 源重同步的判据是**最新持久章**（章节索引最大章号），不是 `lastAppliedChapter`；重开回退后指针在 N-1，若索引仍含该章（已定稿或已修订），最新持久章仍是 N，源允许对 N 重同步。已结算未定稿的章不在索引里，重开后的重算间隙记 D58。

所以 D33 要交付的是**源可观察的基线重算**：把「最新持久章的重算」从「当前状态上叠 delta」改成「第 N-1 章快照 + 本次 delta」，并同次刷新第 N 章快照；早期章、自动校验与恢复旧版后的自动重建都不属于本行。

## 源工程证据

- `inkos/packages/core/src/state/runtime-state-store.ts:65-92`：`loadRuntimeStateSnapshotAtChapter` 从 `story/snapshots/<n>/state/` 严格读四份 JSON，缺任一份即抛「Structured runtime snapshot is incomplete at chapter N」；不做当前状态回落。
- `inkos/packages/core/src/agents/writer.ts:214-221`：`settleChapterState` 在给了 `baselineChapter` 时读该章快照，否则读当前状态；`:242-250` 把 `allowReapply`、`baselineChapter` 传给状态工件构建。
- `inkos/packages/core/src/state/state-reducer.ts:37-39`：delta 章号必须大于 `lastAppliedChapter`（或显式 allowReapply 时等于）；`:45-51` 非 allowReapply 时拒绝重复摘要行；`:195-211` allowReapply 时先删同章摘要行再写入。
- `inkos/packages/core/src/pipeline/runner.ts:1475-1602` 的 `_resyncChapterArtifactsLocked`：只接受最新持久章（`:1495-1498`）；加载第 N-1 章快照，缺失时报「baseline snapshot N-1 is unavailable」（`:1503-1512`）；用该基线跑 settler（`:1525-1536`，`allowReapply: true`）；validator 校验并在不一致时 reconcile（`:1537-1584`，已由 [D34：结算前的状态对账与 reconciliation](2026-11-14-chapter-settle-validation.md) 交付）；`saveChapter` 一次写章节/状态/快照/索引（`:1591`），并清掉 `state-sync-required` 观察（`:1589`）。
- `inkos/packages/core/src/pipeline/runner.ts:952-961`、`:999-1008`：修订也先加载第 N-1 章快照，再以它为基线结算修订后的正文；`:1120-1138` 只有最新章用 `saveChapter` 持久化状态，更早章只写章节文件与索引，不回退活状态；`:1089-1118` 给后代标 `upstream-revision`。
- `inkos/packages/core/src/agent/agent-tools.ts:2963-3013`：`resync_chapter_state` 工具，描述「保持正文不变，从上一章快照重建状态、摘要与伏笔，然后跑审查；只支持最新章」。
- `inkos/packages/cli/src/commands/write.ts:310-327` 的 `write sync` 与 `inkos/packages/studio/src/api/server.ts:5875-5900` 的 `/resync/:chapter` 端点：同一能力的两条入口。
- `inkos/packages/core/src/interaction/edit-controller.ts:82-136`：`planEditTransaction` 为章节改写/替换/局部编辑/实体改名/运行时真值编辑置 `requiresTruthRebuild: true`，但该字段没有消费者；观测不到自动重建。

复刻现状（偏差位置）：

- `packages/see-dsh-novel/src/core/settle.ts:237-242`：`applySettlement` 把「同章」视为增量重结算，早于已结算章的 delta 直接拒绝；`:245-252` 在当前快照上应用。
- `packages/see-dsh-novel/src/pipelines/long/settle-tool.ts:177-189`：`story_settle_chapter` 固定读当前状态，并把 `allowReapply: chapter === lastAppliedChapter` 传下去，所以同章重算是「旧结果上再叠一次」。
- `packages/see-dsh-novel/src/core/state.ts:281-287` 只有写快照的 `snapshotWrites`，没有「按章读快照」的入口；`inspectState`（`:230-272`）只读当前状态。
- `packages/see-dsh-novel/src/core/reopen.ts:61-88`：恢复旧版只换正文与清运行时，不重建状态；`reopenChapter`（`:95-130`）只回退指针并删摘要行，facts/hooks 保留。
- `packages/see-dsh-novel/src/pipelines/long/stages/index.ts:150-163` 的 chapter-done 协议只写了 `story_settle_chapter`，没有重算入口。

## Decision

### 交付范围与非目标

范围（`chapter.settle` 一行）：

1. 新增按章严格读快照的 core 入口 `readStateSnapshot(root, chapter)`：读 `source/story/snapshots/<chapter>/state/` 的四份 JSON，四份齐全且形状合法才返回；缺失、解析失败、形状不符都在写盘前报错并点名文件。不回落当前状态。
2. 新增工具 `story_resettle_chapter`：与 `story_settle_chapter` 同一 delta 形状；目标章取 `max(章节索引最大章号, lastAppliedChapter, 已有快照的最大章号)`（覆盖已定稿、已结算未定稿、以及「重算/定稿过又被重开」的回退；未写正文的新章没有快照，不会被当作目标；从未重算/定稿就重开的间隙见 D58）；读第 `chapter-1` 章快照作为基线，把 delta 应用到基线而不是当前状态；一次 commit 写四份状态 JSON、三份投影与 `snapshots/<chapter>/` 的七份快照文件；不改正文、不改章节索引、不动 workflow start。
3. 收窄 `story_settle_chapter`：`chapter === lastAppliedChapter` 时在写盘前拒绝并指到 `story_resettle_chapter`（同章已结算的重来走重算）；`snapshots/<chapter>/` 已存在时也拒绝（说明该章定稿过，重开回退后不能再用普通结算叠 delta）；`chapter < lastAppliedChapter` 保持拒绝；推进下一章的行为不变。
4. 阶段协议补重算路径（`chapterRepair` 文本块，按「`currentChapter >= 1` 或章节索引里已有章」注入，含 `review`；`proposal`／`foundation` 不注入）：修订、恢复正文或重开回退后，作者要求「重新结算／同步状态」时，派 settler 前先按需复审（修订已补 start），再把 `source/story/snapshots/<chapter-1>/state/` 四份 JSON 与三份投影的原文贴进 settler 提示，声明这是唯一基线、`source/story/state/` 的当前投影只能参考；settler 产出 delta 后调 `story_resettle_chapter`；只支持最新章，重算会刷新第 N 章快照。已结算章不再调 `story_settle_chapter`。
5. 注册工具、更新 host 工具清单与章节结算测试。

非目标：

- **不做自动校验与 reconcile**（D34）：交付时 `story_resettle_chapter` 不跑 validator，也不带 `validationFeedback` 重算；该能力已由 [D34：结算前的状态对账与 reconciliation](2026-11-14-chapter-settle-validation.md) 交付。
- **源的「重算后重审」不在本行**：源 resync 在重建后调用 `reviewChapter` 产生新观察（`runner.ts:1250`）；本项目已结算章恢复后的复审入口不可达（D58），修订路径的复审走 revise 写入的 workflow start。所以本行不承诺重审等价，重算只重建状态；索引 `updatedAt`/`wordCount`/观察仍停在上次定稿的值（D35/D45 的残余），`state-sync-required` 不模拟。
- **不做原子保存重排**（D37）：重算写状态与第 N 章快照，但章节文件与索引仍由写作/定稿各自写；「一次提交章节+状态+快照+索引」仍归 D37。
- 不支持早于最新持久章的通用重结算（源也不支持）；不在本行模拟 `requiresTruthRebuild` 或 `state-sync-required` 标记（源无消费者）。
- 恢复正文后的重新审稿与定稿不在本行：恢复会清掉 `chapter-NNNN.*`（含 review）且不写 workflow start，而 `story_review_chapter` 要该章 start、阶段判定又按 `current_state.chapter+1` 找下一章，所以「已结算章恢复」后无法重审；重开回退又不恢复 facts/hooks。修订路径的复审可达（`story_revise_chapter` 在正文变化时给该章补 start，`revise-tool.ts:193-206`），但需要在重算前先复审。这些 reopen 的机制缺口另记 **D58**（owner `chapter.reopen`），本行只保证状态重建可执行。
- 不做面板「同步状态」动作（`panel.workbench` 行）；不加命令入口（源另有 CLI/Studio，本项目的 agent 工具已够）。
- 不改 hooks/facts 语义、摘要替换规则与状态投影格式。

### 交付行为与验收

1. **重算从基线开始**：对最新持久章调用重算，结果等于「第 N-1 章快照 + 本次 delta」，不包含当前状态里上一版结算留下、且本次 delta 未再产生的事实/伏笔/摘要变化。
2. **判据是最新章且不落后于活状态**：目标章必须等于 `max(章节索引最大章号, lastAppliedChapter, 已有状态快照的最大章号)`（覆盖「已定稿」「已结算未定稿」「重算/定稿过又被重开」；未写正文的新章没有快照，不会被当作目标；从未重算/定稿就重开的间隙见 D58），且当前状态可读时 `chapter >= lastAppliedChapter`；否则拒绝并写明原因与下一步。当前状态缺失或损坏时允许重算，目标取 `max(索引最大章号, 已有快照最大章号)`（都是 0 时报「还没有可重算的章」），用基线+delta 重建状态（对应源 resync 的修复用途）。
3. **基线缺失即拒绝**：`snapshots/<chapter-1>/state/` 四份 JSON 任一缺失或非法时拒绝，错误点名文件；不写任何文件。
4. **普通结算不再叠加重算**：`story_settle_chapter` 对已结算章拒绝，错误指向 `story_resettle_chapter`；推进下一章的行为不变。
5. **一次提交**：重算在 `withWorkAction` 内一次 commit 写四份 JSON、三份投影与第 N 章快照；失败不留半写。
6. **不改正文与索引**：重算后章节文件与 `source/chapters/index.json` 不变；`snapshots/<chapter>/` 由重算刷新（测试断言）。
7. **协议可见**：`currentState.chapter >= 1` 或章节索引已有章时的上下文包含重算入口、基线路径与「只支持最新章」，并提示修订后先复审；重算不改 `workflow-start.json`，若它指向本章，复审前下一章写 start 会被拒绝。

验收判定以 `test/chapter-settle.test.mjs`、`test/stage-context.test.mjs`、`test/host.test.mjs` 的可观察断言为准。

### 决定与未决问题

- **重算用独立工具，而不给 `story_settle_chapter` 加 `baseline` 开关**：源有独立工具 `resync_chapter_state`；独立入口让「推进」与「重来」在协议与测试里分开，避免同章被静默增量重算。
- **重算写第 N 章快照**：源 `saveChapter` 同次写快照；不写会让下一次对 N+1 的重算拿到过期基线（`snapshots/<N>` 仍是旧状态）。索引仍归定稿（D37 合并）。
- **判据同时用章节索引、lastAppliedChapter 与已有快照**：源在 `saveChapter` 里同批写状态+快照+索引，三者在源里恒等；复刻拆开后（D37）三者可能短暂不同步，取并集是对源「最新持久章」的机制还原，不是新状态。它同时覆盖「已定稿」「已结算未定稿」「重算/定稿过又被重开」三种最新形态，且不会把没有正文/快照的下一章当目标。
- **章节索引按「缺失即空」读取**：复刻的索引只由定稿/修订写（`chapter.finalize`、`reviseChapterDocument`），新章结算后未定稿时本就没有 `chapters/index.json`；用严格读取会把主用例（首章重算）直接拒掉。坏 JSON/形状仍拒绝，严格性放在解析之后。
- **不模拟 `requiresTruthRebuild`/`state-sync-required`**：源没有消费者，模拟只会造出源没有的可观察状态；恢复正文后是否需要重算交给作者/协议判断。
- **早期章不回退活状态**：与源一致（`runner.ts:1120-1138`）；修订早期章后的状态重建不在本行。
- **基线由主代理注入 settler 提示，而不是让 settler 自己挑文件**：源把基线 JSON 注入 settler 提示并声明「只按此基线」（`writer.ts:304-311`）；复刻由主代理把第 N-1 章四份 JSON 与三份投影原文贴进子代理提示，`source/story/state/` 的当前投影只作参考。基线不塞进工具参数（整份状态会放大 prompt 且不可校验）。
- 未决问题：无。

### 评审与批准证据

- Plan Review 第 1 轮（Standards／Spec／Architecture 三线独立）：需修订——重算判据用 `lastAppliedChapter` 会漏掉重开回退后的章；重算不写快照会让 N+1 的基线过期；审稿前置与源 resync 不符；`state.check` 属 D34 不应混入；D33 注销的同步清单不全。已改为「最新持久章」判据、同批写 `snapshots/<N>`、去审稿前置、移出 state.check、扩同步清单。
- Plan Review 第 2 轮：需修订——判据只用索引最大章号会在「第 3 章已结算未定稿」时把活状态回退到第 2 章；`inspectState` 行为不能改；「源 resync 的重审」不能说成由审查闸门承接；协议放 `common` 会把指引注入提案阶段。已加 `chapter >= lastAppliedChapter`、跨文件校验只放 `readStateSnapshot`、D58 收窄、协议改条件注入。
- Plan Review 第 3 轮：需修订——`snapshots/<chapter>/` 护栏与重开回退的双入口、`workflow-start` 遗留会挡住下一章、目标章不在索引时的已结算未定稿形态、协议注入条件与状态损坏场景。已加快照护栏、判据改 `max(索引, lastApplied)`、状态不可读时按索引修复、协议按「`currentChapter>=1` 或索引有章」注入。
- Plan Review 第 4 轮：需修订——`workflow-start.chapter` 纳入 max 会把未审的下一章当目标（回归）；重算删除 start 会切断复审授权；判据/协议/AC 多处不同步。已撤掉 start.chapter、改为不消费 start、同步四处文案。
- Plan Review 第 5 轮：Spec／Architecture 只剩文案同步问题（已改：判据、start 处置、注入条件、夹具）；Standards 要求撤掉 `start.chapter` 判据（已撤）与限定「重开回退」的前提（已改）。
- Plan Review 第 6 轮（作者授权补审）：Standards 与 Architecture 通过；Spec 指出「重算写快照 + settle 快照护栏 + 无 start 判据」会造出「已结算未定稿 → 重算 → 重开 → 四个入口全拒」的死锁。已把目标判据改为 `max(索引最大章号, lastAppliedChapter, 已有快照的最大章号)`（不再用 start；未写正文的新章没有快照，不会被当作目标），并在 Risks／D58 里补「从未重算/定稿就重开」的残余与恢复步骤。
- Plan Review 第 7 轮（快速确认）：三线通过；Spec 额外提示「重算后未定稿章被重开再把目标固定在 N」的次序安全拒绝，已在测试中覆盖。
- Implementation Review 第 1 轮：Standards 报 `reopen.ts` 残留 D33、`hasChapters` 误扫章节文件、协议文案与 AC 不一致；Spec 报首章无索引时不可重算、跨文件错误未点名文件、测试缺口。已修并补测。
- Implementation Review 第 2 轮：Standards 报共享 schema 的 `chapter` 描述仍要求审稿、`hasChapters` 注释过时、`foundation` 仍可能注入；Spec 报 `readChapterIndexStrict` 在真实新章没有索引时抛错（测试用 `seedIndex` 掩盖）。已改宽松索引读取、加阶段门、补事实级注入测试。
- Implementation Review 第 3 轮：Spec 通过；Standards 报补测未真正落地、索引放宽未登记、`settle.ts` 注释反向引用工具名。已补重复摘要/形状/坏基线用例，并把这处放宽写进 Design/AC。
- Implementation Review 第 4 轮：两轴通过（各只剩措辞级建议），错误文案补「若状态已回退，先重算第 N 章」。
- 批准：作者 `/implement 批准，执行实现 D33`（2026-11-13）。
- 执行授权：当前工单范围内实施、Implementation Review、范围内修正与 Verify。

## Design

### 快照读取

`src/core/state.ts`：

- 新增 `readStateSnapshot(root, chapter): Promise<StateSnapshot>`：读 `snapshots/<chapter>/state/{manifest,current_state,hooks,chapter_summaries}.json`，复用现有 `isManifest`／`isCurrentState`／`isHooksState`／`isChapterSummaries` 形状校验；缺失与非法分别收集，抛错时点名 `story/snapshots/<n>/state/<file>`。
- 跨文件不变量只在 `readStateSnapshot` 内校验并抛错：`currentState.chapter <= manifest.lastAppliedChapter`、摘要行无重复章、manifest 语言合法。`inspectState` 保持现状（只记单文件 `missing`/`invalid`、不抛），不在本行改变已验证的调用方行为。
- 返回 `StateSnapshot`；不读投影、不回落当前状态。

### 重算工具

`src/pipelines/long/resettle-tool.ts`，注册名 `story_resettle_chapter`：

- 参数与 `story_settle_chapter` 完全相同（chapter、postSettlement、factOps、hookOps、newHookCandidates、chapterSummary）；把 delta 的 JSON schema 抽成 `src/pipelines/long/settle-delta.ts` 的共享常量，两个工具都引用，避免逐字重复。基线固定 `chapter-1`（源同），不开放参数。
- 执行：
  1. 需要所属 agent、`workingDirectory.ensure`、`withWorkAction`。
  2. 正文必须存在（`loadChapterDocument`）；不要求审稿记录：源 `resync_chapter_state` 直接在已保存正文上重建、之后才跑审查；本项目的审稿闸门仍由 `story_finalize_chapter` 把守。
  3. 用 `inspectState` 读当前状态：
     - 可读（无 missing/invalid）时，取 `chapter === Math.max(章节索引最大章号, lastAppliedChapter, latestSnapshotChapter(root))` 且 `chapter >= lastAppliedChapter`；`latestSnapshotChapter` 扫描 `snapshots/<n>/state/manifest.json` 取最大章号（没有快照时为 0）；章节索引用宽松读取（缺索引按空数组——新章未定稿时本来就没有索引；坏 JSON/形状仍抛）。不满足就在写盘前拒绝并给出下一步（只支持最新章／活状态已推进到第 M 章）。
     - 不可读（有 missing/invalid）时，按修复路径处理：目标取 `max(章节索引最大章号, latestSnapshotChapter(root))`，不比较 `lastAppliedChapter`，用基线+delta 重建状态；两者都是 0 时拒绝并说明「还没有可重算的章」。
     - 目标章不在索引中（已结算未定稿）时允许，判据用上面的 `max(...)` 覆盖。
  4. `readStateSnapshot(root, chapter - 1)`；失败信息带基线章号与文件。
  5. `applySettlement(baseline, delta, { allowReapply: false })`：基线 `lastAppliedChapter = chapter-1`，delta 章号 = chapter 正好前进；摘要重复检查在基线上不会命中。
  6. `validateChapterSummaries`；**不动 `workflow-start.json`**：修订/重开会写本章 start，它是复审闸门的授权，重算不消费也不删除；若 start 指向本章，作者需先复审（review 会清掉 start）再开下一章，否则下一章写 start 会被拒绝。`commitFoundation` 一次写 `stateJsonWrites` + `stateProjectionWrites` + `snapshotWrites(settled, chapter)`。
  7. 返回 `{ chapter, baselineChapter, facts, hooks, summaryTitle, postSettlement }`。
- 不写正文、不改章节索引。

### 收窄普通结算

`src/pipelines/long/settle-tool.ts`：

- 去掉 `allowReapply: chapter === lastAppliedChapter`；改为两条拒绝：
  - `chapter === lastAppliedChapter`：`第 N 章已结算；重算请用 story_resettle_chapter（以第 N-1 章快照为基线）`。
  - 文件系统已有 `snapshots/<chapter>/`：`第 N 章已有状态快照（重算或定稿写过）；重开回退后的重算请用 story_resettle_chapter`。这条机械护栏覆盖「重开回退后指针在 N-1、但快照/索引仍指向 N」的双入口，避免两条路都接受 N。
- `chapter < lastAppliedChapter` 的拒绝信息改为「源不支持更早章节重算」，不再引用 D33。
- `applySettlement` 的 `allowReapply` 参数保留（源 reducer 有该能力，`test/chapter-settle.test.mjs` 继续覆盖）；生产工具不再使用，注释写明这一点。
- 其余（下一章推进）不变。

### 协议

`src/pipelines/long/stages/index.ts`：新增 `chapterRepair` 文本块，按「`facts.currentChapter >= 1` 或章节索引里已有 ≥1 章」注入（`foundation-ready`／`plan`／`write`／`review`／`chapter-done` 已开过章时都包含；状态损坏时 `currentChapter` 回落 0，靠索引仍能注入；`proposal`／`foundation` 两者都不满足，不注入）：

- 作者在修订、恢复正文或重开回退后要求「重新结算／同步状态」时，先按需复审（修订已补 start），再把 `source/story/snapshots/<chapter-1>/state/` 与三份快照投影的原文贴进 settler 提示并声明为唯一基线（`source/story/state/` 的当前投影只作参考），再调 `story_resettle_chapter`；只支持最新章，重算会刷新第 N 章快照；不消费 `workflow-start.json`。已结算章不要调 `story_settle_chapter`。
- chapter-done 的第 2 条补一句：`story_settle_chapter` 只用于推进到下一章，已结算章不要调用。

### 注册与测试

- `src/plugin/agent.ts` 安装并释放 `story_resettle_chapter`；`test/host.test.mjs` 工具清单加入。
- 测试：
  - `test/chapter-settle.test.mjs`：同章被 settle 拒绝并指到重算；`snapshots/<N>` 存在时 settle 拒绝；重算从基线得到「旧 fact 消失」的结果；基线缺失/坏 JSON 拒绝且不写文件；重算刷新 `snapshots/<N>`、不改 `workflow-start.json`，且不改正文/索引；非最新章拒绝；已结算未定稿的章可重算；重算后又重开的章可再重算（快照兜住）；当前状态缺失/损坏时按索引最大章号修复。
  - 夹具要补 `source/story/snapshots/0/state/` 四份 JSON（foundation 的实际产物）与 `source/chapters/index.json`（重算按 `max(索引, lastApplied, 快照)` 判最新），因为两者都是严格读取。
  - 既有「同章重结算」用例（`chapter-settle.test.mjs:151`）改写成重算语义：先结算第 1 章，再从 `snapshots/0` 基线重算，断言旧 fact 不残留、摘要只有一行。
  - `test/stage-context.test.mjs`：`currentState.chapter >= 1` 或章节索引已有章的阶段（`foundation-ready`／`plan`／`write`／`review`／`chapter-done` 视条件命中）都含 `story_resettle_chapter`、基线路径、「只支持最新章」、「先把基线原文贴进 settler 提示」与「不消费 workflow-start」；`proposal`／`foundation` 不含该块；状态损坏（`currentChapter` 回落 0、索引有章）时仍注入；chapter-done 不再教已结算章调用 settle。
  - `test/chapter-settle.test.mjs` 的 repair 与次序用例：状态缺失/损坏时目标取 `max(索引, 快照)`、两者都为 0 时报「还没有可重算的章」；多重重开后对中间章安全拒绝并给出正确下一步。
  - `test/chapter-settle.test.mjs` 的 workflow-start 用例：重算不删除、不改写 `workflow-start.json`；start 指向本章时重算成功，下一章写 start 被拒绝，复审消费 start 后恢复。
- 回执：`artifacts/real-runs/chapter.settle.json` 重录（重算路径、拒绝路径、快照刷新）。

## Alternatives considered

- **给 `story_settle_chapter` 加 `baseline` 布尔参数** — 少一个工具。否掉：源有独立 `resync_chapter_state`；同一条工具同时承担「推进」与「重来」，协议与错误信息容易混，静默增量重算的风险就在这个入口。
- **重算只写状态、不写快照** — 更小的写盘面。否掉：下一次对 N+1 的重算会拿 `snapshots/<N>` 旧状态当基线，基线保证失效；源 `saveChapter` 同次写快照。
- **重算连同章节与索引一起原子写（对齐源 `saveChapter`）** — 更接近源一次落盘。否掉：那是 D37 的原子保存范围；本行交付状态+快照，章节与索引仍由写作/定稿写，避免把两笔债混成一个大改动。
- **把基线塞进工具参数由模型传入** — 减少文件读取。否掉：基线是整份状态，塞参数会把 prompt 放大且不可校验；由主代理把快照原文贴进 settler 提示与源「把基线注进 settler」等价。
- **支持任意章重算** — 更通用。否掉：源只允许最新持久章（`runner.ts:1495-1498`）；自创更宽的范围会改变活状态语义。
- **恢复正文时自动重算（模拟 `requiresTruthRebuild`）** — 看起来更省事。否掉：源没有该消费者，自动重算会在作者没要求时改状态；可观察路径是手动同步。
- **重算也跑 validator + reconcile** — 更完整。否掉：D34 的范围；本行不把两笔债合并且不引入未批准的反馈重算语义。

## Testing

- `test/chapter-settle.test.mjs`（18 例）：结算的 facts／hooks／摘要／投影、摘要排序与重复行、空标题拒绝、状态文件缺失/损坏、跳章；`story_settle_chapter` 对已结算章与已有快照的章拒绝并指向重算；`readStateSnapshot` 严格读取（缺失、坏 JSON、形状、跨文件不变量、重复摘要）；`story_resettle_chapter` 从基线丢弃旧结算（旧 fact/hook 不残留）、刷新 `snapshots/<N>`、正文与索引字节不变、workflow-start 保留并阻断下一章、非最新/坏基线/索引与快照皆空拒绝、状态损坏修复、重开后再重算、已定稿章重算。
- `test/stage-context.test.mjs`：`proposal`／`foundation` 不注入重算块；`foundation-ready`／`plan`／`write`／`review`／`chapter-done` 在 `currentChapter>=1` 或索引有章时注入，含基线原文、「只支持最新章」与「不消费 workflow-start」；状态损坏时靠索引仍注入。
- `test/host.test.mjs`：工具清单含 `story_resettle_chapter`。
- 既有 `chapter.reopen`／`chapter.finalize`／`delete-command`／`state.check` 链路回归。
- `pnpm run verify` 全绿：456 tests（455 pass／1 skipped symlink）；`artifacts/real-runs/chapter.settle.json` 已按新行为重录。

## Consequences

- **重算不自动校验（D34）**：交付时可能产生不一致状态，只有作者再用 `story_state_check` 观察；D34 后来把对账接进重算的两阶段提交。
- **基线缺失的恢复路径**：快照是上次定稿时的状态副本，不能从更晚的活状态重放；定稿又只允许 `lastAppliedChapter === chapter`（`finalize.ts:45-47`），已结算到 N 后 `snapshots/<N-1>` 缺失就无法靠定稿补回。错误信息会点名缺失文件，恢复只能靠备份或重开/手工重建，本行不提供自动修复。
- **重开回退后的重算可达性**：重开**已定稿**章后索引仍含该行；重开**重算/定稿过**的章后 `snapshots/<N>` 仍在。两者都能让目标回到 N，重算可达。只有「已结算、未定稿、也从未重算」的章重开时，索引、lastApplied、快照三处都停在 N-1，重算 N 不可达；恢复步骤是重开前先定稿（或修订后补索引行再重算）。这条间隙与重开回退不恢复 facts/hooks 一起记 D58（owner `chapter.reopen`）。
- **settler 可能误用当前状态**：源把基线快照注入 settler 提示并声明约束（`writer.ts:304-312`）；复刻由主代理把 `snapshots/<N-1>/state/` 与三份投影原文贴进 settler 提示，工具无法强制模型的输入选择。测试只证明工具应用到基线，证明不了提示遵守协议。
- **重算保留 start 会挡住下一章**：重算不消费 `workflow-start.json`；若它指向本章，作者未复审就开下一章，`writeWorkflowStart` 会拒绝第二条 start。协议要提示先复审（review 会清 start）；这是审稿闸门的正常表现，不是重算失败。
- **恢复后的重审不可达**：恢复清掉 review 且不写 workflow start，审稿工具要该章 start、阶段又只找下一章；本行只交付状态重建，恢复后的重审/定稿路径记 D58（owner `chapter.reopen`）。修订路径由 revise 补 start，不受影响。
- **多重重开**：先 `reopen N` 再 `reopen N-1` 会留下中间章既不满足 settle 的快照护栏、也不在 resettle 目标里的状态；恢复路径是先删最新章再重算。这不是本增量引入的（重开回退的既有形态），但新判据让目标更偏向最大章号；一并记 D58。
- **重算不改变审稿状态**：源 resync 之后会跑一次新审查；本行不做审查，重算后的复审仍归 D58。未结算章按阶段先审后结算；已结算章恢复后的复审见 D58。
- **旧测试的假设变化**：只有 `test/chapter-settle.test.mjs:151` 依赖同章增量重结算，需要改写成重算夹具；`chapter-reopen.test.mjs:83`、`chapter-finalize.test.mjs:76`、`delete-command.test.mjs:69`、`state-check.test.mjs:75` 都只结算一次，不受收窄影响。
