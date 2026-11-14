# DSH 机制映射

记录每项机制在 DSH 上的等价实现与偏差：源工程做法 / 复刻做法 / 原因 / 验证。本文件记录映射设计与偏差，不记录完成状态。

**登记前提**：偏差只有两种合法来源——DSH 机制无法等价，或源行为本身不可观测。能用 DSH 机制等价实现的一律按源行为复刻；「先简化、记一笔」不算合法偏差，算保真债（见 `AGENTS.md`「保真原则」）。

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
| 面板 | 独立前端服务；文件/阶段确认/只读产物 | `client` 插件 + slots；`panel.workbench`（P6）是唯一作品页，承载阶段栏、产物列表、详情与动作条；确认语义仍归 `panel.confirm` | 从会话进入，与对话、轨迹并列；UI 用 React；DSH resource 只能按路径订阅，阶段与产物清单由宿主投影的 `panel.index.json` 提供；面板只读、不触发投影 | 索引驱动渲染；动作经宿主命令/提示；`workbench`/`client`/`panel-projection` 测试 |

## 偏差登记

偏差明细（源做法／复刻做法／原因／验证）归档在 [`../artifacts/implementation-audit/dsh-deviations.md`](../artifacts/implementation-audit/dsh-deviations.md)；本文件只保留机制映射结论，不在正文展开实现过程。
