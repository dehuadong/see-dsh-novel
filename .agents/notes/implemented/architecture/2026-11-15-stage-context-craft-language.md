# Agent Note: runtime.stage-context —— 阶段创作方法、双语协议与作者方向绑定

Status: implemented

## Problem

2026-11-14 审计把 `runtime.stage-context` 判为保真债 AU-18：注入机制等价（`systemPrompt.context()`），但内容与源工程不一致——plan 没有创作方法、review 缺写作方法、chapter-done 只注入审稿方法而没有结算方法；阶段协议全中文；planner 列出全部 hook id 并把 `brief`／`current_focus`／`author_intent` 拼成指令；writer 把作者方向平铺在已选上下文、把系统默认句当最高优先级；每个阶段还写着一句复刻自创的「不需要再调用技能工具加载」。阶段数据整体放 system context，与源的 worker user message 层级不同。

## Decision

### 阶段→创作方法

`craftSkillsFor(stage)`：

| 阶段 | 技能 |
|---|---|
| proposal | `story-proposal` |
| foundation | `longform-writing` |
| foundation-ready | `longform-writing` |
| plan | `longform-writing` |
| write | `longform-writing` |
| review | `longform-writing` + `story-review` |
| chapter-done | `longform-writing` + `story-review` |

依据源 `workerSkills`（architect／writer 拿 required；auditor／reviser 拿 required + recommended；其它角色为空）、turn 级强制技能与 profile 的 `requiredSkillIds`。注入面是「阶段 × 同预设所有 agent」：子代理继承父预设修订，因此 composer／auditor／settler 会收到同一组技能，也会收到 `story:stage` 协议与当前阶段契约。

### 双语协议与通用句

`StageFacts` 增加 `language`（`detectStage` 从 `work.json` 读取；无 `work.json` 为 `zh`）。`renderStageBase` 分派中文／英文两套文本，英文标题为 `Foundation setup`／`Ready to start`／`Chapter planning`／`Chapter writing`／`Chapter review`／`Chapter complete`，重算块为 `Resettle (recompute)`；proposal 没有作品身份，协议恒中文。通用句改为「本阶段强制注入的创作方法必须使用；其它方法只在确有需要时加载，不要机械加载无关方法」，英文对应。

### planner 契约

删除全部 hook id 列表；当前用户指令只取 `workflow-start` 的 author 来源，不再拼 `brief`／`current_focus`／`author_intent`；三份文件仍由 `plannerGoal` 作为检索目标、由 context package 的固定条目提供。`threadRefs` 不新增校验。

### writer 契约

`author_intent`／`current_focus` 从 `selectedContext` 抽出，渲染「用户方向（优先于模型默认，必须遵循）」块，位置紧跟章级指令；条目格式为 `### 证据 N` + `- 原因:` + `- 细节:`（英文 `### Evidence N` + `- reason:` + `- detail:`）；普通已选上下文同格式，方向条目不再出现在已选上下文。章级指令只取 author 来源，系统默认句不再渲染为最高优先级。`workflowStartInstructionSync` 失去消费者后删除。

### 技能段标题

`renderCraft` 接收语言：中文 `# 创作方法（<skill>）`／`## 参考：<file>`，英文 `# Craft guidance (<skill>)`／`## Reference: <file>`；技能正文与参考读取不变。

### 偏差与相邻债

- 阶段数据层级：源 worker 调用的 user message 放数据；复刻放 `systemPrompt.context()`。原因：会话 system prompt 不能按单次 worker 调用构造，子代理没有源的角色身份；`agent/pre-step`／`subagents.sendMessage`／`session.prompt('queue')` 都不能复刻源的单条 user message 结构。登记在 `artifacts/implementation-audit/dsh-deviations.md` 与 `docs/dsh-mapping.md`。
- 逐角色分发变逐阶段并集：settler 会拿到 `story-review`，composer 子代理会拿到 `longform-writing`，子代理还会收到阶段协议；源的 recommended 在复刻被整段注入并按强制处理。
- 角色提示词折进阶段协议（settler／state-validator）：同一机制约束，单独登记。
- `skill.references` 的 D62（技能正文语言）与 `chapter.revise` 的 D63（reviser 模式说明未注入）不在本行。

