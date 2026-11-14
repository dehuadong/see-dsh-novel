# Agent Note: chapter.revise —— 两阶段修订事务与重结算（D59）

Status: implemented

## Problem

源工程的 `reviseDraft` 在同一个事务里完成：读 N-1 基线快照 → 派 reviser 改正文 → `writer.settleChapterState` 产出修订稿的状态增量 → `stateValidator.validate` 对账（失败时一次 reconcile 重试）→ 复审修订稿 → 把章节、索引、状态与快照一次保存。最新章推进状态；更早章只写正文与索引，不倒退状态；没有显式修订请求且无观察时短路返回 `changed:false`。

复刻的 `story_revise_chapter` 先把正文写进 `source/chapters/`，再更新索引、归档、artifact、作废旧审稿并写复审 start；状态停在旧正文。作者复审后还要另行 `story_resettle_chapter`，且正文与状态分两次提交。D59 要偿还的就是这条：把“状态增量 → 正文/索引/状态/快照”排成**一次提交**，而不是先落正文再补状态。

DSH 工具内不能跑 settler／state-validator／审稿模型，所以“自动”只能由主编用子代理编排；工具负责把修订内容、状态增量、复审与对账收据合成一次原子提交。

## 源工程证据

- `pipeline/runner.ts:896-899`：最新章按已发布索引最大章判断；`:943-961` 用 `targetChapter - 1` 快照做基线，缺快照直接拒绝修订。
- `pipeline/runner.ts:995-1042`：`writer.settleChapterState` 用修订稿与基线产出 `settledRevision`；`stateValidator.validate` 对账；不一致/要求 reconcile 时 `reconcileChapterStateAfterReview` 重试一次。
- `pipeline/runner.ts:1043-1070`：复审修订稿并生成本次 `lengthTelemetry`；`postRevisionObservations` 合并 review 与 stateValidation 观察。
- `pipeline/runner.ts:1090-1100`：索引更新 `wordCount`／`updatedAt`／`observations`／`provenance: edited`／`lengthTelemetry`，后代加 `upstream-revision`。
- `pipeline/runner.ts:1121-1134`：最新章 `writer.saveChapter` 一次写章节、状态、快照与索引；更早章只写章节与索引。
- 复刻：`revise-tool.ts` 先写正文与索引；`resettle-tool.ts` 从 N-1 基线重算并提交状态/快照；`chapter-settle.ts` 已有“修订→复审→重算”修复用例。

## Decision

### 范围与非目标

范围（`chapter.revise` 主 + `chapter.review` + `chapter.settle`（复用重算机制） + `runtime.stage-context`）：

1. **最新已发布章走两阶段**：
   - 阶段 A：`story_revise_chapter` 只写 `.drafts/revision-NNNN.json`（修订提案：chapter、title、content、contentDigest、baseDigest、mode／ranges／replacements／targetText、createdAt）和复审 start；同批删除旧审稿记录（否则审稿闸门拒绝），不写 `source/chapters/`、索引、artifact、状态。缺 N-1 快照时拒绝提案。已有提案时允许覆盖并重写提案/start（旧 revision 审稿一并删除，必须重新审稿）。
   - 阶段 B：`story_review_chapter` 接受 `revisionDigest`，从提案读正文审稿，写带 `reviewedRevisionDigest` 的审稿记录，不写索引。
   - 阶段 C1：`story_commit_revision({chapter, revisionDigest, settlement})` 不写作品文件，只写 `.drafts/revision-NNNN.settlement.json`（settlement 增量、contentDigest、baseDigest、settlementDigest），返回 `proposalDigest`；state-check 子代理读它。
   - 阶段 C2：`story_commit_revision({chapter, revisionDigest, proposalDigest, validation})` 校验提案/审稿/收据，用 N-1 基线重跑 `applySettlement` 并比对，**一次 `commitFoundation`** 写章节、索引（wordCount／lengthTelemetry／observations=review+state-check／provenance edited）、artifact revision、状态与快照；删除提案/结算提案/审稿记录，阶段回 `foundation-ready`。失败/收据不符拒绝且不写任何作品文件，提案保留供重试。
