# DSH 机制映射

记录每项机制在 DSH 上的等价实现与偏差：源工程做法 / 复刻做法 / 原因 / 验证。本文件记录映射设计与偏差，不记录完成状态。

**登记前提**：偏差有三种合法来源——DSH 机制无法等价、源行为本身不可观测，或作者明确裁决的产品决定（记在下方「作者裁决偏差」，不计保真债）。能用 DSH 机制等价实现的一律按源行为复刻；「先简化、记一笔」不算合法偏差，算保真债（见 `AGENTS.md`「保真原则」）。

## 运行形态

- 从 DSH 会话进入，面板与对话、轨迹并列，界面用 React 渲染，接入 `client` 插件与 slots。
- 角色由子代理承担；模型选择由预设／配置提供，代码不绑定 Provider。
- 作品内容以文档形式落盘，可读、可 diff、可直接导出；SQLite 只做索引，一作品一库。一个工作区即一部作品。
- 会话与调用证据留在 DSH session。
- 长任务用 jobs／schedule 调度，不建队列；`story_*` 工具按阶段注册独立 tool schema。

## 映射表

| 机制 | 源工程做法 | 复刻做法 | 原因 | 验证 |
| --- | --- | --- | --- | --- |
| Provider／模型调用 | 自带 provider 与模型路由 | DSH `llm` 服务 | 不重复实现模型接入；模型由预设／配置提供 | 一次角色委派能取得模型回执 |
| Agent 循环 | 自定义 runner 驱动角色 | DSH agent loop + `subagents` | 角色即子代理，循环与上下文由运行时负责 | 一个阶段能派发子代理并收敛结果 |
| CLI | 独立 CLI 进程 | DSH command / headless | 不维护第二套入口与参数解析 | `init`、`export` 各有可执行入口 |
| 会话／事件 | 自建会话与事件存储 | DSH session log | 对话与调用证据留在 session，作品内容另存 | 一次流水线可在 session 中追溯 |
| 作品存储 | 作品内容为落盘文档 | 作品正文与设定落盘为文档，SQLite 只做索引（一作品一库；一个工作区即一部作品） | 正文要可读、可 diff、可直接导出；索引只加速检索，不能成为正文的唯一副本 | 删除索引后能从文档重建；两部作品互不串数据 |
| 调度 | 队列 + worker | DSH jobs／schedule | 长任务用子代理异步执行，不建队列 | 长任务可断点续跑 |
| 技能 | 自有技能目录与加载器 | DSH `skills` 服务：随包 `SKILL.md` 由插件在预设作用域注册（读包内文件，不经文件系统提供者），注册带 `resourceBase` 指向技能目录 | 不自建技能加载层；本组合的宿主 provider 已关，缺什么发现根由预设自己挂；参考文件靠 DSH 的资源基址按需读取 | 写作预设的 agent 看得到随包技能，其它预设看不到；`skill-references.test.mjs` 断言基址与参考文件可读 |
| 方法注入 | 自建 prompt 拼装 | `systemPrompt.context()` | 不在实现里复制方法正文；角色档案整份注入，预算与裁剪留给 `context.brief` | 注入片段可在 trace 中定位 |
| 工具 | 自有工具总线 | `tools.register` | `story_*` 工具按阶段注册独立 schema | 每阶段工具集不同且可校验 |
| 作者确认 | Studio `propose_action` 只确认 workflow start（`create_book`、`write_next` 等 15 项），带 actionPayload／targetSessionKind；确认后 host 执行 | DSH `approval` 服务 + `commands` + `panel.confirm`（P1）；面板/命令/原生确认同一 decision | 原生确认留 `approval/decided` 回执，但与会话权限策略耦合；策略为 `never` 时由面板命令产生回执；plan/write 是 workflow 内部步骤，不逐工具确认 | 无有效回执时不启动 workflow；`panel.confirm` 覆盖 workflow start；`approval.test.mjs` |
| 阶段停点 | 源无“阶段 prompt 自动推进”；workflow start 由作者/命令触发 | `systemPrompt.context()` 只描述当前阶段；阶段完成停下；下一阶段需 workflow start | DSH 阶段上下文是机制落点，不是动作授权 | `runtime.stage-context` 测试；真实回执 |
| 角色提示词 | 源 settler／state-validator 等按角色构造 system prompt，reviser 按模式给约束 | settler／state-validator 折进阶段协议与 craft；reviser 的模式约束未注入（D63） | DSH 的上下文注入按预设／agent 作用域，没有按角色定位子代理的入口 | 协议文本断言；子代理会话回执待补 |
| 阶段数据层级 | 源 worker 调用的 user message 承载章号／指令／governed context／上一章／长度 | 协议与契约进 `systemPrompt.context()`；worker user 消息由主代理委派提示构造 | 会话 system prompt 不能按单次 worker 调用构造；用户消息通道不满足同轮与角色语义 | 阶段文本断言；子代理会话回执待补 |
| 阶段技能分发 | 源按角色分 required／recommended | 复刻按阶段取并集，注入同预设所有 agent | 阶段上下文只有预设／agent 过滤，没有源的角色身份 | `craftSkillsFor` 与 `story:craft` 断言；子代理会话回执待补 |
| 面板 | 独立前端服务；文件/阶段确认/只读产物 | `client` 插件 + slots；`panel.workbench`（P6）是唯一作品页，承载阶段栏、产物列表、详情与动作条；确认语义仍归 `panel.confirm` | 从会话进入，与对话、轨迹并列；UI 用 React；DSH resource 只能按路径订阅，阶段与产物清单由宿主投影的 `panel.index.json` 提供；面板只读、不触发投影 | 索引驱动渲染；动作经宿主命令/提示；`workbench`/`client`/`panel-projection` 测试 |
| 面板投影的写入归属 | 源 Studio 由宿主进程直接提供状态，界面不读派生文件 | 投影由宿主在作品动作内重建：确认、退回、定稿三类动作（含签核的「记录已有效」早退分支与退回分支）在同一作品动作的锁内重建 `panel.index.json` 并报告失败（说明不回滚确认）；其余动作在动作成功后尽力重建，失败保持旧索引 | 复刻的界面读派生文件，状态与投影可能分叉；确认类动作是作者唯一会盯着看结果的地方，必须同一次动作落定并把失败说出来；其余动作按 D64 偿还 | `approval`／`panel-index`／`panel-projection` 测试；真实会话 `session-607ecdcb` 复现了确认后索引未变的旧行为 |
| 人物档案顺序 | 角色卡按目录并发收集，渲染顺序不确定（`Promise.all` 收集四个目录、目录内不排序） | 人物档案按名字码位升序渲染 | 源行为不可观测：没有可比对的确定顺序；排序让上下文可复现 | `cast` 测试的名字排序与同卡用例；回执见 `artifacts/real-runs/cast.single-authority.json` |
| 人物档案坏卡处置 | 物化人物档案时对空卡、读失败、目录读失败、零卡一律抛错（单次触发：foundation 重生成与叙事预测）；章前规划的候选选择对空卡宽容、对读失败抛错 | 候选选择侧四档与源一致；物化侧改为不注入 + `[cast-problem]`，任何动作都不因坏卡被拒 | 源的物化是单次触发，复刻的人物档案由 `systemPrompt.context()` 每步装配，没有对应落点；在提供者里抛错会打断无关对话 | `cast`／`context-package` 用例；回执见 `artifacts/real-runs/cast.single-authority.json`（真实会话部分仍 BLOCKED） |

