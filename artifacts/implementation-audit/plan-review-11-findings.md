# plan-review-11 42 条 finding 复核

- 日期：2026-11-14
- 范围：`artifacts/plan-review-11-designs-2026-11-11.md` 中 10 份设计、42 条 `F<n>` finding
- 输入：该评审文件；`artifacts/implementation-audit/rows/<id>.json`；`artifacts/implementation-audit/2026-11-14.md`；`docs/fidelity-audit.md`；`docs/scope.md`；`docs/dsh-mapping.md`；`capabilities.yaml`；源码、测试与 10 份设计 Note（含后续承接 Note）
- 冻结：工作区 HEAD `e3b7886`；`docs/fidelity-audit.md`、`docs/scope.md` 有未提交修改，按工作区当前内容读取
- 性质：**只读复核，不是状态表**。不改 `capabilities.yaml`、不改 Note、不改审计总表；状态仍只由 `check-capabilities` 依据证据生成

## 一、处置口径

| 处置 | 含义 |
| --- | --- |
| 已修 | finding 指出的缺陷在当前实现或当前文档里已不存在，且给出可复核的 `file:line`（文档类给 Note／mapping／scope 行） |
| 仍债 | 行为与源的差距仍在，已登记为保真债；债号引现有 `docs/scope.md`，没有则写「待分配」 |
| 原 finding 有误 | 评审当时对源、实现或文档的事实判断不成立 |
| 无法核实 | 现有仓库证据不足以判定；写明检索范围 |
| Note 债 | 该能力的**当前设计 Note** 仍写着与实现/源不符的事实，需要回写 Note；不是行为债，不进 `scope.md` 债表 |

判定原则：

1. 不把「测试通过」当作已修证据。已修证据必须是源码、实现文件、Note／mapping／scope 的具体行。
2. 测试只在 finding 本身就在断言「测试不存在／测试只覆盖 X」时作为证据（如 `state.check#F2`、`skill.references#F3`）。
3. 旧 Note 的「后续更新」头或新 Note 已明确取代的句子，只记残留，不改变处置；当前设计 Note 自己仍写错的，记 Note 债。
4. 42 条之外的审计新债（2026-11-14 总表的 AU-xx）不并入本计数，但在行内标注，避免把「finding 已修」误读成「能力行等价」。

## 二、抽取与映射校验

用脚本按设计出现顺序抽取全部 `| F<n> |` 行并映射到账本行：

- 抽取结果：`count=42`
- 编号：`panel.workbench#F1..F5`、`chapter.revise#F1..F5`、`skill.references#F1..F4`、`chapter.summary#F1..F3`、`chapter.settle#F1..F4`、`chapter.finalize#F1..F4`、`chapter.reopen#F1..F5`、`chapter.move-delete#F1..F5`、`state.check#F1..F4`、`export.work#F1..F3`；全部唯一
- 设计到账本行：`chapter.finalize` 已并入 `chapter.settle`（`docs/fidelity-audit.md:435-437`），该 4 条 owner 记 `chapter.settle`；其余设计各自对应同名账本行
- 每行条数：5／5／4／3／4／4／5／5／4／3 = 42

## 三、逐份复核

### 1. panel.workbench → `panel.workbench`

Note：`.agents/notes/implemented/architecture/2026-11-10-panel-workbench-dialogue-first.md`

