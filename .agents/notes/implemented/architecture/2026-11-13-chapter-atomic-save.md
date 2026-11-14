# Agent Note: chapter.settle —— 草稿与原子发布（D37）

Status: implemented

> 后续更新（2026-11-14）：D45（重审观察写回索引）已由 [chapter.review —— 重审观察写回章节索引](2026-11-14-review-index-writeback.md) 注销。

> 后续更新（2026-11-14）：D36／D58 已由 [chapter.reopen —— 重开与恢复的闭环](2026-11-14-chapter-reopen-closure.md) 注销；恢复写索引观察与复审 start，重开从第 N-1 章快照回退。本文以下描述保留当时交付范围。

## Problem

源工程在一章通过审稿与结算后调用一次 `saveChapter`，用同一个 `commitAtomicFileSet` 写入章节文档、三份投影、四份状态 JSON、`story/snapshots/<N>/` 七份文件与 `chapters/index.json`（`inkos/packages/core/src/agents/writer.ts:364-450`、`inkos/packages/core/src/pipeline/chapter-persistence.ts:19-55`、`runner.ts:1382-1440`）。正文在审稿与结算期间只存在于内存，落盘就是发布。

复刻把保存链拆成四个工具：`story_write_chapter` 立刻写 `source/chapters/NNNN_<Title>.md`；`story_review_chapter` 审这份文件；`story_settle_chapter` 写状态；`story_finalize_chapter` 另写快照、索引与 active。结果是正文在结算前就公开，状态/快照/索引分两次落盘，崩溃会留下「章节可见但状态不完整」的作品。D37 的偿还点是**把发布收成一次提交**：正文先以草稿存在，审稿读草稿，结算一次写章节、状态、快照、索引与 active。

## 源工程证据

- `inkos/packages/core/src/agents/writer.ts:364-450`：`saveChapter` 组装章节、三份投影、四份状态 JSON、`snapshots/<N>/` 七份、`chapters/index.json` 与删除项，一次 `commitAtomicFileSet`。
- `inkos/packages/core/src/pipeline/chapter-persistence.ts:19-55`：索引条目带标题、字数、`observations`、`provenance: generated`、可选 telemetry，替换同章条目并保留 `createdAt`；随后 `saveChapter` 与 `markBookActiveIfNeeded`。
- `inkos/packages/core/src/pipeline/runner.ts:1326-1440`：正文在内存中完成审稿与结算；状态校验通过后才 `persistChapterArtifacts`；保存成功后才通知。
- `inkos/packages/core/src/pipeline/runner.ts:952-961`、`:1120-1138`：修订已发布章先加载上一章快照；只有最新章 `saveChapter` 回写，更早章只写章节与索引。

复刻现状（偏差位置）：

- `packages/see-dsh-novel/src/pipelines/long/write-tool.ts:60-78`：写作直接写 `chapters/NNNN_<Title>.md`。
- `packages/see-dsh-novel/src/pipelines/long/settle-tool.ts:82-96`：结算读已发布正文，只写状态。
- `packages/see-dsh-novel/src/core/finalize.ts:34-83`：定稿另写快照、索引与 active。
- `packages/see-dsh-novel/src/pipelines/long/stages/index.ts:74-87`：阶段以 `chapters/NNNN_*.md` 区分写作/审阅。

## Decision

### 交付范围与非目标

范围（D37 一行；作者已批准跨能力）：

