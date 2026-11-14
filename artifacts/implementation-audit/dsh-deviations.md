# DSH 机制偏差明细（工程笔记）

本文件保存 2026-11-14 从 `docs/dsh-mapping.md` 拆出的逐项实现过程与验证路径；判定/状态不在本文件。
入口文档：[`docs/dsh-mapping.md`](../../docs/dsh-mapping.md)。回执在 `artifacts/real-runs/`，审计证据在 `artifacts/implementation-audit/`。

## 偏差登记

每项偏差按四段记录：源工程做法 / 复刻做法 / 原因 / 验证。相等实现不登记，避免把映射表写第二遍。

### 作品锁：action 边界而不是 commit

- 源工程做法：`StateManager.acquireBookLock` 在 `bookDir/.write.lock` 建锁；`withWorkMutationScope` 做同 async scope reentrancy，`runInWorkMutationQueue` 做 whole-action 串行；`commitAtomicFileSet` 不感知锁。
- 复刻做法：`core/work-lock.ts` 的 `source/.write.lock` + metadata/心跳/lease；`core/work-mutation.ts` 的 `withWorkMutationScope`／`runInWorkMutationQueue`；`withWorkAction` 在 init/foundation/truth/plan/write/review/recover action 入口包锁；commit 保持 lock-agnostic。
- 原因：DSH 的 action 边界是 `story_*` 工具/命令；把锁塞进 commit 会多一层源工程没有的行为，也让读-检查-写仍可能在锁外。
- 验证：`test/work-lock.test.mjs` 的同进程/stale/token/队列/跨进程 child；真实回执 `artifacts/real-runs/runtime.work-lock.json`。

### 作者确认：原生确认条与面板命令双通道

- 源工程做法：Studio `propose_action` 生成确认卡，携带 `action`／`targetSessionKind`／`instruction`／`title`／`summary`／`actionPayload`；`write_next` 是 confirmed production intent；确认后 host 用 confirmed binding 执行 workflow start。plan/write/revise 是 workflow 内部步骤，不逐工具确认。
- 复刻做法：会话策略为 `ask` 时用 DSH 原生确认条，回执落在 `approval/asked` 与 `approval/decided`；策略为 `never` 或没有确认端时改由 `/story-approve` 命令产生回执，签核工具只读最近一次决定。`panel.confirm` 承载确认与回执语义；面板上的入口在 `panel.workbench` 的 `foundation-ready` 节点。
- 原因：出树插件没有自定义 RPC 出口，自造会话事件会让持久化整份拒读；原生确认又与会话权限策略绑死，单一通道在 `danger-full-access` 下恒拒。
- 验证：`packages/see-dsh-novel/test/approval.test.mjs` 覆盖两条通道与各类拒绝；`panel.confirm` 的 workflow start 真机回执；不得把 plan/write 改成逐工具 approval。

### 阶段停点：上下文描述不等于动作授权

- 源工程做法：没有每轮自动推进的阶段 prompt；`book create`／`write_next` 等 workflow start 由作者/命令触发，之后才跑 workflow 内部步骤。
- 复刻做法：`systemPrompt.context()` 注入当前阶段说明；阶段完成必须停下；普通问候/讨论不改作品；下一阶段必须由 workflow start（命令/面板/确认）触发。
- 原因：DSH 的阶段上下文只提供模型上下文，不是授权；把描述当命令会绕过作者确认。
- 验证：`runtime.stage-context` 的测试与真实回执；workflow start 由 `/story-write`/`panel.confirm` 写入前，阶段停在 `foundation-ready`，不得自动 plan/write。

### 面板：确认语义与工作台

- 源工程做法：Studio 的作品页由确认卡（动作）与 `TruthFiles`／`ChapterWorkspacePanel`（产物浏览）组成，同属一个页面；立项在对话里由提案工具完成。
- 复刻做法：`panel.confirm` 只拥有确认与拒绝的语义；`panel.workbench`（P6）是唯一作品页，承载阶段栏、本阶段产物列表与详情，当前阶段的动作在右栏顶部动作条。阶段、产物与确认状态来自宿主投影的只读 `panel.index.json`（`withWorkAction` 成功后重建、会话发布时补建缺失/过旧索引），面板只读该投影，不调用 `/story-index`，也不给新建表单。
- 原因：确认是授权入口，产物浏览是读取面；面板若自己触发投影或重算阶段协议，就会和宿主判定分叉，失败时还会静默回退旧卡。
- 验证：`panel-index.test.mjs`／`workbench.test.mjs`／`client.test.mjs`／`panel-projection.test.mjs`；索引不含独立状态；作者裁定不做桌面回执，以进程级测试为证据。

