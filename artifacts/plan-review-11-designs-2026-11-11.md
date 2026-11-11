# 追溯 Plan Review：11 份已实现设计

- 日期：2026-11-11
- 范围：交接文档列出的 11 个规划轮对应 10 份设计 Note（`panel.workbench` 与 `panel.workbench-artifacts` 共用一份 Note，合并评审）
- 方式：每份 Note 一个独立子代理，只读评审；按 `.agents/skills/planning/review.md` 的 Standards / Spec / Architecture 三条线
- 性质：**评审记录，不是状态表**。不改变 `capabilities.yaml` 状态，不构成批准或实施授权

## 一、总体结论

10 份设计**全部需要修订**，没有一份可通过。5 份含 blocker：`skill.references`、`chapter.summary`、`chapter.move-delete`、`chapter.revise`、`chapter.settle`；`chapter.finalize` 另有 2 条高严重度阻断项。

| 设计 | 结论 | blocker | 最重的问题 |
|---|---|---|---|
| panel.workbench（两轮） | 需修订 | 无 | 索引版本自相矛盾；第二轮动作未进合同；白名单与只读行为未登记 |
| chapter.revise | 需修订 | 1 | 自创单段范围限制；artifact revision 无 snapshotPath |
| skill.references | 需修订 | 1 | query 未复刻但 D23 记已偿还 |
| chapter.summary | 需修订 | 2 | 账本 source 指错文件；独立工具与替换语义未登记 |
| chapter.settle | 需修订 | 1 | D33 前提错误；强制 last+1 |
| chapter.finalize | 需修订 | 2 高 | D37 谎称已登记偏差；索引全量重建改变源行为 |
| chapter.reopen | 需修订 | 无 | 「退回重写」实际会落到审旧稿 |
| chapter.move-delete | 需修订 | 1 | 删除前置比源更严；最新章判据改变 |
| state.check | 需修订 | 无 | 账本 source 指错模块；宣称的测试断言不存在 |
| export.work | 需修订 | 无 | EPUB 标题/语言偏离源；原子替换未登记 |

## 二、横切问题

1. **证据链错位**：`capabilities.yaml` 至少两行 `source` 指向错误模块（`chapter.summary` → `pipeline/chapter-persistence.ts`，实际无摘要逻辑；`state.check` → `state/state-validator.ts`，实际语义校验在 `agents/state-validator.ts`）。审计与 Note 又各自引用不同文件，三处互不一致。
2. **「等价」判定失真**：`chapter.summary`、`chapter.move-delete`、`export.work`、`chapter.finalize`、`chapter.revise` 都把改变源行为判成等价；`chapter.finalize` 还把拆分流程写成 deviation（按 `AGENTS.md` 应记保真债）。
3. **未登记的自创限制**：`chapter.revise` 单段范围、`chapter.settle` 强制 last+1、`chapter.move-delete` 七份快照、`chapter.reopen` 只允许最后一章、面板白名单与全只读、`skill.references` 放宽路径/大小校验。
4. **过期或虚假的验收证据**：`chapter.revise.json` 与 `chapter.summary.json` 仍写「P4 未交付」；`state.check` Note 声称的 `stage-context.test.mjs` 断言不存在；`skill.references` 测试未覆盖 skill 输出与子代理；多数 realRun 是 process-level。
5. **源行号普遍错/越界**：至少 6 份 Note 存在行号错误或引用超出文件长度，说明「源工程证据」段没有被逐条核过。
6. **债务前提与偿还错位**：D33 的「无逐章快照」与实现矛盾（`finalize` 已写 `snapshots/0..N`）；D32 的偿还回执仍是旧的；D34 的偿还位置没有归属能力行。

## 三、逐份评审

### 1. panel.workbench / panel.workbench-artifacts

Note：`.agents/notes/implemented/architecture/2026-11-10-panel-workbench-dialogue-first.md`

**结论：需修订（无 blocker）。**