1. **草稿层**：`story_write_chapter` 写 `.drafts/chapter-NNNN.md`（工作区根、不进 `source/`、不建 artifact）；已有本章已发布章节时拒绝；草稿已存在且**有审稿记录**时拒绝并指到 `story_revise_chapter`；无审稿记录时覆盖草稿，并确保本章 workflow start 存在（`commitFile` 原子写）。
2. **审稿与修订读草稿**：`reviewSources`、阶段编号来源、`story_revise_chapter` 的正文读取改为「已发布章节优先、草稿兜底」；草稿态修订只替换草稿并作废审稿记录，不写索引、不归档版本、不写 artifact。
3. **结算即发布**：`story_settle_chapter` 读草稿与审稿记录，应用 delta，一次 `commitFoundation` 写章节文档、四份状态 JSON、三份投影、`snapshots/<N>` 七份、`chapters/index.json`、`work.json` active、章节 artifact（manifest/revision/snapshot），并把新 revision 回填进审稿记录的 `reviewedArtifact`；删除草稿；推进 `lastAppliedChapter`。
4. **退役 `story_finalize_chapter` 工具**：工具、协议步、白名单与 `chapter.finalize` 账本行移除；核心 `finalizeChapter` 保留为 `story_recover` 的内部修复（只用于「最新章已结算、缺快照/索引条目/artifact」），不再被正常流程调用。
5. **阶段与来源**：`detectStage` 以草稿判定审阅；`chapter-done` 协议改为「审稿后结算即发布」；审稿来源与编号上下文包含草稿。
6. **恢复**：`story_recover` 新增 `chapter-publish-incomplete`（已发布章缺快照/索引条目/artifact）与 `chapter-unsettled-published`（章节已存在但 `lastApplied < N` 且 `snapshots/<N>` 缺；索引条目不参与判断，重开回退靠快照排除）。前者在「最新章、`lastApplied===N`、章节与审稿在、索引文件存在但可能缺行」时 `fixable: false`；历史章缺快照、整份索引缺失、或 `lastApplied<N` 时 `fixable: false`，detail 给可执行步骤（旧「未结算已发布」：把 `chapters/NNNN_*.md` 移到 `.drafts/chapter-NNNN.md`、删旧审稿记录、重新开始本章 workflow、重新审稿→结算）。扫描与修复分两段：扫描在 `withCommitQueue` 内且容忍读错误（索引缺失按空、坏 JSON/manifest 记为 finding），修复在队列外调用 `commitFoundation`，避免同根队列自等。
7. **备份边界**：`story_backup` 不包含 `.drafts/`；恢复时删除 `.drafts/`，避免旧备份与更新的草稿混用。
8. **D33/D58 边界**：结算仍写状态、`lastApplied` 仍由结算推进；D33 重算判据不变，草稿不参与、不新增拒绝；D58 语义不变。

非目标：

- 不做自动状态校验（D34；后来由 [D34：结算前的状态对账与 reconciliation](2026-11-14-chapter-settle-validation.md) 交付）；结算前不跑 validator。
- 不补 `lengthTelemetry`／`tokenUsage`（D35）；标题变化旧文件清理仍归 D35。
- 不做旧作品的全量自动迁移：只有最新章缺快照/索引条目/artifact 可由 `story_recover apply` 补；历史章、整份索引缺失、未结算已发布章只报告。
- 不新增面板动作；面板阶段文案随协议改。
- 不改已发布章的修订/恢复/删除语义；恢复任意章仍只换正文与运行时。

### 交付行为

1. 写正文后 `source/chapters/` 无本章文件、`.drafts/chapter-NNNN.md` 存在；阶段为审阅；已发布章拒绝；草稿+审稿在时拒绝并指到 `story_revise_chapter`；无审稿时可覆盖并确保 workflow start 存在。
2. 审稿读草稿，审稿来源与编号上下文包含草稿；观察可引用草稿行；审稿记录落盘且无 `reviewedArtifact`（未发布）。
3. 草稿态修订只替换草稿、作废审稿记录、回到审阅；`chapters/`、索引、版本目录、artifact 都不变。
4. 结算一次提交后：章节文档、四份状态 JSON、三份投影、`snapshots/<N>` 七份、索引条目、章节 artifact、active 同批出现，`lastAppliedChapter` 到 N，审稿记录 `reviewedArtifact` 指向本次 revision，草稿文件删除（`.drafts/` 空目录可保留）。
5. 结算前置缺失（草稿、审稿、状态文件）时写盘前拒绝并点名；提交失败按 `commitFoundation` 回滚，失败重试可重跑；回滚自身失败由现有 `staging-*` 恢复处理，不在本行重新实现。
6. 删除 `story_finalize_chapter` 后，重算、修订、重开、删除与下一章阶段判定不回归；协议/面板/白名单无定稿工具。
7. `story_recover`：最新章缺快照/索引条目/artifact 报 `chapter-publish-incomplete` 且 `fixable: false`；历史章缺快照或整份索引缺失报同 code 但 `fixable: false`；章节在、`lastApplied < N` 且快照/索引也缺时报 `chapter-unsettled-published`（`fixable: false`，detail 含人工步骤）；缺正文/审稿时只报告。
8. `story_backup` 备份不含 `.drafts/`；恢复删除 `.drafts/` 并在回执里明确「未发布草稿已丢弃、不可找回」；面板与 artifact 摘要不含草稿。
9. `dsh-mapping.md` 只加草稿一行；审计/范围/账本/回执按清单同步；`pnpm run verify` 全绿。

