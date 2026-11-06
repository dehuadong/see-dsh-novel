# 产品范围

在 DSH 原生运行时上实现长篇写作流水线：作者从会话进入一部作品，按阶段推进到第 1 章定稿，并能导出与备份。[DSH 机制映射](./dsh-mapping.md)

## v1 范围

只做一条纵向链路，端到端打通：

创意提案 → 立项与初始化 → 基础设定 → 角色权威 → 第 1 章 write / review / revise / summary / settle / finalize → 导出与备份

链路中每一步都是 `capabilities.yaml` 的一行；交付是否成立以该行的证据为准，不以完成度描述为准。

## 交付顺序

按纵向能力推进，一次一个 PR；顺序以账本行序为准，前一行未 `verified` 不跳行。本文只描述范围与顺序，不描述实现是否保真；保真判据、偏差的合法来源与登记位置见 [`AGENTS.md`](../AGENTS.md) 的「保真原则」。

- **P0 运行时骨架**：`runtime.load` + `runtime.agent-tools`（写作预设的工具面：persona、指令、只读文件、联网检索、技能、子代理、ask-user、todo、jobs、上下文压缩；通用写工具不开放，内容写入只走 `story_*`）+ `runtime.client-ui`（面板客户端基线：DSH slots 注册、React/JSX 构建、类型化 slot props、样式安装）+ `runtime.package-check` + `runtime.boundary-check`（打包产物与 DSH 边界的机械校验）。
- **P1 创意提案、立项与基础设定**：
  - 立项：`runtime.session-binding`（一个工作区即一部作品，`work.json` 记身份、预设与语言，面板从会话进入作品）+ `runtime.commands`（至少一条 `init` 入口；`export` 由 P6 的 `export.work` 承担）+ `runtime.telemetry`（每次委派留下 usage／耗时／失败回执）+ `runtime.recovery`（作品索引自检与重建）。
  - 创意提案：`proposal.creative`（对话收敛创意，只问缺的关键信息；结构化提案携带标题／题材／平台／语言／章数／单章字数与卡片文案；确认后按确认参数创建作品）。
  - 确认后继续：`panel.gate-resume`（作者在面板认可之后，把「继续」投回会话，agent 复核回执再接着干；退回是停止信号，不唤醒）。
  - 立项后开工：`panel.foundation-start`（「已立项，还没有基础设定」状态给出「开始基础设定」，一键把开工指令投回会话，agent 起一轮写设定）。
  - 基础设定：`foundation.architect` + `foundation.hooks` + `foundation.approval` + `cast.single-authority`。
  - P1 保真债（复审发现，按行序补齐后才进入 P2）：`foundation.rule-contract`（book_rules 的版本与严格读取）+ `foundation.ready-check`（五段齐全且至少一张角色卡）+ `foundation.truth-projections`（三份 truth 投影）+ `foundation.control-docs`（author_intent／current_focus／brief 的播种与读取）+ `foundation.truth-write`（真值文件替换写入：方向文档、状态真值、book rules、outline 与角色卡）+ `foundation.hook-ledger`（dependsOn／paysOffInArc 字段与严格校验）+ `runtime.commit-safety`（路径包含、串行化、失败保留日志）+ `runtime.work-lock`（跨进程作品锁）+ `runtime.txn-format`（事务目录、日志字段、rename 备份与 committed 阶段）+ `proposal.execution-brief`（instruction 与默认规模）。这些行补的是源工程已有、复刻侧缺失或放宽的行为，不是新能力。
- **P2 章前规划**：`plan.retrieval` + `plan.context-select` + `plan.compression` + `plan.chapter`。检索用源工程的 FTS5/BM25，上下文用四个 LLM 选择器与 ChapterTrace 七字段，超预算走 LLM 压缩；`plan.chapter` 只负责 planner 提示词、memo 与 governed plan 落盘，消费前三层。源工程第 3、4 层提示词在此落地：`plan.chapter` 同时交付 planner 的方法 prompt 与章前上下文装配，`context.brief` 负责每轮上下文包的字段与装配时机。
- **P3 正文生产**：`chapter.write` + `chapter.review` + `chapter.revise`。`chapter.write` 交付 writer 的方法 prompt 与场景／篇幅预算，`chapter.review`／`chapter.revise` 各自交付对应角色方法。
- **P4 结算与定稿**：`chapter.summary` + `chapter.settle` + `chapter.finalize`。`chapter.settle` 交付 settler 的方法 prompt，以及伏笔六动作的合并规则（提及与延后不推进、撤回需要依据）。
- **P5 章节运维与对账**：`chapter.reopen` + `chapter.move-delete` + `state.check`。
- **P6 产物与工作台**：`artifact.identity` + `export.work` + `backup.restore` + `materials.import` + `search.unified` + `panel.*`。
- **P7 短篇流水线**：`short.*`，v1 之后独立推进。
- **P8 剧本流水线**：`script.*`，v1 之后独立推进。
- **P9 补强（v1 之后）**：`radar.topic` + `forecast.plot`——提案阶段的选题雷达与剧情预演，产出方向候选与非正式草案，不改作品事实。

阶段只表达交付顺序，不表达状态；状态仍只来自账本证据。排序依据是源工程的长篇流水线阶段链：创意提案（无作品时的对话，结构化提案 + 确认卡）→ 立项（书配置与作品身份）→ 基础设定（四段设定 + 控制文档 + 初始快照）→ 每章（规划 memo → 装配上下文 → 初稿 → 审阅观察 → 修订 → 落盘 → 结算真相文件 → 校验）→ 定稿与快照 → 导出与备份。

P1 的前四行是内容生成的前提，不是「就近补齐」的附属项：源工程先 `init` 建项目、再 `book create` 生成 `works/<id>/work.json` 并推导 bookId，之后才写 foundation——作品先有身份，才谈写什么。本项目把多作品目录简化成「一个工作区即一部作品」，身份仍以 `work.json` 落在工作区根，`work.json` 同时替代源工程里 `works/<id>/work.json` 的身份、预设与导出边界三项职责。

两处已知的次序偏差：

- `foundation.*` 与 `cast.single-authority` 在 P1 前置行之前就已交付并 `verified`。账本行序仍是推进顺序——`runtime.*` 组剩余行补齐后才进 P2；这条历史事实不改写已验证的状态。
- 源工程在基础设定结束时就建初始快照，`artifact.identity` 属于早期能力；本项目把它排在 P6，意味着 P6 之前没有 revision 身份。v1 只有第 1 章、不做历史修订，因此可以接受；一旦要支持历史章节修订，`artifact.identity` 必须先于 P2 交付。

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

## 边界

交付范围与验收归工作项；能力状态只由 `check-capabilities` 依据证据生成。规则见 [`AGENTS.md`](../AGENTS.md) 的铁律，文档属主见 [`docs/AGENTS.md`](AGENTS.md)。