| # | 严重度 | 线 | 归属 | 事实与证据 | 为什么必须改 |
|---|---|---|---|---|---|
| F1 | major | Spec | Note | 索引版本自相矛盾：Note:30「格式版本 2」、Note:67/151「3」、Note:112「4」；实现 `PANEL_INDEX_VERSION=4`（`panel-index.ts:201`），测试断言 4（`panel-index.test.mjs:46`）。Note:30 字段清单缺根级 `action`（`panel-types.ts:49`）。 | 格式契约与数据形状无法据 Note 实现或验收，两轮结论不一致。 |
| F2 | major | Spec | Note | 第二轮新增的 `chapter-done` 根动作未进合同：Note:87 写「无（等 P4 结算）」、Note:50 只「本章完成」、Note:92 索引形状不含根 action；实现 `panel-index.ts:268-271`、`StoryView.tsx:285`，测试 `workbench.test.mjs:176`、`client.test.mjs:505`。 | 动作表与实现冲突，且该动作无验收条目＝设计缺验收。 |
| F3 | major | Standards | Note / mapping | 白名单多出源没有的条目且未登记：`book_rules.json`（`story-paths.ts:35`）、`source/brief.md`（:23）、`source/story/brief.md`（:20）、诊断 `.planner-context.json`；源白名单 `server.ts:3228-3237,3239` 均无。Note:54 却以源白名单为据，Note:58 表将其列入；`dsh-mapping.md:58-59` 只登记「另加章节正文」。 | 违反「未登记偏差即越界」；白名单的合法性来源被自证改写。 |
| F4 | major | Standards | Note / audit | 源真值浏览器可编辑（`TruthFiles.tsx:54-79,130-167` 的 Edit/Save，`server.ts:5761` PUT），复刻所有产物 `readonly: true`（`src/panel-types.ts:33`）且无编辑；Note:14 源证据只写「只读原因」，范围/非目标/偏差均未处理，`audit:508` 仍判机制等价。 | 丢失源作者写能力却记为等价，既无偏差行也无债号。 |
| F5 | major | Spec | audit | 不变量 7 验证位置不成立：`audit:17/19` 称 `panel.confirm` 与 `panel.workbench`「读同一份索引证据」，但 `panel.confirm`（`write-command.ts`）不读索引，确认状态来自 `detectStage`（`panel-index.ts:238,258-266`）与 approval；验证只写「panel.*／StoryView」，无断言。 | P6 出口依赖不变量 7，验证位置为空等于出口条件未成立。 |

**已核对成立**：① 源行号与行为准确（`BookDetail.tsx:110-118` write-next；`TruthFiles.tsx:168` `<pre>`；`server.ts:3228-3240`、`4175-4182`、`4189-4203`）；② 宿主投影与只读一致（写 action 后重建、`session/created` 补建，`panel-projection.ts:61-98`），面板不调 `/story-index`；③ 索引不污染产物（`artifacts.ts:56` 排除 `panel.index.json`）。

**未能核实**：两轮工作项无留存文件（`proposed/` 为空，旧 Note 已删），各轮范围/非目标/验收只能从 Note 推断；D31 关闭在 `scope.md:37`、`audit:510` 有记录，但裁定本身不在仓库。另：`scope.md:37`「D30 `panel.workbench` 已交付」与 `artifacts/real-runs/panel.confirm.json:14`「D30 记录面板动态章节限制」对 D30 定义不一致。

### 2. chapter.revise

Note：`.agents/notes/implemented/architecture/2026-11-10-chapter-revise.md`

**结论：需修订（1 blocker）。**

| # | 严重度 | 线 | 归属 | 事实与证据 | 为什么必须改 |
|---|---|---|---|---|---|
| F1 | blocker | Standards | Note + 实现 | 源 spot-fix 支持多段不重叠 range（`reviser.ts:96-105`；`text-range-edits.ts:40-59`），且 `targetText` 对任意 mode 都触发范围替换（`reviser.ts:77-78`；`runner.ts:985`）；Note:29-30 拒绝第二段、称其他四模式不设范围限制，实现只在 spot-fix 校验（`revise-tool.ts:100`）。 | 自创单段限制，丢失源的多段局部修订与 `targetText` 绑定。 |
| F2 | 高 | Architecture | Note | 源为每个 revision 写不可变 `snapshotPath`，读取时按 snapshot 校验（`source-sync.ts:111`；`artifact-reader.ts:27,35`）；Note:88 称旧 revision 失配「与源一致」，但本仓 `chapterArtifactWrite` 不写 `snapshotPath`，`readArtifactRevision` 只用 path（`artifact-store.ts:138-171,241-251`），修订后 r1 checksum 悬空、旧 revision 不可读。 | 应写快照或登记保真债，不能称等价。 |
| F3 | 高 | Spec / audit | Note + audit | Note:46/58/80 与 `audit:408` 称 D32 已由 P4 偿还，但所引回执仍写「P4 `chapter.settle` 未交付；保真债 D32」（`chapter.revise.json:16`）；映射行只验证重审（`dsh-mapping.md:68`）；settle 闸门只拒绝无审稿（`settle-tool.ts:174`），并不触发结算。自动重结算未复刻，且非「工具内不能跑模型」可解释。 | 「机制等价（D32 已偿还）」缺当前证据。 |
| F4 | 中 | Standards | Note + audit | `reviser.ts:167-190` 超出文件 178 行（协议实为 167-178）；`reviser.ts:110-160` 实际 spot-fix 为 86-139；`runner.ts:874-1120` 的 `reviseDraft` 实至 1164（漏 1140-1160 的重快照与返回）。 | 行号错，证据不可复核。 |
| F5 | 中 | Architecture / Spec | Note | 源同事务更新 `chapters/index.json`（`wordCount`/`observations`/`provenance=edited`）并给后代标 `upstream-revision`（`runner.ts:1092-1118`）；Note:13 引用却在 Decision 省略；本仓 index 仅 finalize 重建、`provenance` 保持 `generated`（`chapter-index.ts:91-108`），`edited` 无写入者；工具也不限「当前章」（`revise-tool.ts:93-100`）。 | 旧章修订会静默丢后代标记，缺范围/非目标。 |