| id | 原文摘要 | 现状证据 | 处置 | owner |
| --- | --- | --- | --- | --- |
| panel.workbench#F1 | 索引版本自相矛盾（Note 写 2／3／4），实现为 4，字段清单缺根级 `action`。 | `src/core/panel-index.ts:205` 为 `PANEL_INDEX_VERSION = 6`；`src/panel-types.ts:37`、`src/client/panel-types.ts:35` 均为 6；`docs/dsh-mapping.md:59` 记「索引版本 5→6」。Note:30 已补根级 `action`，但 Note:30、:68、:115、:154 仍写「5」，与实现／映射不一致。 | **Note 债**：版本契约仍写错（5 vs 6），需回写 Note；字段清单缺 `action` 已修。 | Note（2026-11-10-panel-workbench-dialogue-first.md） |
| panel.workbench#F2 | 第二轮 `chapter-done` 根动作未进合同：Note 只写「本章完成」，索引形状无根 action，动作表与实现冲突且无验收。 | 根动作在 `src/core/panel-index.ts:274-277`（`chapter-done` → `revise-chapter`），`src/client/StoryView.tsx:303` 派发；Note:89（阶段动作）与 :94（根级 action）已进合同；`test/workbench.test.mjs:207-222`、`test/client.test.mjs:557` 有派发断言。 | **已修**。 | panel.workbench |
| panel.workbench#F3 | 白名单多出源没有的 `book_rules.json`、两份 brief、`.planner-context.json` 且未登记偏差。 | `src/core/panel-index.ts:81-93` 的 `TRUTH_FILES` 只有 11 项，不含 `book_rules.json`／两份 brief；:160 诊断正则只收 `plan`／`review`／`intent`／`context`／`trace`，不收 `planner-context`；`docs/dsh-mapping.md:66` 与 Note:67 均记「白名单与源一致」；D41 已注销。 | **已修**。 | panel.workbench |
| panel.workbench#F4 | 源真值浏览器可编辑，复刻所有产物只读且无编辑，Note／审计未登记为债。 | `src/core/panel-index.ts:198` 仍 `readonly: true`，`src/client/panel-types.ts:31` 同；Note:77 记 D39；`docs/scope.md:149` 写「作者裁决 v1 保留只读」；`docs/fidelity-audit.md:513` 判「机制等价 + 保真债 D39」。 | **仍债（D39）**：行为差距仍在，已按作者裁决登记；不是偏差。 | panel.workbench |
| panel.workbench#F5 | 不变量 7 验证位置不成立：`panel.confirm` 不读索引，验证只写「panel.*／StoryView」无断言。 | `docs/fidelity-audit.md:24` 已写「确认状态由宿主的 `detectStage` 与 approval 回执产生，面板动作与命令走同一宿主入口」；:26 验证位置改为 `workbench.test.mjs`／`client.test.mjs` 的动作派发断言与 `panel.confirm` 测试；`test/workbench.test.mjs:207-222` 断言根动作派发，`test/client.test.mjs:557` 断言修订流程。 | **已修**。 | panel.workbench |

### 2. chapter.revise → `chapter.revise`

Note：`.agents/notes/implemented/architecture/2026-11-10-chapter-revise.md`；后续承接 `2026-11-11-chapter-revise-multirange.md`、`2026-11-14-revise-auto-resettle.md`

| id | 原文摘要 | 现状证据 | 处置 | owner |
| --- | --- | --- | --- | --- |
| chapter.revise#F1 | 源 spot-fix 支持多段不重叠 range、`targetText` 对任意 mode 生效；复刻自创单段限制且只在 spot-fix 校验。 | `src/pipelines/long/revise-tool.ts:179-205` 允许 `ranges`＋`replacements` 多段、任意 mode 的 `targetText`；`src/core/revise.ts:104-141` 校验排序/越界/重叠，:168-185 校验 `targetText` 唯一与片段外逐字节不变；`2026-11-11-chapter-revise-multirange.md:28-35` 与 `docs/fidelity-audit.md:415` 记 D53 注销。 | **已修**。 | chapter.revise |
| chapter.revise#F2 | revision 无 `snapshotPath`，修订后旧 r1 checksum 悬空、旧 revision 不可读。 | `src/core/artifact-store.ts:179-184` 写 `snapshotPath`，:210 同批写快照，:295 读取时优先 `snapshotPath`；`src/core/chapter-document.ts:217-219` 修订时写 artifact 快照；`docs/fidelity-audit.md:415` 记 D42 注销。 | **已修**。 | chapter.revise |
| chapter.revise#F3 | D32 自动重结算未复刻，回执仍写「P4 未交付」，映射只验证重审。 | `src/pipelines/long/revision-commit-tool.ts` 提供 C1 结算提案（:133）与 C2 一次提交（:169-233）；`docs/fidelity-audit.md:415` 与 `docs/scope.md:69` 记 D59 注销；回执 `artifacts/real-runs/chapter.revise.json` 2026-11-14 已覆盖「提案→审稿→C1→C2」。 | **已修**。 | chapter.revise |
| chapter.revise#F4 | 源证据行号越界/错位：`reviser.ts:167-190` 超出 178 行、`runner.ts:874-1120` 漏 1140-1160。 | Note `2026-11-10-chapter-revise.md:17-19` 已改为 `runner.ts:874-1164`、`reviser.ts:167-178`、`:86-139`；`2026-11-11-chapter-revise-multirange.md:45` 记评审轮次修正。 | **已修**。 | chapter.revise（Note 行号） |
| chapter.revise#F5 | 修订不更新索引 `wordCount`／`observations`／`provenance`，后代无 `upstream-revision`。 | `src/core/chapter-index.ts:182-217` 的 `revisedChapterIndex` 写 `wordCount`、`observations: []`、`provenance: 'edited'`，后代替换 `upstream-revision`；`src/core/chapter-document.ts:200-207` 同批写索引；`src/pipelines/long/revise-tool.ts:211` 区分最新章两阶段。 | **已修**。 | chapter.revise |

