# 产品范围

在 DSH 原生运行时上实现长篇写作流水线：作者从会话进入一部作品，按阶段推进到第 1 章定稿，并能导出与备份。[DSH 机制映射](./dsh-mapping.md)

## v1 范围

只做一条纵向链路，端到端打通：

创意提案 → 立项与初始化 → 基础设定 → 角色权威 → 第 1 章 write / review / revise / summary / settle → 导出与备份

链路中每一步都是 `capabilities.yaml` 的一行；交付是否成立以该行的证据为准，不以完成度描述为准。

## 阶段合同

阶段只表达交付顺序，不表达状态；状态仍只来自账本证据。每个阶段固定七项：源模块、能力行、横向不变量、用户可见面、入口条件、出口条件、非目标/债务。行清单按 `capabilities.yaml` 行序；`capabilities.yaml` 是唯一状态表。

横向不变量的编号见 [`fidelity-audit.md`](./fidelity-audit.md) 的「跨能力不变量」段。阶段出口必须同时满足：本阶段行 `verified`、命中的不变量通过、真实回执存在、债号已偿还或有阻塞证据。

### P0 运行时骨架

- **源模块**：Provider／Agent 循环／CLI、agent tools、Studio client、包与边界；见 `inkos/packages/core/src/agent/`、`packages/studio/src/`。
- **能力行**：`runtime.load`、`runtime.agent-tools`、`runtime.client-ui`、`runtime.package-check`、`runtime.boundary-check`、`skill.references`（新行）。
- **横向不变量**：3（作品边界）、7（面板/命令一致）的运行时前提；工具面只注册当前可用能力，内容写入只走 `story_*`。
- **用户可见面**：DSH 会话加载插件、agent 工具面、client slot 基线、包/边界检查。
- **入口**：仓库与 DSH 运行时可用。
- **出口**：六行 `verified` + 行审计 + 真实回执；`verify-audit-coverage` 通过。
- **非目标/债务**：D23：资源基址读取已由 `skill.references` 交付，`query` 检索仍未实现；参考读取的边界校验另记 D54；不实现短篇/剧本。

### P1 创意、立项与基础设定

- **源模块**：`proposal`/`propose_action`、`book create`、`initBook`、foundation agents、truth 文件、`atomic-file-set`、Studio 确认卡；见 `inkos/packages/core/src/agent/`、`pipeline/runner.ts`、`state/manager.ts`、`studio/src/pages/`。
- **能力行**：`runtime.session-binding`、`runtime.commands`、`runtime.telemetry`、`runtime.recovery`、`proposal.creative`、`panel.gate-resume`、`panel.foundation-start`、`foundation.architect`、`foundation.hooks`、`foundation.approval`、`cast.single-authority`、`foundation.rule-contract`、`foundation.ready-check`、`foundation.truth-projections`、`foundation.control-docs`、`foundation.truth-write`、`foundation.hook-ledger`、`runtime.commit-safety`、`runtime.work-lock`、`runtime.stage-context`、`runtime.txn-format`、`proposal.execution-brief`、`panel.confirm`（新行）。
- **横向不变量**：1（workflow start 确认）、2（阶段停点）、3（作品边界）、4（证据同一）、7（面板/命令一致）。
- **用户可见面**：`/story-init`、面板「开始基础设定」、workflow start 确认、`/story-approve`／`/story-reject`、失败回执。
- **入口**：P0 出口。
- **出口**：本阶段行 `verified` + 不变量 1/2/3/4/7 + `runtime.work-lock` + `runtime.commands` D19–D21 真机 + `panel.confirm`；`panel.workbench` 在 P6 交付。
- **非目标/债务**：D27/D28/D29 已偿还；D30 `panel.workbench` 已交付；D31 由作者裁定关闭（不做桌面回执，以进程级测试为交付证据）；D19–D21 由 `runtime.commands` 偿还。

### P2 章前规划

- **源模块**：retrieval、composer、semantic compressor、planner；见 `inkos/packages/core/src/retrieval/`、`agents/composer.ts`、`agents/planner.ts`。
- **能力行**：`plan.retrieval`、`plan.context-select`、`plan.compression`、`plan.chapter`。
- **横向不变量**：5（上下文同一）；1/2 的 workflow start 不越过 P1 确认。
- **用户可见面**：规划阶段的候选/包/trace、章纲预览；面板显示规划产物。
- **入口**：P1 出口。
- **出口**：能力行 `verified` + 不变量 5；D22／D24／D26 偿还或有阻塞证据。
- **非目标/债务**：D22、D24、D26 在本阶段处理；不写正文。

