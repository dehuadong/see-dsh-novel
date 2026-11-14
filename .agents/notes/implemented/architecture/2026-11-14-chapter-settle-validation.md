# Agent Note: chapter.settle —— 结算前的状态对账与 reconciliation（D34）

Status: implemented

> 后续更新（2026-11-14）：D36／D58 已由 [chapter.reopen —— 重开与恢复的闭环](2026-11-14-chapter-reopen-closure.md) 注销；恢复写索引观察与复审 start，重开从第 N-1 章快照回退。本文以下描述保留当时交付范围。

## Problem

源工程每落盘一章的结算结果前，都用独立的状态校验 agent 检查「旧真值 + 新真值」是否忠实于正文与权威文档；不一致时带 `validationFeedback` 重算一次结算再校验；仍不一致或校验不可用时**照常发布章节，但不推进状态**（`runtimeStateApplied: false`），把观察写进章节索引。交付前复刻没有这一步：`story_settle_chapter` 施加增量后直接一次提交发布，重算（D33）也不校验，坏投影会被当成正常结算落盘，作者要事后手动 `story_state_check` 才发现。`story_state_check` 自己也没读全基线：它只 stat 上一章快照的 `manifest.json`，四份 JSON 的严格读取未接。

约束：

- 结算即发布（D37）：发布点是 `story_settle_chapter` 与 `story_resettle_chapter`，对账必须发生在提交之前。
- DSH 工具跨调用无内存、工具内不能派子代理（`subagent` 启动后异步返回、完成走通知），模型输出只能由主编在调用之间派发；工具结果超过 8192 字符会被 `tool-result-pruner` 裁剪（`cordis.patch.yml:89-94`，`headChars: 4096`、`tailChars: 1024`）。
- 正文在发布前只存在于 `.drafts/chapter-NNNN.md`；施加增量后的投影同样只能存在于发布前。
- 作者裁决：覆盖 settle 与 resettle；修订后的自动重结算另立 D59；校验不通过时复刻源（发布章节、状态不推进）；`story_recover` 不报告扣下态（不改 `runtime.recovery`）。

## 源工程证据

- `inkos/packages/core/src/agents/state-validator.ts:23-95`：`validate(chapterContent, chapterNumber, oldState, newState, oldHooks, newHooks, language, authorityContext)`；旧新卡片字符串相同时直接返回一致（`:38-40`），不调模型；否则模型经 `agents/state-validation-tool.ts` 提交 `reconciliationRequired` 与 `reportMarkdown`，`reconciliationRequired && !report.trim()` 抛 `STATE_RECONCILIATION_REASON_REQUIRED`（`:82`）；报告非空生成一条观察，code 为 `state-reconciliation` 或 `state-projection-review`（`:89`）；`consistent = !reconciliationRequired`（`:90`）。系统提示要求以当前章对照校验，并给出判据：只有换一份 truth projection 能消解时才置 true，正文或权威之间的矛盾只作观察、不授权再次结算；`superseded` 伏笔按其 notes 与撤回权威核对，不要求原前提在正文发生（`:46-47`）；按作品语言作答（`:42-44`）。权威上下文为 `story_frame`、`book_rules` 摘录与基线 `chapter_summaries`（`:99-119`）；正文作为 `## Chapter Text` 注入（`:67-68`）。
- `inkos/packages/core/src/pipeline/chapter-truth-validation.ts:15-109`：写章路径先校验（`:44-53`）；**首次校验抛错时直接返回** `state-validation-unavailable`、`reconciliationRequired: true` 与当前真值副本（`:54-68`），不再进入 `:80` 的 reconcile——所以写章路径的「不可用」不占重试预算；`!consistent || reconciliationRequired` 且首次校验成功时才进入 reconcile（`:80-103`）；结果 unresolved 时把输出换回当前库里的真值并置 `runtimeStateApplied: false`（`:99-101`、`:111-127`）。一致但报告非空的观察只写日志（`:70-78`），不进索引。不可用观察的摘要是不本地化的英文 `State validation was unavailable: <error>`（`:60-64`）。
- `inkos/packages/core/src/pipeline/chapter-state-recovery.ts:50-166`：reconcile 带 `validationFeedback` 重跑 `settleChapterState`（`allowReapply: true`，`:58-73`）；反馈文案由观察 code 与 summary 拼成（`:133-154`）；重算后再校验一次；仍不一致返回 `unresolved`（`:123-130`），无观察时补 `state-validation` 观察（`:156-166`）；第二次校验抛错返回 `unresolved` + `state-validation-unavailable`，摘要为 `State reconciliation could not be verified: <error>`（`:87-103`）。
- `inkos/packages/core/src/pipeline/runner.ts:1382-1440`：写章路径在 `persistChapterArtifacts`（`:1430-1440`）之前完成校验与 reconcile；**只有未解决的观察**并入 `auditResult.observations`（`:1418-1428`），再由 `pipeline/chapter-persistence.ts:25-35` 写进章节索引条目（`provenance: generated`）；`agents/writer.ts:364-450` 的 `saveChapter` 一次写章节、三份投影、四份状态 JSON、`story/snapshots/<N>/` 七份与索引，未解决时写当前真值的副本。
- `inkos/packages/core/src/pipeline/runner.ts:1238-1258`：`resyncChapterStateAndAudit` 在外层重建后调用 `reviewChapter`（`:1250`）产生新观察；复刻的重算不复刻这次复审，归 D58（已结算章恢复后的复审入口不可达）。
- `inkos/packages/core/src/pipeline/runner.ts:1537-1591`：按 N-1 快照重同步路径同样先校验、带反馈重算（`:1549-1580`）；首次校验抛错没有 catch，直接失败且不写盘（`:1538-1547`）；仍不一致时抛错且不写盘（`:1582-1584`）。
- `inkos/packages/core/src/state/state-validator.ts:80-101`：`validateRuntimeState` 在读取整份状态时拒绝重复 hook id、重复摘要章与 `currentState.chapter > manifest.lastAppliedChapter`；`runtime-state-store.ts:45-63` 的 `loadRuntimeStateSnapshot` 用它做整份校验。
- `inkos/packages/core/src/pipeline/runner.ts:999-1042`：修订路径先按修订稿结算、再校验与带反馈重算，未解决时把观察并入审稿观察（`:1055-1062`）——属 `chapter.revise`，本行不接（D59）。
- `inkos/packages/core/src/__tests__/longform-harness.flow.test.ts:198-245`：校验始终不可用时章节仍可落盘，`runtimeStateApplied: false`，观察 code `state-validation-unavailable`（该用例把校验 mock 成始终抛错，对应写章路径的「首次不可用即扣下」）。

