# Agent Note: plan.chapter —— 章前规划：检索、上下文包、planner 与章纲落盘

Status: proposed

## Problem

基础设定之后，源工程只做一件事：写下一章。规划这一章是固定的一条链：

1. **检索**：`retrieval/local-search.ts` 按任务目标在伏笔、章节摘要、角色卡、素材里找候选，返回带来源的片段；
2. **装配**：`ComposerAgent.selectTaskContext` 按层级与预算选出 `ContextPackage`（每条带 `source`／`reason`／`excerpt`／`protection`），并记录 trace；
3. **规划**：planner 的 system prompt + 用户消息，把「当前指令 + 权威上下文 + 上一章正文 + 字数遥测」交给模型，拿到 memo `{chapter, goal, body, threadRefs}`（`agents/planner.ts:45-180`、`planner-prompts.ts`）；
4. **落盘**：`chapter-XXXX.plan.json`（version 2：intent + memo + plannerInputs）与 `chapter-XXXX.intent.md`（`persisted-governed-plan.ts`）。

复刻侧一条都没有；`ready` 之后只有 `story_gate`，没有任何「规划这一章」的入口。账本曾把这条链拆成 `context.retrieval`／`context.brief`／`plan.chapter` 三行，那是按代码模块切分，不是源工程的阶段；任何一行单独做都会得到半套规划。本行把它们合并成一个纵向能力。

## Proposal

### 检索

`core/planner-retrieval.ts`：`searchPlanningMaterials(root, query)` 对四类来源做大小写不敏感的子串匹配：

- `source/story/pending_hooks.md`：每行一条，返回 hook id 所在行；
- `source/story/state/chapter_summaries.json`：每章一行摘要文本；
- `source/story/roles/**/*.md`：角色卡前若干行；
- `source/story/materials/**/*.md`（存在时）：素材片段。

每条返回 `{source, excerpt, score, kind}`，`source` 是作品根相对路径（角色卡带文件名），空查询返回空集合。评分是命中次数 + 标题匹配的小加权，排序稳定（分数降序、来源升序）。

### 上下文包

`core/planner-context.ts`：`compilePlanningContext(root, chapter, instruction)` 返回：

```ts
interface PlannerContext {
  chapter: number
  package: ContextPackage   // {chapter, selectedContext: [{source, reason, excerpt?, protection}]}
  trace: { protectedSources: string[], compressibleSources: string[], tokenBudget: {protectedTokens, compressibleTokens, totalSelectedTokens} }
}
```

来源与层级对齐源实现的输入（`composer.ts` 侧）：`current_focus`、`author_intent`、`style_guide`（存在时）、`outline/story_frame`、`outline/volume_map`、角色卡（每张一条）、检索命中的伏笔行与摘要行、`current_state`，以及上一章正文的结尾（存在 `source/story/chapters/NNNN.md` 时取末尾 2000 字，protected）。**不读 `book_rules`**：源工程里它是 writer 的输入，不是 planner 的。

预算按字符数：protected 优先，compressible 按检索分数与来源顺序装入，超过 `maxChars`（默认 24000）截断并在 trace 里记录；`tokenBudget` 用字符估算（`floor(chars / 2)`），与源 trace 的字段同名同形。

### 规划提示词

`src/pipelines/long/prompts/planner.ts`：

- `getPlannerMemoSystemPrompt(language)`：与源逐字一致；
- `buildPlannerUserMessage({chapterNumber, context, currentInstruction, previousChapter, lengthBudget, language})`：按源分段顺序（memo 请求／当前指令／权威上下文／上一章正文／字数遥测）。

### 工具与落盘

- `story_plan_context(chapter, instruction?)`：返回 `PlannerContext` 与拼好的 planner 用户消息，供主编写 memo 前阅读；只读，不落盘；章节号必须是 `当前章 + 1`，且该章没有已存在的 plan。
- `story_plan_chapter(chapter, goal, body, threadRefs)`：校验 `goal`／`body` 非空；`threadRefs` 只做字符串数组校验（源 schema 也允许任意字符串，是否引用真实 id 由提示词约束）；生成 `intent` 与 `memo`，写 `chapter-XXXX.plan.json`（`{version:2, intent, memo, plannerInputs}`，`plannerInputs` 来自同一次 `compilePlanningContext` 的 source 列表）与 `chapter-XXXX.intent.md`（源格式，空 refs 写 `- (none)`），一次 `commitFoundation`；返回两路径与 `plannerInputs`。
- 两个工具都要求基础设定齐（六份文件存在），否则拒绝并点名缺哪份。