### P3 正文生产

- **源模块**：writer、reviewer、revision；见 `inkos/packages/core/src/agents/`、`pipeline/`。
- **能力行**：`chapter.write`、`chapter.review`、`chapter.revise`。
- **横向不变量**：1（workflow start 确认，不逐工具确认）、6（产物同一）、2（阶段停点）。
- **用户可见面**：写作/审阅阶段、章节正文与审阅记录、artifact revision；面板只读展示。
- **入口**：P2 出口。
- **出口**：能力行 `verified` + 不变量 1/2/6；`reviewedArtifact` 与章节 revision 一致（仅非提案审稿）；真实回执；D32 的自动复审已由审稿闸门承接；修订事务内的自动重结算已随 D59 交付（提案→审稿→一次提交）。
- **非目标/债务**：不在每个 write 工具上加 approval；summary/settle 归 P4；修订后的自动重结算已随 D59 交付。

### P4 结算与发布

- **源模块**：summary、settler、finalize；见 `inkos/packages/core/src/pipeline/`。
- **能力行**：`chapter.summary`、`chapter.settle`（结算发布）。
- **横向不变量**：2、6；真值回写与快照。
- **用户可见面**：结算记录、伏笔状态、结算发布/快照。
- **入口**：P3 出口。
- **出口**：能力行 `verified` + 不变量 2/6 + 回执。
- **非目标/债务**：不做重开/移动/导出；索引 `lengthTelemetry` 已随 `chapter.settle`／`chapter.revise` 交付（D35 注销）；`tokenUsage` 已随 `chapter.settle` 交付（D60 注销）；标题变化删 superseded 章节文件（D61）仍待。基线重算与结算前状态对账已随 `chapter.settle` 交付（D33／D34 注销）。

### P5 章节运维与对账

- **源模块**：reopen、move/delete、state check；见 `inkos/packages/core/src/state/`。
- **能力行**：`chapter.reopen`、`chapter.move-delete`、`state.check`。
- **横向不变量**：2、3、4、6；回滚与对账。
- **用户可见面**：章节重开/删除、状态核对。
- **入口**：P4 出口。
- **出口**：能力行 `verified` + 不变量 + 回执。
- **非目标/债务**：不导出；不提供移章/重排（源也没有）；重开回退已从第 N-1 章快照回退、恢复已写索引观察与复审 start（D36／D58 注销）；重审观察已写回索引（D45 注销）；结算前对账已随 `chapter.settle` 交付（D34 注销）；索引长度遥测与 `tokenUsage` 已交付（D35／D60 注销），标题删除（D61）仍待。

### P6 产物与工作台

- **源模块**：artifact revisions、export、backup、materials、搜索、Studio workbench/logs/analysis；见 `inkos/packages/core/src/harness/`、`interaction/export-artifact.ts`、`studio/src/pages/`。
- **能力行**：`artifact.identity`、`export.work`、`backup.restore`、`materials.import`、`search.unified`、`panel.workbench`、`panel.logs`、`panel.analysis`。
- **横向不变量**：3（跨作品隔离）、4（证据同一）、6（产物同一）、7（面板只读同一证据）。
- **用户可见面**：产物 revision、导出、备份/恢复、素材与检索、作品工作台/日志/分析。
- **入口**：P5 出口。
- **出口**：八行 `verified` + 不变量 3/4/6/7 + 真实回执。
- **非目标/债务**：`panel.confirm` 已归 P1；P6 不再承载作者确认；恢复不回滚根上导出文件（D38）；面板真值文件只读（D39）；导出 EPUB 包结构待贴源（D57）。

### v1 之外

P7 短篇、P8 剧本、P9 雷达/预演不进入 v1 阶段合同；对应账本行保留 `missing`，不参与 P0–P6 出口。P7–P9 的源模块与能力另行规划，不能借“补齐”混进当前阶段。



P1 的前四行是内容生成的前提，不是「就近补齐」的附属项：源工程先 `init` 建项目、再 `book create` 生成 `works/<id>/work.json` 并推导 bookId，之后才写 foundation——作品先有身份，才谈写什么。本项目把多作品目录简化成「一个工作区即一部作品」，身份仍以 `work.json` 落在工作区根，`work.json` 同时替代源工程里 `works/<id>/work.json` 的身份、预设与导出边界三项职责。

已知的次序偏差（按交付事实记录；不改写已验证的状态）：