**已核对成立**：① 五模式、默认 rewrite、spot-fix 的 `targetText` 唯一/覆盖与源一致（`reviser.ts:13-15,96,114`；本仓 `revise.ts:109-130`）；② 归档 `.versions/NNNN/<13 位时间戳>_revision_<uuid>.md` 的路径、来源、可列读按源；③ 作废审稿→回 review 的闸门成立；r2/parent r1/superseded 与 `reviewedArtifact` 取 current 且字节匹配。

**未能核实**：未运行 verify/真实会话；回执中的 347 passed 未独立验证。

### 3. skill.references

Note：`.agents/notes/implemented/architecture/2026-11-10-skill-references.md`

**结论：需修订（1 blocker）。**

| # | 严重度 | 线 | 归属 | 事实与证据 | 为什么必须改 |
|---|---|---|---|---|---|
| F1 | blocker | Standards / Spec | Note + audit | `query` 未复刻（Note:60 自认）；`audit:356` 明定 D23＝缺 `use_skill.query`，但 `audit:71`、`scope.md:27`、`dsh-mapping.md:76` 称已偿还；`capabilities.yaml:28` 标题仍称 query 检索/非整份注入，实际 `stages/index.ts:175-191` 整份注入。DSH 无检索 API（`skill/src/index.ts:470-517`），但项目可注册工具（`agent.ts:99-139`）、检索不需模型，非机制强制，亦无裁决。 | 登记偏差不等于偿还；P0 出口（`scope.md:22,27`）依赖此债，审计/账本失真。 |
| F2 | 高 | Spec | Note | 源校验越界、符号链接、非文件、512KB、UTF-8，并自动载入 `SKILL.md` 的 references 链接（`skill-tool.ts:82-91,100-101,248-261`）；复刻未写失败行为，无偏差行。 | 放宽校验属保真债；边界/失败行为须可验收。 |
| F3 | 高 | Spec | Note | 唯一测试只断言注册字段与源检出目录 stat/readFile（`skill-references.test.mjs:26-63`），未覆盖 skill 输出或子代理；回执 `skill.references.json:15` 自认非会话；Note:29 的 `packages/…` 在工作区内，证不了安装包根可读。 | 验收无承接，生产可读性未证。 |
| F4 | 低 | Standards | Note | `SkillRegistration` 实为 `skill/src/index.ts:94-100`（110-120 是 `SkillViewOptions`）；`renderSkillContent` 170-183。 | 行号错，证据不可核。 |

**已核对成立**：① `renderSkillContent` 确渲染绝对基址（`skill/src/index.ts:170-198`），`tool-skill` 输出含 `resourceBase`（152-159）；② DSH 技能服务仅 `list/get/snapshot`，确无检索/资源读取入口；③ `resourceBase` 注册与 `mapping:17`「技能」行一致（`skills.ts:151-160`）。

**未能核实**：真实安装会话中子代理经 skill 输出读包根。

### 4. chapter.summary

Note：`.agents/notes/implemented/architecture/2026-11-10-chapter-summary.md`

**结论：需修订（2 blocker）。**