交付前的债务位置（已由本行改写）：

- `packages/see-dsh-novel/src/pipelines/long/settle-tool.ts`：读当前状态、应用增量、一次提交发布；没有校验步骤，也没有 `validationFeedback` 重算。基线只用 `inspectState`（缺失/单文件坏），没有源 `validateRuntimeState` 的跨文件不变量。
- `packages/see-dsh-novel/src/pipelines/long/resettle-tool.ts`：按 N-1 快照重算同样不校验。
- `packages/see-dsh-novel/src/pipelines/long/state-check-tool.ts:94-97`：基线只 `existsSync(snapshots/<chapter-1>/state/manifest.json)`。
- `packages/see-dsh-novel/src/pipelines/long/stages/index.ts:169`：`chapter-done` 只教「派 settler → 调 settle」一步；对账在第 6 步（`:173`）只作手动观察。

## Decision

### 交付范围与非目标

范围（`chapter.settle` 一行；作者批准跨 `state.check`、`runtime.stage-context`）：

1. **结算两阶段**：`story_settle_chapter` 与 `story_resettle_chapter` 只有带 `validation` 收据的调用才提交；不带收据时只计算并原子写结算提案 `.drafts/settlement-<NNNN>.json`，不写 `source/`、不发布、不删草稿。
2. **提案内容**：第 N-1 章基线（settle 取当前状态，resettle 取 `snapshots/<N-1>/state/`）、施加增量后的三份投影、旧/新 `current_state` 与 `pending_hooks` 卡片（旧卡一律由基线渲染）、旧 `chapter_summaries` 投影、增量、正文文档摘要、基线摘要与提案摘要（sha256）。校验方需要的正文与权威文档不由提案携带，由协议让子代理直接读文件。
3. **收据绑定**：提交调用只带 `validation: { proposalDigest, outcome: consistent | reconciliation-required | unavailable, reportMarkdown }`，不再重发增量；宿主读提案文件后按「重读正文 → 重读基线 → 重算载荷 → 收据摘要」校验，任一不符即拒绝并点名。
4. **报告必填**：`outcome` 为 `reconciliation-required` 且报告为空时拒绝，错误码 `STATE_RECONCILIATION_REASON_REQUIRED`（与源一致）。
5. **一次重试**：第一次 `reconciliation-required` 只把报告写进提案文件并拒绝（不发布、不写作品），要求主编把报告交回 settler 重做；第二次仍为 `reconciliation-required` 时，settle 发布章节但**状态不推进**——四份状态 JSON、三份投影与 `snapshots/<N>/` 写当前真值的副本，`lastAppliedChapter` 不变，章节索引观察带 `state-reconciliation`，输出 `status: 'held'`。
6. **校验不可用**：`outcome` 为 `unavailable` 时按工具分：settle 不重试、直接扣下并观察 `state-validation-unavailable`；resettle 不重试、直接拒绝且不写盘。重试后的第二次校验不可用同样按此处理（源 `chapter-truth-validation.ts:54-68` 与 `chapter-state-recovery.ts:87-103`）。
7. **重算的失败语义**：`story_resettle_chapter` 第二次 `reconciliation-required`、或任一 attempt 的 `unavailable` 时拒绝且不写盘（源 resync 抛错，`runner.ts:1538-1547`、`:1582-1584`），只返回观察与下一步。
8. **文案由宿主渲染**：反馈正文、观察 code 与摘要按源模板（不可用两句英文逐字；反馈模板中英按作品语言），不让模型临场编。
9. **`story_state_check` 基线严格读取**：改用 `readStateSnapshot(root, chapter-1)`（四份 JSON + 跨文件不变量），缺失或损坏时点名文件；仍只读、仍要求报告；不作为结算收据的通道。
10. **结算基线对齐源的整份校验**：提案与提交在读基线后检查「`currentState.chapter > manifest.lastAppliedChapter`」与「摘要重复章」，命中即拒绝；hook id 重复已由 `validateHooks` 拒绝。
11. **协议**：`chapter-done` 与重算块写清两阶段、校验方输入与判据、`failureReport` 用法、失败后的修复路径；「本章已发布但状态未推进」时协议指向重算而不是再次结算。