### 决定与未决问题

- **发布点=结算**（作者已批准跨能力）：不保留定稿步；源没有独立定稿，结算后立即保存。
- **草稿在 `.drafts/`、无 artifact**：DSH 工具跨调用无内存，审稿需要可读正文；草稿放工作区根、不进 `source/`，避免被章节索引、artifact 摘要与面板当成工件。草稿没有 artifact revision；发布时创建第一个章节 revision，并把 `reviewedArtifact` 回填进审稿记录，保证「审过的文本」与发布 revision 对应。登记 `dsh-mapping.md`。
- **`chapter.finalize` 行退役，归属 `chapter.settle`**：不新建 `chapter.publish` 行；旧决定 [定稿：快照、章节索引与阶段推进](../../archived/architecture/2026-11-10-chapter-finalize.md) 与 [定稿只更新本章索引行](../../archived/architecture/2026-11-13-chapter-finalize-index.md) 同批归档并标 `--superseded-by` 本 Note；两篇都否掉「把快照并进结算」「合并结算与定稿的提交」，本行按 D37 反转。
- **旧作品部分可修**：最新章缺快照/索引条目/artifact 由 `story_recover apply` 调 `finalizeChapter` 补；历史章缺快照、整份索引缺失、未结算已发布章只报告并给人工步骤。
- **D45 保留但收窄**：`finalizeChapter` 曾是「重审→结算→定稿」里唯一把重审观察写回索引的位置；退役后已发布章重审没有观察写入入口，D45 从「`edited` 被 finalize 覆盖」收窄为「重审观察无写入入口」。
- **草稿不参与备份**：备份只拥有 `work.json`＋`source/`；恢复清空 `.drafts/` 是本行新增的边界行为。
- **未决**：无；telemetry（D35）不在本行，自动校验（D34）已由 [D34：结算前的状态对账与 reconciliation](2026-11-14-chapter-settle-validation.md) 交付。

### 评审与批准证据

- Plan Review 第 1 轮：Standards 判 blocker（作者确认门/暂存/跨 5 行）；Spec 判 blocker（草稿修订提前写索引、artifact 未定义、迁移入口缺失、finalize Note 未取代）。
- Plan Review 第 2 轮：Standards 仍判跨能力 blocker；Spec/Architecture 指出草稿修订、artifact、读取单点、恢复、D45、AC4 过强。
- Plan Review 第 3 轮：Standards 无 blocker，要求 finalize 旧 Note 取代与链接、删自创重算限制、拆分恢复形态、归属 `chapter.settle`、D45 处置；Spec 要求恢复不自动补写、索引缺失不假装可修、避免 commit 队列嵌套、补失败注入/重复写作/备份语义。已按此收敛。
- Plan Review 第 5 轮：三轴均无 blocker。Standards 要求统一恢复语义、行为 1 与草稿重写条件、`finalizeChapter` 补 artifact 的幂等；Spec 要求 `chapter-unsettled-published` 只看快照、人工步骤补「重新开始 workflow」、artifact 仅缺失时建 r1、审计/范围补 write/review/revise 段；Architecture 要求 settle 对「已发布未结算」分流到 recover、finalize 只补缺失项。以上已写入本 Note 与 AC，作为实施必改点。
- 作者批准跨能力：2026-11-13，`批准 D37 跨能力`。
- 批准：未批准（等待本轮 Plan Review 与实施门）。
- 执行授权：未给。

## Design

### 草稿