### 3. skill.references → `skill.references`

Note：`.agents/notes/implemented/architecture/2026-11-10-skill-references.md`

| id | 原文摘要 | 现状证据 | 处置 | owner |
| --- | --- | --- | --- | --- |
| skill.references#F1 | `query` 未复刻，但审计／scope／mapping 称已偿还；账本标题仍称 query 检索，实际整份注入。 | `src/pipelines/long/skills.ts:151-163` 只注册 `resourceBase`，无检索入口；`src/pipelines/long/stages/index.ts:363-381` 仍把 `SKILL.md`＋`references/*.md` 整份注入；`capabilities.yaml:27-28` 标题仍写「use_skill.query 按需取技能参考」；`docs/scope.md:144` D23 未偿还；`docs/fidelity-audit.md:78` 判「保真债 D23／D54」。 | **仍债（D23；另见 AU-02）**。 | skill.references |
| skill.references#F2 | 源校验越界、符号链接、非文件、512KB、UTF-8 并自动载入 SKILL.md 的 references 链接；复刻未写失败行为。 | `src/pipelines/long/skills.ts:151-163` 只有注册，无路径校验与失败回执；`docs/scope.md:150` D54；`docs/fidelity-audit.md:76,78`。 | **仍债（D54；另见 AU-02）**。 | skill.references |
| skill.references#F3 | 唯一测试只断言注册字段与源检出目录 stat/readFile，未覆盖 skill 输出或子代理；生产可读性未证。 | `test/skill-references.test.mjs:26-64` 仍只断言 provider／resourceBase 与源检出目录可读；`artifacts/real-runs/skill.references.json` 仍是 process-level；Note:54、:61 自认。 | **仍债（AU-02，验收缺口；D23 的关闭判据包含补用例）**。 | skill.references |
| skill.references#F4 | Note 行号错：`SkillRegistration` 实为 `skill/src/index.ts:94-100`，`:110-120` 是 `SkillViewOptions`；`renderSkillContent` 170-183。 | Note:15 已改为 `:94-100` SkillRegistration、`:110-120` SkillViewOptions、`:170-183` renderSkillContent；对照 DSH 源实际 `deepseek-harness/packages/skill/skill/src/index.ts:97-103,119,173`。 | **已修**。 | skill.references（Note 行号） |

### 4. chapter.summary → `chapter.summary`

Note：`.agents/notes/implemented/architecture/2026-11-10-chapter-summary.md`；后续承接 `2026-11-13-settle-only-summary.md`

| id | 原文摘要 | 现状证据 | 处置 | owner |
| --- | --- | --- | --- | --- |
| chapter.summary#F1 | 账本 `source` 指 `pipeline/chapter-persistence.ts`，该文件无摘要 schema／排序／替换。 | `capabilities.yaml:299-306` 的 `source` 已指 `inkos:packages/core/src/agents/settler-tool.ts`；`docs/fidelity-audit.md:421-425` 同步；`chapter-persistence.ts` 共 41 行且无 `summary` 逻辑（检索 `summary`／`settler` 无命中）。 | **已修**。 | chapter.summary |
| chapter.summary#F2 | 自创独立摘要工具、可先于结算落盘、无条件替换，均未登记；`dsh-mapping` 无该行。 | `src/core/summary-tool.ts` 不存在，`story_summarize_chapter` 已无注册；摘要只由 `src/core/settle.ts:61-78` 写入（非重结算遇同章行拒绝，:248 传 `reapply`），入口在 `src/pipelines/long/settle-tool.ts:143-152`；Note 顶部更新头指向 `2026-11-13-settle-only-summary.md`；`docs/fidelity-audit.md:423-425` 判等价、D48 注销。 | **已修**。 | chapter.summary |
| chapter.summary#F3 | Note 仍引 `runner.ts:1438-1450`（1442-1450 为通知），摘要实际写盘在 `writer.saveChapter`。 | Note:18 已改为 `writer.ts:214-260` 的 `settleChapterState`＋`runner.ts:999-1123`，并列出 `saveChapter` 的写盘点（:390,404-407,424-426,433,437）；`docs/fidelity-audit.md:421` 同步。 | **已修**。 | chapter.summary（Note 行号） |

