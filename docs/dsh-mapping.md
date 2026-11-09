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
| 作者确认 | Studio `propose_action` 只确认 workflow start（`create_book`、`write_next` 等 15 项），带 actionPayload／targetSessionKind；确认后 host 执行 | DSH `approval` 服务 + `commands` + `panel.confirm`（P1）；面板/命令/原生确认同一 decision | 原生确认留 `approval/decided` 回执，但与会话权限策略耦合；策略为 `never` 时由面板命令产生回执；plan/write 是 workflow 内部步骤，不逐工具确认 | 无有效回执时不启动 workflow；`panel.confirm` 覆盖 workflow start；`approval.test.mjs` |
| 阶段停点 | 源无“阶段 prompt 自动推进”；workflow start 由作者/命令触发 | `systemPrompt.context()` 只描述当前阶段；阶段完成停下；下一阶段需 workflow start | DSH 阶段上下文是机制等价，不是动作授权 | `runtime.stage-context` 测试；真实回执 |
| 面板 | 独立前端服务；文件/阶段确认/只读产物 | `client` 插件 + slots；`panel.confirm`（P1）与 `panel.workbench`（P6 只读）分开 | 从会话进入，与对话、轨迹并列；UI 用 React；DSH resource 只能按路径订阅，产物清单需要只读索引 | 面板挂载；确认面与只读面不混 |

## 偏差登记

每项偏差按四段记录：源工程做法 / 复刻做法 / 原因 / 验证。相等实现不登记，避免把映射表写第二遍。

### 作者确认：原生确认条与面板命令双通道

- 源工程做法：Studio `propose_action` 生成确认卡，携带 `action`／`targetSessionKind`／`instruction`／`title`／`summary`／`actionPayload`；`write_next` 是 confirmed production intent；确认后 host 用 confirmed binding 执行 workflow start。plan/write/revise 是 workflow 内部步骤，不逐工具确认。
- 复刻做法：会话策略为 `ask` 时用 DSH 原生确认条，回执落在 `approval/asked` 与 `approval/decided`；策略为 `never` 或没有确认端时改由 `/story-approve` 命令产生回执，签核工具只读最近一次决定。`panel.confirm`（P1）承载 workflow start 确认面；`panel.workbench`（P6）只读。
- 原因：出树插件没有自定义 RPC 出口，自造会话事件会让持久化整份拒读；原生确认又与会话权限策略绑死，单一通道在 `danger-full-access` 下恒拒。
- 验证：`packages/see-dsh-novel/test/approval.test.mjs` 覆盖两条通道与各类拒绝；`panel.confirm` 的 workflow start 真机回执；不得把 plan/write 改成逐工具 approval。

### 阶段停点：上下文描述不等于动作授权

- 源工程做法：没有每轮自动推进的阶段 prompt；`book create`／`write_next` 等 workflow start 由作者/命令触发，之后才跑 workflow 内部步骤。
- 复刻做法：`systemPrompt.context()` 注入当前阶段说明；阶段完成必须停下；普通问候/讨论不改作品；下一阶段必须由 workflow start（命令/面板/确认）触发。
- 原因：DSH 的阶段上下文只提供模型上下文，不是授权；把描述当命令会绕过作者确认。
- 验证：`runtime.stage-context` 的测试与真实回执；D28 偿还前，foundation 完成后不得自动 plan/write。

### 面板：确认面与只读工作台分开

- 源工程做法：Studio 的确认卡（动作）与 `TruthFiles`／`ChapterWorkspacePanel`（只读/编辑产物）是不同面。
- 复刻做法：`panel.confirm`（P1）只做 workflow start 确认、拒绝与回执；`panel.workbench`（P6）是只读阶段/产物浏览。DSH `useResource` 只按路径订阅，产物清单由宿主生成只读 `panel.index.json` 投影，从文件重建，不是第二套状态表。
- 原因：确认是授权入口，产物浏览是只读视图；混在一个面板会让“看文件”和“确认动作”混淆。
- 验证：`panel.confirm`／`panel.workbench` 各自测试；面板只读同一证据；索引不含独立状态。


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

### 伏笔 id：记录唯一性由复刻自己校验

- 源工程做法：`HooksStateSchema` 只校验数组形状与单条记录的字段，不要求 `hookId` 在数组内唯一；重复 id 会一起存下来，后续按 id 归并时才隐式覆盖。
- 复刻做法：`validateHooks` 拒绝重复的 `hookId`，报错点名重复的那个 id。
- 原因：复刻的状态读写以 `hookId` 为索引（投影排序、计数、结算合并都按 id 归并），重复 id 会让读到的状态与写入的不一致，且没有可观察的修复点。
- 验证：`packages/see-dsh-novel/test/hooks.test.mjs` 的 `hookId 重复` 用例。