### panel.workbench：审阅目标与索引版本

- 源工程做法：Studio 按当前章打开审阅；没有「审阅目标章」字段，因为源没有阶段状态机。
- 复刻做法：`panel.index.json` 的 `work` 增加 `reviewChapter`，review 阶段取 `StageFacts.reviewTarget`（可能是更早的已发布章），其它阶段为 `currentChapter + 1`；审阅按钮文案改为「审阅本章」，审阅提示词使用 `reviewChapter`；索引版本 5→6，旧索引按版本重建。
- 原因：DSH 的阶段判定在恢复/修订已发布章后把阶段指向该章，面板必须显示同一目标，否则提示词与按钮会指向错误的下一章。
- 验证：`test/panel-index.test.mjs` 的「恢复后 review 目标」用例断言 `work.reviewChapter`、按钮文案与阶段；`test/stage-context.test.mjs` 断言 `reviewTarget`；`test/client.test.mjs` 断言审阅提示词。

### 面板产物：白名单、JSON 键值树与诊断折叠

- 源工程做法：真值文件浏览器按显式白名单列文件（`api/server.ts:3228-3240` 的 flat／outline／运行时诊断正则，`api/server.ts:4189-4203` 加角色卡目录），诊断文件带 `readonlyReason: "runtime-diagnostic"` 与只读警示（`pages/TruthFiles.tsx:119-129`），内容统一用 `<pre>`（`pages/TruthFiles.tsx:168`）。
- 复刻做法：面板展示集合同样走白名单（另加章节正文，源在章节页展示）；诊断文件默认收进「运行时诊断」折叠分组，展开后仍是 `<pre>` 原文与同一条警示；作者产物的 JSON（章纲、审稿）用键值树并保留「原始 JSON」切换。`state/*.json`、`memory.db`、`workflow-start.json` 不进面板；审批摘要仍是 `source/story/` 全量。白名单与源一致：不含 `book_rules.json`、两份 brief 与 `planner-context`。
- 原因：白名单让面板只显示作品产物，作者不必在状态 JSON 与 trace 里找正文；键值树与折叠是作者对可读性的裁决，原文切换保证没有信息损失。
- 验证：`panel-index.test.mjs` 断言展示集合与摘要集合分离、类别与出现阶段；`workbench.test.mjs` 断言折叠分组、JSON 键值树与原始切换、诊断警示。

### 面板删除：宿主命令替代直接 API

- 源工程做法：章节工作台页头的「删除本章」在确认后调用 `DELETE /books/:id/chapters/:num`，服务端直接调 `deleteLatestChapter` 并广播。
- 复刻做法：工作台页头的「删除本章」内联确认后调用宿主命令 `/story-delete`；命令在作品锁内读章节索引的最新章号并调 `deleteLatestChapter`，DSH 把命令结果文本显示在对话里；面板只显示「已提交，结果在对话里」，不判断成功或失败。
- 原因：client 插件没有写权限与作品锁，删除必须经宿主命令；DSH 命令注入面只回 `matched`，面板拿不到结果文本，因此不宣称成败。
- 验证：`delete-command.test.mjs`（成功删除与空工作区失败）、`workbench.test.mjs`（页头按钮与内联确认）、`client.test.mjs`（`/story-delete` 映射与提示）。

### chapter.revise：修订事务拆成提案、审稿与一次提交

- 源工程做法：`pipeline/runner.ts:943-1134` 的 `reviseDraft` 在修订事务内读 N-1 基线、`settleChapterState` 产出状态增量、`stateValidator.validate` 对账（一次 reconcile）、复审修订稿，最后 `writer.saveChapter` 一次写章节/索引/状态/快照；更早章只写章节与索引。
- 复刻做法：最新已发布章由 `story_revise_chapter` 只写 `.drafts/revision-NNNN.json` 与复审 start，并删除旧审稿；`story_review_chapter` 带 `revisionDigest` 从提案正文审稿、不写索引；`story_commit_revision` C1 写修订结算提案，state-check 后 C2 一次写章节、索引、artifact、状态与快照，观察合并 review + `settlementObservations`。更早章/草稿保持即时路径。
- 原因：DSH 的审稿、settler 与 state-check 都是模型输出，工具内不能跑模型；审稿闸门要求复审在结算前，因此把源的单事务拆成“提案 → 复审 → C1/C2 一次提交”，原子提交仍由 `commitFoundation` 保证。
- 验证：`test/chapter-revision-commit.test.mjs` 覆盖提案、`revisionDigest` 错摘要拒绝、审稿与一次提交；`test/chapter-revise.test.mjs` 覆盖更早章即时路径与长度遥测；`test/stage-context.test.mjs` 覆盖提案注入与 C1/C2 协议。
- 更早章观察：源在同事务内复审并写 `postRevisionObservations`；复刻即时修订清空索引观察并写复审 start，由审稿闸门承接。

