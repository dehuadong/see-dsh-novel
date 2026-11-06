# Agent Note: runtime.stage-context —— 阶段协议与创作技能的主动注入

Status: implemented

## Problem

技能与资源原来全部被动：模型看到技能目录后自行判断何时加载。两个后果：阶段协议（做什么、按什么顺序调哪些工具、产出什么、约束）被写成技能（`story-plan`、`story-proposal`），模型不加载流程就断；创作方法也靠语义加载，阶段到了不一定注入。

## Decision

`packages/see-dsh-novel/src/pipelines/long/stages/index.ts`：

- `detectStage(root)` 同步读盘判定阶段：无 `work.json` → `proposal`；基础设定六件套不齐 → `foundation`；六件套齐且没有下一章 plan → `plan`；有 plan → `write`；同时返回标题与当前章号；
- `renderStageProtocol(facts)`：每阶段只写做什么、按什么顺序调什么、产出什么、约束是什么；末尾统一注明「创作方法已随上下文提供」；
- `craftSkillsFor(stage)`：`proposal` 注入 `story-proposal`，`foundation`／`write` 注入 `longform-writing`，`plan` 不注入；
- `renderCraft(packageRoot, stage)`：同步读取技能 `SKILL.md` 与 `references/*.md` 并拼接；
- `installStageContext(ctx, packageRoot, presetId)` 注册两个 `systemPrompt.context` 条目：`story:stage`（order 90）与 `story:craft`（order 95），都按 `workingDirectory.get` 同步读当前工作区，且只在本预设下生效；人物档案（order 130）不动。

删除 `skills/story-plan/`（纯流程，协议已迁入阶段注入）。`skills/story-proposal/` 保留为提案方法论（怎么问、何时够、不虚构、不跳过确认），由 `proposal` 阶段主动注入；`skills/longform-writing/` 与 `references/` 原样保留。

服务注入不变（`systemPrompt` 已在注入面内）。

## Alternatives considered

**协议继续留在技能里。** 否掉：语义加载没有保证，流程必须随阶段主动注入。

**用 `skills.get()` 取技能内容。** 否掉：它是异步的，`systemPrompt.context` 的文本提供函数是同步的；技能文件随包分发，同步读与人物档案一致。

**只注入 SKILL.md，references 按需。** 否掉：资源也是被动加载；四份参考文档合计约 10KB，随技能一起注入。

**把创作方法写进阶段协议。** 否掉：协议与方法职责不同；方法留在技能文件，由宿主主动读取。

## Consequences

收益：阶段协议与创作方法都由宿主按阶段节点主动注入，流程不再依赖模型「想起」加载技能；阶段随文件变化即时切换。

验证见 `test/stage-context.test.mjs`（四阶段检测、协议切换、craft 出现/缺席、异预设为空）与 `test/host.test.mjs`（三个 context 条目、技能清单只剩 `longform-writing`）。

代价与已知限制：

- `foundation`／`write` 阶段系统上下文增加约 10KB，`proposal`／`plan` 只多协议约 1–2KB。
- 阶段判定是同步文件探针，可能与 `story_next` 的返回短暂不一致（同一批文件，口径一致）。
- `story-plan` 删除后，模型若仍尝试加载会得到不存在；协议里已写明方法随上下文提供。