非目标：

- **修订后的自动重结算**（D59）：源在修订事务内结算、校验并随章节保存（`runner.ts:999-1042`）；复刻要先派 settler 再写正文，属于 `chapter.revise` 的提交结构重排，另立工作项。
- 不做发布后的自动重结算：源是校验先于落盘。
- 不改结算的 hooks／facts／摘要与跳章规则、快照与索引字段（D35）、`story_recover` 判据、重开语义（D58）与面板动作。**重算后的复审仍归 D58**：源 `resyncChapterStateAndAudit` 在内层重建后调用 `reviewChapter`（`runner.ts:1250`），复刻的重算只重建状态，已结算章恢复后的复审入口不可达（D58）。作者裁决：扣下态不进 `story_recover` 的发现集（源没有该自检，观察在索引与结算回执里）；扣下态下重开上一章留下的中间章仍归 D58。
- 不为校验方新增工具；`story_state_check` 不参与结算收据，仍是只读观察入口。
- 提案不进 `source/`、不建 artifact、不进备份；不改重开、删除、恢复的清理行为（提案漂移由摘要与重读校验拒绝，旧提案由下一次提案覆盖）。

### 交付行为

- 作者要求结算时，主编先产出增量，再拿提案让 state-check 子代理对账，最后才提交；提交前作品不变，作者看到的是「提案已生成」而不是「已发布」。
- 对账通过：一次提交发布章节、状态、快照与索引；报告非空时的观察只出现在工具回执，不写索引。
- 对账要求重算：第一次只把反馈交回 settler 重做；第二次仍不通过时章节照发，状态停在上一章，输出与索引都写明原因和修复入口（`story_resettle_chapter`）；校验不可用时同样扣下。
- 重算不通过或校验不可用：不写任何作品文件，作者可以修复后重来。
- 扣下态下：可以修订本章后复审再重算、可以直接重算、可以删除本章；不能重开本章（指针不在本章），`story_state_check` 也拒绝本章；协议禁止重开上一章。
- 验证以「## Testing」为准。

### 决定与未决问题