### chapter.revise：局部修订范围由主编随正文提交

- 源工程做法：`revise_chapter` 只收 `targetText`；未给时 reviser 在内部提交 `ranges`（`agents/reviser.ts:96-105`），`utils/text-range-edits.ts:40-59` 逐段替换并保留其余字节。
- 复刻做法：主编把 reviser 子代理选出的 `ranges` 与每段 `replacements` 一起提交 `story_revise_chapter`；宿主逐段替换正文构造结果，并与 `chapterBodyForChapter` 归一后的整段 `content` 逐字节比对，范围外必须逐字节不变。
- 原因：DSH 的修订正文由子代理整段返回，宿主拿不到内部替换字段；不声明范围就无法区分多段局部修订与范围外改动。
- 验证：`test/chapter-revise.test.mjs` 的多段成功、范围外拒绝、范围非法与 `targetText` 任意 mode 用例；参数形状错误复用 `ARTIFACT_EDIT_RANGE_INVALID` 也由这些用例覆盖。

### chapter.publish：草稿先写、结算一次提交发布

- 源工程做法：正文在内存中完成审稿与结算，saveChapter 一次写章节、状态、快照与索引；校验先于落盘。
- 复刻做法：正文先写 `.drafts/chapter-NNNN.md`，不进入 `source/chapters/`；发布仍是带收据的那一次 `story_settle_chapter` 提交，一次写章节/状态/快照/索引/artifact（提案与收据见下一条）。
- 原因：DSH 工具跨调用无内存，审稿与状态校验子代理都需要可读正文。
- 验证：`test/chapter-settle.test.mjs` 断言写后 chapters 无文件、带一致收据的提交后同批出现；`test/write-tool.test.mjs` 覆盖草稿审稿/修订。

### chapter.settle：结算提案落 `.drafts/`，收据随提交回传

- 源工程做法：`runner.ts:1394-1416` 在内存里持有 `settleChapterState` 输出，交给 `StateValidatorAgent.validate` 后同一次 `saveChapter` 落盘（`chapter-truth-validation.ts:44-53`）。
- 复刻做法：两个结算工具先写 `.drafts/settlement-NNNN.json`（旧/新卡片、增量、正文与基线摘要），主编派 state-check 子代理读文件，收据随第二次调用回传；宿主重读正文与基线、逐字段重算后一次 `commitFoundation`。
- 原因：DSH 工具跨调用无内存、工具内不能派子代理、工具回执超过 8192 字符会被裁剪；提案必须对校验方可读且可绑定。
- 验证：`test/chapter-settle.test.mjs` 断言提案只写 `.drafts`、`source/` 字节不变；改正文/基线/提案/收据的漂移都被拒。

### chapter.settle：重算不自动复审

- 源工程做法：`resyncChapterStateAndAudit` 在重算后调用 `reviewChapter`（`runner.ts:1238-1253`），刷新索引观察。
- 复刻做法：`story_resettle_chapter` 只重建状态，不改正文、章节索引与 `workflow-start.json`；需要新观察时作者走 `story_review_chapter`（D58 入口），已发布章审稿写回索引由 D45 的 `chapter.review` 路径覆盖。
- 原因：DSH 工具内不能跑审稿模型；源 resync 的自动复审在复刻由 D58 的审稿闸门 + 作者显式复审承接（与修订后的复审同一机制）。重算不改正文，既有审稿记录仍有效；可观测后果是重算后索引观察不会自动刷新。
- 验证：`test/chapter-settle.test.mjs` 断言重算不改正文/索引/start；`test/chapter-review.test.mjs` 与 `test/chapter-reopen.test.mjs` 断言复审写回索引。

### chapter.settle：reconcile 重试由主编再派 settler

