# AGENTS.md — 工作区执行约定

> **源工程**是 `inkos/`：本项目是在 DSH 上对它的**高保真复刻**，不是另做一个同级实现。默认必须复刻源工程的行为；只有 DSH 机制无法等价、或源行为本身不可观测时才允许偏差，且必须登记（见「保真原则」）。


## 保真原则

- 术语：`inkos/` 是**源工程**，本仓库是**复刻**；不叫「参考工程」。
- **行为等价优先于「能跑」**：每一行能力都对应源工程的一个纵向能力，判定标准是行为是否一致，不是测试是否通过。
- **偏差只有两种合法来源**：DSH 机制强制（证据留在 session、确认走 approval、面板走 client 插件等），或源行为不可观测。两者都要写进 [`docs/dsh-mapping.md`](docs/dsh-mapping.md) 的「偏差登记」，格式是「源行为 → DSH 落点 → 原因 → 验证」。
- **不得以简化代替复刻**：缺字段、缺文件、放宽校验、把一段流程合并或拆分，都算**保真债**，必须当行补齐或记入 [`docs/scope.md`](docs/scope.md) 的后续阶段，不允许以「已记录」当作已合理。
- 账本的 `source:` 字段记**源工程证据位置**（`inkos:…` 模块路径），不叫 reference。

### 保真工作法
- 只使用本 Harness 的 Skill、Preset、Plugin、Subagent、文件与 Session 状态；不引入 LLM Provider、独立 Harness/SDK、资源管理服务或额外子 Agent 运行时。
- **源工程行为是规格**：`inkos/` 的产品结构、产物、顺序、错误与拒绝行为按原样复刻；结构差异必须写进 `docs/dsh-mapping.md` 的偏差行并裁决，未登记的偏差视为越界。其运行时机制（Provider、Agent 循环、CLI、存储、调度）逐项整改为 DSH 的运行机制，用 Skill/Preset/Plugin/Subagent/文件状态等价实现；不 import、不运行 inkos 的代码，也不引入它自带的运行时。DSH 缺少的机制不得删能力，必须给出等价实现并登记验证。
- **不得自创产品限制**：数量上限、白名单、格式限制等，源工程没有、作者也未裁决的，不得写进合同或校验；工程预算问题只能在消费层（选择、截断）解决。
- 本项目代码、内容与注释不标注来源、不建立关联：不在代码、注释、prompt 或正文里写"这段来自 inkos 的某文件/某段"这类归属说明；源工程证据的位置只写在 `capabilities.yaml` 的 `reference` 字段、`docs/dsh-mapping.md` 与工作项。该条**不限制**复用源工程的 prompt 文案、方法正文、结构或数据形状；复用时按独立项目口径命名与放置，不在实现里标注来源。
- 保真的记忆不靠对话：规则记在本文件，机制对照与偏差记在 `docs/dsh-mapping.md`，能力映射记在 `capabilities.yaml`，决定记在工作项/Note，验证记在 tests/CI；当前状态只以 CI 与真实会话证据为准。
- 遇到实现、流程、节点或验收问题时，**先查源工程如何实现**：读它的源码、文档、CI、技能、角色资源与测试，再决定复刻做法；不得先改提示词或凭直觉自创。
- **提案必须带源工程证据**：工作项或设计 Note 必须有“源工程证据”段，写清 `inkos` 的证据位置（文件、类型、流程或测试）及其行为；再写复刻做法与裁决（行为等价 / 机制等价 / 不可观测）。没有可对照行为时，写“源行为不可观测”、检索范围和理由。不得只用“超出范围/成本高”作为不采用理由。改变结构时，还必须给出偏差行（源工程做法 / 复刻做法 / 原因 / 验证）；没有偏差行的结构变化不得进入实现。
- 每次保真先提取可验证的不变量；再写“源工程证据 / 复刻落点 / 偏差原因 / 验证命令”。偏差原因只能是 DSH 机制无法等价或源行为不可观测；其余差异登记为保真债。
- 缺字段、缺产物、缺消费者、放宽校验不是“偏差”，是保真债；必须指出偿还路径或阻塞证据，不能因为已登记就视为完成。
- **阶段出口不只看单行 `verified`**：按 [`docs/scope.md`](docs/scope.md) 的阶段合同与 [`docs/fidelity-audit.md`](docs/fidelity-audit.md) 的横向不变量检查；上一阶段未通过不进入下一阶段。`capabilities.yaml` 仍是唯一状态表。
- 新发现先更新 `docs/dsh-mapping.md` 或对应能力行，再决定是否立工作项；不要把聊天里的分析当成已完成的保真证据，也不新建手写状态表。

