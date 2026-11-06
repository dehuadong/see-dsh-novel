# Agent Note: runtime.stage-context —— 阶段协议与创作技能的主动注入

Status: proposed

## Problem

技能与资源现在全部被动：模型看到技能目录后自行判断何时加载。由此有两个错误：

- 阶段协议（当前阶段做什么、按什么顺序调用哪些脚本/工具/命令、产出什么、约束是什么）被写成了技能——`story-plan`、`story-proposal` 都是流程，不是创作方法；模型不加载，流程就断（P2 真机已出现过工具未挂载、技能未读的会话）；
- 创作方法（怎么写人物、场景、节奏）也靠语义加载，阶段到了却不保证注入，写作质量取决于模型是否想起要读技能。

阶段节点已经存在（`story_next` 的 `unbound／foundation／ready／draft`），但没有地方按阶段主动装配内容。

## Proposal

### 阶段判定

`src/pipelines/long/stages/detect.ts`：同步读盘（`systemPrompt.context` 的文本提供函数是同步的），按以下顺序判定：

- 无 `work.json` → `proposal`；
- 有 work 但基础设定六件套不齐 → `foundation`；
- 六件套齐、没有 `source/story/runtime/chapter-0001.plan.json` → `plan`；
- 已有该章 plan → `write`（本章规划完成，进入写作）。

判定与 `story_next` 的口径一致；两者读同一批文件，不改 `story_next` 的返回。

### 阶段协议（主动）

`src/pipelines/long/stages/protocols.ts`：每阶段一段协议文本，只写「做什么、按什么顺序调什么、产出什么、约束是什么」：

- `proposal`：访谈要问什么、够了几句话就提案、确认/退回/取消后的动作；来自原 `story-proposal` 技能的流程部分；
- `foundation`：四段基础设定（outline／details／cast_index／cards）的顺序、每段的工具与产出、签核门禁；
- `plan`：`story_context_candidates` → 原生 `subagent` 选择 → `story_context_package` → 写 memo → `story_plan_chapter` 的顺序，以及「只规划下一章」「不覆盖已有章纲」；
- `write`：加载创作方法、派发 writer `subagent`、用 `story_write_chapter` 落盘、字数只报告不拒绝；来自原 `story-plan` 技能里与写作衔接的部分。

协议文本不复制创作方法正文。

### 创作技能（主动）

`src/pipelines/long/stages/craft.ts`：阶段声明需要的创作技能：

- `foundation` 与 `write` → `longform-writing`；
- `proposal`、`plan` → 不注入创作技能（这两段不是写正文）。

注入内容为 `skills/longform-writing/SKILL.md` 的正文 + `references/` 下全部参考文档（当前四份，合计约 10KB），每份带标题；`plan`／`proposal` 阶段不出现。

### 注册

`installStageContext(ctx, packageRoot)` 注册两个 `systemPrompt.context` 条目：

- `story:stage`（order 90，required）：阶段协议 + 「本阶段的创作技能已随上下文提供，不需要再调用技能工具」；
- `story:craft`（order 95，required）：当前阶段的创作方法正文（无则返回空串）。

两者都在每次装配时同步读盘，阶段随文件变化即时切换；人物档案（order 130）保持不动。

### 删除

- 删除 `skills/story-plan/` 与 `skills/story-proposal/`（协议已迁入 stages）；
- `skills/longform-writing/` 与 `references/` 保持原样，只承载创作方法。

## Alternatives considered

**继续把协议留在技能里，只加大描述。** 否掉：语义加载没有保证，协议必须随阶段注入。

**用 `skills.get()` 主动取技能内容。** 更「官方」。否掉：`skills.get` 是异步的，`systemPrompt.context` 的文本提供函数是同步的；技能文件随包分发，同步读文件与人物档案的读法一致。

**把创作方法也塞进阶段协议。** 否掉：协议与方法职责不同；方法仍放在技能文件里，只是由宿主主动读取注入。

**只注入 `SKILL.md`，`references/` 继续按需。** 否掉：资源同样是被动加载；四份参考文档很小，随技能一起注入。

## Acceptance criteria

- `detectStage` 在无 work／基础设定缺件／基础设定齐无 plan／有 plan 四种工作区分别返回 `proposal`／`foundation`／`plan`／`write`。
- `story:stage` 的文本随阶段变化：`proposal` 含「提案」与「确认卡」；`plan` 含 `story_context_candidates` 与 `story_plan_chapter`；`write` 含 `story_write_chapter`；`foundation` 含四段顺序。
- `story:craft` 在 `foundation`／`write` 含 `longform-writing` 的正文标题与四份 references 的标题；在 `proposal`／`plan` 返回空串。
- 技能目录只剩 `longform-writing`；`story-plan`／`story-proposal` 不再注册。
- 测试：`test/stage-context.test.mjs` 覆盖四个阶段、craft 的出现/缺席、同步读盘随文件变化；`test/agent-tools.test.mjs`／`test/host.test.mjs` 的技能清单更新。
- 实现与证据：implementation `packages/see-dsh-novel/src/pipelines/long/stages/`；consumer `packages/see-dsh-novel/test/stage-context.test.mjs`；realRun `artifacts/real-runs/runtime.stage-context.json`。
- 真实运行：在两个工作区（无 work 的 `.artifacts/work-init` 与新作品）各开一个会话，不主动调用技能工具，确认模型第一轮就按注入的协议执行（引用了协议里的工具与顺序）。

## Risks

- 阶段协议每轮占用上下文（约 1–2KB），比纯被动加载多；换来的是流程确定性。
- 主动注入创作方法会让 `foundation`／`write` 阶段的系统上下文增加约 10KB；若模型窗口紧张，需要后续按阶段裁剪 references。
- 阶段判定是同步文件探针，作者手动删文件会即时切换阶段；这是期望行为，但可能与 `story_next` 的缓存视图短暂不一致。
- 删除两个技能后，若模型仍按旧习惯调用 `skill` 工具找它们，会得到不存在；协议里写明「技能已随上下文提供」来避免。