- 源工程做法：`chapter-state-recovery.ts:50-131` 在 pipeline 内自动带 `validationFeedback` 重跑结算并再校验一次。
- 复刻做法：第一次 `reconciliation-required` 只把报告写进提案并拒绝；主编把报告交回 settler，再生成提案、再对账、提交；`attempt` 由同键提案文件记录，第二次失败才扣下（settle）或拒绝（resettle）。
- 原因：重结算需要 settler 的模型输出，工具内不能派子代理；重试次数与反馈必须落在可校验的文件上。
- 验证：`test/chapter-settle.test.mjs` 覆盖 attempt 1 失败不写作品、attempt 2 失败扣下/拒绝、失败提案重复提交被拒、同键不提交失败收据直接重生成也升 attempt 2。

### chapter.settle：校验结论由收据真实性假设承接

- 源工程做法：`state-validator.ts:71-92` 通过结构化工具提交，宿主强制报告必填，布尔与报告由 agent 循环接收。
- 复刻做法：state-check 子代理按协议回 `{reconciliationRequired, reportMarkdown}`，主编映射为 `outcome` 并连同 `proposalDigest` 提交；宿主校验摘要、必填报告与 attempt，不证明子代理真的读过证据。
- 原因：DSH 工具内不能运行模型，子代理完成走通知，报告只能经主编转交。
- 验证：`test/chapter-settle.test.mjs` 覆盖报告必填错误码与摘要不符拒绝；`test/stage-context.test.mjs` 固定输入与判据文本。

### chapter.settle：扣下态不能直接开下一章

- 源工程做法：扣下后索引已含第 N 章，`getNextChapterNumber` 取索引连续前缀 +1，下一次写入是 N+1；reducer 只拒 `chapter <= lastApplied`，所以源会在状态停在 N-1 时继续写并结算 N+1。
- 复刻做法：`detectStage` 按 `current_state.chapter + 1` 找下一章，扣下时命中第 N 章审稿记录 → `chapter-done`；下一章 start 只在 `foundation-ready` 写，所以先修复（重算／修订复审后重算／删除本章）才推进。
- 原因：阶段由工作区文件判定，是已登记的机制落点（源没有阶段概念）；不新增作者确认门，也不把状态缺口静默带过。
- 验证：`test/stage-context.test.mjs` 断言扣下态阶段与修复行；`test/chapter-settle.test.mjs` 断言扣下时的修复与删除出口。

### chapter.settle：按章用量记账（显式子会话 id、四桶→三字段）

- 源工程做法：`runner.ts` 在发布前把 writer 输出用量与 review 用量累加成 `{promptTokens, completionTokens, totalTokens}`，随 `persistChapterArtifacts` 写索引；用量是模型调用内部的累计，不落单独文件。
- 复刻做法：`story_record_chapter_usage` 接收本章 writer／review 的**直接**子会话 id（`kind==='child' && depth===1`），从 `sessionQuery` 的 `tokenUsage` 投影读四桶，映射 `prompt = uncachedInput + cacheRead + cacheWrite`、`completion = output`、`total = 两者之和`，写 `source/story/runtime/chapter-NNNN.usage.json`；结算读取后写索引 `tokenUsage`，发布成功的同一提交删除文件。settler／state-check 是独立子代理，不计入本章（源把结算调用放在 writer 侧）。工具拒绝已发布章：源没有该工具/文件，复刻为避免孤儿文件，只允许发布前记录。
- 原因：DSH 工具边界拿不到模型 usage；会话投影只有四桶且不归属章节，必须由主编显式给 id、工具校验直接子会话后汇总，才能审计来源并避免把其它委派算进本章。
- 验证：`test/chapter-usage.test.mjs` 断言求和/映射、直接 child 校验、文件写入/覆盖；`test/chapter-settle.test.mjs` 断言发布与扣下写 `tokenUsage` 并删除 usage 文件、坏文件按无用量；`test/chapter-revise.test.mjs` 断言修订保留 `tokenUsage`。

### chapter.settle：无用量省略 tokenUsage 而不是写 0

- 源工程做法：发布恒写 `tokenUsage`；没有模型用量时 `totalUsage` 兜底 `{0,0,0}`。
- 复刻做法：没有 usage 文件（或文件不可用）时不写 `tokenUsage` 字段；索引 schema 允许省略。
- 原因：DSH 的会话投影无法区分「模型没花 token」与「没有记录」，写 0 会把「没记」伪装成「没花」；省略是源 schema 允许的可选缺省。
- 验证：`test/chapter-settle.test.mjs` 的无文件/坏文件用例断言字段缺省，另有 usage 文件用例断言三字段写入。