## 作者裁决偏差

作者明确要求、源工程没有或不同的产品行为；不是保真债，也不是机制偏差。明细与验证入口见 [`../artifacts/implementation-audit/dsh-deviations.md`](../artifacts/implementation-audit/dsh-deviations.md)。

| 决定 | 源工程做法 | 复刻做法 | 作者裁决 | 验证 |
| --- | --- | --- | --- | --- |
| 开章前基础设定确认 | 只检查基础设定完整；`write_next` 一次确认后跑完整章 | 作品级 `foundation-approval.json`（大纲/规则/角色卡摘要）；`/story-write` 每次开章前校验；改了基础设定要重新确认；确认失效只拦下一章，不把已结算章节的阶段轨回退 | 2026-11-15：全书计划确认后才能开章，第 2 卷同样适用；结算事实与确认状态是两件事 | `foundation-approval`／`write-command`／`approval`／`panel-index` 测试；真实回执待补 |
| 正文不进入主会话 | Studio 写作中流式显示 `draft:delta`，正文进作品页 | writer 子代理调 `story_write_chapter` 落盘，只回四行摘要；writer 子会话落盘后不再注入审稿阶段 | 2026-11-15：主会话只给摘要与路径，不显示整章正文 | `stage-context` 测试；真实回执待补 |
| 结算前正文的阅读面 | Studio 写作中在聊天流式显示 `draft:delta`，作者边写边读；作品页章节工作台只列版本 | 正文落盘后，`write`/`review` 阶段在面板出现只读「第 N 章 · 草稿」；结算删除草稿后改为显示已发布章节；主会话只给摘要 | 2026-11-15：正文移出主会话后，结算前必须能在面板读到草稿 | `panel-index`／`workbench` 测试；真实会话回执待补 |
| 首版结算显式确认 | `write_next` 内自动结算，无独立 settle 动作 | 面板「结算本章」+ `/story-settle` 写 `.drafts` 标记；`story_settle_chapter` 无标记拒绝，提交事务消费 | 2026-11-15：结算不能自动，也不能只靠对话语义 | `settle-command`／`chapter-settle`／`panel-index`／`client` 测试；真实回执待补 |
| 读写只留在工作区 | 工具围绕作品目录设计，没有可指向任意绝对路径的通用检索面，也没有「宿主安装在别处」的概念 | 阶段协议通用段（中英）要求一切读写留在当前工作区：工具契约以 schema 与报错为准，不读宿主安装目录与别人的作品目录 | 2026-11-16：写小说的会话不应翻宿主安装目录；约束放在阶段协议，机制事实与拦截取舍见偏差明细 | `stage-context` 测试断言中英通用段；真实会话观察待补 |

## 偏差登记

偏差明细（源做法／复刻做法／原因／验证）归档在 [`../artifacts/implementation-audit/dsh-deviations.md`](../artifacts/implementation-audit/dsh-deviations.md)；本文件只保留机制映射结论，不在正文展开实现过程。
