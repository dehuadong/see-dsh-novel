# Agent Note: chapter.reopen —— 重开与恢复的闭环（D36／D58）

Status: implemented

## Problem

`chapter.reopen` 行剩两笔债：

- **D36**：源工程恢复/替换正文时在章节索引里记人工编辑观察（`provenance: edited`、`wordCount`、`manual-edit-review`，`edit-controller.ts:302-325,337-380`）；复刻的 `restoreChapter` 只换正文、归档、追加 artifact revision，不更新索引。
- **D58**：重开回退只把 `lastAppliedChapter` 与摘要行退回，facts/hooks 仍是第 N 章的——投影会出现「当前章节 N-1」却包含 N 的事实；恢复清掉审稿记录且不写 workflow start，恢复后审稿不可达；多重重开留下中间章（N、N-1 都「已发布」，`lastApplied=N-2`）既不能 settle 也不能 resettle；「已结算未定稿」章重开后重算不可达（D37 之后结算必写快照、索引与 artifact，该项只剩旧工作区形态，由 `story_recover` 承接）。

约束与已裁决事实：

- 源工程没有「重开回退」这个动作。它是复刻为阶段判定引入的机制等价（`dsh-mapping.md` 现有偏差行）；2026-11-11 评审的 C5 已裁决：恢复旧版与重开回退解耦，任意章可恢复正文，**重开回退仍限最新章**。
- 源 `reviewChapter(bookId, chapterNumber)` 可审任意章，并把当次 observations 写回索引（`runner.ts:820-873`）；源 `executeChapterReplace` 清掉该章全部 `chapter-NNNN.*`（保留 user-brief）后记索引观察（`edit-controller.ts:279-299,337-380`）。
- 复刻的审稿闸门要求该章 workflow start，审稿契约以章纲 memo 作 governed-context（`review-tool.ts:85`、`stages/review.ts:56-88`）；工作区同一时间只允许一条 start（`workflow-start.ts:45-49`）。
- 阶段由工作区文件判定（`stages/index.ts:79-116`），不是源的概念；它的目标章永远是 `currentState.chapter + 1`。
- D34 之后新增「扣下态」（章节已发布、状态停在 N-1、快照 N 在）；此时允许重开 N-1 正是 D58 多重重开的入口。

## 源工程证据

- `inkos/packages/core/src/state/chapter-workspace.ts:61-130`：版本 id `<13 位时间戳>_<来源>_<uuid>`（来源 `manual|agent|revision|regeneration|restore`）、`chapters/.versions/<NNNN>/`、列表倒序、`readChapterVersion` 只认合法 id。
- `inkos/packages/core/src/interaction/edit-controller.ts:279-299`：`clearChapterRuntimeFiles` 删除 `chapter-NNNN.*` 但保留 `chapter-NNNN.user-brief.md`。
- `inkos/packages/core/src/interaction/edit-controller.ts:302-334`：`recordManualEditObservation` 写 `provenance: edited`、`updatedAt`、可选 `wordCount`（`roughChapterLength`：去 frontmatter、去标题行、去空白后取字符数），并把旧的 `manual-edit-review` 替换成一条固定英文摘要；其它观察保留。
- `inkos/packages/core/src/interaction/edit-controller.ts:337-380`：`executeChapterReplace` 先归档旧正文（默认来源 `agent`，Studio 恢复用 `restore`），再覆盖正文，再清运行时，最后写索引；**不动运行时状态**。
- `inkos/packages/core/src/pipeline/runner.ts:820-873`：`reviewChapter(bookId, chapterNumber)` 默认章为最后一章，也可指定任意章；审稿后把该章索引 `updatedAt` 置 now、`observations` 换成当次结果并保存。
- `inkos/packages/core/src/pipeline/runner.ts:1503-1591`：按 N-1 快照重同步的基线读取（`loadRuntimeStateSnapshotAtChapter`）与一次 `saveChapter` 写状态/快照/索引；这是复刻重开回退可借用的唯一「状态回到 N-1」的源路径。
- `inkos/packages/core/src/pipeline/runner.ts:1238-1258`：重同步后调用 `reviewChapter`（`:1250`）；恢复/重开后的复审属同一能力面。
- `inkos/packages/studio/src/api/server.ts:3026-3051,3132-3178`：版本列表/读取与 restore 端点；恢复对任意章可用，不要求 `lastAppliedChapter === chapter`。
- `inkos/packages/core/src/interaction/edit-controller.ts:82-137,429-439`：`requiresTruthRebuild` 只被规划置位，没有消费者；不模拟。

复刻现状（债务位置）：