### chapter.settle：usage 文件生命周期

- 源工程做法：没有单独文件；用量随发布一次性写索引。
- 复刻做法：usage 文件在发布前由 `story_record_chapter_usage` 写、同章覆盖；发布成功在同一提交删除；发布失败保留供重试；`reopen`／`restore`／`delete` 清 `chapter-N.*` 运行时（含该文件）。
- 原因：运行时诊断不属于作品正文；保留旧文件会让下次发布读到旧用量。
- 验证：`test/chapter-usage.test.mjs` 覆盖同章覆盖；`test/chapter-settle.test.mjs` 断言发布后文件删除；删除/重开/恢复回归覆盖 `chapter-N.*` 清理。

### chapter.revise：缺索引行时追加修订条目

- 源工程做法：写章节时已有章节索引行，`reviseDraft` 直接 `index.map` 更新当前章与后代；缺行不会发生。
- 复刻做法：正文先写 `.drafts/chapter-NNNN.md`，结算发布时才进入 `source/chapters/`；索引在结算发布时写；修订时若缺当前章行，`revisedChapterIndex` 追加一条 `edited` 行（`createdAt = updatedAt`），已有行保留 `createdAt`；追加行与已有行一样写 `lengthTelemetry`。
- 原因：DSH 的修订早于结算发布；追加让修订后的索引反映当前正文。
- 验证：`test/chapter-revise.test.mjs` 的「无索引行时追加」「已有行保留 createdAt」与修订长度遥测用例。


### chapter.reopen：恢复正文与重开回退分开

- 源工程做法：`chapter-replace` 对任意章可用，只替换正文、归档旧稿、清该章 `chapter-NNNN.*` 运行时文件（保留 user-brief）并记索引观察，不动运行时状态；源用 `requiresTruthRebuild` 标出后续重建。源没有「重开回退」这个动作。
- 复刻做法：`story_reopen_chapter` 按 `versionId` 分流。恢复分支对任意章可用：替换正文、归档当前为 `restore`、清运行时（保留 user-brief 与章纲）、写索引的 `provenance: edited`／rough `wordCount`／`manual-edit-review`、写/替换本章复审 start，不改指针/摘要/facts/hooks；当前章号不可读时照常恢复但跳过 start 并返回 `startSkipped: state-unreadable`，`chapter > current+1` 时跳过 start 并返回 `startSkipped: later-chapter`。重开分支只对「最新已发布且最后已结算」章：保留正文、清运行时、从 `snapshots/<N-1>` 回退四份状态与三份投影；要求本章 `snapshots/<N>`、索引条目与 artifact 三件套，缺任一项指向 `story_recover`。阶段判定在 chapter-done 之前识别「已发布章有待复审 start」，把阶段判为 `review` 目标该章。
- 原因：DSH 的阶段判定用 `current_state.chapter` 找下一章；指针不回退会把重开的章判到下一章。只退指针会留下「章号 N-1、facts/hooks 是 N」的源不可能状态，所以从 N-1 快照回退。恢复保留章纲：源清全部运行时，但复刻的审稿闸门与 governed-context 契约依赖章纲 memo；章纲缺失/损坏时审稿退化为只用正文。恢复/修订/重开写/替换 start 并把 review 目标化：源 `reviewChapter` 可审任意章，复刻用 start 闸门承接。
- 验证：`test/chapter-reopen.test.mjs` 断言状态回退、三件套拒绝、start 覆盖、恢复索引观察（provenance/rough wordCount/manual-edit-review）、章纲保留与无章纲复审、已发布章复审后回到等待下一章、修订已发布章进入 review；`test/stage-context.test.mjs` 断言已发布章 start 命中 `reviewTarget`；`test/panel-index.test.mjs` 断言 `reviewChapter` 投影；`test/chapter-review.test.mjs` 断言已发布章无章纲可审。D36／D58 已注销；D33 已由 [chapter.settle 基线重算](../.agents/notes/implemented/architecture/2026-11-13-chapter-settle-baseline.md) 注销。

### backup.restore：工作区内的备份与恢复