| # | 严重度 | 线 | 归属 | 事实与证据 | 为什么必须改 |
|---|---|---|---|---|---|
| F1 | blocker / 高 | Standards | capabilities.yaml:301 | `chapter.summary.source` 指 `pipeline/chapter-persistence.ts`；该文件只建章节索引并调 `saveChapter`/`markActive`（:11-43），无摘要 schema、排序、替换。真实证据：`settler-tool.ts:21-29,62`、`runtime-state.ts:39-56`、`state-reducer.ts:195-211`。 | `source` 是账本唯一源证据位；指向无关文件即证据错位，且与 `audit:414` 自相矛盾。 |
| F2 | blocker / 高 | Spec | Note + audit | `audit:418` 判「等价」，Note 却称已改「机制等价（拆分登记）」；`dsh-mapping.md` 无该行。源无独立摘要工具：摘要只在结算 schema（`settler-tool.ts:21-29,62`），随 `saveChapter` 同批写（`writer.ts:364-437`）；复刻新增 `story_summarize_chapter`，可先于结算单独落盘（`chapter-summary.ts:93-111`；`stages/index.ts:154`），Note:68 自认时序差异。源仅 `allowReapply` 时替换/拒绝重复（`state-reducer.ts:45-51,195-211`），复刻无条件替换（`chapter-summary.ts:102-103`）。 | 自创入口 + 时序/替换条件差异未登记，「等价」不成立；结构差异必须写偏差行或债。 |
| F3 | 中 | Standards | Note | 仍引 `runner.ts:1438-1450`（1442-1450 为通知）；摘要实际写盘在 `writer.saveChapter`（:390,404-407,424-426,433,437）；`audit:414` 已改为 `writer.ts:214-260` + `runner.ts:999-1123`。 | 历史修正未同步，证据不可复核。 |

**已核对成立**：① 七字段逐字一致；② 排序与同章过滤符合 reducer；③ 前置正文+审稿、坏 JSON 拒绝覆盖均已实现并有测试。

**未能核实**：只读未跑 verify；`real-run:14` 仍写「结算未交付」，与 `chapter.settle` 已 verified 冲突，需同批重录。

### 5. chapter.settle

Note：`.agents/notes/implemented/architecture/2026-11-10-chapter-settle.md`

**结论：需修订（1 blocker）。**

| # | 严重度 | 线 | 归属 | 事实与证据 | 为什么必须改 |
|---|---|---|---|---|---|
| F1 | 高 / blocker | Spec | Note | Note 称「无逐章结算前快照、本项目尚未交付、偿还＝章节快照能力」；实际 `finalize.ts:50-62`、`tools.ts:209` 已写 `snapshots/0..N`（四 JSON+三投影），`state-check-tool.ts:91-93` 读 N-1 作基线，`scope.md:130` 同；源 `writer.ts:429-438` 逐章写快照，`runner.ts:1120-1137` 旧章的活状态重结算本不回写。 | 债前提与偿还错（快照已交付；旧章活状态重结算非源能力），会误导后续范围。 |
| F2 | 中 | Spec | Note | 实现强制 `last+1`（`settle.ts:240-242`；`chapter-settle.test.mjs:223-230`），源仅拒倒退（`state-reducer.ts:37-39`）；同章自动开 `allowReapply`（`settle-tool.ts:182`），Note 写成调用方条件。 | 自创跳章边界与重结算入口未登记，与源 reducer 不符。 |
| F3 | 低 | Spec | Note | 称「状态文件存在且可解析、不覆盖坏状态」；`inspectState` 把缺失当默认（`state.ts:228-260`），`settle-tool.ts:177-180` 只拒 invalid，缺文件按默认继续（第 1 章可写）；测试仅覆盖坏 JSON。 | 缺状态失败行为与 Note/源不一致。 |
| F4 | 低 | Standards | Note + audit | `settler-tool.ts` 止于 73（引 45-82）、`settler-prompts.ts` 止于 41（引 5-45）；`state-reducer.ts` hooks 75／facts 144（引 82-199）。行为描述本身成立。 | 引用越界/偏移，无法复核。 |

**已核对成立**：① 六动作与源一致；② facts expire＝章-1、同 key 失效、排序；摘要七字段同批；finalize 快照/索引与 state.check 只读边界一致；③ 两指针写侧同步，分读已登记 `dsh-mapping.md:81-82`；D34 属可实现未接，非机制强制。

### 6. chapter.finalize

Note：`.agents/notes/implemented/architecture/2026-11-10-chapter-finalize.md`

**结论：需修订（2 高，阻断）。**