2. **更早章与草稿保持即时路径**：更早已发布章仍只写正文与索引（不倒退状态、不进入两阶段），但同样要求 N-1 快照存在（源 `reviseDraft` 对所有已发布章都先读基线）；草稿修订仍走现有即时路径（结算由首次发布承接）。最新章判定用已发布索引最大章号（与源一致）。
3. **观察合并**：最终索引观察 = 复审观察 + `settlementObservations(receipt, attempt)`（源形状；consistent 的 state-projection-review／reconciliation／unavailable 由该函数生成）。这是源 `postRevisionObservations` 的落点。
4. **协议、阶段与注入**：`StageFacts` 增加 `revisionProposed`（提案存在，供审稿注入与路由）与 `revisionReviewed`（带 `reviewedRevisionDigest` 的审稿记录存在）。提案无审稿 → `review`；审稿落盘后 → `chapter-done` 的修订分支（不是 `foundation-ready`），协议依次 settler 增量 → C1 结算提案 → state-check → C2 提交。`chapter-done` 的修复块写“修订单走两阶段，不要先调 resettle”；扣下/恢复仍走 resettle。`revisionProposed` 时 review/chapter-done 注入的编号正文来源改为**提案 content**（不是已发布章），保证审稿 `sourceRefs` 与提交时正文一致。
5. **偏差登记**：源在同一事务内跑 settler/validator/review；DSH 把模型调用拆给子代理，工具用提案 + 收据在一次提交里合并。登记 `dsh-mapping.md`（源自动事务 → 提案/复审/提交三段，原子提交仍由 commitFoundation 保证）。

非目标：

- 不把模型调用塞进工具；不让 `story_commit_revision` 跑 settler/validator/review。
- 不改 D33/D34 的普通结算与重算；`story_resettle_chapter` 仍是扣下/恢复路径，不承担修订。
- 不改修订模式、范围构造、artifact 内容与 D45 审稿写回（已发布章非修订路径）。
- 最新已发布章即使正文未变也走两阶段（源显式修订仍会 settle/复审）；更早章/草稿的未变化仍即时刷新索引。
- 不改更早章修订“不倒退状态”。

### 产品行为与验收

- 最新章修订在提交前对作者可见的是提案，不是已发布正文；复审针对提案内容；提交后正文、索引、状态、快照同时出现，不经过“正文新/状态旧”的中间态。
- 更早章修订仍是即时正文+索引，不触碰状态。
- 提交失败或收据不符时提案保留，作品文件不变；协议给出重试入口。
- 判定以「## Acceptance criteria」为准。

### 决定与未决问题

- **两阶段而非扩展 resettle**：修订提交要同时写章节、索引、artifact 与状态；`story_resettle_chapter` 只写状态/快照，扩展它会把“恢复重算”和“修订提交”混成一条路径。新工具边界更清楚，仍由 `chapter.revise` 拥有。
- **提案即审稿源**：审稿必须先于提交（DSH 审稿闸门），所以提案要携带正文；`story_review_chapter` 用 `revisionDigest` 显式选择提案源，避免误审旧已发布章。
- **一次提交**：`story_commit_revision` 用一次 `commitFoundation` 写全部作品文件；settler/state-check 的对账在提交前完成，失败不落盘。
- **状态窗口消除**：提交前 `source/chapters/` 不变，作者看到的仍是旧已发布章；提案在 `.drafts`，不会出现“正文新/状态旧”的可见窗口。
- **阶段 A 清旧审稿并允许覆盖**：已发布章必有审稿记录；阶段 A 同批删除它并写新 start，否则审稿闸门拒绝。已有提案时覆盖并删旧 revision 审稿，提案不会成为死锁。
- **二次对账仍不一致时照源提交**：源在 reconcile 一次后仍不一致时仍保存，并写 `unresolvedStateObservation`（`runner.ts:1040-1062`、`chapter-state-recovery.ts:76-103`：二次 validate 抛错返回 unresolved 并带 `state-validation-unavailable`）；复刻 C2 在 attempt=2 的 reconciliation/unavailable 时提交并写 `settlementObservations`，不扣下。首次 validate 抛错（`runner.ts:1009` 未捕获）仍拒绝，故 attempt=1 的 unavailable 不提交。
- **提交删除审稿记录**：提案审稿没有 artifact identity；提交把 review 观察写进索引后删除运行记录，P3 的 `reviewedArtifact` 一致性只约束非提案审稿。
- 未决问题：无。

### 评审与批准证据

- Plan Review 第 1 轮（Standards／Spec／Architecture）：Standards 指出 D59 不能以回执降判据、观察未合并、unchanged 边界；Spec 指出审稿落点、最新章、覆盖与 attempt；Architecture 指出最新章判据、基线前置与状态窗口。作者裁决选 A（两阶段修订事务）。
- 第 2 轮：收据无绑定文件、审后阶段落错、attempt 断开、注入源仍读已发布章、跨轮回退；已改为 C1/C2 结算提案、`revisionProposed`/`revisionReviewed`、提案正文注入、attempt 递增与跨轮守卫。
- 第 3 轮：Standards／Spec／Architecture 均通过（余非阻塞边界已写进 AC/Notes）。
- 作者裁决范围（2026-11-14）：选择 **A. 两阶段修订事务**（`ask_user_question`），接受跨 `chapter.revise`／`chapter.review`／`chapter.settle` 与 `runtime.stage-context`；D61 仍待。
- 作者批准实施（2026-11-14）：`/implement 批准，执行实现 D59（含跨 chapter.revise / chapter.review / chapter.settle / runtime.stage-context）`；执行授权覆盖实施、Implementation Review、范围内修正与 Verify。

