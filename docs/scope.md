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
- **出口**：能力行 `verified` + 不变量 1/2/6；`reviewedArtifact` 与章节 revision 一致；真实回执；D32 的自动复审已由审稿闸门承接；修订事务内的自动重结算归 D59。
- **非目标/债务**：不在每个 write 工具上加 approval；summary/settle 归 P4；修订后的自动重结算归 D59。

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

债之间的依赖：`materials.import` → `search.unified` → D22／D24；章节链的写入与对账已交付（D33／D34 注销），重开/恢复入口与重审写回索引已交付（D36／D58／D45 注销），索引 `lengthTelemetry` 与按章 `tokenUsage` 已交付（D35／D60 注销），残余 D61（标题删除）；修订事务内的自动重结算（D59）随 `chapter.revise` 另立；D38、D23／D54、D57 独立。凭据见 [`fidelity-audit.md`](fidelity-audit.md) 与各能力 Note。

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
| D61 | `chapter.write` 标题变化删 superseded 文件 | 源 `saveChapter` 删除同章号其它 `.md`；复刻没有会改标题的写入路径（结算拒绝已发布章、修订沿用文件名），删除分支不可触发 | `chapter.write` 在改标题能力（导入/重命名）出现时同批实现删除并测试；关闭判据=该路径有测试 |
| D38 | `backup.restore` 导出不回滚 | 源恢复整目录会连 `exports/` 一起回滚；复刻导出在根上且不在作品拥有项内，恢复后导出仍是旧内容 | 恢复时用恢复前 id 删当前导出、恢复后 id 兜底删，作者重新导出 |
| D39 | `panel.workbench` 真值编辑 | 源 `TruthFiles` 有 Edit/Save 与 PUT 落盘；复刻所有产物 `readonly`，作者不能在面板改真值 | 作者裁决 v1 保留只读；后续补面板写通道 |
| D54 | `skill.references` 参考边界 | 源校验越界、符号链接、非文件、512KB、UTF-8 并自动带 references；复刻未复刻失败行为 | 补校验与失败回执 |
| D57 | `export.work` EPUB 包结构 | 源 `epub-gen-memory` 产出 `style.css`、`toc.ncx`／`toc.xhtml`、完整 `content.opf` 元数据（identifier／creator／publisher／date／rights／description／guide）、章文件名 `N_slug.xhtml`、DEFLATE 压缩、`container.xml` 序列化与包级 `xml:lang`；复刻是最小 EPUB3（无 CSS、无 ncx、全 store） | 另立工作项逐模板复刻（是否引入打包库届时裁决） |
| D59 | 修订事务内的自动重结算 | 源在修订时结算修订稿、校验并随章节保存（`runner.ts:999-1042`），复刻的修订只写正文与索引，状态停在旧正文直到作者重算 | `chapter.revise` 把「先出状态增量再落正文」排成一次提交 |

## 边界

交付范围与验收归工作项；能力状态只由 `check-capabilities` 依据证据生成。规则见 [`AGENTS.md`](../AGENTS.md) 的铁律，文档属主见 [`docs/AGENTS.md`](AGENTS.md)。