| # | 严重度 | 线 | 归属 | 事实与证据 | 为什么必须改 |
|---|---|---|---|---|---|
| F1 | 高 | Standards | Note | Note:50,78 把拆分流程写成「偏差」并称已登记 `docs/dsh-mapping.md`，该文件实际无该行；`scope.md:134`、`fidelity-audit.md:434` 已定为保真债；`AGENTS.md` 明确拆分＝债。Note:50「验证…字段与源一致」又与 D35 矛盾；D35/D37 只列后果、无偿还路径。 | 把 D37 合法化并谎报登记；应改记为债、引 `scope.md:134`，删除虚构登记。 |
| F2 | 高 | Spec / Arch | Note | Decision 写「读全部章节文件重建数组」；Alternatives 却否掉「重建全部索引」、称选择「只更新本章行并保留其它行」。实现 `buildChapterIndex` 重建所有行并把各章 `updatedAt` 置 now（`chapter-index.ts:91-108`），源只替换本章 entry、其它行原样（`chapter-persistence.ts:23-40`）。校验亦弱：源严格 `ChapterMetaSchema.parse`（`manager.ts:456,487`），索引缺失而章文件存在时拒绝（459-461）；复刻缺索引返回 `[]` 重建、只查 number/title（`chapter-index.ts:66,76-82`），坏 schema 项被静默归一化。 | 定稿第 2 章会改写第 1 章 `updatedAt`/`observations`；Note 否掉的方案正是所选方案。 |
| F3 | 中 | Spec | Note | `runner.ts:1424-1434` 实为 truth-validation 观察合并；`markBookActiveIfNeeded` 定义在 2106-2115、调用在 1439；源每次章节保存后调用，条件仅 `status==="outlining"`（`chapter-persistence.ts:41`），不是「第一章完成后」。 | 行号与条件描述错，无法核实 `work.status` 行为；应写明复刻 `draft`≡源 `outlining`、不按章号门控。 |
| F4 | 中 | Arch | Note | 快照消费者漏写：`delete-chapter.ts:58-65` 用上一章快照恢复状态与投影；`state-check-tool.ts:91-93` 要求上一章快照。Note 仅提 `state.check`/基线重结算，未写删除依赖与「缺快照」失败面，也不要求前章已定稿。 | 第 1 章未定稿时定稿第 2 章仍会把 work 置 active，删除/对账随即因缺快照失败。 |

**已核对成立**：① `writer.ts:392-450` 单次 commit 写章节+三投影+四状态+七快照+索引、标题变化删 superseded；② 幂等保留 `createdAt` 与源一致；标题变化在工具链不可达；③ 快照七文件、`draft→active`、已 active 不改 `updatedAt`。

### 7. chapter.reopen

Note：`.agents/notes/implemented/architecture/2026-11-10-chapter-reopen.md`

**结论：需修订（无 blocker；核心路径未承接）。**

| # | 严重度 | 线 | 归属 | 事实与证据 | 为什么必须改 |
|---|---|---|---|---|---|
| F1 | 高 | Spec / Arch | Note + 协议 | 重开留正文、删 review+plan；重规划后 `detectStage` 判 review（`stages/index.ts:64-73`），write 拒覆盖已有正文（`chapter-document.ts:95-97`；`stages:143-144`）；Note:50「再写」与 `test/chapter-reopen.test.mjs:126` 仅测 `stage=plan`。 | 「退回重写」会落到审旧稿；须明确改稿走 revise 并补阶段协议与验收。 |
| F2 | 中高 | Standards | Note | 源 `chapter-replace` 对任意章可用且不动运行时状态（`edit-controller.ts:335-378`；`server.ts:3147-3178` 无 latest 限制）；DSH 以 `lastAppliedChapter===chapter` 拒绝（`reopen.ts:48-50`）。 | 源没有的限制；恢复旧版不需基线，应与「重开回退」解耦。 |
| F3 | 中 | Standards | Note | Note:34 称 DSH 的 plan 是 `chapter-NNNN.intent.md`；实际 plan 是 `plan.json`（`chapter-plan.ts:24-26`），`intent.md` 只是投影（:28-30）。reopen 只删 review+`plan.json`（`reopen.ts:54`），残留 intent/planner-context/context/trace；源清全部 `chapter-NNNN.*` 仅留 user-brief（`edit-controller.ts:288-291`）。 | 落点描述错误；旧 planner-context 可被重规划复用（`plan-tool.ts:119-121`）。 |
| F4 | 中 | Arch | Note + mapping | 偏差行只记指针回退+facts/hooks（`dsh-mapping.md:81`），未记删摘要行（`reopen.ts:85`；`settle.ts:60-74` 的 `applySummary` 本可 upsert）；同页称源用 `requiresTruthRebuild`，但该字段/`planEditTransaction` 在源仓库无调用者（`edit-controller.ts:82-137,429-439`）。 | 「机制等价+D36」未覆盖源没有的可观察状态删除，等价依据不完整。 |
| F5 | 低 | Standards | Note | 版本列表在 `server.ts:3026-3051`（3034-3037 的 GET …/workspace 返回 versions），不在 Note:14 所引 3132-3175（该段仅读取 3132-3145 与 restore 3147-3178）。 | 证据行号错。 |