## Design

### 提案（`.drafts/revision-NNNN.json`）

```
{ version: 1, chapter, title, content, contentDigest, baseDigest, changed,
  mode, ranges?, replacements?, targetText?, createdAt }
```

- `contentDigest = sha256(content)`；`baseDigest = sha256(当前已发布正文)`。
- 阶段 A 校验：章存在、正文非空、目标章为最新已发布章、N-1 快照存在；已有提案时覆盖（删旧 revision 审稿与旧结算提案，重新写 start），不拒绝。写提案（含 `changed`）与复审 start（start 指向本章）；阶段 `review`。
- 不归档旧正文（提交时归档），不写 artifact/index/state。

### 注入来源（`stages/review.ts`／`stages/index.ts`）

- `revisionProposed` 为真时，review 与 chapter-done 的 numbered source（`## 来源 chapter-N`）从提案 content 渲染；`renderReviewContract` 与 `reviewSources` 也改为从提案 content 解析，而非已发布章；否则保持现有来源。提交/审稿的 `sourceRefs` 因此指向提案正文。

### 审稿（`story_review_chapter` 可选 `revisionDigest`）

- 参数新增 `revisionDigest`（可选）。存在时：
  - 读提案并校验 digest/contentDigest；审稿源 = 提案正文 + 章纲 memo（与已发布章同规则）。
  - 写 `chapter-NNNN.review.json`，带 `reviewedRevisionDigest`；不写索引、不要求 artifact identity。
  - 提案缺失/digest 不符拒绝；同一章已有审稿记录仍拒绝。
- 无 `revisionDigest` 时保持现有草稿/已发布章行为。

### 提交（`story_commit_revision`，两段）

- **C1 结算提案**：`{chapter, revisionDigest, settlement}`。校验提案/审稿、当前正文仍为 `baseDigest`、N-1 快照在；索引最大章号等于 N 且 `lastAppliedChapter` ∈ {N-1, N}（跨轮防回退）；读已有结算提案决定 `attempt`（没有则 1，已有则保持 2），写 `.drafts/revision-NNNN.settlement.json`（settlement 增量、contentDigest、baseDigest、attempt、settlementDigest），返回 `proposalDigest`；不写作品文件。
- **C2 提交**：`{chapter, revisionDigest, proposalDigest, validation: {proposalDigest, outcome, reportMarkdown}}`。
  - 校验：结算提案 digest 匹配；审稿 `reviewedRevisionDigest` 匹配；当前正文仍为 `baseDigest`；索引最大章号仍为 N 且 `lastAppliedChapter` ∈ {N-1, N}（期间若已结算 N+1 则拒绝，不回退状态）。
  - `outcome=consistent`：用 N-1 快照 + `settlement.delta` 重跑 `applySettlement`，提交。
  - `outcome` 非 consistent 且 `attempt=1`：拒绝，提案保留；C2 把结算提案的 `attempt` 改写为 2（同一 settlementDigest），派 settler 重做一次，再 C1/C2；C1 读到已有 attempt=2 时保持 2，不回退。
  - `attempt=2` 的 `reconciliation-required` 或 `unavailable`：按源行为照常提交，观察用 `settlementObservations(receipt, attempt)` 生成（源在二次对账仍不一致时写 `unresolvedStateObservation` 而不是扣下）。
  - 一次 `commitFoundation`：
    - `changed` 时归档当前正文到 `.versions/NNNN/`；写 `source/chapters/NNNN_<title>.md`（提案 content）；
    - 索引条目：`wordCount`、`lengthTelemetry`（`repairApplied = changed`；writerCount=旧正文、postRevise/final=提案正文）、`observations = review + settlementObservations`、`provenance: edited`（源无条件）、保留 `createdAt`/`tokenUsage`；后代加 `upstream-revision`；
    - artifact revision（`r<current+1>`，parent current，旧 revision superseded）；
    - 四份状态 JSON、三份投影、`snapshots/N` 七份；
    - 删除提案、结算提案、审稿记录；
    - 阶段回 `foundation-ready`。