- **P1 前置行晚于 `foundation.*` 与 `cast.single-authority`**：这两组在 P1 前置行之前就已交付并 `verified`。账本行序仍是推进顺序——`runtime.*` 组剩余行补齐后才进 P2；这条历史事实不改写已验证的状态。
- **`artifact.identity`（P6）晚于 `chapter.revise`（P3）**：源在基础设定结束时就建初始快照；复刻的 `chapter.revise` 先交付了 r2／parent／superseded 修订历史，而不可变 `snapshotPath` 到 `artifact.identity`（`235d9c6`）才补上，期间旧 revision 覆盖后不可读，记 D42 并已注销。这与本段原先「v1 只有第 1 章、不做历史修订，因此可以接受」的前提冲突：修订能力已经交付，前提不成立。后续任何写 revision 的能力必须先有 `artifact.identity`。
- **P6 行在 P4／P5 债务未偿还时交付**：`panel.workbench`、`artifact.identity`、`export.work` 已 `verified`，但 P4／P5 的 D61（标题删除）仍未偿还。按本文件顶部的出口条件，P4／P5 出口尚未成立；P6 其余四行（`materials.import`、`search.unified`、`panel.logs`、`panel.analysis`）与 D57 也未完成。在这批债偿还、或作者把其中某几项明确改挂到 P6 之后以前，P4／P5 出口不能标记完成。

债之间的依赖：`materials.import` → `search.unified` → D22／D24；章节链的写入与对账已交付（D33／D34 注销），重开/恢复入口与重审写回索引已交付（D36／D58／D45 注销），索引 `lengthTelemetry` 与按章 `tokenUsage` 已交付（D35／D60 注销），残余 D61（标题删除）；修订后的自动重结算已随 D59 交付；D38、D23／D54、D57 独立。凭据见 [`fidelity-audit.md`](fidelity-audit.md) 与各能力 Note。

源工程还有历史修订的下游影响（`upstream-revision` 标记与重放）、风格指纹、剧情预演与雷达，这些不在 v1 范围内，账本也没有对应行——它们是 v1 之后的独立能力，不靠「补齐」混进当前阶段。

### 运行形态

- 从 DSH 会话进入，面板与对话、轨迹并列，界面用 React 渲染，接入 `client` 插件与 slots。
- 角色由子代理承担；模型选择由预设／配置提供，代码不绑定 Provider。
- 作品内容以文档形式落盘，可读、可 diff、可直接导出；SQLite 只做索引，一作品一库。一个工作区即一部作品。
- 会话与调用证据留在 DSH session。
- 长任务用 jobs／schedule 调度，不建队列；`story_*` 工具按阶段注册独立 tool schema。

## 非目标（v1）

- **短篇与剧本流水线**：v1 之后独立推进；账本中已登记，不占 v1 交付。
- **选题雷达与剧情预演**：`radar.topic`、`forecast.plot` 是提案阶段的补强项，账本已登记、排在 P9，不占 v1 交付；补上以后提案可以带方向候选与分支预演，但不改作品事实。
- **兼容层**：不提供双格式读写，不保留旧版接口别名。
- **旧作品迁移**：不导入既有作品库，不做历史数据清洗。
- **横向重构**：不做跨模块统一抽象，按能力纵向交付。
- **第二套状态表**：能力状态只由 `capabilities.yaml` 承载，不另建进度表、交付盘点或验收清单。

## 保真债

审计结论与逐行依据见 [`fidelity-audit.md`](fidelity-audit.md)；这里只列未偿还项与偿还位置。