**已核对成立**：源 13 位 id+5 来源、清运行时留 user-brief、先归档后替换并记索引观察；D36 已正确归债；两指针双写一致；阶段判定依赖 `current_state.chapter`。

### 8. chapter.move-delete

Note：`.agents/notes/implemented/architecture/2026-11-10-chapter-move-delete.md`

**结论：需修订（1 blocker）。**

| # | 严重度 | 线 | 归属 | 事实与证据 | 为什么必须改 |
|---|---|---|---|---|---|
| F1 | 高 / blocker | Standards | Note + audit | 要求上一章快照七份齐全且 `manifest.lastAppliedChapter` 匹配；源只 stat `current_state.md`、`pending_hooks.md`（`chapter-delete.ts:60-71`），回滚允许 `chapter_summaries.md` 缺失（`manager.ts:564-592`）；Note:13、`audit:448` 自己都只写两份。 | 自创更严门槛；源能删的快照这里被拒。按源放宽，或登记偏差并撤回「等价」。 |
| F2 | 高 | Standards | Note | 按章节文件定最新章、索引缺失时重建；源以 `loadChapterIndex` 为准，索引缺失而章节文件在时直接报错（`manager.ts:450-463`；`chapter-delete.ts:41-47`）。 | 放宽校验且改变最新章判据与 discarded 集合；`audit:452` 判等价不成立。 |
| F3 | 中 | Spec | Note | 「面板不加动作，删除走对话」；源 Studio 有删除按钮与确认（`ChapterWorkspacePanel.tsx:132-163`、`use-i18n.ts:70-71`），`dsh-mapping.md` 无偏差行。 | 自创 UI 限制、缺消费者；补动作或登记债。 |
| F4 | 中 | Spec | scope.md:74 | P5 用户可见面仍写「章节重开/移动/删除」，与 Note:9、`scope.md:77` 及 `capabilities:332` 冲突。 | 规划集仍承诺源没有的移章。 |
| F5 | 低 | Standards | Note | 引 `manager.ts:612-690`，文件止于 685 行；`rollbackToChapter` 实为 612-675。 | 行号越界。 |

**已核对成立**：① 源只删最新章并拒绝中间章；`-2` 重名后缀是源行为；② 源确实从上一章快照恢复状态与投影，并删更晚章的章节/快照/runtime/drafts 与 `memory.db*`；③ 删前校验、失败搬回 trash、`AggregateError` 与源一致。

**未能核实**：「D33 部分偿还」在本 Note/audit/scope 无据；`audit:452` 只说 D33 不影响删除，`scope` 的 D33 偿还位置仍是 `state.check`／后续阶段。

### 9. state.check

Note：`.agents/notes/implemented/architecture/2026-11-10-state-check.md`

**结论：需修订（无 blocker）。**

| # | 严重度 | 线 | 归属 | 事实与证据 | 为什么必须改 |
|---|---|---|---|---|---|
| F1 | 中 | Standards | capabilities.yaml:341 | `source` 指向 `state/state-validator.ts`（静态 `validateRuntimeState`），非 Note:13 与 `audit:456` 的 `agents/state-validator.ts`（语义 `validate`）。 | 账本 source 是保真证据链，指错模块会把后续工作引向静态校验。 |
| F2 | 中 | Spec | Note | 称 `test/stage-context.test.mjs` 断言 chapter-done 协议含 `story_state_check`；该文件 118-126 与全仓测试均无此断言。 | 验收证据不存在；协议第 8 步无回归保护。 |
| F3 | 中 | Spec | scope.md:131、Note:46 | D34 偿还只写「后续把校验接进结算流程」，不指向任何 capability/工作项。 | 债不可执行。 |
| F4 | 中 | Spec | Note / 协议 | 源 `state-validator.ts:47` 判据（仅换投影可消解才置 true；正文/权威间矛盾只作观察、不授权重结算）未进 Note 与协议，仅剩参数描述。 | 布尔语义被放宽，`state-reconciliation`/`state-projection-review` 选码失依据；D34 未覆盖。 |

**已核对成立**：① 源 :38-40/:82/:89、`chapter-truth-validation.ts:80-103` 与 Note:13/15 吻合，未谎称复刻自动校验；② 「结算路径不校验」已登记 D34，未误判 deviation；③ 报告必填与只读不写源自源与测试。

### 10. export.work

Note：`.agents/notes/implemented/architecture/2026-11-10-export-work.md`

**结论：需修订（无 blocker）。**