- 源工程做法：整本作品目录 `cp` 到 `<projectRoot>/.inkos/backups/<bookId>/<stamp>/`；恢复先做 `pre-restore` 备份，再 `rm(bookDir)` + `cp` 整目录；作品身份文件坏掉也能备份/恢复。
- 复刻做法：备份 `work.json` 与 `source/`（作品拥有项）到 `<workspace>/.backups/<backupId>/`，不读 `work.json`；恢复只替换这两项，保留工作区根的 `.git`、作者文件、导出文件、`.backups/` 与活动锁；恢复前先回收死事务，回收失败把 `.inkos-file-txn-*` 隔离为 `.dead-txn-*` 后继续。
- 原因：DSH 没有“项目根 + `works/`”层级，工作区是命令唯一稳定根，且工作区根可能同时是仓库根（`/story-init` 已同因裁定不删根）；复刻的提交事务目录在作品根，恢复是裸 fs 写入，不先回收会让下一次 commit 用旧事务备份覆盖恢复内容。
- 验证：`test/backup.test.mjs` 的拥有项复制/排除、id 与列表、恢复替换与根文件保留、坏 `work.json`、空工作区 `preRestoreBackupId: null`、死事务隔离、命令参数边界；根上导出文件不回滚是 D38。

### export.work：导出回执从原生 alert 改为页面内 notice

- 源工程做法：Studio 导出按钮 POST `/export-save`，成功后 `alert("已导出到项目目录\n<path>\n(N 章)")`，失败 `alert(e.message)`（`studio/src/pages/BookDetail.tsx:389-401`）。
- 复刻做法：`StoryView` 的导出动作走 `executeCommand`（`remote.commands.execute`），把命令处理器回执文本写进动作条 notice：成功含落盘路径、章数、字数、字节数，失败含错误文本；回执不跨视图保留。
- 原因：DSH client UI 规范用页面内反馈面（成功可用 Toast、surface-owned 失败用 in-place notice），不引入原生 `alert` 模态；成功与失败都选与导出按钮同一处的 notice，保持单一入口。
- 验证：`test/client.test.mjs` 的导出回执用例与 `executeCommand` 桥接用例；`artifacts/real-runs/export.work.json`。

### 就绪判据：角色卡只能由会话路牌数

- 源工程做法：状态接口用 `isBookFoundationComplete` 判断完成——六份文件（作品身份、大纲两份、book rules 两份、伏笔池）加 `story/roles/` 任一目录里的至少一张角色卡。
- 复刻做法：`story_next` 按同一份清单判 `ready`；面板的阶段与产物一律来自宿主投影的 `panel.index.json`（`story_next` 的判据在宿主侧），client 不数文件；没有索引时只保留「开始基础设定」的兜底入口。
- 原因：客户端资源通道按路径订阅，没有列目录能力，`story/roles/` 下有什么文件客户端拿不到；因此「≥1 张角色卡」只能由宿主侧判。
- 验证：`packages/see-dsh-novel/test/ready-check.test.mjs` 覆盖七项判据与四个角色目录；`test/host.test.mjs` 覆盖四阶段与 `draft` 的两种下一步；`client.test.mjs` 覆盖索引驱动与无索引兜底。

### 控制文档：语言由调用方解析，写入项并入同一次提交

- 源工程做法：`loadControlDocuments(bookId)` 自己读 `book.json` 解析语言并直接落盘；`ensureControlDocuments` 建目录、写默认模板。
- 复刻做法：`controlDocumentWrites(root, language)` 建目录并返回缺失文件的写入项，调用方（三个真值写入工具）用 `projectionLanguage` 解析语言后并入同一次 `commitFoundation`；`readControlDocs(root, language)` 读取前先补默认。
- 原因：core 不读作品身份（语言由管线层解析），且所有真值写入走同一次原子提交，写入项比直接落盘更能保证「要么全成、要么不动」。
- 验证：`packages/see-dsh-novel/test/control-docs.test.mjs` 覆盖目录骨架、只补缺失、中英模板与读取默认；`test/foundation.test.mjs` 断言 outline 与 details 的写入集合包含两份方向文档。

### 伏笔 id：记录唯一性由复刻自己校验

- 源工程做法：`HooksStateSchema` 只校验数组形状与单条记录的字段，不要求 `hookId` 在数组内唯一；重复 id 会一起存下来，后续按 id 归并时才隐式覆盖。
- 复刻做法：`validateHooks` 拒绝重复的 `hookId`，报错点名重复的那个 id。
- 原因：复刻的状态读写以 `hookId` 为索引（投影排序、计数、结算合并都按 id 归并），重复 id 会让读到的状态与写入的不一致，且没有可观察的修复点。
- 验证：`packages/see-dsh-novel/test/hooks.test.mjs` 的 `hookId 重复` 用例。