- **对账在提交前，提案落 `.drafts/`**：源把提案留在内存；DSH 工具跨调用无内存、回执会被裁剪、子代理异步，所以提案落草稿目录、由主编派 state-check 子代理读文件、收据随提交调用回传。`dsh-mapping.md` 有偏差行。
- **收据由提交方校验，不经 `story_state_check`**：state_check 的契约是只读观察，且它的前置要求本章已结算（`state-check-tool.ts:91-93`），结算前调用必然被拒。报告必填与摘要绑定放在发起提交的工具里，同一次调用完成。
- **重试预算由宿主用提案文件强制**：预算键为 `(kind, chapter, documentDigest, baselineDigest)`；同键提案文件不存在或键不同 → `attempt: 1`；同键已有 `attempt: 1` → 新提案 `attempt: 2`；同键已是 `attempt: 2` → 拒绝新提案（`SETTLEMENT_PROPOSAL_BUDGET_EXHAUSTED`），要求先提交或改正文/基线。提交成功或扣下即删除提案（预算清除）。损坏的提案按 `SETTLEMENT_PROPOSAL_UNAVAILABLE` 拒绝并点名删除路径，不静默重建。代价是「发现增量写错后重新生成」也消耗一次机会。
- **提交调用不再重发增量**：源在内存里用同一份输出校验与落盘；复刻从提案文件取增量，避免主编转写 `postSettlement` 等自由文本被误判为漂移。
- **扣下时写当前真值副本到 `snapshots/<N>`**：源 `saveChapter` 无条件写快照目录；扣下后 `snapshots/<N>/state/manifest.json` 的 `lastAppliedChapter` 仍为 N-1，`readStateSnapshot` 的跨文件不变量照常通过。显式不变量：**快照目录章号可以大于其 `lastAppliedChapter`**。
- **不实现源的无变化短路**：源只在旧新卡片字符串相同时短路（`state-validator.ts:38-40`），卡片含「当前章节」行（`state/state-projections.ts:108-116`），而 `applySettlement` 必把 `currentState.chapter` 推到增量章号（`core/settle.ts:249-253`）；新章结算与基线重算都不可能触发，复刻不实现该分支，`core` 的同章 `allowReapply` 只保留给测试。
- **扣下后靠重算修复**：重算目标取 `max(章节索引最大章号, lastAppliedChapter, 已有快照最大章号)`，扣下章在判据里是 N；不新增恢复 code。
- **跨能力**：`chapter.settle`（结算与重算工具）、`state.check`（严格基线）、`runtime.stage-context`（协议文案）。

### 评审与批准证据

- Plan Review 第 1 轮（Standards／Spec／Architecture 三线独立）：共 24 条。修正包括删掉不可达的无变化短路、索引只写未解决观察、补校验方输入契约与「不得调 `story_state_check`」、提交只带收据、定义 `baselineDigest`、重试预算键、删跨 reopen/delete 的清理、补偏差行与同步清单。Architecture 曾主张 `unavailable` 应占重试预算；保留原判断：源 `chapter-truth-validation.ts:54-68` 首次抛错直接 return；Standards 第 2 轮复核同意。
- Plan Review 第 2 轮（聚焦未解决项与回归）：提交侧改为重读正文/基线 + 逐字段重算；预算改由同键提案文件是否存在判定；两形态参数完整性；回执保留既有字段；基线跨文件校验；不可用文案逐字英文；同步清单按 `rg` 枚举。
- Plan Review 第 3 轮：AC3 增加「改卡片并同步重算摘要」逼出重算防线并定死错误码；`attempt` 放入载荷；AC5/AC7 补预算与出口；新增偏差行「扣下态不能直接开下一章」；`StageFacts` 双事实。
- Plan Review 第 4 轮：三线通过；修正 `2026-11-13-chapter-settle-baseline.md:182` 的源事实（源 `resyncChapterStateAndAudit` 确实在 `runner.ts:1250` 复审，债务改挂 D58）。
- Implementation Review 第 1 轮（Standards／Spec 并行）：Standards 报 `expire.object` 被删、扣下态再结算指向 `story_recover`、坏提案可重置预算、参数类型未拆、重复代码；Spec 报 AC3/AC5/AC7/AC8 缺可直接观察的断言、扣下回执 `summaryTitle` 与写盘不一致。均按「范围内修正」处理。
- Implementation Review 第 2 轮：Standards 通过（只余回执测试计数与坏提案文案）；Spec 余 AC1 跨文件基线断言与回执计数。已补 `assertStateConsistent` 用例、坏提案删除指引、删 `feedback` 恒空字段、合并重复校验、`describeStateInconsistencies` 共用，并重录回执。
- 作者批准范围与跨能力：2026-11-14（`批准 D34 跨能力`：`chapter.settle`／`state.check`／`runtime.stage-context`）；接受 `story_recover` 不报告扣下态。
- 执行授权：2026-11-14 `/implement 批准，执行实现 D34`。

## Design

### 结算提案（core）

`src/core/settlement.ts`：