- `packages/see-dsh-novel/src/core/reopen.ts:97-133`：重开只写 `lastAppliedChapter=N-1`、`currentState.chapter=N-1`、删摘要行 N，facts/hooks 保留 N 的；`chapterRuntimePaths` 清 `chapter-N.*`；start 只在没有 start 时写。
- `packages/see-dsh-novel/src/core/reopen.ts:63-90`：恢复换正文、归档、清运行时、写 artifact revision；不写索引、不写 start。
- `packages/see-dsh-novel/src/pipelines/long/stages/index.ts:79-116`：阶段目标固定为 `currentState.chapter + 1`；`review` 只会在这一章出现。
- `packages/see-dsh-novel/src/pipelines/long/reopen-tool.ts:100-124`：工具按 `versionId` 分流，返回 `stage`。
- `packages/see-dsh-novel/src/core/panel-index.ts:290`、`src/client/StoryView.tsx:269-275`：面板的审阅动作固定用 `nextChapter`。

## Decision

### 范围与非目标

范围（`chapter.reopen` 一行；跨 `chapter.reopen` / `chapter.revise`（start 写入与回执）/ `chapter.review`（已发布章无章纲可审）/ `runtime.stage-context` / `panel.workbench`，跨能力待作者批准）：

1. **重开回退改为从 `snapshots/<N-1>` 回退状态**：校验 `lastAppliedChapter === N`、本章有正文、状态文件可读、本章已有 `snapshots/<N>`、索引条目 N 与章节 artifact、`snapshots/<N-1>/state/` 四份严格读通过且 `baseline.manifest.lastAppliedChapter === N-1`；把四份状态 JSON 与三份投影写成该快照（facts/hooks/摘要都回到 N-1），清本章运行时（保留 user-brief），写/替换本章 workflow start；快照 N 保留；输出新增 `stateRewoundTo`。三件套缺任一项时拒绝并指向 `story_recover`（可 apply 条件与 `chapter-publish-incomplete` 的 fixable 判据一致；D37 之后正常结算必有这三者）。
2. **重开限制为最新已发布章**：除 `lastAppliedChapter === N` 外，还要求不存在编号大于 N 的已发布章节；否则拒绝并点名更晚章（多重重开与 D34 扣下态从源头挡住）。
3. **恢复写索引观察（D36）**：覆盖正文、归档当前、artifact revision 不变；新增索引条目更新——`provenance: edited`、`updatedAt` now、`wordCount` 用源 `roughChapterLength` 公式、`manual-edit-review` 替换旧同名观察并保留其它观察；只更新已存在的条目，不补行（源 `recordManualEditObservation` 只 map 已有行）；索引缺失/损坏时按严格读取拒绝。
4. **恢复保留章纲、写本章 start**：清运行时仍保留 `chapter-NNNN.plan.json`（审稿契约以章纲 memo 作 governed-context）；写/替换本章 workflow start（指令说明「恢复后复审」）。章纲缺失不再拒绝恢复：保留不到章纲时，审稿契约退化为「只用本章正文」（见下），保证恢复本身不被锁死。
5. **审稿契约支持无章纲的已发布章**：`reviewSources` 在章纲缺失但已发布正文存在时只返回章节正文这一个来源；`renderReviewContract` 在无章纲时渲染「审稿要求 + 章节正文来源」并注明缺章纲。草稿态仍要求章纲（正常流程的规划闸门不变）。
5. **阶段增加复审目标**：`StageFacts.reviewTarget`；当存在一条 start 指向已发布章且该章无审稿记录时，阶段为 `review`、目标为该章（不再固定 `current+1`）；审稿契约与编号来源用目标章；修订已发布章（已写本章 start）复用同一入口。
6. **面板暴露复审目标**：`panel.index.json` 的 work 增加 `reviewChapter`（审稿目标章）；面板审阅动作的提示词与按钮文案用它，不再固定「下一章」。
7. **协议**：`chapter-done` 第 4 步与重算块写清——重开从 N-1 快照回退、只限最新已发布章；重开后改稿走 `story_revise_chapter`（`story_write_chapter` 拒已发布章），规划只负责章纲；恢复后先复审，再按需重算。

非目标：

- **D45**（已发布章重审的 observations 写回索引）不并入：源 `reviewChapter` 会把当次 observations 写回索引，复刻的 `story_review_chapter` 仍只写 review 记录；这是 `chapter.review` 行的债，D58 只负责让重审可达。后果写进 Risks。
- 不改结算/重算（D34/D59）、索引 telemetry（D35）、删除、备份、恢复任意章的状态语义（C5 不变）。
- 不模拟 `requiresTruthRebuild`/`state-sync-required`（源无消费者）。
- 不为早期章重开开口（C5 裁决）；早期章的恢复只换正文与索引观察，审稿目标阶段仍可指向它并完成复审。
- 不重建缺失的历史快照：缺 `snapshots/<N-1>` 时重开拒绝并点名；旧工作区不自动迁移。
- 不新增工具与命令；面板不新增动作。