### plan.compression：memory 分组预算按 DSH 子代理输出预留

- 源工程做法：`groupMemoryCandidates` 用 `semanticInputBudget(client,{reservedOutputTokens:2048,promptOverheadTokens:2048})` 分组，选择调用的输出上限是 2048。
- 复刻做法：D25 分组用 `contextWindow - reservedOutputTokens - 3072`；`reservedOutputTokens` 取自模型 `maxTokens`（当前 256k），每个选择任务交给 DSH subagent。
- 原因：DSH subagent 的输出预算由模型 `maxTokens` 决定，不能在调用级设 2048；照搬源的 2048 会让选择请求本身接近 1M 窗口，无法放进模型。分组更保守，选择结果与 candidate 映射不变。
- 验证：`test/context-package.test.mjs` 的 D25 分组用例；`test/context-spool.test.mjs` 的句柄读取；真实运行 `artifacts/real-runs/plan.compression.json` 记录派生窗口与 D26 证据缺口。

### artifact.identity：产物 manifest 独立于作品身份文件

- 源工程做法：`WorkManifest.artifacts` 嵌在作品 manifest 里，`stageArtifactRevision` 同时写 revision 文件与 manifest；章节 revision 的 `path` 由调用方给，指向 `source/chapters/...`，不复制正文。
- 复刻做法：`source/artifacts/manifest.json` 独立记录 `workId`、artifact、revision、current、checksum、byteLength 与 `snapshotPath`；结算发布同一次提交写章节文件、manifest 与该 revision 快照；章节 revision 的 `path` 仍指向章节文件，`snapshotPath` 指向 `source/artifacts/<artifactId>/revisions/<rid>.md`。
- 原因：复刻的 `work.json` 是作品身份文件，产物索引可重建；把 artifacts 混进身份会耦合身份校验与产物状态。DSH 单工作区一作品，跨作品隔离由工作区边界保证。
- 验证：`test/artifact-store.test.mjs` 覆盖 stage/promote/current、checksum、parent、ID/路径、快照回填；`artifacts/real-runs/artifact.identity.json` 记录 r1/r2 的 `snapshotPath` 与 `reviewedArtifact`。

### artifact.identity：章节 revision 快照布局

- 源工程做法：快照写在作品内 `revisions/<artifactId>/<revisionId><ext>`（工作根 `works/<workId>/` 下），`snapshotPath` 是作品内相对路径。
- 复刻做法：快照写在 `source/artifacts/<artifactId>/revisions/<revisionId>.md`，`snapshotPath` 是相对工作区根的路径。
- 原因：复刻的作品根就是工作区，artifacts 集中在 `source/artifacts`；两种路径都由各自的作品根解析。
- 验证：`readArtifactRevision` 按 `snapshotPath ?? path` 解析并校验 checksum；`test/artifact-store.test.mjs` 与 `test/chapter-revise.test.mjs` 覆盖快照读取、回填与错误码。

### runtime.commands：建书后启动基础设定

- 源工程做法：`book create` 在命令里同步调用 `createBookFoundationTool`，跑完基础设定后打印完成行。
- 复刻做法：`/story-init` 写身份、brief 与方向文档，然后用 `invocation.agent.followup` 投一条基础设定指令；命令立即返回「已启动」，模型在下一轮按 `story_next` 完成 outline／details／角色卡。
- 原因：命令处理器不能同步等待一次模型生成；DSH 的 `Agent.followup` 是启动后续回合的机制。源行为对应点是「一条命令启动基础设定」，完成回执在后续回合。
- 验证：`test/work-command.test.mjs` 覆盖 followup 一次、消息内容/source、init 失败不投、followup 失败回执；真实运行回执在 `artifacts/real-runs/runtime.commands.json`。

### runtime.commands：重新立项的清理范围

- 源工程做法：`book create` 遇到不完整作品目录时 `rm(workDir,{recursive:true})` 后重建；完整作品拒绝。
- 复刻做法：`/story-init` 判六项 foundation 探针；完整拒绝，不完整删除内容根 `source/` 与根 `work.json`，不删工作区根、不碰 `source/` 外文件。
- 原因：DSH 的工作区根就是作品根，不能删除根（会连 `.git` 与作者文件一起删）；用命令拥有的内容根替代 workDir。
- 验证：`test/work-command.test.mjs` 覆盖完整拒绝、清理重建、`source/` 外文件保留、坏 `work.json` 重建；真实运行回执在 `artifacts/real-runs/runtime.commands.json`。