- `documentDigest(bytes)`：对正文文档原始字节取 sha256（settle 为 `.drafts/chapter-NNNN.md`，resettle 为 `source/chapters/NNNN_*.md`；含标题）。
- `baselineDigest(snapshot)`：对基线四份 JSON 的规范化 JSON（键序固定）取 sha256。
- `settlementDigest(payload)`：对提案载荷的规范化 JSON 取 sha256；载荷 = `{version, kind, chapter, baselineChapter, attempt, baselineDigest, documentDigest, delta, previousState, proposedState, previousHooks, proposedHooks, previousChapterSummaries}`。校验方可见的字段与 `attempt` 全部在载荷里。
- `buildSettlementProposal({kind, chapter, attempt, baseline, delta, documentText, language})` → `{ payload, digest, settled }`；`settled` 由 `applySettlement(baseline, delta)` 得到；卡片用三份 `render*` 渲染；旧卡一律由基线渲染。
- `assertStateConsistent(snapshot)`：复用 `state.ts` 的 `describeStateInconsistencies`，`currentState.chapter > manifest.lastAppliedChapter` 或摘要重复章即抛错。
- `settlementObservations(receipt, attempt)`：`reconciliation-required` → `state-reconciliation`；`unavailable` → `state-validation-unavailable`（attempt 1 用 `State validation was unavailable: <reason>`，attempt 2 用 `State reconciliation could not be verified: <reason>`，逐字复刻英文，不本地化）；`consistent` → 报告非空时 `state-projection-review`（只进回执）。
- `renderSettlementFeedback(observations, language)`：源 `chapter-state-recovery.ts:133-154` 的两种模板。

`src/core/settlement-proposal.ts`：

- `settlementProposalPath(chapter)`（`.drafts/settlement-<NNNN>.json`）、`writeSettlementProposal`、`readSettlementProposal`、`readProposalForRegeneration`、`clearSettlementProposal`；一次 `commitFile` 原子写。
- 文件形状：`{version: 1, kind, chapter, baselineChapter, status: 'proposed' | 'reconciliation-required', payload, digest, failureReport?}`；`attempt` 在 `payload` 内（被摘要覆盖），`status` 与 `failureReport` 是提交侧写回的状态标记；读取时校验 `kind` 与载荷一致、`status` 在枚举内、`status` 与 `failureReport` 一致、摘要与载荷一致。
- `nextAttempt(file, kind, documentDigest, baselineDigest)`：预算键与 attempt 升级/拒绝在这里统一。
- `recordSettlementFailure(root, file, report)`：第一次失败写回。
- `verifySettlementProposal({proposal, baseline, documentText, language, receipt})`：重读正文与基线摘要、重跑 `buildSettlementProposal`、比对文件与收据摘要，返回结算后快照；漂移一律 `SETTLEMENT_PROPOSAL_STALE`。

### 结算工具（两阶段）

`settle-delta.ts`：

- `chapter` 两种形态都必填；其余五个 delta 字段在 schema 里可选，`validation` 可选。
- `proposalArgsOf` 校验五个 delta 字段齐全，缺任一抛「结算增量缺字段：…」；`commitArgsOf` 校验 `validation` 三字段、`outcome` 枚举与报告必填关系。两者都带、都不带、半套 → 拒绝并点名。
- 运行时的 schema 子集不支持 `oneOf` 与 `properties/required` 并列（`test/support/schema-subset.mjs`），所以两形态用「单一对象 + `execute` 校验」表达，不写成联合 schema；对内暴露 `ProposalArgs` 与 `CommitArgs` 两个类型，提交形态的增量从提案载荷读取。

`settle-tool.ts`：

- 提案：`withWorkAction(..., { project: false })` 内跑前置（状态文件、跨文件不变量、`assertSettleTarget`、草稿、审稿记录）→ 读正文文档字节 → `nextAttempt` → 建提案 → 写 `.drafts/settlement-NNNN.json`。
- 提交：`withWorkAction` 默认投影面板；读提案并校验形态 → `verifySettlementProposal` → 按 `outcome` 分支：
  - `consistent` → 一次 `commitFoundation`（章节、状态、投影、`snapshots/<N>`、索引、work、artifact、审稿回填；删草稿与提案），`status: 'published'`；
  - `reconciliation-required` 且 `attempt === 1` → `recordSettlementFailure` 后以 `SETTLEMENT_RECONCILIATION_REQUIRED` 拒绝，返回源文案反馈，不写 `source/`；
  - `reconciliation-required` 且 `attempt === 2`，或 `unavailable` → 同一批提交但写当前真值副本与未解决观察，`status: 'held'`。
- 回执：`{status, chapter, baselineChapter, stateApplied, facts, hooks, summaryTitle, postSettlement, proposalPath, proposalDigest, observations}`；扣下态 `summaryTitle` 为空串（本章摘要行没有落盘）。

`resettle-tool.ts`：

- 同一两阶段；基线固定 `readStateSnapshot(root, chapter - 1)`；正文文档字节取已发布章节；成功提交只写状态、投影与 `snapshots/<N>`（不改正文、索引、workflow start、artifact）。
- 第一次 `reconciliation-required` → `recordSettlementFailure` 后拒绝；第二次 `reconciliation-required` 或任一 attempt 的 `unavailable` → 删除提案并拒绝，不写作品文件。