### 产品行为与验收

- 作者要求重开最新已发布章：状态回到上一章（facts/hooks/摘要/投影一致），本章正文保留，运行时清空，start 指向本章；随后可重新规划、修订正文、复审、重算。
- 作者要求恢复任意章旧版本：正文替换、旧正文归档、artifact revision 追加；索引记人工编辑观察；该章 plan 保留；start 指向该章；阶段进入该章的审阅，审完回到等待下一章。
- 更早的已发布章存在时，重开被拒绝并指出先处理哪一章；缺 N-1 快照时拒绝并点名文件。
- 阶段与面板的审阅目标指向真正要审的章（可能是更早章），不再固定「下一章」。
- 判定以「## Acceptance criteria」为准。

### 决定与未决问题

- **重开回退必须回退状态（不是只退指针）**：源没有 reopen；机制等价不得产生源不可能的可观察状态（章号 N-1 却含 N 的 facts）。源回到 N-1 状态的唯一可观察路径是按 N-1 快照重同步；重开复用同一基线读取。这是推导结果，不是产品选择。
- **C5 的「最新章」按「最新已发布章」落地**：D37 之后状态指针不一定是发布前沿；允许重开更早章会留下中间章，源不可能产生且不可恢复。护栏只约束复刻自造的「重开回退」，不约束源有的「恢复任意章」。
- **恢复保留章纲**：源清全部 `chapter-NNNN.*`；复刻的审稿闸门与 governed-context 契约依赖章纲 memo（`dsh-mapping.md` 的 chapter.revise 重审闸门偏差行），删 plan 会让已登记的机制无法运行；保留 plan、并在章纲缺失/不可读时退化为只用正文审稿，登记 `dsh-mapping.md`。
- **旧工作区的「已结算未定稿」不是新能力**：D37 之后结算必写 `snapshots/<N>`、索引条目与章节 artifact；旧工作区缺任一项时重开先拒绝并指向 `story_recover`（可 apply 条件按 `chapter-publish-incomplete` 的 fixable 判据，否则按它的手动步骤），补齐后再重开。这一项随 D37 消失，不再作为 D58 的功能偿还。
- **start 由动作替换而不是并存**：工作区只允许一条 start。重开/恢复/修订共用一个 start 写入助手：同章 start 沿用；没有 start 或指向其它章时写本章 start 并在回执写明被替换的章（动作代表作者最新意图）。修订改用同一助手，否则「已有下一章 start 时修订已发布章」仍会让复审不可达；这会把 `chapter.revise` 纳入跨能力。
- **阶段目标而不是新阶段**：不新增 `reopen-review` 阶段；`review` 阶段加 `reviewTarget`，避免面板/协议出现新状态。
- **索引严格读取**：恢复写索引前用 `readChapterIndexStrict`（索引缺失但章节在时拒绝），与修订一致；旧工作区恢复前需先修复索引。
- 未决问题：无；跨能力批准在实施门禁确认。

### 评审与批准证据