| 编号 | 行 | 欠什么 | 偿还位置 |
|---|---|---|---|
| D22 | `plan.retrieval` | 素材仍由 FTS 过渡候选供给作者搜索；源是 P6 素材 scope | `materials.import`／`search.unified` |
| D23 | `skill.references` | 源 `use_skill.query` 对参考文件检索；复刻只给资源基址与目录读取，`query` 未实现，阶段注入是整份读取 | `skill.references` 补参考检索入口 |
| D24 | `plan.context-select` | book reference 上下文未实现；源 composer 追加 reference entries | P6 `materials`／`search.unified` |
| D26 | `plan.compression` | 大 compressible 夹具写出 task spool，但主模型读取 2.3MB task 时卡死；真压缩回执未取得 | 小窗口测试模型或专用夹具后续 |
| D61 | `chapter.write` 标题变化删 superseded 文件 | 源 `saveChapter` 写新标题时删除同章号其它 `.md`；触发点是 `import_chapters`，`materials.import` 只导素材不写章节；复刻尚无章节导入能力 | 导入写入（`chapter.import` 票据 1）按标题命名并同批删除旧文件；关闭判据=该路径有测试 |
| D38 | `backup.restore` 导出不回滚 | 源恢复整目录会连 `exports/` 一起回滚；复刻导出在根上且不在作品拥有项内，恢复后导出仍是旧内容 | 恢复时用恢复前 id 删当前导出、恢复后 id 兜底删，作者重新导出 |
| D39 | `panel.workbench` 真值编辑 | 源 `TruthFiles` 有 Edit/Save 与 PUT 落盘；复刻所有产物 `readonly`，作者不能在面板改真值 | 作者裁决 v1 保留只读；后续补面板写通道 |
| D54 | `skill.references` 参考边界 | 源校验越界、符号链接、非文件、512KB、UTF-8 并自动带 references；复刻未复刻失败行为 | 补校验与失败回执 |
| D57 | `export.work` EPUB 包结构 | 源 `epub-gen-memory` 产出 `style.css`、`toc.ncx`／`toc.xhtml`、完整 `content.opf` 元数据（identifier／creator／publisher／date／rights／description／guide）、章文件名 `N_slug.xhtml`、DEFLATE 压缩、`container.xml` 序列化与包级 `xml:lang`；复刻是最小 EPUB3（无 CSS、无 ncx、全 store） | 另立工作项逐模板复刻（是否引入打包库届时裁决） |

## 边界

交付范围与验收归工作项；能力状态只由 `check-capabilities` 依据证据生成。规则见 [`AGENTS.md`](../AGENTS.md) 的铁律，文档属主见 [`docs/AGENTS.md`](AGENTS.md)。

## 2026-11-14 实现审计债

来源：[`../artifacts/implementation-audit/2026-11-14.md`](../artifacts/implementation-audit/2026-11-14.md)。审计只读，不改 `capabilities.yaml` 状态；本表记录审计判为保真债/机制等价但仍有未关闭差异的行。