`state-check-tool.ts`：基线改成 `readStateSnapshot(root, chapter - 1)`，错误点名缺失或非法的快照文件；其余只读行为与 `STATE_RECONCILIATION_REASON_REQUIRED` 不变。

### 校验方契约（state-check 子代理）

主编在 `chapter-done`／重算协议里按此派发，子代理不调用 `story_state_check`：

- 输入：提案文件（旧/新 `current_state` 与 `pending_hooks` 卡片、`previousChapterSummaries`、`proposalDigest`）、本章正文（settle 读 `.drafts/chapter-NNNN.md`，resettle 读 `source/chapters/NNNN_*.md`）、`source/story/outline/story_frame.md`、`source/story/book_rules.md`。正文与权威由子代理自己读文件，不塞进工具回执。
- 判据（源 `state-validator.ts:46-47`）：只有换一份 truth projection 能消解时才置 `reconciliationRequired: true`；正文或权威之间的矛盾只作观察、不授权再次结算；`superseded` 伏笔按其 notes 与撤回权威核对，不要求原前提在正文发生；按作品语言作答。
- 输出：`{reconciliationRequired: boolean, reportMarkdown: string}`（与源 `state-validation-tool` 同形，无发现时报告为空），经子代理最终消息回传主编。
- 映射：`true → outcome: reconciliation-required`；`false → outcome: consistent`；子代理失败或不可用 → `outcome: unavailable`，报告写失败摘要。主编不得改写判据或报告来凑「一致」；`reconciliationRequired: true` 但报告为空属违约，主编不得改写成 `unavailable`，重派或让提交以 `STATE_RECONCILIATION_REASON_REQUIRED` 拒绝。

### 扣下态与修复

- 扣下提交写：章节文档、当前真值的四份 JSON 与三份投影、`snapshots/<N>` 的当前真值副本、索引条目（观察 = 审稿观察 + `state-reconciliation`／`state-validation-unavailable`）、artifact、审稿回填、active；删草稿与提案。`lastAppliedChapter` 保持 N-1。
- 修复：`story_resettle_chapter` 的目标判据把扣下章算作 N（`max(索引, lastApplied, 快照)`），基线取 `snapshots/<N-1>`，成功后真值到 N、`snapshots/<N>` 被刷新。若先修订了正文，修订会删除旧审稿并写本章 workflow start，必须**先复审**（消费 start）再重算，否则下一章 start 会被未消费的 start 拒绝。
- 阶段：扣下后 `current_state.chapter` 停在 N-1、审稿记录仍在 → `detectStage` 仍是 `chapter-done`；`StageFacts` 增加 `chapterPublished` 与 `chapterSnapshot`（下一章是否已有 `chapters/NNNN_*.md`、`snapshots/NNNN/state/manifest.json`），协议据此分两态：快照在 → 扣下态，追加「用重算修复，不要再次结算，也不要重开上一章」；快照缺 → D37 遗留的「已发布未结算」，保持 `story_recover` 的人工步骤，不给重算指引。
- 已知边界：跳章扣下时 `snapshots/<N-1>` 不存在，重算无基线（源 `write sync` 同样报 baseline unavailable）；该分支当前机械不可达（`/story-write` 的 start 要求 `foundation-ready`，扣下后阶段是 `chapter-done`），保留为防御分支。扣下态下重开第 N-1 章会造出 D58 的同族中间章，协议禁止该动作但不改 `chapter.reopen`。

### 生命周期

- `.drafts/settlement-<NNNN>.json` 与章节草稿同域：`story_backup` 不含 `.drafts/`；恢复清空 `.drafts/`；面板索引与 artifact 摘要不包含它。
- 提案只由两阶段工具写：提交成功或扣下后删除；失败时保留并记录完整报告；同键新提案按预算规则升级 attempt，键不同则归 1。
- 不改重开、删除、恢复的清理行为（跨能力限定三行）：遗留提案对作品无影响，下一次提案按预算键覆盖；重开保留正文时键不变，可能让下一次重算只剩一次尝试——已知边界，记 Consequences。

### 协议

- `stages/index.ts` 的 `chapter-done` 第 2 步是两阶段：派 settler → 提案 → 派 state-check 子代理（按上面的契约）→ 带收据提交；写明判据、`failureReport` 原文用法（提案文件里有完整报告，回执可能被裁剪）、第二次失败的扣下含义与修复入口。
- `CHAPTER_REPAIR` 重算块是两阶段，并写明第二次失败或校验不可用时不写盘；修订过的章要先复审再重算。
- 第 6 步（手动对账）保留，但注明「结算前不得调用 `story_state_check`（本章未结算会被前置拒绝），结算前对账走上面的提案契约」。
- `chapterPublished`／`chapterSnapshot` 分支：扣下态（两者都在）追加重算修复行；遗留「已发布未结算」（章在、快照缺）保持 `story_recover` 的人工步骤，不追加重算行。