- Plan Review 第 1 轮（Standards／Spec／Architecture 三线独立）：Standards 报 4 项（D58 第三项未处置、保留章纲的偏差原因不成立、跨能力/同步漏项、修订 start 冲突）＋1 minor；Spec 报 5 项（恢复补索引行、修订 start、面板版本、AC 拒绝情形、D45 文案）；Architecture 报 1 major（缺章纲会把流程卡死）＋3 minor（基线身份、reopen-tool 漏列、阶段顺序与测试）。已修：重开前置三件套与基线身份；状态回退；`story_recover` 出口按 fixable 判据限定；修订改用同一 start 助手并输出 `replacedStartChapter`；`PANEL_INDEX_VERSION` 升 6；阶段 `reviewTarget`；D45 文案。
- 第 2 轮：Spec 指出「恢复缺章纲即拒绝」会锁死旧工作区（`plan-tool` 只允许 current+1 补规划）；Architecture 指出章纲判定口径不一致、recover 出口过度承诺。已改为：恢复不再因章纲拒绝，审稿契约与 `reviewSources` 在已发布章无章纲/损坏时退化为只用正文（`chapter.review` 进跨能力）；`reviewStartWrites` 统一三工具；同步清单补 chapter.revise/chapter.review realRun 与 owning note。
- 第 3 轮：Spec 通过；Architecture 通过（余 3 项 minor：无章纲审稿测试、判定口径措辞、recover fixable 判据）；Standards 报 1 必修（重开前置漏章节 artifact）＋2 项非阻断。已修：重开前置补 `currentChapterArtifact`；recover 修饰语与 fixable 判据一致；验证清单补 `chapter-review`/`review-contract`/早期章无章纲恢复；恢复 start/阶段规则统一为 `<= current` 进 review、`= current+1` 正常、`> current+1` 不写 start；范围/决定/AC2 的判据同步。
- 第 4 轮（Standards 确认）：通过；两项非阻断（验证清单的早期章无章纲用例、范围 #1 与决定仍漏 artifact 的措辞）已在同批补齐。
- 作者裁决 C5（2026-11-11）：恢复旧版与重开回退解耦，任意章可恢复正文，重开回退仍限最新章。
- 作者裁决范围：2026-11-14，D58 含 D36；D45 另立；「恢复保留章纲/无章纲退化」按机制等价登记。
- 作者批准实施（2026-11-14）：`/implement 批准，执行实现 D58（含跨 chapter.reopen / chapter.revise / chapter.review / runtime.stage-context / panel.workbench）`；执行授权覆盖实施、Implementation Review、范围内修正与 Verify。
- Implementation Review 第 1 轮（Standards／Spec 两线独立）：Standards 报 6 硬（注释标注源工程、审计批次 F 未同步、Note 未转 implemented 与旧笔记未改、面板契约变化未登记、重算块残留、恢复新增状态读取与回执缺提示）＋4 判断项；Spec 报 3 项（三件套文案未区分 fixable、恢复回执缺「先处理更晚章」、重算块未写恢复/重开后先复审）＋AC1/AC5/AC7/AC8 测试缺口。已修：删除代码注释中的来源标注；恢复的当前章读取改为可失败的安全读取并新增 `startSkipped`；三件套拒绝按 fixable 判据区分「可 apply／需人工」；重算块写恢复/重开先复审与 N-1 基线；审稿契约与 `reviewSources` 的章纲判定对齐；审计/scope/Note/旧笔记同步；面板 `reviewChapter` 与版本 6 登记偏差；补 AC1/AC5/AC7/AC8 用例。
- Implementation Review 第 2 轮：Spec 指出 artifact 缺失但 store 可读时 fixable 应为 true、AC1 只比对一份投影、`startSkipped` 无测试与 Note 未登记、AC7 提示词无断言；Standards 指出 client 验证引用不成立、audit revise 段 D45 措辞矛盾、`startSkipped` 公共契约未同批。已修：`artifactOk` 按 store 可读性判定；AC1 比对三份投影；补 `state-unreadable`／`later-chapter` 测试与 Note/mapping/回执；补 client 审阅目标测试；audit/scope 的 D45 残余统一为「observations 写回」；reopen 判定把复审 start/阶段目标标为 DSH 机制承接。
- Implementation Review 第 3 轮：Spec 要求补「artifact 缺失且 store 可读 → 可 apply」用例，已补并通过；Standards 通过（无新硬违规）。两项判断项不阻塞：restore 与 revise 的索引观察写入未抽公共（保留其它观察与清空观察语义不同）；安全读取把意外异常降级为 `state-unreadable` 并在输出中可观察。
- 验证：`pnpm run verify` 通过（484 passed／1 skipped symlink）；`pnpm run verify-notes` 通过；CI `43550190665` 的 `verify (ubuntu-latest)` 与 `verify (windows-latest)` 均通过（提交 `78c66ea`）。

## Design

### 重开（core/reopen.ts）

- 新增 `latestPublishedChapter(root): Promise<number>`（扫描 `source/chapters/NNNN_*.md` 取最大章号；没有为 0）。
- `reopenChapter(root, chapter)`：
  1. 读 `work.json`、本章文档、`inspectState`；`missing`/`invalid` 非空即拒绝（无法确认指针）。
  2. `lastAppliedChapter !== chapter` → 拒绝（现有文案）。
  3. `latestPublishedChapter(root) !== chapter` → 拒绝：`只能重开最新已发布的一章：第 M 章已发布；先处理或删除更晚的章`。
  4. 本章缺 `snapshots/<N>/state/manifest.json`、索引条目 N 或章节 artifact → 拒绝并指向 `story_recover`（`apply` 只在索引可严格读取、审稿记录仍在且 artifact 可读时能补齐，与 `chapter-publish-incomplete` 的 fixable 判据一致；否则按它的手动步骤处理。D37 之后正常结算必有这三者）。
  5. `readStateSnapshot(root, chapter - 1)` 严格读四份 JSON 与跨文件不变量；要求 `baseline.manifest.lastAppliedChapter === chapter - 1`，否则拒绝；缺失/损坏点名文件（`第 N-1 章快照不可用：…`）。
  6. `chapterRuntimePaths` 删本章运行时（保留 user-brief）。
  7. start：同章 start 沿用原指令；没有 start 或指向其它章时写本章 start（指令 `重开第 N 章`），后者在返回值里带 `replacedStartChapter`。
  8. 一次 `commitFoundation`：`stateJsonWrites(baseline)` + `stateProjectionWrites(baseline)` + start + runtime deletes。快照 N 不动。
  9. 返回 `{chapter, versionId: null, archived: null, removed, stateRewoundTo: chapter - 1, replacedStartChapter?}`。
