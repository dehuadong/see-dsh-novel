# DSH 机制映射

记录每项机制在 DSH 上的等价实现与偏差：源工程做法 / 复刻做法 / 原因 / 验证。本文件记录映射设计与偏差，不记录完成状态。

**登记前提**：偏差只有两种合法来源——DSH 机制无法等价，或源行为本身不可观测。能用 DSH 机制等价实现的一律按源行为复刻；「先简化、记一笔」不算合法偏差，算保真债（见 `AGENTS.md`「保真原则」）。

## 映射表

| 机制 | 源工程做法 | 复刻做法 | 原因 | 验证 |
| --- | --- | --- | --- | --- |
| Provider／模型调用 | 自带 provider 与模型路由 | DSH `llm` 服务 | 不重复实现模型接入；模型由预设／配置提供 | 一次角色委派能取得模型回执 |
| Agent 循环 | 自定义 runner 驱动角色 | DSH agent loop + `subagents` | 角色即子代理，循环与上下文由运行时负责 | 一个阶段能派发子代理并收敛结果 |
| CLI | 独立 CLI 进程 | DSH command / headless | 不维护第二套入口与参数解析 | `init`、`export` 各有可执行入口 |
| 会话／事件 | 自建会话与事件存储 | DSH session log | 对话与调用证据留在 session，作品内容另存 | 一次流水线可在 session 中追溯 |
| 作品存储 | 作品内容为落盘文档 | 作品正文与设定落盘为文档，SQLite 只做索引（一作品一库；一个工作区即一部作品） | 正文要可读、可 diff、可直接导出；索引只加速检索，不能成为正文的唯一副本 | 删除索引后能从文档重建；两部作品互不串数据 |
| 调度 | 队列 + worker | DSH jobs／schedule | 长任务用子代理异步执行，不建队列 | 长任务可断点续跑 |
| 技能 | 自有技能目录与加载器 | DSH `skills` 服务：随包 `SKILL.md` 由插件在预设作用域注册（读包内文件，不经文件系统提供者） | 不自建技能加载层；本组合的宿主 provider 已关，缺什么发现根由预设自己挂 | 写作预设的 agent 看得到随包技能，其它预设看不到 |
| 方法注入 | 自建 prompt 拼装 | `systemPrompt.context()` | 不在实现里复制方法正文；角色档案整份注入，预算与裁剪留给 `context.brief` | 注入片段可在 trace 中定位 |
| 工具 | 自有工具总线 | `tools.register` | `story_*` 工具按阶段注册独立 schema | 每阶段工具集不同且可校验 |
| 作者确认 | 独立审批 UI，确认与执行分离 | DSH `approval` 服务 + `commands` | 原生确认留 `approval/decided` 回执，但与会话权限策略耦合；策略为 `never` 时由面板命令产生回执 | 无有效回执时签核被拒绝 |
| 面板 | 独立前端服务 | `client` 插件 + slots | 从会话进入，与对话、轨迹并列；UI 用 React | 面板挂载到指定 slot |

## 偏差登记

每项偏差按四段记录：源工程做法 / 复刻做法 / 原因 / 验证。相等实现不登记，避免把映射表写第二遍。

### 作者确认：原生确认条与面板命令双通道

- 源工程做法：独立审批界面，确认由 UI 直接提交，提议与执行分离。
- 复刻做法：会话策略为 `ask` 时用 DSH 原生确认条，回执落在 `approval/asked` 与 `approval/decided`；策略为 `never` 或没有确认端时改由 `/story-approve` 命令产生回执，签核工具只读最近一次决定。
- 原因：出树插件没有自定义 RPC 出口，自造会话事件会让持久化整份拒读；原生确认又与会话权限策略绑死，单一通道在 `danger-full-access` 下恒拒。
- 验证：`packages/see-dsh-novel/test/approval.test.mjs` 覆盖两条通道与各类拒绝；真实运行记录在 `artifacts/real-runs/foundation.approval.json`。

### 就绪判据：角色卡只能由会话路牌数

- 源工程做法：状态接口用 `isBookFoundationComplete` 判断完成——六份文件（作品身份、大纲两份、book rules 两份、伏笔池）加 `story/roles/` 任一目录里的至少一张角色卡。
- 复刻做法：`story_next` 按同一份清单判 `ready`；客户端面板订阅其中的五份设定文件判断「设定齐全」（身份单独判），但不数角色卡。
- 原因：客户端资源通道按路径订阅，没有列目录能力，`story/roles/` 下有什么文件客户端拿不到；因此「≥1 张角色卡」只能由宿主侧判。
- 验证：`packages/see-dsh-novel/test/ready-check.test.mjs` 覆盖七项判据与四个角色目录；`test/host.test.mjs` 覆盖四阶段与 `draft` 的两种下一步；面板测试断言六个文件锚点。

### 控制文档：语言由调用方解析，写入项并入同一次提交

- 源工程做法：`loadControlDocuments(bookId)` 自己读 `book.json` 解析语言并直接落盘；`ensureControlDocuments` 建目录、写默认模板。
- 复刻做法：`controlDocumentWrites(root, language)` 建目录并返回缺失文件的写入项，调用方（三个真值写入工具）用 `projectionLanguage` 解析语言后并入同一次 `commitFoundation`；`readControlDocs(root, language)` 读取前先补默认。
- 原因：core 不读作品身份（语言由管线层解析），且所有真值写入走同一次原子提交，写入项比直接落盘更能保证「要么全成、要么不动」。
- 验证：`packages/see-dsh-novel/test/control-docs.test.mjs` 覆盖目录骨架、只补缺失、中英模板与读取默认；`test/foundation.test.mjs` 断言 outline 与 details 的写入集合包含两份方向文档。