### `/story-init --brief`：简报路径相对工作区根解析

- 源工程做法：CLI `book create --brief <path>` 从进程当前目录读取简报文件。
- 复刻做法：`/story-init --brief <path>` 相对当前工作区根解析，路径必须留在工作区内。
- 原因：DSH 命令没有独立的进程 cwd，命令能拿到的稳定根只有会话工作区；用工作区根解析也让「简报属于作品」这件事可预期。
- 验证：`packages/see-dsh-novel/test/work-command.test.mjs` 的 `--brief` 用例（含 `../x.md` 被拒绝）。

### panel.gate-resume：确认后的续作通道

- 源工程做法：Studio 确认请求由宿主执行 pending action，并在同一会话里重放隐藏 assistant tool-call 与真实 toolResult（`agent-session.ts:1220-1267`），后续 system prompt 带 resumeAfterAction 行；确认与续作在一次宿主请求内完成（`server.ts:4931-5013`）。
- 复刻做法：`/story-approve` 命令写确认回执后，由 client 向同一会话投一条可见的 queue user 消息（`client/index.ts:89-94,122`），agent 再调 `story_gate` 复核并继续下一阶段；确认与续作是两次会话动作。
- 原因：DSH approval 在 agent 工具之外，不能在模型上下文里注入隐藏 toolResult；命令与提示是宿主可用的等价确认/叫醒面。
- 验证：`client.test.mjs:494-511,794-829` 覆盖确认后 queue 消息与 gate 复核；真实会话 seq 380-417。

### chapter.settle：状态探针不抛错

- 源工程做法：`loadRuntimeStateSnapshot` 读取失败即抛错，调用方拿不到 missing/invalid 分类。
- 复刻做法：`inspectState` 返回 `{missing, invalid}`，供 finalize/recovery/reopen/settle 的探针使用；`readStateSnapshot` 与结算前置仍抛错。
- 原因：DSH 的恢复/重开/结算前置需要在同一读取器上区分“缺失可补”和“损坏需人工修”，源没有这些恢复面。
- 验证：`state-schema.test.mjs` 的 strict 拒绝/接受；`chapter-settle.test.mjs` 的坏文件拒绝与 chapter 0 基线。

### chapter.settle：重算目标章

- 源工程做法：`_resyncChapterArtifactsLocked` 只取章节索引最后一章。
- 复刻做法：`resettle-tool` 取 `max(索引最大章, lastAppliedChapter, 最大快照章)`，用于扣下/索引落后/状态回退后的修复。
- 原因：复刻的扣下态可能让索引领先状态、重开可能让状态回退；只取索引末章无法定位要修的真值（D34 扣下态偏差）。
- 验证：`chapter-settle.test.mjs` 的扣下/重算用例；`resettle` 目标章测试。

### chapter.settle：work.status 激活

- 源工程做法：`book.status === 'outlining'` 时写 `active`，在 chapter-persistence 发布路径。
- 复刻做法：`draft` 对应 `outlining`；`activateWorkStatus` 在 settle/finalize 共用；`archived` 无源对应。
- 原因：复刻 `WorkStatus` 只有 draft/active/archived；源其余状态（incubating/paused/completed/dropped）归 AU-06 的 work.json 身份债，本行只对齐激活生命周期。
- 验证：`chapter-settle.test.mjs` 发布后 status=active；`state-schema.test.mjs` 的 activateWorkStatus 单测；finalize 回归。

### chapter.revise：非显式修订入口

- 源工程做法：`runner.ts:909-941` 由 externalContext/targetText/rewrite/rework 组合决定是否显式；非显式先复审，观察为空返回 `changed:false`。
- 复刻做法：`story_revise_chapter` 只承接显式修订；工具调用本身即显式，没有非显式自动复审入口。
- 原因：DSH 的修订由主编在审稿后显式调用；源的非显式短路是 pipeline 内部行为，没有对应的工具调用面。登记为机制差异，不新增 `explicit` 参数。
- 验证：`test/chapter-revise.test.mjs` 的显式路径与回执；更早章观察差异由同一事务行覆盖。