- 新增 `src/core/chapter-draft.ts`：`DRAFT_DIR='.drafts'`、`draftPath(chapter)`、`writeChapterDraft`（复用 `renderChapterDocument`；写前不建 artifact）、`loadChapterDraft`、`readChapterText`（同步读取；已发布章节优先，草稿兜底）、`clearChapterDraft`。
- `story_write_chapter`：已发布章存在则拒绝；草稿已存在且审稿记录在时拒绝（指到 `story_revise_chapter`）；否则用 `commitFile` 写/覆盖草稿，并确保 workflow start 在（审稿会清 start，重写后要能再审）；输出 `path` 指向草稿。
- `reviewSources`（`chapter-review.ts:46-54`）与 `stages/review.ts` 的正文读取、`stages/index.ts` 的 `renderNumberedSources` 改用 `readChapterText`；草稿审稿不写 `reviewedArtifact`。
- `story_revise_chapter`：草稿存在时走 `replaceChapterDraft`（渲染写回草稿、删审稿记录、保留/补写 workflow start），不调用 `reviseChapterDocument`；已发布章保持现有分支。

### 结算发布

- `story_settle_chapter` 前置先按章节文件分流：`chapters/NNNN_*.md` 存在时——`chapter <= lastApplied` 且 `snapshots/<N>` 在 → 指到 `story_resettle_chapter`；`chapter <= lastApplied` 且快照缺 → 指到 `story_recover`；`chapter > lastApplied` → 「本章已发布但状态未推进」指到 `story_recover`（人工）。无章节文件时再判 `snapshots/<N>`（存在则指到重算），然后判草稿、审稿记录、四份状态文件、`chapter > lastApplied`。
- 应用 delta 得新状态；严格读取 `chapters/index.json`（`readChapterIndexStrict`：缺失/非法/条目不合 schema 时拒绝，D49 不回退），只替换本章条目、保留其它条目的字段与 `createdAt`；构造章节文档（标题取草稿头，正文取草稿）、索引条目（observations 取审稿记录、字数、provenance）、active 的 work 与章节 artifact（`chapterArtifactWrite`）。
- `writes = chapter + stateJsonWrites + stateProjectionWrites + snapshotWrites(settled,N) + index + work + artifactWrites + reviewWithReviewedArtifact`；`deletes = draft`；一次 `commitFoundation`。
- 审稿回填写入同一批：`reviewedArtifact = {workId: work.id, artifactId, revisionId}`（artifactId/revisionId 取自 `chapterArtifactWrite` 结果）。
- 章号规则不变：`chapter === lastApplied` 已结算拒绝（指到重算）、`chapter < lastApplied` 拒绝、跳章允许、已有 `snapshots/<N>` 拒绝。
- 删除 `src/pipelines/long/finalize-tool.ts` 与 `story_finalize_chapter` 注册；`src/core/finalize.ts` 保留并扩展为 `story_recover` 的内部修复：只补缺失的快照、索引条目、章节 artifact 与 active，已有行/快照不覆盖、不改正文与状态；正常流程不再调用；`chapter.finalize` 账本行与 `chapter.finalize.json` 退役，快照/索引/active 用例迁入 `chapter-settle.test.mjs`，恢复用例留在 recovery 测试。

### 阶段与清理

