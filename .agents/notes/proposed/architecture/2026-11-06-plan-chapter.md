# Agent Note: plan.chapter —— planner 技能、memo 与 governed plan 落盘

Status: proposed

## Problem

上下文与预算已就绪，但章纲还没有落点：源工程由 `PlannerAgent.planChapter`（`agents/planner.ts:45-180`）把上下文编译成 memo `{chapter, goal, body, threadRefs}`，写 `story/runtime/chapter-XXXX.intent.md`，并由 `persisted-governed-plan.ts` 存成 `chapter-XXXX.plan.json`（`version: 2`，intent + memo + plannerInputs）；读取时校验章号一致、优先用 intent.md 投影。复刻侧没有任何「规划这一章」的方法或工具。

## Proposal

### 方法：planner 技能

新增 `skills/story-plan/SKILL.md`（DSH 原生 Skill，不新增 prompt 拼装层）：

- 只编译上下文，不写正文；
- 一个具体 goal + 可读的 Markdown 计划（body）；
- `threadRefs` 只引用候选里出现过的 hook/摘要 id，不虚构；
- 保留作者方向与既成事实；不引入上下文里没有的设定；
- 调用顺序：`story_context_candidates` → `subagent` 选择 → `story_context_package` → 按 package 写 memo → `story_plan_chapter`。

### 落盘：`core/chapter-plan.ts`

```ts
interface ChapterPlan { intent: {chapter,goal}, memo: {chapter,goal,body,threadRefs}, intentMarkdown: string, plannerInputs: string[] }

saveChapterPlan(root, input): Promise<{planPath, intentPath}>
loadChapterPlan(root, chapter): Promise<ChapterPlan | null>
```

- `saveChapterPlan`：校验 `chapter` ≥1、`goal`／`body` trim 非空、`threadRefs` 是字符串数组（与源 schema 一致，不额外拒绝未知 id）；写 `source/story/runtime/chapter-XXXX.plan.json`（`{version:2,intent,memo,plannerInputs}`，2 空格缩进 + 末尾换行）与 `chapter-XXXX.intent.md`（`# Chapter Intent`／`## Goal`／`## Chapter Memo`／`### Thread Refs`／`### Body`，空 refs 为 `- (none)`），一次 `commitFoundation`；
- `loadChapterPlan`：文件缺失返回 `null`；`version !== 2` 或 `memo.chapter`／`intent.chapter` 与请求章号不一致时报错；`.intent.md` 存在时作为 `intentMarkdown`，缺失回退 `memo.body`。

### 工具：`story_plan_chapter`

参数：`chapter`、`goal`、`body`、`threadRefs`、`plannerInputs?`。

- 章节必须是 `current_state.chapter + 1`，且该章 plan 不存在（不允许覆盖已规划的章纲）；
- 基础设定六件套不齐时拒绝并点名缺失文件；
- `plannerInputs` 由主编写入调用方传入（来自 `story_context_package` 返回的 `trace.plannerInputs`）；缺省空数组；
- 返回 `{chapter, planPath, intentPath, plannerInputs}`；
- 拒绝时不落盘。

### 与其它行的关系

- 上下文、选择、压缩已完成，本行只消费它们的产物；
- 正文写作（`chapter.write`）之后消费 `loadChapterPlan` 与 package；
- 重规划不支持（plan 已存在即拒绝）；重规划留给后续章节运维能力。

## Alternatives considered

**把 planner 方法正文写成 TS prompt 模块。** 否掉：DSH 的方法是 Skill；`systemPrompt.context()` 负责注入，不另建 prompt 拼装层。

**threadRefs 严格校验为已知 hook id。** 否掉：源 `ChapterMemoSchema` 只要求字符串数组；约束在方法里。

**允许覆盖已有 plan。** 否掉：正文可能已按旧章纲生成，覆盖会让章纲与正文错位；重规划留给专门能力。

## Acceptance criteria

- `story_plan_chapter` 写出两个文件：JSON 四键（`version:2`、`intent`、`memo`、`plannerInputs`），memo 严格四字段；md 与源格式逐字一致（含空 refs 的 `- (none)`）。
- `loadChapterPlan` 往返一致；章号不一致、版本非 2 报错；缺 md 回退 `memo.body`；缺文件返回 `null`。
- 章号不是 `当前章 + 1`、该章 plan 已存在、`goal`／`body` 空白、基础设定缺失时拒绝且不落盘。
- 技能文件存在且被工具描述引用；`test/host.test.mjs` 工具清单加 `story_plan_chapter`。
- 测试：`test/chapter-plan.test.mjs` 覆盖写入／读取／拒绝／md 格式；`test/skills.test.mjs` 或现有技能清单测试加 `story-plan`。
- 实现与证据：implementation `packages/see-dsh-novel/src/core/chapter-plan.ts`；consumer `packages/see-dsh-novel/test/chapter-plan.test.mjs`；工具在 `src/pipelines/long/plan-tool.ts`；realRun `artifacts/real-runs/plan.chapter.json`。
- 真实运行：在 `ready` 的工作区会话里按技能顺序规划第 1 章，核对两个文件与回执；再用同一章号调一次确认拒绝。

## Risks

- memo 由主编按技能撰写，模型行为与源 PlannerAgent 不同；落盘契约与校验一致。
- 章节连续性依赖 `current_state.chapter`；P4 前它不会推进，所以只能规划第 1 章（与当前阶段一致）。
- 不支持重规划；写坏一章只能删文件重来。