| # | 严重度 | 线 | 归属 | 事实与证据 | 为什么必须改 |
|---|---|---|---|---|---|
| F1 | 高 | Standards | Note:34；audit:478 | 源 EPUB 章标题取渲染 `#` 标题（`export-artifact.ts:115-128`，含「第N章」），语言交给打包器（:131）；复刻取裸索引 title（`export.ts:217`；nav :168），章 XHTML `xml:lang` 固定 `zh-CN`（:115）、nav 标题固定「目录」（:178），无视 `work.language`。 | en 作品 EPUB 语言/目录/标题偏离源；审计「等价」低估。 |
| F2 | 中 | Standards | Note:26/51；audit:478 | 源直接 `writeFile`（`export-artifact.ts:174-176`）；复刻 temp+rename（`export.ts:242-250`）。Note:51 称「无新的机制偏差」，`audit:478` 承认「行为更强」仍判等价。 | 偏差仅限 DSH 强制或不可观测；「更强」不合法，改变失败半写语义；须回退直写或登记裁决。 |
| F3 | 低 | Standards | Note:11-12 | `ChapterExportSourceError` 实为 27-38、`buildChapterFileLookup` 40-69，均不在所引 :12-36；「默认 txt」在 :98 不在 :100-160。 | 行号错，审计链失真。 |

**已核对成立**：① 源 `export-save` 写 `bookDir/<id>.<fmt>` 且只写文件，工作区根≡bookDir，落点等价；② 命令/面板同一实现，不经 agent，合不变量 7；③ 根上导出不在 `source/` 产物与备份拥有项内，合 D38。

**未能核实**：无 `epub-gen-memory` 安装，无法逐字节比对源 EPUB；阅读器兼容仅有 ZIP 结构断言。

## 四、处置建议

### A. 纯文档修正（不需 implement 授权）

1. **账本 `source`**：`chapter.summary`、`state.check` 两行改指真实模块；同时复核 `realRun` 描述是否仍描述新行为。
2. **Note 回写**：
   - `chapter.finalize`：把 D37 从「偏差」改回保真债，删虚构的 mapping 登记，补偿还路径。
   - `chapter.settle`：重写 D33 段（快照已交付；旧章活状态重结算不是源能力），把 last+1 与 `allowReapply` 写成实际行为与债。
   - `chapter.summary`：把「等价」改为实际判定，补结构差异与替换语义；修正行号。
   - `chapter.move-delete`：删除前置校验改回源的两份快照；最新章判据写明；面板删除动作补设计或登记债；`scope` 的 P5 删「移动」。
   - `chapter.reopen`：补「退回重写」路径（改稿走 revise）与清运行时集合；解除恢复旧版的 `lastAppliedChapter` 限制或登记债。
   - `chapter.revise`：删单段限制；补 `snapshotPath` 与索引后续标记的债/实现决策；更新 D32 回执。
   - `panel.workbench`：统一索引版本；补第二轮 `chapter-done` 动作与验收；白名单 4 项与全只读登记为偏差或债；补不变量 7 的断言位置。
   - `skill.references`：撤回 D23「已偿还」；写明 query 的真实状态与偿还路径；补失败边界。
   - `export.work`：EPUB 标题/语言与原子替换按裁决改判。
   - `state.check`：补测试断言或删不实声明；D34 指到能力行；补源布尔判据。
3. **审计**：同步上述判定（等价/机制等价/保真债）与债号。
4. **范围**：新增债（建议 D39 起，编号在 `scope.md` 统一分配）：面板真值文件不可编辑、面板无删除章动作、artifact revision 无 snapshotPath、reopen 残留运行时文件、章节索引无 `provenance/wordCount/upstream`、settle 缺文件按默认继续、EPUB 语言/标题、索引全量重建改写他章。
5. **映射**：只给真正 DSH 机制强制的差异补四段式偏差行；「更强/更严/自创入口」不得记为偏差。

### B. 代码/协议修正（需 `批准，使用技能 implement 执行实现 {工作项}`）

- `chapter.revise`：多段不重叠 range + 任意 mode 的 `targetText`；artifact 写 `snapshotPath`；索引 `provenance/wordCount/upstream-revision`。
- `chapter.settle`：去掉强制 `last+1`（只拒倒退）；同章 `allowReapply` 语义。
- `chapter.finalize`：索引单行替换、严格 schema、缺索引拒绝。
- `chapter.reopen`：退回重写路径（协议 + 阶段判定 + 验收）；清全部 `chapter-NNNN.*`。
- `export.work`：EPUB 标题取渲染标题、语言取 `work.language`；原子写按裁决回退或保留。
- `state.check`：布尔判据进协议；补 `stage-context` 断言。