### 5. chapter.settle → `chapter.settle`

Note：`.agents/notes/implemented/architecture/2026-11-10-chapter-settle.md`；后续承接 `2026-11-13-chapter-settle-gaps.md`、`2026-11-13-chapter-settle-baseline.md`、`2026-11-14-chapter-settle-validation.md`

| id | 原文摘要 | 现状证据 | 处置 | owner |
| --- | --- | --- | --- | --- |
| chapter.settle#F1 | Note 称无逐章结算前快照、本项目尚未交付、偿还＝章节快照能力；实际已写 `snapshots/0..N`。 | 快照在发布提交里写：`src/pipelines/long/settle-tool.ts:271-277`（`snapshotWrites(written, chapter)`）；恢复路径 `src/core/finalize.ts:55-59` 仍写快照；`docs/scope.md:116` 记 D33 注销，`docs/fidelity-audit.md:433` 记基线重算已交付；Note:39 已改「逐章快照已由 `chapter.finalize` 写出」。残留：Note:39／:60／:80 仍写「记 D33」，与 D33 已注销不一致（文档回写项，不构成行为债）。 | **已修**（快照前提与 D33 偿还路径已改正；残留 D33 字句见上）。 | chapter.settle |
| chapter.settle#F2 | 实现强制 `last+1`，源仅拒倒退；同章 `allowReapply` 写成调用方条件。 | `src/core/settle.ts:238-243` 只拒 `chapter < last`，同章仅要求 `allowReapply`，允许跳章；`src/pipelines/long/settle-tool.ts:128-140` 的前置只拒已发布/已结算/更早章；Note:28 已写「只拒倒退；`chapter > lastAppliedChapter` 允许（含跳章）」。 | **已修**。 | chapter.settle |
| chapter.settle#F3 | Note 称「状态文件存在且可解析、不覆盖坏状态」；实现缺文件按默认继续，第 1 章可写。 | `src/pipelines/long/settle-tool.ts:144-147`、`:199-202` 对 `read.missing` 与 `read.invalid` 都拒绝；`src/core/state.ts:230-270` 的 `inspectState` 同时返回 `missing`／`invalid`，调用方不再静默用默认值；Note:46 已写「四份状态文件必须存在……D46 注销」。 | **已修**。 | chapter.settle |
| chapter.settle#F4 | 行号越界/偏移：`settler-tool.ts` 引 45-82（实止 73）、`settler-prompts.ts` 引 5-45（实止 41）、`state-reducer.ts` 引 82-199（hooks 75／facts 144）。 | Note:13-18 已改为 `settler-tool.ts:45-73`、`settler-prompts.ts:5-41`、`state-reducer.ts:17-79` 与 `:75-199`；行为描述本身成立。 | **已修**。 | chapter.settle（Note 行号） |

### 6. chapter.finalize → `chapter.settle`

Note：`.agents/notes/archived/architecture/2026-11-10-chapter-finalize.md`（已归档；`chapter.finalize` 行已并入 `chapter.settle`，见 `docs/fidelity-audit.md:435-437`）

| id | 原文摘要 | 现状证据 | 处置 | owner |
| --- | --- | --- | --- | --- |
| chapter.finalize#F1 | Note 把拆分流程写成「偏差」并称已登记 `docs/dsh-mapping.md`，该文件实无该行；应为保真债。 | 归档 Note:49-51 已改为「按 AGENTS.md，流程拆分是保真债 D37；`docs/dsh-mapping.md` 不登记，也不声称与源等价」；D37 后续由 `2026-11-13-chapter-atomic-save.md`（结算即发布）偿还，`docs/fidelity-audit.md:435-437` 记 finalize 并入 settle。 | **已修**。 | chapter.settle |
| chapter.finalize#F2 | Decision 写「重建全部索引」，Alternatives 否掉「重建全部索引」；实现重建所有行并改写他章 `updatedAt`，校验宽松。 | `src/core/finalize.ts:61` 改用 `readChapterIndexStrict`，:83-84 已有本章条目时不覆盖、只补缺失；`src/core/chapter-index.ts:248-267` 索引缺失而章节文件存在时拒绝、逐字段严格解析、坏 schema 不归一化。归档 Note:31 仍描述已删除的 `buildChapterIndex`（历史残留，已被 D49 承接 Note 取代）。 | **已修**。 | chapter.settle |
| chapter.finalize#F3 | `runner.ts:1424-1434` 实为 truth-validation 观察合并；`markBookActiveIfNeeded` 在 2106-2115、调用 1439，条件仅 `status === "outlining"`。 | 归档 Note:20 已按此改写；对照源 `runner.ts:1430-1439`（`persistChapterArtifacts` 传入 `markBookActiveIfNeeded`）与 `runner.ts:2106-2115`（`status !== "outlining"` 直接返回）。 | **已修**。 | chapter.settle（Note 行号/条件） |
| chapter.finalize#F4 | Note 漏写快照消费者：删除章用上一章快照恢复、`state.check` 要求上一章快照；也未写「缺快照」失败面。 | 归档 Note:82 已补「删除与对账消费上一章快照（`delete-chapter.ts:58-65`、`state-check-tool.ts:91-93`）；定稿不要求前章已定稿，第 1 章未定稿就定稿第 2 章时，删除/对账会因缺上一章快照失败」；`src/core/delete-chapter.ts:58-95` 与 `src/pipelines/long/state-check-tool.ts:87-91` 与描述一致。 | **已修**。 | chapter.settle |