- `detectStage` 完整顺序：无 `work.json` → proposal；基础设定缺 → foundation；下一章审稿记录存在 → chapter-done；`!workflowStarted(下一章)` → foundation-ready；下一章章纲缺 → plan；`chapters/NNNN_*.md` 存在 → review；草稿存在 → review；否则 write。只把「已发布章」与「草稿」两处插进原顺序，保留既有分支。
- `chapter-done` 协议第 2 步改为「结算即发布」，删除第 4 步定稿；`stages/index.ts:159` 的「不覆盖已存在的章节首版」改为「草稿可重写、已发布章拒绝」；`settle-tool` 文案去掉「定稿写过」；`panel-index.ts:251` 的「结算/定稿尚未交付」改为「本章结算/发布尚未完成」；`write-tool` description 改为草稿路径。
- `writeChapterDocument` 退役（渲染逻辑并入 `chapter-draft`），`chapter-document.test.mjs` 的对应用例迁入 `chapter-settle`／草稿测试；`reviseChapterDocument` 保持已发布章分支。
- `reopenChapter` 清理 `runtime/chapter-NNNN.*` 时同时清 `.drafts/chapter-NNNN.md`；`story_delete_chapter` 只删被删章自己的草稿（不碰更晚章的在写正文）；`story_backup` 的恢复分支在写回 `source/` 后删除 `.drafts/` 并在回执提示草稿已丢弃。
- `story_recover`：扩 `FINDING_CODES` 与输出 schema，新增 `chapter-publish-incomplete` 与 `chapter-unsettled-published`。扫描用容忍读：章节索引缺失按空、坏 JSON／artifact manifest 坏时记 `fixable:false` 的 finding，不让工具抛错。`chapter-publish-incomplete` 覆盖 N=1..lastApplied 的已发布章缺快照/索引条目/artifact：最新章（`lastApplied===N`）且索引文件存在时 `fixable:true`，`apply` 调 `finalizeChapter` **只补缺失项**（快照不存在才写、索引无该行才追加、artifact 无 current revision 才建 r1、work 未 active 才改），已有行/快照/revision 不覆盖，不改正文/状态，重复 apply 幂等；历史章或整份索引缺失时 `fixable:false`。`chapter-unsettled-published` 只在 `lastApplied<N` 且 `snapshots/<N>` 缺时报告（索引条目不参与判断；`fixable:false`，人工把章节移回草稿、删旧审稿、重新开始 workflow、重新审稿结算）；重开回退留下的章节+快照不报此 code。扫描与修复分两段：扫描在 `withCommitQueue` 内，修复在队列外走 `commitFoundation`，避免同根队列自等。

### 迁移与证据

- 旧「已结算但缺快照/索引/artifact」：最新章可由 apply 补，其余只报告；历史章缺快照、整份索引缺失只报告。旧「章节已发布但未结算」只报告，给人工步骤。
- D33 Note（[基线重算](../../implemented/architecture/2026-11-13-chapter-settle-baseline.md)）结论不改；只更新其「索引仍归定稿」措辞与「已结算未定稿」相关测试/验收表述（新时序下结算即发布）。
- 六处同批：
  - `capabilities.yaml`：删 `chapter.finalize`；更新 `chapter.write`／`chapter.review`／`chapter.revise`（草稿读写、consumer/realRun）、`chapter.settle`（title/实现/consumer/realRun）、`runtime.recovery`、`runtime.stage-context`、`panel.workbench`、`backup.restore`、`chapter.reopen`、`chapter.move-delete`。
  - `docs/fidelity-audit.md`：`chapter.write`／`chapter.review`／`chapter.revise` 段、`chapter.finalize` 段并入 `chapter.settle`、D45 残余改写、批次表。
  - `docs/scope.md`：D37 行注销、D45 行改写、P4 的 `chapter.write`／`review`／`revise`／`settle` 行与「三行 verified」出口口径（删 `chapter.finalize`）、P6 债务句与依赖行、批次表。
  - `docs/dsh-mapping.md`：新增草稿一行；把既有「索引在定稿才写」行改为「索引在结算发布时写」；`artifact.identity` 的描述（`writeChapterDocument` 同批写章节/manifest/快照）改为「结算发布同批写章节/blob/manifest/snapshot」。
  - `artifacts/real-runs/`：`chapter.settle.json` 重录；`chapter.finalize.json` 删除；`chapter.write.json`／`chapter.review.json`／`chapter.revise.json`／`runtime.recovery.json`／`runtime.stage-context.json`／`panel.workbench.json`／`backup.restore.json`／`chapter.reopen.json`／`chapter.move-delete.json` 按行为更新。
  - 代码文案：`stages/index.ts` 的 chapter-done／plan 步骤与 review 协议「读章节文档」、`write-tool`／`settle-tool` description、`panel-index.ts:251`。
  - Note：本行转 implemented 并归档两篇 finalize 旧 Note。

## Alternatives considered

