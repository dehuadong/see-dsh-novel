# Agent Note: 角色方法 prompt 与每轮上下文包（第 3、4 层）

Status: proposed

## Problem

源工程的写作方法有四层组装：harness system prompt、技能束、按角色拆的方法 prompt、每轮上下文包。复刻侧已经落地前两层（见 [`implemented/process/2026-11-05-skill-bundle-and-persona.md`](../../implemented/process/2026-11-05-skill-bundle-and-persona.md)），后两层还没有设计记录：

- **角色方法 prompt**：源工程把 planner／writer／settler／reviewer 的方法写成各自的 prompt 模块（`agents/planner-prompts.ts`、`writer-prompts.ts`、`settler-prompts.ts`），worker 的 system prompt 由「角色方法 + 当轮任务」组成；复刻侧现在只有工具描述，角色子代理拿到的是任务本身，没有方法层。
- **每轮上下文包**：源工程每轮编译出 current_work_context、host_execution_progress、conversation_summary、book rules、truth 投影，作为结构化的上下文块；复刻侧目前只有 `story_next` 的路牌、cast 的 systemPrompt 片段与工具回执，没有「装配上下文」这一层。

没有这份记录，`plan.chapter`、`chapter.write`、`context.brief` 在规划时只会看到行标题，缺少方法 prompt 的组织方式与上下文包的字段依据；而这些正是源工程行为的一部分。

## Proposal

本笔记只定**组织方式与落点**，具体字段与措辞在对应行规划时定稿：

### 角色方法 prompt

每个角色一个方法模块，放在 `packages/see-dsh-novel/src/pipelines/long/prompts/`（planner、writer、settler、reviser），导出纯文本或按任务拼装的函数；子代理的系统提示由「方法模块 + 当轮任务 + 作品上下文」组成，与源工程一致的顺序。方法模块只讲方法，不含作品事实；作品事实来自档案与状态文件。

落点：

- `plan.chapter` 交付 planner 方法（章纲、threadRefs、闸门的写法）；
- `chapter.write` 交付 writer 方法（场景、篇幅预算、开场与章末）；
- `chapter.revise` 交付 reviser 方法（patch／polish／rewrite／deslop 的边界）；
- `chapter.settle` 交付 settler 方法（事实抽取、伏笔动作、冲突校验）。

### 每轮上下文包

`context.brief` 交付上下文包的字段与装配时机；`context.retrieval` 交付检索命中的来源标注。参考源工程的结构，上下文包至少包含：当前作品与阶段、本章目标与约束、相关角色 brief、book rules 摘要、truth 投影摘要、伏笔与承诺、宿主执行进度、对话摘要。每个块标明来源（文件路径或台账 id），不把模型生成的内容当作品事实。

### 与技能束的分工

技能束提供**跨阶段的手艺方法**（怎么写、怎么审），角色方法 prompt 提供**当前阶段的操作规程**（这一步产出什么、按什么顺序、哪些字段必填）。上下文包只提供**当轮事实**。三者不互相复制：技能不写字段清单，方法 prompt 不重复手艺正文，上下文包不做方法指导。

## Alternatives considered

**把角色方法写进技能束。** 少一层文件。否掉：技能是跨阶段可加载的手艺，按需加载；角色方法是每个 worker 固定的操作规程，必须每次都在，不依赖模型是否记得加载技能。

**把方法 prompt 直接写进工具描述。** 零新增文件。否掉：工具描述是「这个工具做什么」，塞进方法与操作规程会挤占参数说明，也让方法无法按角色复用。

**用一份通用上下文包给所有阶段。** 省装配逻辑。否掉：源工程按阶段装配不同块（规划要卷与章纲，写作要场景与预算，结算要状态与伏笔）；一份通用包会让每个角色都拿到无关信息。

**等 P2 实现时再写这份笔记。** 更省。否掉：没有这份记录，`plan.chapter` 的规划会把方法 prompt 当作可选项；而且「三层分工」这个决定需要和实施同批存在，否则又变成口头约定。

## Acceptance criteria

- 本笔记在 `plan.chapter` 与 `context.brief` 的规划时被逐条落实或修订；落实后转为 `implemented`，或按新方案归档并在新笔记里说明取代关系。
- `plan.chapter` 的行内交付包含 planner 方法模块与章前上下文装配；`chapter.write`／`chapter.revise`／`chapter.settle` 各自包含对应方法模块；`context.brief` 包含上下文包字段与装配时机。
- 方法模块与技能束没有内容重复：技能讲手艺，方法模块讲操作规程；测试至少断言两类文件都存在且不互相引用正文。
- 上下文包的每个块标明来源（路径或台账 id），并有测试断言缺来源时不装配。

## Risks

- 本笔记只有组织方式，没有字段清单；`context.brief` 规划时如果发现源工程的上下文包结构比这里列的更细，以源工程为准并修订本笔记。
- 角色方法模块与技能束的边界在实际写作中可能模糊（例如「场景预算」既是手艺也是操作规程）；划分以「是否每次都在」为准，出现争议时在对应行规划里裁决。
- 源工程的角色方法 prompt 是英文，复刻用中文，措辞会随表达调整，方法要点保持一致。