- 不删摘要行：基线快照本来就没有第 N 行。
- `reopen-tool.ts`：输出 schema/接口/`execute` 补 `stateRewoundTo`、`replacedStartChapter`；参数说明的「最后已结算」改为「最新已发布章」；回执写明状态回退到第 N-1 章与被替换的 start。

### 恢复（core/reopen.ts）

- `restoreChapter(root, chapter, versionId)` 在现有归档/替换/artifact revision 之外：
  1. `chapterRuntimePaths(root, chapter, { keep: planPath })` 保留章纲；`chapter-NNNN.user-brief.md` 仍保留。章纲缺失或损坏不阻止恢复：审稿时退化为只用正文。
  2. `readChapterIndexStrict(root)`；只更新已存在的该章条目（源 `recordManualEditObservation` 只 map 已有行，不补行）；缺行时索引原样保留，`story_recover` 仍能报告索引缺口。
  3. 索引条目：`provenance: edited`、`updatedAt: now`、`wordCount: roughChapterLength(restoredText)`；`observations = existing.filter(code !== 'manual-edit-review') + [{code:'manual-edit-review', summary:'Chapter content was replaced by an explicit edit action.', evidence: []}]`。
  4. start：当前章可读且 `chapter <= current + 1` 时写/替换本章 start（`chapter <= current` 进复审，`= current+1` 走正常 plan/review）；`chapter > current + 1`（旧的多发布章）不写 start 并返回 `startSkipped: later-chapter`；当前章号不可读（work.json/状态缺失或损坏）时不拒绝恢复、不写 start 并返回 `startSkipped: state-unreadable`。
  5. 一次 `commitFoundation` 写：归档版本、正文、artifact manifest/revision/snapshot、索引（如有条目）、start（按第 4 条）；删运行时。
  6. 状态（四份 JSON、投影、摘要行、`lastAppliedChapter`）不动。
- 新增 `roughChapterLength(text)`（放 `core/chapter-index.ts` 或 `chapter-document.ts`）：`text.replace(/^---[\s\S]*?---\s*/m,'').replace(/^#{1,6}\s+.*$/gm,'').replace(/\s+/g,'').length`，与源 `edit-controller.ts:327-334` 同式。

### start 写入（core/workflow-start.ts）

- `workflowStartChapterSync(root): number | null`：供阶段判定同步读 start 章号。
- `reviewStartWrites(root, chapter, instruction): Promise<{ writes: FileWrite[], replacedStartChapter?: number }>`：start 不存在或同章 → 写一条本章 start；不同章 → 覆盖为本章 start 并返回被替换章号。工具把 writes 并进同一次 commit，不再调 `writeWorkflowStart`（它会拒绝第二份）。重开/恢复/修订共用。
- `revise-tool.ts`：输出 schema 与回执增加 `replacedStartChapter`（没有替换时省略），描述写明「会替换其它章的未消费 start」。

### 阶段（pipelines/long/stages/index.ts）

- `StageFacts` 增加 `reviewTarget: number`（无目标时 0）。
- `detectStage`：基础设定齐后先算 `nextChapter` 与 `latestPublished`；**在 chapter-done 判断之前**检查「start 指向已发布章（`startChapter <= currentChapter`）、该章无审稿记录」——满足则返回 `{stage:'review', reviewTarget: startChapter, ...}`（`chapterPublished/chapterSnapshot` 仍按下一章算）；这样恢复早期章时不会被下一章的 chapter-done 吞掉。章纲缺失或损坏不影响进入 review：审稿契约退化为只用正文。其余路径不变；现有 review 分支的 `reviewTarget = nextChapter`；其它阶段为 0。
- `renderStageBase` 的 review 文案用 `target = reviewTarget || next`（「审第 target 章」）。
- `stages/review.ts`：`renderReviewContract(root, chapter)` 改为显式章号；章纲可读时输出「审稿要求 + 章节正文 + governed-context」，章纲缺失/不可读/解析失败但正文存在时只输出「审稿要求 + 章节正文 + 缺章纲说明」。同步版读取章纲（`loadChapterPlanSync` 或等价）供阶段/契约共用，判定口径与 `reviewSources` 一致：能正常解析且章号匹配才算可读。
- `core/chapter-review.ts` 的 `reviewSources`：章纲缺失、不可读或解析失败（按缺失处理）但已发布正文存在时只返回章节正文来源；草稿态仍要求章纲（`reviewSources` 原逻辑保留在无正文分支）。`review-tool.ts` 的 description 与 `chapter` 参数说明同步改为「已发布章可无章纲（只用正文）；草稿必须有章纲」。
- `installStageContext`：review 阶段用 `reviewTarget` 调 `renderReviewContract`；chapter-done 的编号来源仍用 `nextChapter`。