- 失败：校验/写盘错误回滚，提案与审稿保留，状态/索引/正文不变。

### 协议与阶段（`stages/index.ts`）

- `StageFacts.revisionProposed`：提案存在；`revisionReviewed`：带 `reviewedRevisionDigest` 的审稿记录存在。提案无审稿 → `review`；有审稿 → `chapter-done` 的修订分支（不是 `foundation-ready`）。
- `review` 阶段：存在提案时要求 `story_review_chapter({chapter, revisionDigest})`；旧审稿已在阶段 A 删除，审稿闸门可落盘。
- `chapter-done` 修订分支：派 settler 产出增量 → C1 → 派 state-check 读结算提案 → C2；修复块写“修订单走 `story_commit_revision`，不要先调 resettle”。扣下/恢复仍走 resettle。
- 旧“修订后 resettle”文案删除；`foundation-ready` 不再承接修订提案。

### 失败行为

- 阶段 A：非最新章（走即时路径）/缺 N-1 快照/正文空 → 拒绝，不写提案；已有提案允许覆盖（删旧 revision 审稿，重新审稿）。
- 审稿：提案缺失/digest 不符/无审稿源 → 拒绝。
- 提交：提案/审稿/收据任一不匹配、attempt=1 的 reconciliation-required/unavailable、基线/正文在提交前变动 → 拒绝，不写作品文件，提案保留。
- attempt=2 的 unresolved：按源照常提交，状态用二次结算结果，观察记 `state-reconciliation`/`state-validation-unavailable`。
- 更早章/草稿：走即时路径，行为不变。

### 同步清单（六处）

1. `capabilities.yaml`：`chapter.revise` 的 title/source/consumer/realRun 补两阶段提案、审稿、提交；`chapter.review` 补 `revisionDigest`；`chapter.settle` 说明 resettle 不承担修订；`check-capabilities -- --write`。
2. `docs/fidelity-audit.md`：`chapter.revise` 判定改“机制等价（提案/复审/提交）”，D59 注销；`chapter.review` 补提案源；`chapter.settle` 补“修订提交不走 resettle”；批次 E/F 去 D59。
3. `docs/scope.md`：删 D59；P4/P5 的 D59 指针与出口句改为只剩 D61；P3 出口的 `reviewedArtifact` 一致性限定为「非提案审稿」；依赖句同步。
4. `docs/dsh-mapping.md`：`chapter.revise` 偏差行改“源事务内 settle/validate/review → DSH 提案 + 复审 + 一次提交”；写失败/扣下与更早章边界。
5. `artifacts/real-runs/`：`chapter.revise.json` 重录（提案/审稿/提交）；`chapter.review.json` 补 revisionDigest；`chapter.settle.json` 不动（resettle 行为不变）；`runtime.stage-context.json` 重录（两阶段协议）；`chapter.revise` 的 host 工具列表。
6. 本 Note 转 implemented；D59 指针（scope/audit/旧 Note）同批注销；`plugin/agent.ts`／`host.test.mjs` 加 `story_commit_revision`。

### 验证切入点

- `test/chapter-revise.test.mjs`：最新章阶段 A 只写提案/start 并删旧审稿，正文/索引/state 不变；缺 N-1 拒绝；覆盖提案/审稿；草稿/更早章即时路径不变。
- `test/chapter-review.test.mjs`：`revisionDigest` 读提案、写 `reviewedRevisionDigest`、不写索引；digest 不符/提案缺失拒绝；旧路径不变。
- `test/chapter-revision-commit.test.mjs`：C1 只写结算提案、不写作品文件；C2 一致时一次提交写正文/索引/artifact/state/快照；观察合并；tokenUsage 保留；坏收据/正文变动/attempt 1 reconciliation 拒绝且不写；attempt 2 unresolved 提交并写观察；提案删除。
- `test/stage-context.test.mjs`：review/chapter-done 在 `revisionProposed` 下来源为提案正文（含编号行），且出现 `revisionDigest`／C1／C2／`story_commit_revision`；chapter-done 不再要求修订后 resettle。
- 文本断言：协议。

## Alternatives considered

- **在 revise-tool 内自动结算**：最贴源。否掉：settler／state-check／审稿是模型调用，工具内不能跑模型。
- **扩展 `story_resettle_chapter` 承担修订提交**：少一个工具。否掉：resettle 是恢复/扣下路径，只写状态/快照；把正文/索引/artifact 塞进去会让恢复与修订共享不可审计的入口。
- **先写正文再 resettle（当前）**：实现最小。否掉：正文/状态两次提交，D59 的“一次提交”与状态窗口都不成立。
- **只加 settleRequired＋协议文本**：最小。否掉（第 1 轮评审）：降低已登记判据，且状态窗口/最新章判定与 resettle 冲突。
- **更早章也两阶段**：更一致。否掉：源不倒退状态，更早章只写正文/索引；两阶段会制造无意义的提案与状态校验。