### C. 需要作者裁决的产品行为

1. 面板真值文件是否要可编辑（源可编辑）？不做则记保真债，不能判等价。
2. 面板是否加「删除本章」动作（源 Studio 有）？
3. 独立摘要工具是否保留？保留则替换语义要与源对齐（`allowReapply`）。
4. EPUB 与原子替换：贴源，还是保留增强并登记为作者裁决的偏差？
5. `chapter.reopen` 的「恢复旧版」是否与「重开回退」解耦（源对任意章可用）？

## 五、评审方法与抽查

- 每份 Note 一个独立子代理（`subagent`，非 fork），只读；prompt 限定「只报实质问题 + 结论 + 证据位置」。
- 子代理编号：panel `fecfaaf8`、revise `a8163757`、skill `4c08000d`、summary `ae12a5fb`、settle `5ddeaede`、finalize `1339bc6b`、reopen `f53ed39e`、move-delete `5dd4a3ad`、state.check `5c4100bb`、export `d3210201`。
- 主评审者对 6 处关键 finding 做了独立抽查，均成立：
  1. `TruthFiles.tsx` 有 `Pencil/Save` 与 `canEdit`（panel F4）；
  2. `chapter-delete.ts:60-71` 只校验 `current_state.md`、`pending_hooks.md`（move-delete F1）；
  3. `stages/index.ts` 的 `renderCraft` 全量拼 `SKILL.md` + `references/*.md`（skill F1）；
  4. `reviser.ts` 的 `submitSpotFix` 支持多段 `ranges` 且 `targetText` 任意 mode 生效（revise F1）；
  5. `state-check-tool.ts:91-93` 读 `snapshots/<chapter-1>`（settle F1）；
  6. `chapter-persistence.ts` 无任何 `summary` 逻辑，七字段在 `settler-tool.ts`（summary F1）。

## 六、限制

- 全程只读，未运行 `pnpm run verify`、未跑 `check-capabilities`，`verified` 状态未复验。
- 所有 realRun 为 process-level；真实 DSH 会话证据未取得。
- 两轮 `panel.workbench` 工作项没有留存文件，无法独立核对当时声明的范围与验收。
- 源工程行为按评审员引用核对；未做逐字节产物比对（EPUB、导出文本）。

## 七、裁决记录（2026-11-11）

| 编号 | 决定 | 影响 |
|---|---|---|
| C1 | 面板真值文件 v1 保留只读，登记保真债 | D39；后续补面板写通道 |
| C2 | 面板补「删除本章」动作 | D40；动作条接 `story_delete_chapter` |
| C3 | 摘要收敛为结算内唯一路径 | D48；退役作者侧独立入口 |
| C4 | EPUB 标题/语言与写入方式全部贴源 | D50；取渲染标题、按 `work.language`、直接写 |
| C5 | 恢复旧版与「重开回退」解耦 | D44；任意章可恢复正文，重开回退仍限最新章 |

## 八、处置状态

已完成（纯文档修正，未改代码）：

- `capabilities.yaml`：`chapter.summary.source` 改指 `agents/settler-tool.ts`；`state.check.source` 改指 `agents/state-validator.ts`。
- `docs/fidelity-audit.md`：面板、技能参考、摘要、修订、结算、定稿、重开、删除、对账、导出十段判定与债号同步；不变量 7 的验证位置改为实际测试。
- `docs/scope.md`：P0/P3/P4/P5/P6 债务描述同步；新增 D23、D39–D55；P5 用户可见面删除「移动」。
- `docs/dsh-mapping.md`：移除「基址读取替代 query」伪偏差；面板白名单差异记 D41。
- 10 份 Note：修正源证据行号与行为描述、D37 改回保真债、补 C1–C5 裁决与 D39–D55 引用、订正失效的 `realRun`/阶段描述。
- 验证：`verify-agent-note-{tree,format,lifecycle}` 通过（67 篇）；`check-capabilities` 报 60 条、verified 46 / missing 14；`verify-audit-coverage` 50 行通过。

未完成（需单独授权）：

- B 节代码/协议修正（多段 range、`snapshotPath`、`last+1`、索引单行替换、重写路径、EPUB、删除动作、摘要收敛、恢复解耦、`state.check` 判据、D37 原子化）。
- 未运行 `pnpm run verify`（本次只改文档，未重建 bundle、未跑 396 测试）。
- 所有 realRun 仍是 process-level；`chapter.revise.json`、`chapter.summary.json` 等回执描述已过期，代码改动后需同批重录。