### 面板（panel.workbench）

- `panel-types.ts` 的 `work` 增加 `reviewChapter: number`（阶段为 review 时取 `reviewTarget`，否则 `nextChapter`）；`client/panel-types.ts` 同步；`PANEL_INDEX_VERSION` 5→6，`panel-index.test.mjs` 的版本断言同批更新。
- `panel-index.ts`：`work.reviewChapter = facts.stage === 'review' ? facts.reviewTarget : facts.currentChapter + 1`；`stageAction('review')` 的按钮文案从「审阅下一章」改为「审阅本章」。
- `StoryView.tsx`：审阅动作的提示用 `panelData?.work?.reviewChapter ?? chapter`。
- 面板动作 id 与命令不变。

### 协议（runtime.stage-context）

- `chapter-done` 第 4 步：重开只限最新已发布章、状态回退到 N-1 快照；恢复保留章纲并进入该章审阅；重开后改稿走 `story_revise_chapter`（写入口拒已发布章），规划只负责章纲。
- `CHAPTER_REPAIR`：恢复/重开后先复审（start 已指向该章），再按需重算；重开已把状态回退到 N-1，重算基线仍是 `snapshots/<N-1>`。
- review 阶段文案：审阅目标可能是更早的已发布章；审完回到等待下一章。若本章是「重开保留的旧稿」，先问作者是否改稿：改稿走 `story_revise_chapter`，不要直接审旧稿；直接审只作确认现有正文。

### 生命周期与失败行为

- 重开提交失败按 `commitFoundation` 回滚，正文/状态/start 不变。
- 重开的缺 N-1 快照、状态不可读、存在更晚已发布章、start 写入失败都在写盘前拒绝；恢复只在索引缺失/损坏或版本非法时拒绝，状态不可读时照常恢复并跳过 start。
- 恢复的索引更新、start、归档、artifact 与正文同一次提交；索引缺失时拒绝，不部分写。
- 旧工作区的恢复会保留 plan；plan 缺失/损坏时审稿退化为只用正文（契约里注明），不会因此拒绝恢复或锁死。
- 重开前置的 `story_recover` 出口只在「索引能被严格读取、审稿记录仍在且章节 artifact 可读」时可 `apply` 补齐，与 `chapter-publish-incomplete` 的 fixable 判据一致；否则按 `story_recover` 的手动步骤处理（拒绝文案会区分「可 apply」与「需人工」）。

### 偏差登记（写入 `docs/dsh-mapping.md`）

1. **重开回退：状态从 N-1 快照回退** — 源无重开动作；复刻为阶段判定自造该动作，只能借源的「按 N-1 快照重同步」把状态与投影一起回退，否则会产生源不可能的可观察状态。验证：重开后四份 JSON/三份投影等于 `snapshots/<N-1>`，`lastApplied=N-1`。
2. **恢复保留章纲** — 源 `clearChapterRuntimeFiles` 删全部 `chapter-NNNN.*`（保留 user-brief）；复刻保留 `chapter-NNNN.plan.json`，因为复刻审稿以章纲 memo 作 governed-context（`dsh-mapping.md` 的 chapter.revise 重审闸门偏差行）；章纲缺失/损坏时审稿退化为只用正文。验证：恢复后 `story_review_chapter` 可直接运行（有章纲／无章纲两条路径）。
3. **恢复/重开/修订写 start 并把 review 阶段目标化** — 源 `reviewChapter` 可审任意章且写索引；复刻以 workflow start 闸门 + `reviewTarget` 承接「任意章可审」，面板提示目标章。验证：恢复/修订已发布章后阶段为 review 目标该章，审完回到 foundation-ready。
4. **面板审阅目标** — 源 Studio 按当前章打开审阅；复刻在面板 work 投影里暴露 `reviewChapter`，提示词用它。验证：`panel-index`/`client` 测试。

### 同步清单（六处）

