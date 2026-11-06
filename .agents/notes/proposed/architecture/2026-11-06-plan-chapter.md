# Agent Note: plan.chapter —— 章纲 memo、intent 投影与规划上下文

Status: proposed

## Problem

P2 的章前规划在复刻侧完全缺失：没有 planner 的方法 prompt，没有把「当前方向 + 规则 + 伏笔 + 上一章结尾」组装成一次规划请求的入口，也没有任何地方落盘章纲。源工程这条能力由三块组成：

- `PlannerAgent.planChapter`（`agents/planner.ts:45-116`）：从 `current_focus`／`author_intent`／`brief` + 外部指令拼任务目标（都为空时用「根据当前作品状态续写第 N 章」），调用 ComposerAgent 选上下文，把上一章结尾作为 protected 片段追加，生成章纲 memo，写 `chapter-XXXX.intent.md`；
- 章纲的形状：`ChapterMemo` 是严格对象 `{chapter, goal, body, threadRefs}`（`models/input-governance.ts:3-10`），`threadRefs` 只允许引用输入里出现过的 hook id（`agents/planner-prompts.ts:12-14`）；
- 持久化：`persisted-governed-plan.ts` 写 `story/runtime/chapter-XXXX.plan.json`（`version: 2`，`intent` + `memo` + `plannerInputs`），读取时校验章号、优先读 `.intent.md` 投影。

复刻侧 `story_next` 在 `ready` 后指向 `story_gate`，签核之后没有任何「规划这一章」的工具。

## Proposal

### 章纲工具

新增 `story_plan_chapter`：

- 参数：`chapter`（≥1 整数）、`goal`（非空）、`body`（非空 Markdown）、`threadRefs`（字符串数组，可空）；
- 校验：`chapter` 与当前状态章节连续（`current_state.json` 的 `chapter + 1`，只允许规划下一章，不重规划已存在章节）；`threadRefs` 必须是 `hooks.json` 里已有的 id，未知 id 拒绝并列出可用 id；`goal`／`body` trim 后非空；
- 生成 `intent = {chapter, goal}` 与 `memo = {chapter, goal, body, threadRefs}`，按源格式写两个文件：
  - `source/story/runtime/chapter-XXXX.plan.json`：`{version: 2, intent, memo, plannerInputs}`，`plannerInputs` 是本次装配出的上下文来源列表；
  - `source/story/runtime/chapter-XXXX.intent.md`：源格式（`# Chapter Intent`／`## Goal`／`## Chapter Memo`／`### Thread Refs`／`### Body`，threadRefs 为空时 `- (none)`）；
- 一次 `commitFoundation` 写两个文件；拒绝时不落盘；
- 返回 `{chapter, planPath, intentPath, plannerInputs}`。

### 读取入口

`core/chapter-plan.ts`：

```ts
export async function loadChapterPlan(root: string, chapter: number): Promise<ChapterPlan | null>
```

- 校验 `version === 2`、`memo.chapter === intent.chapter === chapter`，不一致报错（源实现的 identity check）；
- `.intent.md` 存在时作为 `intentMarkdown` 返回，缺失时回退到 `memo.body`；
- 文件缺失返回 `null`。

### 规划上下文

`core/planner-context.ts`：`selectPlannerContext(root, chapter)` 返回条目 `{source, reason, excerpt?}` 列表，来源与理由对齐源实现的输入：

- `book_rules.md`（规则，protected，摘要正文）；
- `current_focus.md`／`author_intent.md`（用户方向，protected）；
- `pending_hooks.md`（伏笔池，compressible，摘要表头与行数）；
- `current_state.md`（当前状态，compressible）；
- `chapter_summaries.md` 的最后一行（上一章摘要，compressible）；
- 上一章 `chapter-XXXX.intent.md` 的正文（protected，仅当存在）。

条目列表与正文对不上时不装配，报错点名文件。`plannerInputs` 就是这些 source 的列表。

### planner 方法 prompt

新增 `src/pipelines/long/prompts/planner.ts`：

- `getPlannerMemoSystemPrompt(language)`：与源逐字复刻（英文／中文两版）；
- `buildPlannerUserMessage({chapterNumber, context, currentInstruction, previousChapter, lengthBudget, language})`：按源格式拼「memo 请求 / 当前用户指令 / 权威上下文 / 上一章正文 / 宿主字数遥测」。

