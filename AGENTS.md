# AGENTS.md — 工作区执行约定

> inkos项目是复刻对象。本项目代码、内容与注释不标注来源、不建立关联：不在代码、注释、prompt 或正文里写"这段来自 inkos 的某文件/某段"这类归属说明；该条**不限制**复用inkos工程的 prompt 文案、方法正文、结构或数据形状；需要复用时按独立项目口径命名与放置，不在实现里标注来源。
> 复刻目标运行时：只用 DSH 原生机制（Skill / Preset / Plugin / Subagent / 文件与 Session 状态），不 import、不运行参考工程代码，不引入其`inkos`源工程的 Provider、Agent 循环、CLI、存储或调度。

## 铁律

1. **一个 PR 只做一个纵向能力**：对应 `capabilities.yaml` 的 `id`，同时包含参考证据 → DSH 落点 → 实现 → 消费者 → 契约测试；缺一项 CI 拒绝。禁止只拆文件／只改文档／只改存储的 PR。
2. **状态只来自证据**：`capabilities.yaml` 的 `status` 只能由 `check-capabilities` 依据测试与真实运行证据生成；人工只能写 `missing`。不建第二套状态表、交付盘点、进度看板、"已实现／已验收"清单。
3. **只用 DSH 运行时**：Provider → DSH `llm`；Agent 循环 → DSH agent loop + `subagents`；CLI → DSH command / headless；存储 → 作品内容落盘为文档，DSH storage/session 或既有 SQLite 只做索引（一作品一库，不新建独立存储服务）；调度 → DSH jobs/schedule；技能 → DSH `skills` 服务 + 文件系统；上下文注入 → DSH `systemPrompt.context()`，不自定义 prompt 拼装层重复方法正文。
4. **状态只有两种**：`missing` 与 `verified`；不设待重验、旧口径等中间状态。能力状态只由第 2 条的证据生成。

## 文档与约定

文档遵循 [`docs/AGENTS.md`](docs/AGENTS.md)：文档分层、位置、职责与写法。

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