1. `capabilities.yaml`：`chapter.reopen` 的 title/source（补 `interaction/edit-controller.ts`、`pipeline/runner.ts:820-873`）/implementation/consumer/realRun；`chapter.revise` 的 realRun（start 写入助手、回执新字段）；`chapter.review` 的 realRun（已发布章无章纲可审）；`runtime.stage-context` 与 `panel.workbench` 的 realRun 重录；`check-capabilities --write`。
2. `docs/fidelity-audit.md`：`chapter.reopen` 段重写（重开回退、恢复索引、复审目标），判定改「机制等价 + D36/D58 注销」；`chapter.review` 段补「已发布章无章纲时只用正文」；`chapter.revise` 段的 D45 说明保持、start 替换写明；批次 F 表。
3. `docs/scope.md`：删 D36、D58 行；P5 非目标与「已知次序偏差」里对应句更新；D45 的「重审入口见 D58」改为「重审入口已由 D58 交付，剩余为重审观察写回索引」；依赖链。
4. `docs/dsh-mapping.md`：更新既有 reopen 偏差行；新增第 2、3 条；把 `chapter.revise` 的「没有 start 时写入」改为「替换其它章 start」（`:73` 一带）。
5. `artifacts/real-runs/`：`chapter.reopen.json`、`chapter.revise.json`、`chapter.review.json`、`runtime.stage-context.json`、`panel.workbench.json` 重录。
6. 本 Note 转 implemented；`2026-11-10-chapter-reopen.md`、`2026-11-13-reopen-restore-split.md`、`2026-11-14-chapter-settle-validation.md`（held 态重开边界）、`2026-11-13-chapter-atomic-save.md`（退回重写路径）、`2026-11-13-chapter-settle-baseline.md:177`（重开回退后的重算间隙）、`2026-11-10-chapter-revise.md:41` 与 `2026-11-13-revise-index-changed-region.md`（start 替换与回执字段）就地更新并链本 Note；D58/D36 注销说明回写审计。

### 兼容与失败行为

- `story_reopen_chapter` 输出新增 `stateRewoundTo`（可能还有 `replacedStartChapter`）；恢复的 `stage` 可能变为 `review`。
- 已开过章的工作区：重开现在要求 N-1 快照；旧作品缺快照时拒绝（不自动迁移）。
- `panel.index.json` 增加 `reviewChapter` 字段并把 `version` 升到 6；客户端与面板索引同批更新，旧索引按版本重建，不保留旧字段兼容分支。
- 恢复现在写索引与 start；旧行为（只换正文）不再保留。
- D34 扣下态：重开上一章被「更晚已发布章」护栏拒绝；修复路径仍是 `story_resettle_chapter`。

### 验证切入点

- `test/chapter-reopen.test.mjs`：重开回退状态/投影、快照 N 保留、start、`stateRewoundTo`、stage plan；拒绝非最新已发布/非最后已结算/缺 N-1 快照/缺快照 N 或索引行或 artifact/坏状态；start 覆盖；恢复索引观察（provenance、rough wordCount、manual-edit-review 替换、其它观察保留）、plan 保留、start、stage review 目标、复审后可继续；早期章恢复（含无章纲）→ review 目标该章 → 审稿 → 回到等待下一章；D34 held 态重开上一章被拒；工具输出 schema 含新字段。
- `test/stage-context.test.mjs`：已发布章 start 命中 reviewTarget（先于 chapter-done）；review 契约使用目标章；正常下一章流程不变；panel 字段。
- `test/chapter-review.test.mjs`：已发布章无章纲/章纲损坏时 `reviewSources` 只返回正文并成功落盘审稿记录；草稿态缺章纲仍拒绝。
- `test/review-contract.test.mjs`：`renderReviewContract(root, chapter)` 的新签名与目标章来源；章纲缺失/损坏但正文存在时输出「要求 + 章节正文」并注明缺章纲；缺正文仍为空。
- `test/chapter-revise.test.mjs` 或 `test/write-tool.test.mjs`：修订已发布章后阶段为 review 目标该章；已有他章 start 时被替换。
- `test/panel-index.test.mjs`、`test/workbench.test.mjs`、`test/client.test.mjs`：`reviewChapter` 投影、`PANEL_INDEX_VERSION=6`、提示词、按钮文案。
- `test/chapter-delete.test.mjs`、`test/recovery.test.mjs`：重开/恢复相关回归与 `story_recover` 补齐路径。
- 只能由文本断言的部分：协议文案、面板提示词。

## Verification