### 偏差登记（已写入 `docs/dsh-mapping.md`）

1. **结算对账的提案落 `.drafts/`，收据随提交回传** — 源在内存里把 `settleChapterState` 输出交给校验 agent 后同一次 `saveChapter` 落盘；DSH 工具跨调用无内存、工具内不能派子代理、回执会被裁剪，所以提案落文件、主编派子代理读、收据随第二次调用回传；验证是提案只写 `.drafts` 与四类漂移拒绝。
2. **reconcile 的重试由主编再派 settler** — 源在 pipeline 内自动带反馈重跑；复刻第一次失败只记录并拒绝，主编交回 settler 后重新提案；`attempt` 由同键提案文件记录，第二次失败才扣下（settle）或拒绝（resettle）。
3. **校验方的结构化提交由收据真实性假设承接** — 源宿主强制报告必填；复刻主编映射 `outcome` 并回传摘要，宿主校验收据与 attempt，不证明子代理读过证据；审计记录该信任边界。
4. **扣下态不能直接开下一章** — 源在状态停在 N-1 时继续写并结算 N+1；复刻的阶段判定命中 `chapter-done`，下一章 start 只在 `foundation-ready` 写，所以要先修复；诊断原因是阶段由工作区文件判定（D37 已登记的机制等价）。

### 六处同步（已执行）

1. `capabilities.yaml`：`chapter.settle` 的 title／source／implementation（指向 `core/settlement.ts`）／consumer／realRun；`state.check` 与 `runtime.stage-context` 的 realRun 重录；`check-capabilities --write` 通过。
2. `docs/fidelity-audit.md`：`chapter.settle` 与 `state.check` 的「复刻现状」与判定重写，注销 D34；`chapter.revise` 的「随 D34」改 D59；批次 E/F 表。
3. `docs/scope.md`：删 D34 行；新增 D59；P3／P4／P5 的 D34 句改 D59 或删除；次序偏差与依赖链去掉 D34／D37。
4. `docs/dsh-mapping.md`：新增四条偏差行，更新 publish 行。
5. `artifacts/real-runs/`：`chapter.settle.json`、`state.check.json`、`runtime.stage-context.json` 按新行为重录。
6. 本 Note 转 implemented；`2026-11-10-chapter-settle.md`、`chapter-settle-gaps`、`settle-only-summary`、`state-check`、`state-check-criterion`、`chapter-atomic-save`、`chapter-settle-baseline` 的 D34 现状陈述就地更新并链本 Note；`chapter-revise*` 改挂 D59；`chapter-move-delete`、`reopen-restore-split` 只加前向链接。

### 兼容与失败行为

- 不带 `validation` 的旧调用不再发布，只返回提案；提交调用不再携带增量；回执在既有字段上新增状态字段。工具描述、参数说明与协议同批改，测试改写。
- 提案漂移（正文被改写、基线变化、提案文件被改、收据摘要不符、提案缺失）→ 拒绝并要求重新生成，不写作品。
- 结算基线：`inspectState` 的缺失/坏文件前置 + `assertStateConsistent` 的跨文件不变量，与源 `loadRuntimeStateSnapshot` 的整份校验对齐。
- 提交失败按 `commitFoundation` 回滚，不删草稿与提案，可重跑。
- 旧作品没有提案文件时自然生成；`.drafts/` 缺失时创建。

## Alternatives considered