### 读取

`core/chapter-plan.ts`：`loadChapterPlan(root, chapter)` 校验 version 2 与章号一致，`.intent.md` 优先作为 `intentMarkdown`、缺失回退 `memo.body`，文件缺失返回 `null`。

### 账本与文档

删除 `context.brief` 与 `context.retrieval` 两行（职责并入本行）；`docs/scope.md` 的 P2 只保留 `plan.chapter`。与源的差额在本行内消除不了的（主代理代替 planner 子代理、字符预算代替 token 计数）在 Consequences 里如实记录，并登记到 `docs/dsh-mapping.md`。

## Alternatives considered

**保持三行分开做。** 账本更细。否掉：源工程没有「只检索」或「只装配」的独立阶段；分开做会让每一行都没有真实消费者，评审与证据链都不可闭合。

**规划时直接启动 planner 子代理。** 更接近源的多代理结构。否掉：角色子代理的装配（prompt + 上下文 + 工具）还没落地；本行先把「检索 → 上下文包 → memo → 落盘」做成主编可调用的完整链，等子代理能力落地后替换调用方，契约不变。

**预算按 token 精确计数。** 更准确。否掉：仓库没有 tokenizer；源 trace 的数字也是估算，字段与算法在这里保持同形，误差在 Consequences 记录。

**threadRefs 拒绝不存在的 hook id。** 更严格。否掉：源 `ChapterMemoSchema` 只要求字符串数组，真正的约束在提示词；在提示词里给出 hook id 就够了，落盘时额外拒绝会把源接受的数据挡在外面。

## Acceptance criteria

- `story_plan_context` 返回的 `package.selectedContext` 含方向文档、大纲两份、角色卡、当前状态、检索命中的伏笔/摘要行；存在上一章正文时含 protected 的结尾片段；不含 `book_rules`。
- 每条 context 条目都有 `source`（作品根相对路径）、`reason`、`protection`；trace 的三个计数与实际条目字符数一致。
- `story_plan_chapter` 写出的 JSON 与 md 格式对齐源：`{version:2, intent, memo, plannerInputs}`；md 为 `# Chapter Intent`／`## Goal`／`## Chapter Memo`／`### Thread Refs`／`### Body`，空 refs 是 `- (none)`。
- 章节号不是 `当前章 + 1`、或该章 plan 已存在时拒绝；`goal`／`body` 空白时拒绝；拒绝时不产生文件。
- `loadChapterPlan` 往返一致；章号不一致、版本不是 2 时报错；缺 `.intent.md` 回退 `memo.body`；文件缺失返回 `null`。
- 基础设定不齐时两个工具都拒绝并点名缺失文件。
- 测试：`test/planner-context.test.mjs`（检索、层级、预算、trace、无 book_rules、上一章结尾）、`test/chapter-plan.test.mjs`（写读、拒绝、md 格式）、`test/planner-prompts.test.mjs`（中英两版与消息分段）；`test/host.test.mjs` 工具清单加两个工具。
- 账本删除 `context.brief`／`context.retrieval`，`docs/scope.md` P2 同步；`plan.chapter` 标题改为「章前规划：检索、上下文包、planner 与章纲」。
- 实现与证据：implementation `packages/see-dsh-novel/src/core/chapter-plan.ts`；consumer `packages/see-dsh-novel/test/chapter-plan.test.mjs`；工具在 `src/pipelines/long/plan-tool.ts`；realRun `artifacts/real-runs/plan.chapter.json`。
- 真实运行：在已 `ready` 的工作区会话里先调 `story_plan_context` 看上下文与提示词，再调 `story_plan_chapter` 落盘第 1 章；核对两个文件与回执；再用已存在的章号调一次确认拒绝。

## Risks

- 检索是子串匹配，没有 FTS/BM25；命中质量低于源工程，这一差额由后续 `context.retrieval` 能力升级（本行先把来源与结构定死）。
- 预算是字符近似；trace 的 token 字段是估算值，和源实现的精确计数有差距。
- memo 由主编撰写而不是独立 planner 子代理；模型行为可能不同，落盘契约与校验一致。
- 上一章正文路径按 `source/story/chapters/NNNN.md` 约定；P3 写正文时若采用不同命名，这里要同步。