1. 重开最新已发布章：四份状态 JSON 与三份投影等于 `snapshots/<N-1>`，`lastAppliedChapter=N-1`，快照 N 不变，运行时清空（user-brief 保留），start 指向本章（同章 start 沿用指令；不同章则替换并回执被替换章号），输出 `stateRewoundTo=N-1`，阶段 `plan`。
2. 重开拒绝：`lastAppliedChapter !== N`；存在编号大于 N 的已发布章（含 D34 扣下章的上一章）；本章缺 `snapshots/<N>`、索引条目 N 或章节 artifact（指向 `story_recover`；可 apply 条件按 `chapter-publish-incomplete` 的 fixable 判据，否则给人工步骤）；`snapshots/<N-1>` 缺失/损坏或 `baseline.manifest.lastAppliedChapter !== N-1`（点名文件）；状态缺失/损坏。拒绝时不写任何文件。
3. 恢复任意章：正文替换、旧正文归档、artifact revision 追加、状态与摘要行不变；索引中**已有**条目的 `provenance: edited`、`updatedAt` 更新、`wordCount` 等于源 rough 公式、`manual-edit-review` 替换旧同名并保留其它观察（缺条目时不补行）；`chapter-NNNN.plan.json` 保留（缺失也不拒绝）；start 与阶段：`chapter <= current` 写 start 并进入 `review` 目标该章；`chapter === current+1` 写 start 并按正常 flow（plan 缺失则 plan，否则 review）；`chapter > current+1` 不写 start 并返回 `startSkipped: later-chapter`；状态不可读时不写 start 并返回 `startSkipped: state-unreadable`。拒绝情形：版本 id 非法、正文与当前相同、索引缺失/损坏；拒绝时不写任何文件。
4. 恢复后复审：`story_review_chapter` 用 start 成功；章纲可读时编号来源含正文与 governed-context，章纲缺失/损坏时只用正文并在契约里注明；审完 start 清空，阶段回到等待下一章。
5. 早期章恢复：阶段为 `review` 目标该早期章；审完回到等待下一章；状态指针不变；章纲缺失时按第 4 条退化。
6. 修订已发布章：阶段为 `review` 目标该章（不再显示 foundation-ready）；即使已有指向其它章的 start，也用本章 start 替换并在修订回执带 `replacedStartChapter`；审完回到等待下一章。
7. 面板：`panel.index.json` 的 work 含 `reviewChapter`，review 阶段等于目标章；`version` 为 6；审阅动作提示词与该章一致；按钮文案不再写「下一章」。
8. start 覆盖：存在指向其它章的未消费 start 时，重开/恢复（写 start 的情形）/修订用本章 start 替换并在回执/输出里带被替换章号；同一时间仍只有一条 start。
9. 协议：`chapter-done` 第 4 步与重算块写明重开只限最新已发布章、状态回退到 N-1、重开后改稿走修订、恢复后先复审；review 阶段文案可指向早期章。
10. 六处同步（含 D36/D58 注销、D45 保持、real-runs、implemented Note 链）；`pnpm run verify` 全绿；`verify (ubuntu-latest)`／`verify (windows-latest)` 双端通过。


## Alternatives considered

- **保持只退指针，靠重算修复** — 改动最小。否掉：修复前投影自相矛盾（章号 N-1、facts 是 N），源不可能产生；重算前任何读取都会看到脏状态。
- **允许重开更早章，并把中间章逐个重算** — 看似更灵活。否掉：重算只支持最新章；中间章无法 settle（已发布）也无法 resettle，源没有这种状态。
- **恢复后不写 start，放宽审稿前置** — 少一次写。否掉：审稿闸门是作者确认机制（不变量 1）；放宽会让审稿绕过 start，与修订路径不一致。
- **恢复清全部运行时（含章纲），另建审稿上下文** — 更贴源清理行为。否掉：复刻审稿契约以章纲 memo 作 governed-context；重建上下文是另一条能力，本行保留 plan 并登记偏差更小。
- **为复审新增独立阶段** — 阶段语义更直白。否掉：面板/协议/测试都要新增状态；`reviewTarget` 复用现有 `review` 阶段，改动面更小。
- **阶段目标固定 `current+1`，只让工具可达** — 不碰面板。否掉：面板会继续显示「审阅下一章」并给出错误章号，模型与作者都会被误导；D58 的目标就是让复审真正可达。


## Consequences
收益：恢复后能直接复审、重开回退后状态与投影一致、多重重开被拒绝；代价见下。

- **恢复保留章纲**：计划 memo 可能与被恢复的旧正文不一致；这正是复审要抓的差异。章纲缺失/损坏时审稿退化为只用正文，质量下降但不锁死。
- **start 被替换**：作者先前确认的下一章 start 会被重开/恢复/修订覆盖；回执会写明被替换的章，作者需重新确认下一章。
- **阶段目标可指向早期章**：审阅早期章期间，下一章的 start 无法写入；这是单 start 机制的必然结果，协议会说明「审完再开下一章」。
- **缺历史快照的旧作品**：重开被拒绝且无法自动重建 `snapshots/<N-1>`；删除/恢复仍是可用出口，重算需要基线。旧作品迁移不在本行。
- **D45 残留**：重审的 observations 仍只写 review 记录，不写回索引；恢复写入的 `manual-edit-review` 会在索引里保留到下一次结算/索引写入。D45 独立偿还。
- **索引严格读取**：旧工作区缺索引时恢复被拒绝（与修订一致）；需要先修复索引。
- **跨能力**：`chapter.reopen` / `chapter.revise`（start 写入与回执）/ `chapter.review`（已发布章无章纲可审）/ `runtime.stage-context` / `panel.workbench` 五行同批；`chapter.revise` 的正文/索引/artifact 行为不变。
- **面板投影变化**：`reviewChapter` 是 `panel.index.json` 的新字段；客户端与测试同批更新，不保留旧字段兼容。