## 铁律

1. **一个 PR 只做一个纵向能力**：对应 `capabilities.yaml` 的 `id`，同时包含源工程证据 → DSH 落点 → 实现 → 消费者 → 契约测试；缺一项 CI 拒绝。禁止只拆文件／只改文档／只改存储的 PR。
2. **状态只来自证据**：`capabilities.yaml` 的 `status` 只能由 `check-capabilities` 依据测试与真实运行证据生成；人工只能写 `missing`。不建第二套状态表、交付盘点、进度看板、"已实现／已验收"清单。
3. **只用 DSH 运行时**：Provider → DSH `llm`；Agent 循环 → DSH agent loop + `subagents`；CLI → DSH command / headless；存储 → 作品内容落盘为文档，DSH storage/session 或既有 SQLite 只做索引（一作品一库，不新建独立存储服务）；调度 → DSH jobs/schedule；技能 → DSH `skills` 服务 + 文件系统；上下文注入 → DSH `systemPrompt.context()`，不自定义 prompt 拼装层重复方法正文。
4. **状态只有两种**：`missing` 与 `verified`；不设待重验、旧口径等中间状态。能力状态只由第 2 条的证据生成。

## 技能与阶段上下文

- **技能 = 创作方法**：人物、场景、节奏、类型手法、参考文档。技能里不写工具、命令、脚本调用顺序或阶段流程。
- **技能加载 = 主动**：宿主按阶段节点决定本阶段加载哪份技能，并通过 `systemPrompt.context()` 把技能正文与资源注入当前上下文；不依赖模型按语义自行判断何时加载。
- **阶段协议不是技能**：某阶段做什么、按什么顺序调用哪些工具/命令、产出什么、约束是什么，由宿主按阶段节点注入；不得写成技能，也不得依赖模型碰巧读取。
- **阶段节点由工作区状态判定**（`story_next`／探针），协议与技能随阶段切换；上下文注入统一走 `systemPrompt.context()`，不另建 prompt 拼装层。
- **新增或修改技能时的检查**：内容若描述「先调什么、再调什么、产出到哪」，它属于阶段协议，移到阶段注入；技能只保留「怎么写」。

## 任务完成前

每次非平凡改动提交前，同一批更新以下六处；缺任何一处都算未完成：

1. **笔记**：`proposed/` 的对应篇转 `implemented/`（或删除／归档被取代篇），入站链接改完，`pnpm run verify-notes` 通过；
2. **账本**：`capabilities.yaml` 的 implementation／consumer／realRun 指向当前证据，跑 `pnpm run check-capabilities -- --write`；行为变化过的行必须重录 `artifacts/real-runs/<id>.json`，旧回执不得继续描述新行为；
3. **审计**：`docs/fidelity-audit.md` 的该行判定（等价／机制等价／保真债）与债号同步；
4. **范围**：`docs/scope.md` 的保真债表增删该行的债，债号与审计一致；
5. **偏差**：仅「机制等价」需要 `docs/dsh-mapping.md` 的偏差行，格式为源行为 → DSH 落点 → 原因 → 验证；
6. **CI**：推送后确认 `verify (ubuntu-latest)` 与 `verify (windows-latest)` 两个 job 通过。

## 文档资源与约定

- 文档遵循 [`docs/AGENTS.md`](docs/AGENTS.md)：文档分层、位置、职责与写法。

- InkOS 仓库分析研究文档 `docs\report\inkos\readme.md`；源工程地址`inkos/`

## DSH 插件与预设
`dsh-doc` skill：涉及 DSH 插件/slot/tool 机制时查本机 DSH 事实。
在开发deepseek-harness 插件时遇到问题可参阅deepseek-harness官方源码工程包 `deepseek-harness/packages`（仓库根下的目录联接）
DSH UI设计判断参考`deepseek-harness/docs/ui-design-review-cases.zh.md`
Web UI 样式参考`deepseek-harness/docs/web-styling.zh.md`
DSH  UI统一圆角规范`deepseek-harness/docs/ui-radius.zh.md`
本地装包、验证与已知限制见 [`docs/plugin-local-install.md`](docs/plugin-local-install.md)

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


- 收到 `/planning 批准，执行规划 {工作项}` 时加载 `planning`，完成规划及必要评审后回到 Discuss。
- 收到 `/implement 批准，执行实现 {工作项}` 时加载 `implement`。若关键合同仍未解决，指出 blocker 并建议先 `planning`，不自行进入规划。

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