它们是纯函数，后续子代理实现时直接引用；本行的工具由主编在会话里调用，不启动子代理。

### 与其它行的关系

- 章纲的消费（写正文）是 P3 的 `chapter.write`；本行只产出并持久化章纲；
- 更细的上下文选择／压缩（ComposerAgent）是 `context.brief` 与 `context.retrieval` 的范围；本行只做「章前最小装配」，不实现 token 预算与检索；
- `story_next` 的 `ready → story_gate` 不变；规划在签核之后由主编按需调用。

## Alternatives considered

**把章纲直接写进 `volume_map.md`。** 少两个文件。否掉：源工程的章纲是有版本的运行期产物（plan.json + intent 投影），与卷图（作者可读的规划文档）不是同一层。

**规划时启动子代理跑 planner。** 更接近源的多代理结构。否掉：本行还没有 planner 子代理的装配与预算（属 `context.brief`），先用主编直接调用工具落盘，等上下文装配落地后再把模型换成子代理；章纲的形状与持久化不因此改变。

**threadRefs 允许任意字符串。** 少一次校验。否掉：源提示词要求只引用输入里出现的 hook id；落盘前拒绝未知 id，能让「规划引用了不存在的伏笔」当场暴露。

**允许重规划任意章节。** 更灵活。否掉：重规划会覆盖已写的章纲与 intent 投影，而正文可能已经生成；本行只允许规划下一章，重规划留给后续的章节运维能力。

## Acceptance criteria

- `story_plan_chapter` 写入 `chapter-0001.plan.json` 与 `chapter-0001.intent.md`：JSON 是 `{version:2, intent, memo, plannerInputs}`，memo 严格四字段，`plannerInputs` 与装配的 source 列表一致；md 与源格式逐字一致（含 `- (none)` 分支）。
- 章号不是 `current chapter + 1` 时拒绝；`goal`／`body` 空白时拒绝；`threadRefs` 含未知 id 时拒绝并列出可用 id；拒绝时不产生文件。
- `loadChapterPlan` 读回同一对象；章号不一致、版本不是 2 时报错；`.intent.md` 缺失时回退 `memo.body`；文件缺失返回 `null`。
- 规划上下文包含：book rules、方向文档、伏笔池、当前状态、最后一章摘要（有则）、上一章 intent（有则）；缺失必需文件时报错点名。
- planner prompt 的中英文与源逐字一致，`buildPlannerUserMessage` 的分段顺序按源（指令／上下文／上一章／字数遥测）。
- `test/chapter-plan.test.mjs` 覆盖写入、读取、拒绝与 md 格式；`test/planner-prompts.test.mjs` 覆盖两版 prompt 与消息拼装；`test/host.test.mjs` 工具清单加 `story_plan_chapter`。
- `capabilities.yaml` 删除 `plan.outline` 行（与 `foundation.architect` 重复，A 选项），`docs/scope.md` 的 P2 列表同步；`plan.chapter` 行标题补「governed plan 持久化」。
- 实现与证据：implementation `packages/see-dsh-novel/src/core/chapter-plan.ts`；consumer `packages/see-dsh-novel/test/chapter-plan.test.mjs`；工具注册在 `src/pipelines/long/plan-tool.ts` 与 `src/pipelines/long/tools.ts`；realRun `artifacts/real-runs/plan.chapter.json`。
- 真实运行：在已 `ready` 的工作区会话里调 `story_plan_chapter` 规划第 1 章，核对两个文件与回执；再用未知 hook id 调用一次确认拒绝，并确认没有多余文件。

## Risks

- 规划上下文是「最小装配」：没有 token 预算、压缩与检索，比源工程的 ComposerAgent 粗；这些差额由 `context.brief`／`context.retrieval` 行补齐，NOTE 记录在前。
- 章纲由主编直接提交，而不是 planner 子代理生成；模型行为可能与源不同，但落盘契约与校验一致。
- 章节连续性只按 `current_state.json` 判：状态被手改到别的章节时，规划会被拒绝；这与「结算推进章节」的契约一致。
- 重规划任意章节不支持，写坏一章只能重开作品或删掉 plan 文件；重规划留给后续章节运维行。
