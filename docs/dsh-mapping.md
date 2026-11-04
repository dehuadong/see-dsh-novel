# DSH 机制映射

记录每项机制在 DSH 上的等价实现与偏差：参考做法 / 我们的做法 / 原因 / 验证。本文件记录映射设计与偏差，不记录完成状态。

## 映射表

| 机制 | 参考做法 | 我们的做法 | 原因 | 验证 |
| --- | --- | --- | --- | --- |
| Provider／模型调用 | 自带 provider 与模型路由 | DSH `llm` 服务 | 不重复实现模型接入；模型由预设／配置提供 | 一次角色委派能取得模型回执 |
| Agent 循环 | 自定义 runner 驱动角色 | DSH agent loop + `subagents` | 角色即子代理，循环与上下文由运行时负责 | 一个阶段能派发子代理并收敛结果 |
| CLI | 独立 CLI 进程 | DSH command / headless | 不维护第二套入口与参数解析 | `init`、`export` 各有可执行入口 |
| 会话／事件 | 自建会话与事件存储 | DSH session log | 对话与调用证据留在 session，作品内容另存 | 一次流水线可在 session 中追溯 |
| 作品存储 | 作品内容为落盘文档 | 作品正文与设定落盘为文档，SQLite 只做索引（一作品一库；一个工作区即一部作品） | 正文要可读、可 diff、可直接导出；索引只加速检索，不能成为正文的唯一副本 | 删除索引后能从文档重建；两部作品互不串数据 |
| 调度 | 队列 + worker | DSH jobs／schedule | 长任务用子代理异步执行，不建队列 | 长任务可断点续跑 |
| 技能 | 自有技能目录与加载器 | DSH `skills` 服务 + 文件系统 | SKILL.md + references 由运行时加载 | 技能能按角色／动作激活 |
| 方法注入 | 自建 prompt 拼装 | `systemPrompt.context()` | 不在实现里复制方法正文，只注入受预算约束的片段 | 注入片段可在 trace 中定位 |
| 工具 | 自有工具总线 | `tools.register` | `story_*` 工具按阶段注册独立 schema | 每阶段工具集不同且可校验 |
| 作者确认 | 独立审批 UI，确认与执行分离 | DSH `approval` 服务 + `commands` | 原生确认留 `approval/decided` 回执，但与会话权限策略耦合；策略为 `never` 时由面板命令产生回执 | 无有效回执时签核被拒绝 |
| 面板 | 独立前端服务 | `client` 插件 + slots | 从会话进入，与对话、轨迹并列；UI 用 React | 面板挂载到指定 slot |

## 偏差登记

每项偏差按四段记录：参考做法 / 我们的做法 / 原因 / 验证。相等实现不登记，避免把映射表写第二遍。

### 作者确认：原生确认条与面板命令双通道

- 参考做法：独立审批界面，确认由 UI 直接提交，提议与执行分离。
- 我们的做法：会话策略为 `ask` 时用 DSH 原生确认条，回执落在 `approval/asked` 与 `approval/decided`；策略为 `never` 或没有确认端时改由 `/story-approve` 命令产生回执，签核工具只读最近一次决定。
- 原因：出树插件没有自定义 RPC 出口，自造会话事件会让持久化整份拒读；原生确认又与会话权限策略绑死，单一通道在 `danger-full-access` 下恒拒。
- 验证：`packages/see-dsh-novel/test/approval.test.mjs` 覆盖两条通道与各类拒绝；真实运行记录在 `artifacts/real-runs/foundation.approval.json`。
