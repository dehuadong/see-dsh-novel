# Agent Note: chapter.revise —— 章节修订：五种模式与版本

Status: implemented

> 后续更新（2026-11-14）：D36／D58 已由 [chapter.reopen —— 重开与恢复的闭环](2026-11-14-chapter-reopen-closure.md) 注销；恢复写索引观察与复审 start，重开从第 N-1 章快照回退。本文以下描述保留当时交付范围。

## Problem

P3 已经能写首版、能审稿，但审稿发现问题后没有修订入口：`chapter.revise` 曾是 `missing`。作者对一版不满意时只有两条路——重开一次 workflow start 重写整章，或手工改文件；前者丢版本，后者绕开宿主。

源工程在章节写出来后提供 `revise_chapter`：按五种模式修订已落盘的章节，保留旧版本，修订后重新审稿。缺这一行，P3 出口不成立，也接不上 P4 的结算。

## 源工程证据

- `inkos/packages/core/src/pipeline/runner.ts:874-1164` `reviseDraft`：读章节与审稿观察（有显式指令时跳过观察）→ `ReviserAgent.reviseChapter` → `settleChapterState` 与 `StateValidator.validate` → 复审 `collectReviewObservations` → `archiveChapterVersion` → 写章节与 index，后代章节标 `upstream-revision`（`:1092-1118`）；`:1140-1160` 重写快照并返回。
- `inkos/packages/core/src/agents/reviser.ts:13-15`：`ReviseMode = polish | rewrite | rework | anti-detect | spot-fix`，默认 `rewrite`；`:167-178` 每种模式一句协议（polish 只改文字、rewrite 重写受影响段落、rework 可重构场景、anti-detect 只调文字、spot-fix 先选行范围再替换）。
- `inkos/packages/core/src/agents/reviser.ts:86-139`：spot-fix 用范围编辑契约，支持多段不重叠 range（`:96-105`、`text-range-edits.ts:40-59`），`CHAPTER_EDIT_SCOPE_CONFLICT` 拒绝超范围的替换；`targetText` 对任意 mode 都触发范围替换（`:77-78`）。
- `inkos/packages/core/src/harness/tools/longform-production.ts` 的 `revise_chapter`：参数 `chapterNumber`／`mode`／`instruction`／`targetText`；局部修订要求绑定 `targetText`，宿主保留周围正文；返回 `changedRegion`。
- `inkos/packages/core/src/state/chapter-workspace.ts:61-80` `archiveChapterVersion`：旧正文写到 `chapters/.versions/NNNN/<13 位时间戳>_revision_<uuid>.md`。
- `inkos/packages/studio/src/api/server.ts:5571-5599` 的 `POST /revise/:chapter` 与 `:5832-5870` 的 `POST /rewrite/:chapter`（`mode=rework`）：都是 `revise_chapter` 动作，绑 `recoverable-write`。

## Decision

### 工具：`story_revise_chapter`

`src/pipelines/long/revise-tool.ts`：

- 参数：`chapter`、`mode`（五种，默认 `rewrite`）、`content`（修订后的正文，不含标题行）、`targetText?`。
- 修订要求（源工具的 `instruction`）由主编交给 reviser 子代理，工具只做落盘与范围校验，不重复解释。
- 守卫：章节必须有正文与章纲；`content` 非空；标题沿用现有文档头，不接受改标题；不要求 workflow start（修订发生在 review／chapter-done，不是新一章）。
- **spot-fix 的范围保证**：`core/revise.ts` 用行级 diff 数改动块，出现第二段不连续改动时拒绝 `CHAPTER_EDIT_SCOPE_CONFLICT`；给了 `targetText` 时要求它在原文中唯一出现并完整覆盖改动区间，否则 `ARTIFACT_EDIT_TARGET_AMBIGUOUS`／`CHAPTER_EDIT_SCOPE_CONFLICT`。行数超过 diff 预算时只做 `targetText` 校验。源支持多段不重叠 range，当前单段限制记 D53。
- 其他四种模式不做范围限制；源 `targetText` 对任意 mode 生效，复刻只在 spot-fix 校验，记 D53。
- 返回 `{ chapter, path, mode, changed, charCount, target, revisionId, reviewInvalidated }`；`changed=false` 时不写文件、不作废审稿。