## Verification

- `pnpm run verify`：551 tests／550 pass／1 skip；`check-capabilities` 为 59 条能力、verified 45、missing 14；`verify-audit-coverage` 45 个 v1 行均有审计段；`verify-notes` 四线通过。
- 真实会话 `session-abfe5ad6-b1cb-4165-bad0-52feb1c2156e`（cwd `D:\workspace\see-dsh-novel-runtime`，预设 `see-dsh-novel`，中文作品《夜行测试》，1 章／1200 字）从提案→基础设定→规划→正文→审稿→修订→复审→结算发布：
  - seq 12 基础设定、65/97 等待开工、121 章前规划、146/159 正文写作、241/265 章后审阅、176/287 本章完成、375 结算后等待开工；
  - plan 的 `## 当前用户指令` 只有作者 `开始第 1 章`，无 hook id 列表；writer 的 `## 用户方向` 含 current_focus／author_intent 两条证据，位于字数之前；chapter-done 与 review 同时注入 `longform-writing` 与 `story-review`，chapter-done 的 craft 含 `state-projection`；两阶段结算的提案、state-check 与带 validation 提交均成功，第 1 章 1383 字、status active、快照 0/1。
- 英文协议与英文 craft 标题：由文本断言与同一夹具的中英工具名／编号步骤结构对照覆盖；没有英文真实会话（见 Consequences）。
- Implementation Review：Standards 与 Spec 两轴修复后 PASS。
- CI：提交后待 `verify (ubuntu-latest)` 与 `verify (windows-latest)`。

## Alternatives considered

- **只补 plan 与 chapter-done，不补 review／foundation-ready／brief 指令段／writer 默认句。** 否掉：源 `workerSkills` 与 `taskGoal`／`externalContext` 已给出这些事实，属当行补齐。
- **保留「不需要再调用技能工具加载」。** 否掉：源规则是强制必须用、其它按需；预设带 `tool-skill`，这句会挡住确有需要的其它方法。
- **用 `agent/pre-step` 或 `subagents.sendMessage` 复刻 user message 层级。** 否掉：会话 system prompt 不能按单次 worker 调用构造；`pre-step` 无法只对目标 worker 注入，合并会改写主代理委派内容；`sendMessage` 排队或新回合；`queue` 新开作者可见回合。
- **把 hook id 收窄到 context package。** 否掉：源 planner user message 没有列表，收窄会另造集合来源。
- **新建 `story-plan` 技能。** 否掉：`longform-writing` 已含规划参考，源 planner 用同一份技能。
- **技能正文中英双份。** 否掉（本轮）：属于独立内容工作，记 D62。

## Consequences

- 收益：plan／review／chapter-done 有方法；结算拿到 `state-projection`；英文作品得到英文协议与英文 craft 标题；planner 不再凭全量 hook 列表规划；writer 把作者方向当绑定块；阶段文本与源技能规则一致。
- 代价：协议文本两套并行，新增阶段要同时改中英与技能映射；plan／foundation-ready 新增约 10KB 上下文，review／chapter-done 再增约 10KB；plan 的每个 composer 子代理各拿一份。
- 已知限制：英文真实会话未跑（英文协议由文本断言与结构对照覆盖）；技能正文仍是中文（D62）；reviser 模式说明未注入（D63）；settler／state-validator 的角色提示词折进阶段协议（偏差）；源 recommended 被整段注入并强制使用（并集偏差）。
- 旧篇关系：部分取代 [`2026-11-06-runtime-stage-context.md`](./2026-11-06-runtime-stage-context.md)（plan 不注入）、[`2026-11-06-plan-planner-prompt.md`](./2026-11-06-plan-planner-prompt.md)（hook id 列表与指令拼接）、[`2026-11-06-chapter-writer-contract.md`](./2026-11-06-chapter-writer-contract.md)（writer 契约六段）、[`2026-11-10-chapter-revise.md`](./2026-11-10-chapter-revise.md)（chapter-done 只注入 story-review）；与 [`2026-11-14-plan-chapter-inputs.md`](./2026-11-14-plan-chapter-inputs.md)、[`2026-11-14-planner-instruction-reuse.md`](./2026-11-14-planner-instruction-reuse.md) 互链。