| 债号 | 能力行 | 债 | 关闭判据 |
| --- | --- | --- | --- |
| AU-01 | runtime.agent-tools | 写作工具面与 persona 的源证据指向错文件，工具面替换与 artifact 读面缺失未登记 | 把 capabilities.yaml 与 docs/fidelity-audit.md 的源证据改到 inkos/packages/core/src/harness/production-capabilities.ts:232-295 与 system-prompt.ts:13-103；在 docs/dsh-mapping.md 登记工具面替换（含未搬的源工具、read 的 artifactId/revision 模式、persona 文本）；补运行时工具集与 persona 行为对照测试；重录 artifacts/real-runs/runtime.agent-tools.json。 |
| AU-02 | skill.references | D23 use_skill.query 参考检索未实现；D54 参考边界校验与失败回执未实现 | 注册一个按技能取参考的工具/入口：收集 md/txt、按标题切段、对 query 检索 top N 并返回带区间与来源的段落；同时复刻 resourcePath 的 safe-child、符号链接、非文件、512KB、UTF-8 与失败回执。停止把整份 references 注入当作 query 的等价；补检索与拒绝用例。 |
| AU-03 | runtime.client-ui | 客户端 real-run 回执过期（9325B/8 例 → 43507B/34 例） | 重录 artifacts/real-runs/runtime.client-ui.json：当前 lib/client.js 大小与 sha256、client.test.mjs 与 workbench.test.mjs 的通过数、真实会话里面板注册与命令回执的 seq。 |
| AU-04 | runtime.package-check | package-check 的 source 不属冻结源工程、检查集合只覆盖标题要求且回执过期 | 把 source 改为 `none:仓库工具` 或 pin dsh-webnovel-writer@<commit>；逐条登记源脚本里不适用的检查与未复刻的通用检查；重录 artifacts/real-runs/runtime.package-check.json 的 files/patchRows。 |
| AU-05 | runtime.boundary-check | check-boundary 回执过期（33→100 文件），扫描范围未覆盖 tests/scripts/清单 | 重录 artifacts/real-runs/runtime.boundary-check.json 的 files 数；在文档写明扫描范围仅限 src，或把 tests/、scripts/、package.json 纳入检查并补测试。 |
| AU-06 | runtime.session-binding | work.json 身份 schema、作品 id 与会话绑定语义未按源对齐/登记 | 在 docs/dsh-mapping.md 登记 work.json 两源合并、profileId→profile、lineage 缺失、id 取目录名与 work.json 位置；或按源补 profileId/lineage/source/book.json；把 capabilities.yaml 的 source 指向 work-store.ts:11-20 与 interaction/session.ts:92；重录 real-run。 |
| AU-07 | runtime.commands | 重新立项判据、work id、brief.md 写入与源不一致，且审计文档自相矛盾 | 按源 isCompleteBookDirectory 的 7 项改预检（含 current_state.md 与 chapters/index.json）或登记差异；id 改 deriveBookIdFromTitle 或登记；brief.md 只在有简报时写且写原文（或登记）；修正 docs/fidelity-audit.md:116 与 :123 的矛盾并去掉 --chapters/--words 为源别名的说法；重录 artifacts/real-runs/runtime.commands.json。 |
| AU-08 | runtime.recovery | 启动/读取边界不回收死事务；自检与索引/章节重建面没有偏差登记；realRun 停在 2026-11-08，未覆盖 D37 后的 chapter-* 行为 | 在宿主入口（session/created 或 workingDirectory.ensure/读阶段前）调用 recoverDeadTransactions，使只读路径与源启动回收时序一致并补用例；在 docs/dsh-mapping.md 增偏差行，记录源无自检/重建面、复刻新增 story_recover 与 chapter-* 补齐的原因与验证；重录 artifacts/real-runs/runtime.recovery.json，用非 process:* 会话覆盖 chapter-publish-incomplete/chapter-unsettled-published 与启动回收。 |
| AU-09 | proposal.creative | 确认后的源默认（genre/platform='other'、language 取会话语言）未复刻；确认的 min/max 只存不消费，且该债未在 fidelity-audit 本行或 scope.md 立号 | 在 proposal 的批准路径补源默认：未给 genre/platform 时写 'other'，language 未给时取会话语言再回退 zh，并补测试；让 writer 长度契约与修订替换预算消费 work.metadata.minChapterLength/maxChapterLength，越界返回 CHAPTER_LENGTH_OUT_OF_RANGE（或明确记录不做的作者裁决），补越界用例；在 docs/scope.md 立 debt 号并在 docs/fidelity-audit.md 本行引用，重录 proposal.creative 的真实回执覆盖 min/max 拒绝与默认值。 |
| AU-10 | panel.gate-resume | 已关闭：`dsh-mapping.md` 续作偏差行已补 | — |
| AU-11 | panel.confirm | write_next 的 chapterCount（N>1）未复刻；状态 verified 只有 process:panel.confirm 的进程级回执，没有真实 DSH 会话证据 | 给 workflow-start 与 /story-write 增加 chapterCount（缺省 1，strict，int≥1），阶段协议按连续 N 章推进并保留每章审阅停点，补 N>1、重复 start、锁竞争的测试；在真实 DSH 会话里从面板『开始下一章』/ /story-write 走一次并录非 process:* 的 sessionId、命令回执与 workflow-start 文件，替换 artifacts/real-runs/panel.confirm.json；若作者裁决不做 N>1，需在 capability 标题与审计行删掉该语义并记 limitation。 |
| AU-12 | foundation.architect | 四段生成未贴源：审核反馈/修订与导入/同人变体缺失，schema 下限未补偿，init 换档删卡、多写 chapters/index.json、种子状态不校验、英文强制与外部指令引导句都不同 | 1) 为 foundation 建立修订入口（反馈→reviseFrom→writeFoundationFiles('revise')）或在作者裁决后另立能力行；2) 导入/同人变体按源补工具或登记为 v1 外；3) 在四个工具入口补空串/空 roles/空 hook 字段拒绝，补偿 schema 子集不能表达的 minLength/minItems；4) 把 movedRoleCards 限定 revise；5) 裁决 chapters/index.json 与种子状态校验：补 validateHooks 后写入，或登记偏差；6) 补 LANGUAGE OVERRIDE 与外部指令引导句；每项关闭判据=对应拒绝/写入用例+真实回执更新，且 capabilities.yaml 的 source/dsh 字段修正（architect-tool.ts、tools.register 而非 subagents）。 |
| AU-13 | foundation.hooks | 播种路径不做源等价的写前校验；自造且未使用的 TRANSITIONS/transitionHook 与源 reducer 语义相反；mention 过滤与 notes 兜底未登记 | 1) 在 story_foundation_details 播种前对 hooks 状态跑 validateHooks（或在 stateWritesIfMissing 增加保存前校验），使非法 pendingHooks 与源一样不落盘；2) 删除 TRANSITIONS/transitionHook 或改为只实现源 reducer 允许的语义，并把 hooks.test.mjs:48 改成源迁移行为（deferred→resolved 允许、resolved 不能被 defer 改回）；3) mention 按源过滤或登记落盘 delta 的结构偏差；4) notes 缺省按源必填处理；关闭判据=非法播种拒绝用例、迁移用例与源 reducer 对齐、真实回执重录。 |
| AU-14 | foundation.approval | 新增的 foundation 定稿闸门无源行为、无作者裁决、无偏差登记；本行未复刻 pendingProposedAction 的确认-执行语义；退回决定通道为源所无 | 1) 作者裁决：保留 foundation 定稿面则按『源行为（无该闸门）→ DSH 落点（approval/commands/receipt）→ 原因（DSH 无法表达 host 执行 pending action 的授权切换？需给出机制证据）→ 验证』登记 deviation，并修正 capabilities.yaml 的 source（不是 session.ts）或把 PendingProposedAction 的确认-执行并入 panel.confirm/proposal.creative；2) 不保留则移除 story_gate/story_foundation_signoff、/story-approve、/story-reject 与 RESUME_TEXT 中的签核要求，让 workflow start 确认只走 panel.confirm；3) 把『自由文本无执行权』与 actionSource 拒绝作为 panel.confirm 的验收项；关闭判据=偏差行或移除提交 + 更新测试与真实回执（当前回执是 2026-11-04，gate.ts 在 2026-11-05 有重构）。 |
| AU-15 | cast.single-authority | 人物权威的目录覆盖、同名冲突、空卡与上下文格式均未贴源；英文档位目录的卡不计入上下文，唯一权威在就绪判定与模型侧不一致 | 1) readCast/roleCandidates 读四个档位目录（或把 major/minor 迁移/别名成中文目录并拒绝并存），保证『就绪有卡』与『上下文有卡』同一集合；2) 同名跨档位、空卡、读失败的处置按源行为（合并/抛错）复刻，或由作者裁决后登记为偏差并写清源行为→DSH 落点→原因→验证；3) 上下文格式与结尾规则行改贴源 readCharacterContext，或登记为方法注入偏差；4) 补英文作品、英文目录、空卡三类测试与真实回执。关闭判据=上述用例通过且 capabilities.yaml 的 source 从 reference-context.ts 改为 outline-paths.ts/composer.ts 后重录回执。 |
| AU-16 | foundation.control-docs | 章节执行前不补方向文档：源在每个章节执行前 ensureControlDocuments，复刻只有 foundation／truth 写入路径补，章前读取缺文件即空 | 在 plan／write 入口（或 context 装配前）调用 controlDocumentWrites 或 readControlDocs；新增测试：删除 author_intent.md／current_focus.md 后构建 planner／writer 上下文，文件应被补默认模板且上下文包含该模板。 |
| AU-17 | runtime.work-lock | work-lock 旧 lease 的 stale 基准与源不一致：源回退 startedAt，复刻回退文件 mtime | parseLockMetadata 在缺 heartbeatAt 时回退 startedAt（与源一致）；测试覆盖 startedAt 与 mtime 不一致的两个方向（startedAt 旧／mtime 新应 stale，startedAt 新／mtime 旧应不 stale）；重录 process-level 回执。 |
| AU-18 | runtime.stage-context | plan 阶段没有创作方法、chapter-done 结算没有 state-projection 方法、英文作品仍注入中文阶段协议；planner 契约把全部 hook id 当可用集合，且 stage 文本的提示层级与源 user message 不同 | 按源每个角色调用点的 requiredSkillIds 映射阶段→技能：plan 注入 longform-writing（或新建 story-plan 方法）并带 planning 参考，chapter-done 注入 longform-writing 的 state-projection；把 renderStageBase/CHAPTER_REPAIR 做成中英双语并补英文协议用例；删除或收窄「不需要再调用技能工具加载」；planner 的可用 hook id 改为 planner 包/selectedContext 中的集合；把 writer 的 author_intent/current_focus 绑定块放回注入；每项用文本断言 + 真实回执关闭。 |
| AU-19 | plan.retrieval | D22 素材过渡候选仍在 story-memory scope；检索读取用自写校验（hook 重复拒绝、摘要未知字段/非整数章放行）与源 zod strict 不一致；trace 文档 id 命名不同；源 MemorySelection 单入口被拆到 context-select | P6 把素材移出 story-memory（materials scope / search.unified）并补跨 scope 用例；检索入口改用与源等价的 strict schema（拒未知字段、chapter 为 int≥1、title 非空；hook 唯一性按作者裁决）；trace candidates/semanticSelectedIds 使用源 document id；或补一个与源同形的 retrieveMemorySelection 入口承接选择与 trace；重录真实回执覆盖三类型与素材分离。 |
| AU-20 | plan.context-select | D24 book reference 上下文缺失；上一章只取末尾 2000 字且带着 N-1 标题；N-1 摘要未强制进入选择；英文角色目录不参与；入口顺序/reason/trace id 与源不同；上下文包读取不校验 strict schema；多写 planner-context.json | 按源补 reference context（material 读取 + 段选择 + compressible entries + notes）并登记；上一章取全文、去掉 N-1 标题行，补 context-package/stages 断言；semantic 选择强制包含 N-1 摘要；roleCandidates 加 roles/major|minor；按源顺序与 reason 组装，trace id 用源 document id；用 strict schema 校验 context/trace 的读入；planner-context 若保留则登记为复刻产物；重录真实回执覆盖 semantic 子代理分支与带 book reference 的作品。 |
| AU-21 | plan.compression | D26 真压缩没有会话回执；重压一次只在阶段协议文本、宿主不执行；压缩也作用于 planner pass；压缩分块缺 Source id/pointer；缺 onContextCompression 回执；预算派生缺失时静默跳过 | 补一条真实会话回执覆盖 selection→compression→package（小窗口模型或专用夹具），记录 sessionId 与回执；把重压一次做成宿主可验证的下一步（例如 package 返回 recompress 指令或压缩任务），并断言超预算拒绝；与源对齐只对 writer 压缩，或把 planner 压缩登记为偏差；分块输入补 Source id/Source pointer；补压缩进度回执或登记为不可观测；预算不可得时按源记录/报错而不是静默 complete；重录 real-run，并在 docs/dsh-mapping.md 增加压缩编排（非 D25）的偏差行，否则不满足机制等价的门槛。 |
| AU-22 | plan.chapter | plan 阶段缺创作方法、章级作者指令与全文上一章；plan 复用语义与源条件缓存相反；进度按 current_state 而非章节索引；hook id 列表为自创输入 | 1) 恢复/补齐 plan 阶段创作方法注入（craftSkillsFor('plan') 指向长文写作技能或新增规划技能，并用测试断言 plan 阶段上下文含方法正文）；2) 为本章产生并读取章级作者指令（workflow-start.instruction 进 planner「当前用户指令」，或恢复带 instruction 的 start 入口），方法句与段落顺序按源 planner-prompts.ts；3) previous_chapter 改用全文并删掉自创的 prompt 段（或登记为偏差）；4) plan 工具按源 resolveGovernedPlan 语义：有新上下文/新指令时重规划并覆盖、无上下文才 reused，并补「带新指令重规划覆盖 plan.json」用例；5) 进度改用章节索引连续前缀（或把 current_state 口径写进 docs/dsh-mapping.md 并说明分叉后果）；6) 删除 hook id 全量列表或改为只列 governed context 内的 id；7) 同批更新 fidelity-audit.md:376-382 的判定与 dsh-mapping 偏差行。 |
| AU-23 | chapter.write | 草稿写入后阶段停在 write（.drafts 路径不一致）；writer 缺章级用户指令与 min／max 区间回执；D61 标题删除分支不可达 | 统一 draftPath 与 detectStage 的路径（或直接复用 draftPath()），补「story_write_chapter 后 detectStage=review」用例；把 workflow-start.instruction 与 work.metadata.min／max 注入 writer 契约并返回 delivery；修正 scope.md 的 D61 owner 与账本 implementation；D61 随改标题写入路径（import_chapters）关闭。 |
| AU-24 | chapter.review | 修订审稿缺对照来源与 scope 证据校验；审稿失败无 unavailable 回退；一章只能审一次（源可重复审并替换索引观察） | 把修订前 revision 作为第二个编号来源交给审稿子代理，并在 review 工具校验 scope 类 issue 同时引用 before+current（错误码 REVIEW_SCOPE_EVIDENCE_REQUIRED）；实现 review-unavailable 落盘；允许重审（记录版本化或替换并写明语义）；补对照、失败、重审测试。 |
| AU-25 | chapter.revise | 修订缺显式章长区间校验（CHAPTER_LENGTH_OUT_OF_RANGE）与 spot-fix 替换预算冲突（CHAPTER_EDIT_SCOPE_CONFLICT）；更早章修订的复审时点与源不同 | 按 work.metadata.min／max（或条目 lengthTelemetry.target）构造 LengthSpec，在 rewrite 与 spot-fix 候选上校验并返回源错误码；spot-fix 计算 fixedContentLength／replacementBudget，受保护文本超限时返回 CHAPTER_EDIT_SCOPE_CONFLICT；补 rewrite／spot-fix／多段范围测试；在 docs/dsh-mapping.md 登记更早章复审延后。 |
| AU-26 | chapter.settle | 四份状态读取放宽（摘要行未知字段／非整数 chapter 不拒，源 zod strict 拒绝）；work.status 的 draft→active 与源 outlining→active 不一致 | 为四份状态 JSON 补与源等价的 strict schema（拒未知字段、chapter 为 int≥1、标题非空）并在 inspectState／readStateSnapshot 使用，补 corrupt-row 测试；把 work.status 激活条件对齐源或在 runtime.session-binding 登记身份状态差异；重算目标章判定与源差异写进 dsh-mapping。 |
| AU-27 | chapter.reopen | 恢复分支未复刻源 chapter-replace 的 trim／空正文拒绝；恢复新增 artifact revision 仍是未登记偏差 | 在 core/reopen.ts 按源 trim 版本全文并拒绝空正文，补两个失败用例；在 docs/dsh-mapping.md 的 chapter.reopen 偏差行补记恢复同批写 artifact revision 与原子提交。 |
| AU-28 | artifact.identity | artifactId／revisionId 方案、按 checksum 去重、全量 source 文件登记与 manifest 严格校验未贴源；通用 stage／promote 无消费者 | 1) 按源方案生成宿主 artifactId（basename＋路径 hash）与 revisionId（内容 hash），或把 id 方案与可观察影响写进 docs/dsh-mapping.md 偏差行并说明 reviewedArtifact／manifest 的变化；2) chapterArtifactWrite 与 reopen 恢复在 current checksum 相同时不追加 revision，并补「同字节重发布不新增 revision」用例；3) 把基础设定／状态／索引纳入 artifact 登记（或把本行明确缩到 chapter artifact 并把范围差登记为债），并补文件删除时的 superseded／removedAt 行为；4) loadArtifactStore 按源 schema 校验 revision 字段，读取错误补 recovery 负载，把 byteLength 额外校验登记或去掉；5) 让 stage／promote 有产品入口或删除死代码；6) 同批更新 docs/fidelity-audit.md:460-466 的判定与 dsh-mapping 偏差行。 |
| AU-29 | export.work | D57 EPUB 包结构未贴源；导出索引未严格校验；章节文件编号正则收紧为 4 位 | 另立工作项逐模板复刻 EPUB（D57，是否引入打包库届时裁决）；导出改用 readChapterIndexStrict；chapterNumberOf 改回任意位数数字前缀并补失败用例。 |
| AU-30 | backup.restore | 导出文件不回滚（D38 遗留）；create 缺作品存在校验；panel.index 排除与 .drafts 清理未登记为偏差 | 1) 按 docs/scope.md D38 的偿还位置处理导出：恢复时用恢复前 id 删当前导出、恢复后 id 兜底删，作者重新导出，并补「恢复后导出不残留」用例；2) create 前按 work.json／source 判作品存在，空工作区回「没有可备份的作品」并补失败用例（与源 Book Work not found 对齐）；3) 把 panel.index.json 排除与 .drafts 清理写进 docs/dsh-mapping.md 的 backup.restore 偏差行，说明恢复后索引由宿主重建；4) 同批更新 docs/fidelity-audit.md:476-482 的判定与 scope D38 行。 |
| AU-31 | panel.workbench | 面板未复刻源工作台的设置编辑、删书、基础设定重修、章节重写／同步／版本恢复与本章 brief 入口；真值文件编辑仍只读（D39） | 为上述每个动作补宿主命令／提示 + 面板控件 + workbench/client 测试；或由作者裁决为不可见并在 docs/dsh-mapping.md 逐条登记偏差；D39 按 scope.md 的后继面板写通道偿还。 |

| AU-32 | foundation.truth-projections | projection realRun 描述旧写入集，回执过期 | 重录 artifacts/real-runs/foundation.truth-projections.json，按当前写入集记录文件数与真实会话；或在回执中明确旧写入集限制。 |
| AU-33 | runtime.commit-safety | 回滚目录替换语义与源不同 | 对齐源 rm(target,{force:true}) 语义并补目录替换用例，或登记偏差行。 |
| AU-34 | foundation.truth-write | truth 写工具入参/回执与源不同，realRun 早于加锁 | 补 bookId 可选入参与源回执文本，或登记单工作区偏差；重录覆盖加锁后的回执。 |
| AU-35 | chapter.summary | 摘要 title 空白处理与源字节不同；仅 process-level 证据 | 按源保留原始 title 不 trim（或登记偏差并补边界用例）；补真实 DSH 会话回执。 |