### plan.compression：memory 分组预算按 DSH 子代理输出预留

- 源工程做法：`groupMemoryCandidates` 用 `semanticInputBudget(client,{reservedOutputTokens:2048,promptOverheadTokens:2048})` 分组，选择调用的输出上限是 2048。
- 复刻做法：D25 分组用 `contextWindow - reservedOutputTokens - 3072`；`reservedOutputTokens` 取自模型 `maxTokens`（当前 256k），每个选择任务交给 DSH subagent。
- 原因：DSH subagent 的输出预算由模型 `maxTokens` 决定，不能在调用级设 2048；照搬源的 2048 会让选择请求本身接近 1M 窗口，无法放进模型。分组更保守，选择结果与 candidate 映射不变。
- 验证：`test/context-package.test.mjs` 的 D25 分组用例；`test/context-spool.test.mjs` 的句柄读取；真实运行 `artifacts/real-runs/plan.compression.json` 记录派生窗口与 D26 证据缺口。

### artifact.identity：产物 manifest 独立于作品身份文件

- 源工程做法：`WorkManifest.artifacts` 嵌在作品 manifest 里，`stageArtifactRevision` 同时写 revision 文件与 manifest；章节 revision 的 `path` 由调用方给，指向 `source/chapters/...`，不复制正文。
- 复刻做法：`source/artifacts/manifest.json` 独立记录 `workId`、artifact、revision、current、checksum、byteLength；`writeChapterDocument` 同一次提交写章节文件与该 manifest；章节 revision path 也直接指向章节文件。
- 原因：复刻的 `work.json` 是作品身份文件，产物索引可重建；把 artifacts 混进身份会耦合身份校验与产物状态。DSH 单工作区一作品，跨作品隔离由工作区边界保证。
- 验证：`test/artifact-store.test.mjs` 覆盖 stage/promote/current、checksum、parent、ID/路径；`artifacts/real-runs/artifact.identity.json` 记录 `chapter-0001` 的 r1 current revision 与 `reviewedArtifact`。

### runtime.commands：建书后启动基础设定

- 源工程做法：`book create` 在命令里同步调用 `createBookFoundationTool`，跑完基础设定后打印完成行。
- 复刻做法：`/story-init` 写身份、brief 与方向文档，然后用 `invocation.agent.followup` 投一条基础设定指令；命令立即返回「已启动」，模型在下一轮按 `story_next` 完成 outline／details／角色卡。
- 原因：命令处理器不能同步等待一次模型生成；DSH 的 `Agent.followup` 是启动后续回合的机制。源行为等价点是「一条命令启动基础设定」，完成回执在后续回合。
- 验证：`test/work-command.test.mjs` 覆盖 followup 一次、消息内容/source、init 失败不投、followup 失败回执；真实运行回执在 `artifacts/real-runs/runtime.commands.json`。

### runtime.commands：重新立项的清理范围

- 源工程做法：`book create` 遇到不完整作品目录时 `rm(workDir,{recursive:true})` 后重建；完整作品拒绝。
- 复刻做法：`/story-init` 判六项 foundation 探针；完整拒绝，不完整删除内容根 `source/` 与根 `work.json`，不删工作区根、不碰 `source/` 外文件。
- 原因：DSH 的工作区根就是作品根，不能删除根（会连 `.git` 与作者文件一起删）；用命令拥有的内容根替代 workDir。
- 验证：`test/work-command.test.mjs` 覆盖完整拒绝、清理重建、`source/` 外文件保留、坏 `work.json` 重建；真实运行回执在 `artifacts/real-runs/runtime.commands.json`。

### `/story-init --brief`：简报路径相对工作区根解析

- 源工程做法：CLI `book create --brief <path>` 从进程当前目录读取简报文件。
- 复刻做法：`/story-init --brief <path>` 相对当前工作区根解析，路径必须留在工作区内。
- 原因：DSH 命令没有独立的进程 cwd，命令能拿到的稳定根只有会话工作区；用工作区根解析也让「简报属于作品」这件事可预期。
- 验证：`packages/see-dsh-novel/test/work-command.test.mjs` 的 `--brief` 用例（含 `../x.md` 被拒绝）。