## Verification

1. 最新已发布章修订阶段 A 只写 `.drafts/revision-NNNN.json` 与 review start，同批删除旧审稿记录；`source/chapters`、索引、artifact、四份状态/快照字节不变；缺 N-1 快照拒绝；已有提案时覆盖（删旧 revision 审稿、重新 start），不卡死。非最新章走即时路径（AC5），不进入阶段 A。
2. `story_review_chapter` 带 `revisionDigest` 时从提案读正文、写 `reviewedRevisionDigest`、不写索引；review/chapter-done 的 numbered source 与 `renderReviewContract`/`reviewSources` 都从提案 content 解析，`sourceRefs` 可按提案正文校验；digest 不符/提案缺失拒绝；不带时旧行为不变。
3. `story_commit_revision` C1 只写 `.drafts/revision-NNNN.settlement.json` 并返回 `proposalDigest`，不写作品文件；C2 在提案/审稿/收据一致且 outcome=consistent 时，一次提交写正文、索引（wordCount／lengthTelemetry／observations=review+`settlementObservations`／provenance edited／tokenUsage 保留）、artifact、状态与快照；提案/结算提案/审稿记录删除；阶段回 `foundation-ready`。
4. 提交前正文被改动/digest 不符/收据不匹配时拒绝，不写任何作品文件，提案保留；`attempt=1` 的 reconciliation-required/unavailable 拒绝并提示重做（C2 把结算提案 attempt 改写 2）；`attempt=2` 的 reconciliation-required/unavailable 照常提交并写 `state-reconciliation`/`state-validation-unavailable` 观察（源不扣下）。
5. 更早章修订只写正文与索引，不进入两阶段，不倒退状态；草稿修订保持即时路径。
6. 索引观察 = 复审观察 + `settlementObservations(receipt, attempt)`；consistent 且报告为空时只有复审。
7. 协议：提案无审稿 → `review`；审稿后 `StageFacts.revisionReviewed` 让阶段落 `chapter-done` 修订分支，文案出现 `revisionDigest`/C1/C2/`story_commit_revision`；修订修复不再指向 resettle；扣下/恢复仍用 resettle。
8. D59 从 scope/audit 注销，D61 保留；六处同步；`pnpm run verify` 全绿；CI 双端通过。
9. 最新章正文未变（`changed:false`）仍走两阶段：C2 不归档、`repairApplied=false`、`writerCount=postReviseCount=finalCount`，索引 `provenance: edited` 且观察更新；更早章/草稿未变仍即时。

## Consequences

- **改动面大**：`chapter.revise`/`chapter.review`/`chapter.settle`/协议/装配/测试同时动；已发布章修订从即时变两阶段，现有测试与真实流程要重写。
- **审稿源/artifact**：提案没有 artifact 身份，修订审稿不写 `reviewedArtifact`；评审/提交删除该审稿记录，索引 observations 保留，P3 的「reviewedArtifact 与章节 revision 一致」只约束正常审稿路径，提案路径不产生该字段。
- **状态一致性**：提交用 `applySettlement` 重跑并与 validation 收据比对；收据来自 state-check 模型，工具只能校验摘要/结果，不能重跑模型。attempt=2 unresolved 照源提交并写观察，不再扣下。
- **更早章/草稿双路径**：判定最新章用已发布索引最大章；扣下/恢复边界仍由 resettle 负责，避免两条路径互相覆盖。
- **兼容**：`story_revise_chapter` 对最新章的返回从正文回执变为提案回执；协议/测试/真实会话需同步。

## 实施记录

- Plan Review 三轴：Standards／Spec／Architecture 均通过（第 3 轮确认）；实施完成。
- 实施：`core/revision.ts`、`pipelines/long/revision-commit-tool.ts`、`revise-tool.ts` 提案分支、`review-tool.ts` 的 `revisionDigest`、`chapter-review.ts` 提案源、`stages/index.ts` 的 `revisionProposed`/`revisionReviewed` 与 C1/C2 协议；`chapter-revision-commit` 端到端用例。
- 验证：`pnpm run verify` 通过（505 passed／1 skipped）；`verify-notes`、`check-capabilities`、`audit-coverage`；CI `43560442643` 的 `verify (ubuntu-latest)` 与 `verify (windows-latest)` 均通过（提交 `7e0286b`）。
