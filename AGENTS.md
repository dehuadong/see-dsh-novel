# AGENTS.md — 工作区执行约定

> **源工程**是 `inkos/`：本项目是在 DSH 上对它的**高保真复刻**，不是另做一个同级实现。默认必须复刻源工程的行为；只有 DSH 机制无法等价、或源行为本身不可观测时才允许偏差，且必须登记（见「保真原则」）。
> 复刻时不在代码、注释、prompt 或正文里写来源归属（"这段来自 inkos 的某文件/某段"）；该条**不限制**复用源工程的 prompt 文案、方法正文、结构或数据形状——复用时按独立项目口径命名与放置，不标注来源。
> 复刻目标运行时：只用 DSH 原生机制（Skill / Preset / Plugin / Subagent / 文件与 Session 状态），不 import、不运行源工程代码，不引入其 Provider、Agent 循环、CLI、存储或调度。

## 保真原则

- 术语：`inkos/` 是**源工程**，本仓库是**复刻**；不叫「参考工程」。
- **行为等价优先于「能跑」**：每一行能力都对应源工程的一个纵向能力，判定标准是行为是否一致，不是测试是否通过。
- **偏差只有两种合法来源**：DSH 机制强制（证据留在 session、确认走 approval、面板走 client 插件等），或源行为不可观测。两者都要写进 [`docs/dsh-mapping.md`](docs/dsh-mapping.md) 的「偏差登记」，格式是「源行为 → DSH 落点 → 原因 → 验证」。
- **不得以简化代替复刻**：缺字段、缺文件、放宽校验、把一段流程合并或拆分，都算**保真债**，必须当行补齐或记入 [`docs/scope.md`](docs/scope.md) 的后续阶段，不允许以「已记录」当作已合理。
- 账本的 `source:` 字段记**源工程证据位置**（`inkos:…` 模块路径），不叫 reference。

## 铁律

1. **一个 PR 只做一个纵向能力**：对应 `capabilities.yaml` 的 `id`，同时包含源工程证据 → DSH 落点 → 实现 → 消费者 → 契约测试；缺一项 CI 拒绝。禁止只拆文件／只改文档／只改存储的 PR。
2. **状态只来自证据**：`capabilities.yaml` 的 `status` 只能由 `check-capabilities` 依据测试与真实运行证据生成；人工只能写 `missing`。不建第二套状态表、交付盘点、进度看板、"已实现／已验收"清单。
3. **只用 DSH 运行时**：Provider → DSH `llm`；Agent 循环 → DSH agent loop + `subagents`；CLI → DSH command / headless；存储 → 作品内容落盘为文档，DSH storage/session 或既有 SQLite 只做索引（一作品一库，不新建独立存储服务）；调度 → DSH jobs/schedule；技能 → DSH `skills` 服务 + 文件系统；上下文注入 → DSH `systemPrompt.context()`，不自定义 prompt 拼装层重复方法正文。
4. **状态只有两种**：`missing` 与 `verified`；不设待重验、旧口径等中间状态。能力状态只由第 2 条的证据生成。

## 文档资源与约定

- 文档遵循 [`docs/AGENTS.md`](docs/AGENTS.md)：文档分层、位置、职责与写法。

- InkOS 仓库分析研究文档 `docs\report\inkos\readme.md`；源工程地址`inkos/`

## DSH 插件与预设

在开发deepseek-harness 插件时遇到问题可参阅deepseek-harness官方源码工程包 `deepseek-harness/packages`（仓库根下的目录联接）
DSH UI设计判断参考`deepseek-harness/docs/ui-design-review-cases.zh.md`
Web UI 样式参考`deepseek-harness/docs/web-styling.zh.md`
DSH  UI统一圆角规范`deepseek-harness/docs/ui-radius.zh.md`

## 工程工作流 

工程任务从 Discuss 开始。

### Discuss


使用 Discuss 理解问题，结合现有代码、文档、历史决策、已接受的 ADR/RFC 和项目约束形成解决方案，并消除足够的歧义，以判断下一阶段。

讨论不是被动访谈。优先自行分析已有项目上下文，而不是把可判断的问题交给用户。

讨论过程中：

- 明确实际问题、约束和相关既有决策
- 提出有实质差异的可行方案，并在依据充分时给出推荐
- 说明关键权衡、风险和影响
- 发现假设与现有事实或决策冲突时，明确指出
- 仅在缺少必要信息，或涉及未决的产品、业务、范围、兼容性、成本、风险及其他价值判断时，请求用户裁决

不要要求用户重复已有信息，也不要求在 Discuss 中确定所有实现细节。

在以下情况下继续停留在 Discuss：

- 工作仍处于探索阶段
- 仍在比较重要的备选方案
- 用户当前只是寻求理解，而不是准备推进
- 目标或选定范围尚不足以形成实施合同

不要仅因为正在讨论产品、技术或架构决策，就创建规划产物。

若可以判断讨论已经足够成熟，并说明已解决事项、剩余未决事项和建议的下一阶段，但不能仅凭自身判断离开 Discuss。

何时从 Discuss 进入 Planning 或 Implementation Gate，由用户决定。若用户此前的请求已经明确授权推进，则复用该授权。

讨论后推进、直接收到阶段请求或恢复工程工作时，读取并按 `docs/agents/GATES.md` 的 Steps、授权与返回规则执行；具体工作方法由对应技能负责。

任务汇报之后，提示用户输入下一步门禁指令（以 `docs/agents/GATES.md` 为准）：


- 收到 `批准，使用技能 planning 执行规划 {工作项}` 时加载 `planning`，完成规划及必要评审后回到 Discuss。
- 收到 `批准，使用技能 implement 执行实现 {工作项}` 时加载 `implement`。若关键合同仍未解决，指出 blocker 并建议先 `planning`，不自行进入规划。

执行授权仅适用于**当前工单已确认范围的实施工作**，并覆盖该工作内部连续发生的：

- 实施
- Implementation Review
- 范围内修正
- Verify

这些阶段之间不需要重复请求执行授权。

文档和仓库治理工作可以绕过该工程工作流；涉及重要产品、技术、架构或其他工程合同变化时，仍遵守 GATES 门控规则。

### Triage labels

议题分诊使用 `needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix` 五个角色标签；映射见 [`docs/agents/triage-labels.md`](docs/agents/triage-labels.md)。本项目未配置 Issue 跟踪器，工作项由当前任务/对话承载。

### Document ownership

- 文档入口：[`docs/AGENTS.md`](docs/AGENTS.md)；各类文档的属主、位置与适用范围以其中归属配置为准。
- 领域文档：单上下文，根目录 `GLOSSARY.md`（当前不存在，术语收敛时建立）；术语与决定消费规则见 [`docs/agents/domain.md`](docs/agents/domain.md)。
- Agent Note：格式与生命周期遵循 `write-agent-notes` Skill，记录根为 `.agents/notes/`。

登记的路径一律从仓库管理根（本目录）解析，在子目录中工作也相同。

## 重要改动必须留笔记

1. 非平凡改动（改了行为、架构、跨文件契约、流程与工具链、测试策略、落盘/网络/配置格式）前，遵循 `write-agent-notes` Skill 写或更新笔记；机械性小改（样式、格式化、打标、不改行为的补丁）直接提交。
2. 写之前先检索 .agents/notes/ 里的同主题旧笔记：有归属就地更新；新想法先放 proposed/，落地随同代码改动转 implemented/；新方案彻底取代旧决策时，同批归档旧篇并标明被谁取代。
3. 被放弃的方案先写它最强的理由，再解释为什么不用。
4. 提交前跑 npm run verify-notes，红了先修再交。