### 持久化：新 revision + 旧版本归档

- `core/chapter-document.ts` 的 `reviseChapterDocument`：按章号前缀找现有文件与标题，读旧正文，写新正文到同一路径。
- 同一次 `commitFoundation` 写三样：章节文件、`source/chapters/.versions/NNNN/<时间戳>_revision_<uuid>.md`（旧正文）、artifact manifest 的新 revision（`r2`、`r3`…，`parentRevisionId` 指向旧 current，旧 revision 标 `superseded`）。
- `core/artifact-store.ts` 抽出 `nextRevisionId`，`chapterArtifactWrite` 不再固定写 `r1`。

### 复审：旧审稿作废，阶段回到 review

- 修订成功后删除 `source/story/runtime/chapter-XXXX.review.json`，返回 `reviewInvalidated: true`。审稿要过 workflow start 闸门，所以同一次提交里写或替换本章的 workflow start（`instruction: 修订后重审第 N 章`；同章沿用，指向其它章时替换并返回 `replacedStartChapter`），`detectStage` 因此回到 `review`。
- 源在修订事务里自动复审（`collectReviewObservations`）；DSH 的审稿观察由模型产出、经 `story_review_chapter` 校验落盘，工具内不能跑模型。这是机制偏差：修订后必须重新调用审稿工具，阶段闸门保证这一步不会跳过。已登记 `docs/dsh-mapping.md`。

### 状态结算延后

- 源修订后重结算 `current_state` 与伏笔并做状态校验。本行只改章节与产物版本；修订后必须重新审稿，再由作者/协议调 `story_settle_chapter` 重结算。自动重结算未复刻（D59），重结算按增量、基线快照缺口见 D33。

### 阶段与面板

- `chapter-done` 阶段协议：先问清要改哪里与模式，派 reviser 子代理，调 `story_revise_chapter`，修订后必须重新审稿。
- `review` 阶段协议：审稿不通过可转修订，修订后必须重新审稿。
- `craftSkillsFor('chapter-done')` 注入 `story-review`；源 reviser 的 workerSkills 也是 review 技能，不新增技能。
- **索引根动作**：`chapter-done` 时没有「当前阶段」节点，`PanelStage.action` 挂不上；索引根加 `action`（只在没有当前阶段时给出，v1 就是「修订本章」），动作条渲染 `current?.action ?? index.action`。索引版本升到 `4`。
- 面板点击「修订本章」走 `advance`：提示「作者在工作台点了修订本章；先确认要改哪里与模式，再派 reviser 并调用 `story_revise_chapter`；修订后必须重新审稿」。会话运行时按钮与其他动作一样禁用。

### 行与债务

- `capabilities.yaml` 的 `chapter.revise` 从 missing 到实现；implementation 指向 `src/pipelines/long/revise-tool.ts`，consumer 指向 `test/chapter-revise.test.mjs`，realRun 指向 `artifacts/real-runs/chapter.revise.json`；索引版本 4 与 `panel.workbench` 的面板动作同批更新。
- `docs/fidelity-audit.md` 的 `chapter.revise` 段改为机制等价（重审闸门）+ D42／D45／D53；`docs/scope.md` P3 债务同步；`docs/dsh-mapping.md` 保留「不自动复审」偏差。
- revision 缺不可变快照（D42）；修订不更新索引 `wordCount`/`observations`/`provenance`、后代无 `upstream-revision` 标记（D45）。
- 单段范围限制与 `targetText` 只在 spot-fix 生效是 D53；多段范围与任意 mode 的 `targetText` 由 [chapter.revise 多段局部修订](2026-11-11-chapter-revise-multirange.md) 承接并已注销 D53。