### 7. chapter.reopen → `chapter.reopen`

Note：`.agents/notes/implemented/architecture/2026-11-10-chapter-reopen.md`；后续承接 `2026-11-13-reopen-restore-split.md`、`2026-11-14-chapter-reopen-closure.md`

| id | 原文摘要 | 现状证据 | 处置 | owner |
| --- | --- | --- | --- | --- |
| chapter.reopen#F1 | 重开留正文、删 review＋plan；重规划后 `detectStage` 判 review，`story_write_chapter` 拒覆盖已有正文；「退回重写」会落到审旧稿。 | `src/pipelines/long/stages/index.ts:249`（plan 协议：整章重写用 `story_revise_chapter`，不走首次写作）、`:277`（review 协议：先问改稿，不直接审旧稿）、`:327`（chapter-done：重开后改稿走 revise）；Note:54 同；`docs/fidelity-audit.md:447` 记 D43／D44／D55 注销。 | **已修**。 | chapter.reopen |
| chapter.reopen#F2 | 源 `chapter-replace` 对任意章可用且不动运行时状态；DSH 以 `lastAppliedChapter === chapter` 拒绝。 | `src/core/reopen.ts:127-194` 的 `restoreChapter` 对任意章可用（不检查 `lastAppliedChapter`），只换正文、清运行时、写索引观察与复审 start；`:201-216` 的 `reopenChapter` 仍限「最新已发布且最后已结算」，该限制是 DSH 阶段机制并在 `docs/dsh-mapping.md:165-166` 登记；D44 注销。 | **已修**（恢复与重开已解耦；重开限制为已登记机制）。 | chapter.reopen |
| chapter.reopen#F3 | Note 称 DSH 的 plan 是 `chapter-NNNN.intent.md`（实为 `plan.json`）；重开只删 review＋`plan.json`，残留 intent/planner-context/context/trace。 | `src/core/reopen.ts:79-99` 的 `chapterRuntimePaths` 收集该章全部 `chapter-NNNN.*`（仅保留 user-brief 与调用方 `keep`），`:245-249` 重开时全部删除；`chapterPlanPath` 只在恢复分支作为 `keep` 保留（已登记偏差，`dsh-mapping.md:166`）；Note:38 仍写「当前仍残留……记 D43」为历史残留（D43 已注销，新 Note 已写「两条路径都清该章全部运行时文件」）。 | **已修**。 | chapter.reopen |
| chapter.reopen#F4 | 偏差行只记指针回退＋facts/hooks，未记删摘要行；同页称源用 `requiresTruthRebuild`，但源无调用者。 | `docs/dsh-mapping.md:162-167` 已重写：恢复分支任意章、重开分支从 `snapshots/<N-1>` 回退四份状态与三份投影（摘要/facts/hooks 一并回退）、三件套前置、复审 start 目标化；`2026-11-13-reopen-restore-split.md:23` 注明 `requiresTruthRebuild`「仓内未见消费方，复刻也没有对应流程（并入 D33）」；D36／D58 注销。mapping:164 仍保留「源用 requiresTruthRebuild 标出后续重建」的措辞，属残留表述，不影响等价依据。 | **已修**。 | chapter.reopen |
| chapter.reopen#F5 | 版本列表源行号错：实际在 `server.ts:3026-3051`（3034-3037 返回 versions），不在所引 3132-3175。 | Note:18 已改为 `server.ts:3026-3051`（`:3034-3037` 的 `GET …/workspace` 返回 versions）、`:3132-3145` 读取版本、`:3147-3178` restore。 | **已修**。 | chapter.reopen（Note 行号） |