- **发布后校验再重算** — 不需要提案文件、流程最短。否掉：源是校验先于落盘（`runner.ts:1382-1430`），发布后校验会让真值先推进再回滚，多一次提交与崩溃窗口，扣下语义也无法表达。
- **提案卡片直接放工具回执** — 少一个文件。否掉：工具结果超过 8192 字符会被 `tool-result-pruner` 裁剪（`headChars: 4096`、`tailChars: 1024`），校验方会看到残缺投影；卡片还要经主编上下文转交。
- **让结算工具内部派子代理跑校验** — 一次调用、最接近源。否掉：DSH 工具不能派子代理（`subagent` 启动即返回、完成走通知；D51 已否掉同类方案），在工具内阻塞等子会话会与 agent 循环重入。
- **把收据写进 `story_state_check`** — 复用现有对账入口。否掉：state_check 只读且要求本章已结算，结算前调用必然被拒；把收据塞进去会引入跨工具写语义。
- **校验只吃增量与基线，不落提案** — 最小改动。否掉：校验方拿不到施加后的投影（hook 仲裁与摘要替换在宿主），会把「应用后是否一致」降级成心算；收据也无法绑定。
- **失败时拒绝发布、保留草稿** — 作品形态最简单。否掉：作者裁决复刻源（章节照发、状态不推进）；拒绝发布会让一章卡在结算，且改动源的可观察行为。
- **工具自动重试（本地循环）** — 不需要提案文件计数。否掉：工具不能派代理，重派只能由主编做；没有提案文件就无法区分第一次与第二次失败。
- **沿用 D37 否掉的「暂存结算 + 原子定稿」** — 两者都引入一个发布前的中间物。区别：D37 当时已明确「不做自动状态校验（D34）；结算前不跑 validator」（`2026-11-13-chapter-atomic-save.md:42`），也没有决定校验物应该放在哪里；本行决定实现 D34，校验物必须存在于发布前。D37 还担心「结算不推进状态会与 D33 冲突」——扣下态只在失败时出现，D33 的目标判据 `max(索引, lastApplied, 快照)` 把扣下章算作 N，重算能把状态补到 N，不是发布流程的常态停点。发布点仍是结算工具，仍是一次 `commitFoundation`，不新增作者确认门。

## Testing

- `test/chapter-settle.test.mjs`（36 例）：结算与重算两阶段、提案只写 `.drafts`、形态组合拒绝、收据绑定五例（正文/基线/卡片+摘要/收据/缺失）、报告必填、预算与 attempt 1/2、不可用扣下、扣下态（发布/状态 N-1/`snapshots/<N>` 副本/索引观察/`summaryTitle` 空）、扣下出口（重开被拒、state_check 被拒、删除工具、带 versionId 恢复、修订→复审→重算、recover 扫描无 finding）、resettle 失败不写盘、kind 不符拒绝、基线跨文件不一致拒绝、expire 选择器、提交失败回滚。
- `test/state-check.test.mjs`（7 例）：严格基线缺/坏文件点名、未结算/缺快照拒绝、只读不写、报告必填、判据文本。
- `test/stage-context.test.mjs`：`chapter-done` 两阶段与校验方契约文本、扣下/遗留两态、重算块、阶段判定。
- `test/backup.test.mjs`、`test/panel-index.test.mjs`、`test/chapter-reopen.test.mjs`、`test/chapter-delete.test.mjs`：生命周期与既有链路回归。
- `test/host.test.mjs`：工具清单不变。
- `pnpm run verify` 全绿：470 tests（469 pass／1 skipped symlink）。`artifacts/real-runs/chapter.settle.json`、`state.check.json`、`runtime.stage-context.json` 已重录。

## Consequences

- **校验先于发布，发布仍是一次提交**：提交前作品不变；对账通过后章节、状态、快照、索引与 artifact 同批落盘。失败时章节照发但状态停在上一章，索引记录原因，作者用重算修复。
- **扣下是源行为，但复刻不能直接开下一章**：阶段判定停在 `chapter-done`，必须先修复（重算／修订复审后重算／删除本章）。与源的结构差异已登记偏差行。
- **`story_recover` 盲点（作者裁决接受）**：扣下态不产生 finding；扣下提交必须写 `snapshots/<N>` 才让它保持沉默。若实现漏写快照，recover 会给出与扣下修复矛盾的指引；测试固定「扣下态扫描无该 finding」。
- **提案是工作区普通文件**：摘要覆盖载荷（含 `attempt`），工具链内漂移一律拒绝；作者或外部脚本可改写文件并重算摘要，这不在模型可见工具面内。损坏的提案要求先删除 `.drafts/settlement-NNNN.json` 再重建，预算随之重置（外部干预）。
- **预算代价**：提案生成即占 `attempt: 1`，同键重新生成即升 `attempt: 2`，第三次被拒；增量写错也会消耗一次机会。重开保留正文时预算键不变，下一次重算可能只剩一次尝试。
- **信任边界**：宿主只能校验收据形态、摘要与必填报告，无法证明子代理读过提案与正文；与 D51 同类，记入审计。
- **成本**：每章多一次工具调用与一次 state-check 子代理派发；提交调用只带收据，避免重复传增量。协议文案变长，但阶段流程更可验证。
- **回执与兼容**：既有字段保留、新增状态字段；「调用即发布」的语义变化由工具描述、协议与测试同批承接。
- **残余**：修订事务内的自动重结算归 D59（修订后状态停在旧正文直到作者重算）；索引字段仍归 D35；重算后的复审仍归 D58。