## Alternatives considered

- **做成 `/story-revise` 命令。** 否掉：源是 tool，作者动作在对话里；命令只会多一套参数解析，且面板动作本就走 `advance` 提示。
- **修订后保留旧审稿并标 stale。** 否掉：审稿是单记录，保留会让「同章只审一次」挡住重审；删除即作废，符合源「修订后重新审」。
- **修订内自动复审。** 否掉：审稿观察由模型产出并经证据校验，工具内不能跑模型；用阶段闸门替代，行为等价可观察。
- **修订时顺带结算状态。** 否掉：P4 未交付，提前做会把结算规则塞进 P3；登记 D32 而不是自创一套半成品结算。
- **只做整章重写，不做 spot-fix。** 否掉：局部修订是源的核心模式；targetText + 单段替换校验能在宿主侧保证周围正文不动。
- **修订也写一份新文件（`0001_Title.r2.md`）。** 否掉：章节 artifact 的 path 指向章节文件，源也是覆盖同一路径、旧正文进 `.versions`。
- **照搬范围编辑契约（选行 + 逐段替换）。** 否掉：DSH 的修订正文由子代理整段返回，宿主用行级 diff 校验单段替换即可得到同样的可观察保证，少一套 schema。
- **把审阅阶段标成 current，让修订动作挂在现有节点上。** 否掉：chapter-done 时没有任何阶段在进行，把审阅标成 current 会让「当前阶段」谎报；索引根动作只在没有当前阶段时出现，语义清楚。

## Testing

- `test/chapter-revise.test.mjs`：`singleEdit`／`changeHunks`／`assertSpotFix` 的单段与多段判定、`targetText` 唯一与覆盖范围；`reviseChapterDocument` 覆盖章节文件、归档旧正文、manifest `r2`（parent `r1`，旧 revision superseded）；工具作废审稿并重开 workflow start（`changed=false` 不写、不作废、不重开）；缺正文/缺章纲/空正文/未知模式拒绝；spot-fix 多段改动被拒绝且文件不变、单段修订落盘；归档目录不在章节列表里。
- `test/panel-index.test.mjs`：索引版本 4；`chapter-done` 的根动作 `revise-chapter`，提案与 foundation-ready 无根动作。
- `test/workbench.test.mjs`：没有当前阶段时动作条显示根动作并可派发。
- `test/client.test.mjs`：根「修订本章」走 `advance`，提示里带 `story_revise_chapter` 与「重新审稿」。
- `test/stage-context.test.mjs`：`chapter-done` 协议含 `story_revise_chapter` 且注入 `story-review`；`review` 协议写明修订后重审。
- `test/host.test.mjs`：工具清单包含 `story_revise_chapter`。
- 真实回执：`artifacts/real-runs/chapter.revise.json` 记录 process-level 证据；作者裁定不做桌面回执，该回执即交付证据。

## Consequences

- 修订会作废旧审稿并重开本章（写一条 workflow start），作者必须重审（与源一致）；面板在修订后回到 review 阶段，不再显示「本章完成」。
- 旧正文归档在 `source/chapters/.versions`（不进 artifact digest；`source/chapters` 不在 digest 内），只用于回看。
- 修订不自动重结算：修订后重新审稿，再调 `story_settle_chapter`；重结算按增量应用，旧 delta 不再适用的 facts 可能残留（D33）。
- 单段替换校验用行级 diff，两个相同段落同时出现时依赖 `targetText` 的唯一性检查；没有 targetText 时退化为单段判断。
- 章节 artifact 的旧 revision 与章节文件同路径，内容被覆盖后旧 revision 的 checksum 不再匹配文件；源为每个 revision 写不可变 `snapshotPath`（`source-sync.ts:111`、`artifact-reader.ts:27,35`），复刻不写、旧 revision 读不到，记 D42。
- 索引版本 4：客户端读到旧索引（没有根 `action`）时按 `null` 处理，宿主补建后动作出现；`normalizeIndex` 补默认值，不崩。