### 8. chapter.move-delete → `chapter.move-delete`

Note：`.agents/notes/implemented/architecture/2026-11-10-chapter-move-delete.md`；后续承接 `2026-11-12-chapter-delete-parity.md`、`2026-11-13-workbench-delete-whitelist.md`

| id | 原文摘要 | 现状证据 | 处置 | owner |
| --- | --- | --- | --- | --- |
| chapter.move-delete#F1 | 要求上一章快照七份齐全且 `manifest.lastAppliedChapter` 匹配；源只 stat `current_state.md`、`pending_hooks.md`，允许 `chapter_summaries.md` 缺失。 | `src/core/delete-chapter.ts:21` 的 `REQUIRED_SNAPSHOT_FILES` 只有两份；`:58-95` 的 `snapshotRestore` 按快照实际 `state/*` 恢复、`chapter_summaries.md` 缺失时删投影；Note:29 同；D52 注销。 | **已修**。 | chapter.move-delete |
| chapter.move-delete#F2 | 按章节文件定最新章、索引缺失时重建；源以 `loadChapterIndex` 为准，索引缺失而章节文件在时直接报错。 | `src/core/delete-chapter.ts:151-156` 用 `readChapterIndexStrict`、latest 取索引最大章号、非最新章拒绝；`src/core/chapter-index.ts:248-267` 索引缺失而章节文件存在时拒绝；Note:32、:69 同。 | **已修**。 | chapter.move-delete |
| chapter.move-delete#F3 | 面板不加删除动作；源 Studio 有删除按钮与确认，`dsh-mapping` 无偏差行。 | `src/client/Workbench.tsx:123,147` 页头「删除本章」内联确认，`src/client/StoryView.tsx:301` 派发 `/story-delete`；`docs/dsh-mapping.md:70-75` 有「面板删除：宿主命令替代直接 API」偏差行；D40 注销。 | **已修**。 | chapter.move-delete |
| chapter.move-delete#F4 | `scope.md` P5 用户可见面仍写「章节重开/移动/删除」，与 Note／scope／capabilities 冲突。 | `docs/scope.md:87` P5 已改为「章节重开/删除」，无「移动」；Note:9 与 `capabilities.yaml:323` 标题「删最新章（源无移章）」一致。 | **已修**。 | chapter.move-delete（scope 行） |
| chapter.move-delete#F5 | 引 `manager.ts:612-690`，文件止于 685 行；`rollbackToChapter` 实为 612-675。 | Note:14 已改为 `manager.ts:612-675`；`chapter-delete.ts:33-115` 与 `agent-tools.ts:2937-2950` 引用正确。 | **已修**。 | chapter.move-delete（Note 行号） |

### 9. state.check → `state.check`

Note：`.agents/notes/implemented/architecture/2026-11-10-state-check.md`；后续承接 `2026-11-13-state-check-criterion.md`、`2026-11-14-chapter-settle-validation.md`

| id | 原文摘要 | 现状证据 | 处置 | owner |
| --- | --- | --- | --- | --- |
| state.check#F1 | 账本 `source` 指 `state/state-validator.ts`（静态 `validateRuntimeState`），非 Note／审计的 `agents/state-validator.ts`（语义 `validate`）。 | `capabilities.yaml:323-329` 的 `source` 已指 `inkos:packages/core/src/agents/state-validator.ts`；`docs/fidelity-audit.md:463` 同。 | **已修**。 | state.check |
| state.check#F2 | 称 `test/stage-context.test.mjs` 断言 chapter-done 协议含 `story_state_check`；该文件与全仓测试均无此断言。 | `test/stage-context.test.mjs:246-252` 现有断言（结算前不调 `story_state_check`、派状态对账子代理的协议文本、含 `story_state_check`）；Note:61 同；`test/state-check.test.mjs` 覆盖判据与只读。 | **已修**。 | state.check |
| state.check#F3 | D34 偿还只写「后续把校验接进结算流程」，不指向任何 capability／工作项。 | D34 已由 `2026-11-14-chapter-settle-validation.md` 以「结算提案＋收据」交付；`docs/scope.md:90,116` 记 D34 注销；Note:47 指向该能力行。 | **已修**。 | state.check |
| state.check#F4 | 源 `state-validator.ts:47` 判据（仅换投影可消解才置 true；正文/权威矛盾只作观察、不授权重结算）未进 Note 与协议。 | Note:15 已抄录判据，:47 记 D51 注销；`src/pipelines/long/state-check-tool.ts:27-31`（参数说明）与 :62（description）写明判据，`src/pipelines/long/stages/index.ts:315` 结算协议同；`docs/fidelity-audit.md:461` 同。 | **已修**。 | state.check |