- **保留定稿作为发布点（草稿 + 暂存结算 + 原子定稿）** — 不删工具、面板改动小。否掉：结算不再推进状态会与 D33 冲突，暂存 delta 是比草稿更重的自创中间态，且多一个作者确认门。
- **保留现状，只做崩溃恢复** — 改动最小。否掉：恢复只能补半成品，改不了未结算正文已公开。
- **写作把正文留在会话上下文、审稿/结算从参数读** — 不新增文件。否掉：整章跨轮次经模型参数反复传递，截断与丢字段风险高。
- **草稿也建 artifact revision** — 审稿身份更完整。否掉：`currentChapterArtifact` 只认 `source/chapters/NNNN_` 路径，草稿 artifact 会被排除；发布时建首个 revision 并回填更简单。

## Testing

1. 写正文后 `source/chapters/` 无本章文件、`.drafts/chapter-NNNN.md` 存在；阶段为审阅；已发布章拒绝；草稿+审稿在时拒绝并指到 `story_revise_chapter`；无审稿时可覆盖并确保 workflow start 存在。
2. 审稿读草稿，编号来源包含草稿正文；审稿记录落盘且无 `reviewedArtifact`。
3. 草稿态修订只改草稿、删审稿记录、不写 `chapters/`/索引/版本/artifact。
4. 结算一次提交写章节、状态、投影、七份快照、索引、artifact、active；`lastApplied=N`；草稿删除；审稿记录 `reviewedArtifact` 指向新 revision；索引用 `readChapterIndexStrict` 严格读取，只替换本章条目、保留其它条目的字段与 `createdAt`，缺失/非法/条目不合 schema 时拒绝（D49 不回退）。
5. 结算前置缺失时写盘前拒绝并点名；提交失败按 `commitFoundation` 回滚（把 `source/story/snapshots` 占成文件，使快照写入的父路径 `mkdir` 报 ENOTDIR），章节/状态/快照/索引不落地、草稿保留；移除占位后重试可完成。
6. 删除 `story_finalize_chapter` 后，重算、修订、重开、删除与下一章阶段判定不回归；协议/面板/白名单无定稿工具。
7. `story_recover`：最新章缺快照/索引条目/artifact 报 `chapter-publish-incomplete` 且最新章 `fixable: true`（apply 只补缺失），其余只报告；历史章缺快照或整份索引缺失报同 code 但 `fixable: false`；章节在、`lastApplied < N` 且 `snapshots/<N>` 缺时报 `chapter-unsettled-published`（`fixable: false`，detail 含「移回草稿、删旧审稿、重新开始 workflow、重审结算」步骤）；重开回退留下的章节+快照不报此 code。缺正文/审稿时只报告。
8. `story_backup` 备份不含 `.drafts/`；恢复删除 `.drafts/` 并在回执明确「未发布草稿已丢弃、不可找回」；面板与 artifact 摘要不含草稿。
9. `dsh-mapping.md` 新增草稿一行并修正既有「索引在定稿才写」行；六处同步完成；`pnpm run verify` 全绿。

## Consequences

- **跨能力**：write/review/revise/settle/finalize、recovery/stage-context/panel/backup/reopen/delete 多行同批改，PR 较大；work item 内用三个 ticket 表示检查点（草稿 → 结算发布 → 恢复/证据），同一 PR 内顺序完成。
- **旧作品部分可修**：最新章缺快照/索引/artifact 可由 recover 补；历史章缺快照、整份索引缺失、章节已发布未结算都只报告，给人工步骤。
- **草稿可见性**：`.drafts/` 在工作区根，不进 `source/`；备份不含、恢复清空；验证要断言面板/artifact 摘要不含草稿。
- **审稿身份**：草稿审稿没有 `reviewedArtifact`；发布回填后，若草稿再修订会删旧审稿，不会错配。
- **D33/D45/D58**：D33 测试与「索引归定稿」措辞需同批更新；D45 收窄为「重审观察无写入入口」；D58 语义不变。
- **D35**：telemetry 与标题旧文件清理仍缺。

[历史快照：chapter.finalize —— 定稿：快照、章节索引与阶段推进](../../archived/architecture/2026-11-10-chapter-finalize.md)

[历史快照：定稿只更新本章索引行](../../archived/architecture/2026-11-13-chapter-finalize-index.md)
