# Agent Note: plan.chapter —— planner 技能、memo 与 governed plan 落盘

Status: implemented

## Problem

上下文与预算已就绪，但章纲没有落点：源工程由 `PlannerAgent.planChapter`（`agents/planner.ts:45-180`）把上下文编译成 memo `{chapter, goal, body, threadRefs}`，写 `chapter-XXXX.intent.md`，并由 `persisted-governed-plan.ts` 存成 `chapter-XXXX.plan.json`（`version: 2`）；读取时校验章号一致、优先 intent 投影。复刻侧没有「规划这一章」的方法或工具。

## Decision

方法用 DSH 原生 Skill `skills/story-plan/SKILL.md`：只编译上下文、一个具体 goal、`threadRefs` 只引用候选里出现过的 id、不写正文；顺序为 `story_context_candidates` → `subagent` → `story_context_package` → 写 memo → `story_plan_chapter`。不新增 TS prompt 拼装层。

`packages/see-dsh-novel/src/core/chapter-plan.ts`：

- `saveChapterPlan(root, {chapter, goal, body, threadRefs, plannerInputs})`：校验 chapter ≥1、goal／body trim 非空、threadRefs 是字符串数组；一次 `commitFoundation` 写 `source/story/runtime/chapter-XXXX.plan.json`（`{version:2,intent,memo,plannerInputs}`）与 `.intent.md`（`# Chapter Intent`／`## Goal`／`## Chapter Memo`／`### Thread Refs`／`### Body`，空 refs 为 `- (none)`）；
- `loadChapterPlan(root, chapter)`：缺文件返回 `null`；`version !== 2` 或章号不一致报错；`.intent.md` 存在时作为 `intentMarkdown`，缺失回退 `memo.body`。

`src/pipelines/long/plan-tool.ts` 的 `story_plan_chapter`：要求基础设定六件套齐全（缺失点名）、章号必须是 `current_state.chapter + 1`、该章 plan 不存在；`plannerInputs` 由调用方传入（来自 `story_context_package` 的 `trace.plannerInputs`）；返回两路径与 plannerInputs；拒绝时不落盘。

## Alternatives considered

**planner 方法写成 TS prompt 模块。** 否掉：DSH 的方法是 Skill，`systemPrompt.context()` 负责注入。

**threadRefs 严格校验为已知 hook id。** 否掉：源 `ChapterMemoSchema` 只要求字符串数组。

**允许覆盖已有 plan。** 否掉：正文可能已按旧章纲生成；重规划留给专门能力。

## Consequences

收益：一章的上下文可以落成可读章纲与机器可读 plan；章号与版本有 identity 校验；P3 的正文写作可直接 `loadChapterPlan`。

验证见 `test/chapter-plan.test.mjs`（写入、`- (none)`、读取往返、identity、缺 md 回退、空白与类型校验、拒绝不落盘）与 `test/host.test.mjs`（工具与 skill 清单）。

代价与已知限制：

- memo 由主编按技能撰写，模型行为与源 PlannerAgent 不同；落盘契约一致。
- 章节连续性依赖 `current_state.chapter`；P4 前只能规划第 1 章。
- 不支持重规划，写坏一章只能删文件重来。
- `plannerInputs` 是调用方传入的，宿主不校验它是否来自真实 trace。