### 10. export.work → `export.work`

Note：`.agents/notes/implemented/architecture/2026-11-10-export-work.md`；后续承接 `2026-11-13-export-work-epub-fidelity.md`

| id | 原文摘要 | 现状证据 | 处置 | owner |
| --- | --- | --- | --- | --- |
| export.work#F1 | 源 EPUB 章标题取渲染 `#` 标题、语言交给打包器；复刻取裸索引 title、章 XHTML `xml:lang` 固定 `zh-CN`、nav 标题固定「目录」、无视 `work.language`。 | `src/core/export.ts:110-112` 的 `renderedTitle` 取渲染文档 `#` 标题，:140 用于章标题与导航；:137 `lang = work.language === 'en' ? 'en' : 'zh-CN'`，:161／:184 写进 `content.opf` 与章 XHTML；Note:14、:36 已改写并记 D50 注销；`docs/fidelity-audit.md:481` 记四项已贴源。 | **已修**。 | export.work |
| export.work#F2 | 源直接 `writeFile`；复刻 `temp+rename`，Note 称「无新的机制偏差」，审计承认「行为更强」仍判等价。 | `src/core/export.ts:248-252` 已改为 `mkdir` 父目录后直接 `writeFile`，无临时文件/rename；Note:28 记「作者裁决贴源直写，D50 注销」；`capabilities.yaml:347` 标题含「直写」。 | **已修**。 | export.work |
| export.work#F3 | 行号错：`ChapterExportSourceError` 实为 27-38、`buildChapterFileLookup` 40-69；「默认 txt」在 :98 不在 :100-160。 | Note:13 已改为 `:27-38`、`:40-69`；:14 已拆开「`:98` 默认 `txt`；`:100-160` 的 `buildExportArtifact`」。 | **已修**。 | export.work（Note 行号） |

## 四、原文 6 处「未能核实」的现状与处置

| # | 原文未能核实 | 现状与检索范围 | 处置 |
| --- | --- | --- | --- |
| 1 | panel.workbench：两轮工作项无留存文件，各轮范围/非目标/验收只能从 Note 推断；D31 关闭在 `scope.md:37`、`audit:510` 有记录，但裁定本身不在仓库；`scope.md:37` 与 `panel.confirm.json:14` 对 D30 定义不一致。 | `.agents/notes/proposed/` 现有两份 11-14 提案（`chapter-import`、`implementation-audit`），仍无 11-09／11-10 的 panel 工作项；`docs/scope.md:50` 只写「D31 由作者裁定关闭（不做桌面回执，以进程级测试为交付证据）」，无裁定正文；`docs/scope.md:50`「D30 `panel.workbench` 已交付」与 `artifacts/real-runs/panel.confirm.json:14`「D30 记录面板动态章节限制」仍冲突。检索：`.agents/notes/proposed`、`.agents/notes/implemented`、`artifacts/real-runs`、`docs/scope.md`。 | **仍无法核实**；D30 定义冲突另属 Note／账本回写项（建议记「待分配」文档债，不进 scope 保真债表）。 |
| 2 | chapter.revise：未运行 verify／真实会话；回执中的 347 passed 未独立验证。 | `artifacts/real-runs/chapter.revise.json` 已重录为 2026-11-14（505 passed／1 skipped），347 不再存在；本审计同样只读、未运行 `pnpm run verify`。检索：`artifacts/real-runs/chapter.revise.json`、`docs/fidelity-audit.md:411-415`。 | **已消解**（回执已更新；「未独立运行 verify」是审计限制，不是 finding 残留）。 |
| 3 | skill.references：真实安装会话中子代理经 skill 输出读包根。 | 仍只有 `artifacts/real-runs/skill.references.json` 的 process-level 回执（2026-11-10，350 passed）与 `test/skill-references.test.mjs` 对源检出目录的 `stat`／`readFile`；没有安装包根的真实会话 id 或日志。检索：`artifacts/real-runs/skill.references.json`、`test/skill-references.test.mjs`、`artifacts/implementation-audit/rows/skill.references.json`。 | **仍无法核实**；登记为 D23／D54／AU-02 的验收缺口。 |
| 4 | chapter.summary：只读未跑 verify；`real-run:14` 仍写「结算未交付」，与 `chapter.settle` 已 verified 冲突。 | `artifacts/real-runs/chapter.summary.json` 已重录为 2026-11-13（422 passed），receipts 明确写「`story_summarize_chapter` 已删除……D48 已注销」，不再有「结算未交付」。检索：`artifacts/real-runs/chapter.summary.json`、`docs/fidelity-audit.md:419-425`。 | **已消解**。 |
| 5 | chapter.move-delete：「D33 部分偿还」在本 Note／audit／scope 无据；`audit:452` 只说 D33 不影响删除。 | D33 已整体注销（`docs/scope.md:116`；`2026-11-13-chapter-settle-baseline.md`）；`2026-11-10-chapter-move-delete.md:47` 已写「D33 仍影响重结算，不影响删除」，不再出现「部分偿还」。检索：`docs/scope.md`、`docs/fidelity-audit.md:449-455`、该 Note。 | **已消解**。 |
| 6 | export.work：无 `epub-gen-memory` 安装，无法逐字节比对源 EPUB；阅读器兼容仅有 ZIP 结构断言。 | `packages/see-dsh-novel/package.json` 无 `epub-gen-memory` 依赖，`src/core/zip.ts` 自写 store ZIP；`test/export.test.mjs` 只断言标题/语言/导航/ZIP 结构；D57／AU-29 仍登记包结构债。检索：`packages/see-dsh-novel/package.json`、`node_modules`、`test/export.test.mjs`、`artifacts/real-runs/export.work.json`。 | **仍无法核实**；D57（AU-29）承接逐模板复刻。 |

## 五、处置计数

42 条 finding：

| 处置 | 数量 | 明细 |
| --- | --- | --- |
| 已修 | 37 | panel F2/F3/F5；revise F1-F5；skill F4；summary F1-F3；settle F1-F4；finalize F1-F4；reopen F1-F5；move-delete F1-F5；state.check F1-F4；export F1-F3 |
| 仍债 | 4 | panel F4（D39）；skill F1（D23）；skill F2（D54）；skill F3（AU-02） |
| 原 finding 有误 | 0 | — |
| 无法核实 | 0 | — |
| Note 债 | 1 | panel F1（索引版本 5 vs 实现 6） |

原文 6 处「未能核实」：

| 处置 | 数量 | 明细 |
| --- | --- | --- |
| 已消解 | 3 | #2 chapter.revise 回执已重录、#4 chapter.summary 回执与冲突已重录、#5 chapter.move-delete 的 D33 已整体注销 |
| 仍无法核实 | 3 | #1 panel.workbench 工作项缺档（另 D30 定义冲突未消解）、#3 skill.references 无真实安装会话证据、#6 export.work 无 EPUB 逐字节比对 |

## 六、复核注记

1. **已修 ≠ 行等价**。本文件只回答「这 42 条 finding 是否还成立」。2026-11-14 实现审计对同一批行另有新债（如 `chapter.revise` 的 AU-25 章长校验/替换预算、`export.work` 的 AU-29 严格索引/4 位章号、`panel.workbench` 的 AU-31 工作台动作面），不在本计数内，也不因本文件的「已修」而消失。
2. **文档类已修的边界**。行号修正、来源指针修正按「当前 Note／mapping／capabilities 的行」复核；旧 Note 中被新 Note 取代的历史文句不算 finding 残留，但若当前设计 Note 仍写错（panel F1、settle Note 的 D33 字句、reopen Note:38 的 D43 字句、finalize 归档 Note:31 的 `buildChapterIndex` 描述），只在行内标注，供后续 Note 回写时同批处理。
3. **证据级别**。`artifacts/real-runs/` 下的回执几乎都是 process-level（`sessionId: process:*`）；本文件不把它们当作真实 DSH 会话等价证据，只作为回执内容是否更新的核对对象。
4. **只读范围**。本次没有运行 `pnpm run verify`、`check-capabilities`、`verify-audit-coverage`，也没有启动 DSH 会话；「已修」全部来自源码／Note／映射／审计文档的逐行阅读，未把测试通过当证据。
5. **未改动的文件**。本文件是本次唯一写入；`docs/fidelity-audit.md`、`docs/scope.md`、`capabilities.yaml`、10 份 Note 与 `artifacts/implementation-audit/2026-11-14.md` 均未修改。
