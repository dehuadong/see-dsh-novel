# Agent Note: chapter.review —— 证据化审稿：观察校验与审稿记录

Status: proposed

## Problem

正文首版落盘后没有审稿。源工程由审稿 agent 产出 `AuditResult`（`models/observation.ts`）：每条观察有 `code`／`summary`／`assessment`（issue／resolved／unavailable／observation）／`category`／`sourceRefs`；`sourceRefs` 必须指向给定编号原文中的**确切行或逐字引文**，宿主用 `resolveObservationSources` 把行号解析成原文片段，空行、越界、引文不匹配都报错。`pipeline/chapter-review.ts` 负责用审计器跑这一轮，并在审计不可用时记录 `unavailable` 观察而不是让整章失败。

复刻侧有正文，没有审稿入口，也没有观察校验。

## Proposal

### 观察与校验：`core/observation.ts`

移植源模型与校验：

- `Observation`：`{code, summary, evidence: string[], assessment, category?, sourceRefs: [{sourceId, quote}]}`；
- `numberSourceLines(text)`：给原文加行号（审稿子代理看到的版本）；
- `resolveObservationSources(observations, sources)`：
  - `quote` 给了就原样校验；
  - 只给 `startLine`／`endLine` 时，从命名来源取对应行拼成 quote；范围非法报 `REVIEW_SOURCE_RANGE_INVALID`，空行报 `REVIEW_SOURCE_REQUIRED` 并附邻近非空行；
  - 没有 `sourceRefs` 且 `assessment !== 'unavailable'` 报 `REVIEW_SOURCE_REQUIRED`；
  - `quote` 不在来源原文里报 `REVIEW_SOURCE_MISMATCH`。

### 审稿：`core/chapter-review.ts`

- 来源：`chapter-<N>` 是章节文档正文；`governed-context` 是本章章纲的 memo body（`loadChapterPlan`），两者都加行号供子代理引用；
- 工具 `story_review_chapter(chapter, summary, observations)`：
  - 该章必须有正文与章纲；观察先经 `resolveObservationSources` 校验；
  - 校验通过后写 `source/story/runtime/chapter-XXXX.review.json`（`{version:1, chapter, summary, observations, counts}`，一次 `commitFoundation`）；
  - 返回 `{chapter, path, counts: {issue, resolved, observation, unavailable}}`；
  - 同一章已有 review 文件时拒绝（重审属修订能力）；
- 审计子代理不可用（调用失败）时，主编提交一条 `assessment: 'unavailable'` 的观察即可，宿主照常落盘并在 counts 里记 1。

### 审稿方法与阶段

- 审稿方法仍在 `longform-writing`（`reader-contract-and-progression.md` 等），由阶段上下文主动注入；不新增审稿技能。
- 阶段判定增加 `review`：有正文、没有对应 review 文件；协议写「按章纲与正文审稿 → 每条观察带确切证据 → 调 `story_review_chapter`」；`story:craft` 在 `review` 阶段注入 `longform-writing`。
- `review` 完成（review 文件存在）后阶段回到 `plan` 的下一章？本行只加 `review`，章节推进与结算留给 `chapter.settle`。

## Alternatives considered

**不校验引文，直接存模型给的观察。** 否掉：源工程的核心就是证据校验；不校验等于把无证据的断言写进审稿记录。

**审稿失败就整章报错。** 否掉：源工程用 `unavailable` 观察记录，让流程继续。

**把审稿方法写成新技能。** 否掉：方法已在 `longform-writing` 的参考文档里；阶段协议负责调用顺序。

**审稿记录写 Markdown 投影。** 本行先存 JSON（机器消费）；人类可读投影留给面板或后续能力。

## Acceptance criteria

- `resolveObservationSources`：逐字 quote 通过；行号范围解析成原文片段；越界、空行、引文不匹配、缺 sourceRefs（non-unavailable）分别报对应错误码。
- `story_review_chapter` 在「有正文与章纲」时写出 `chapter-0001.review.json`，内容含 summary 与经校验的 observations；同章已有 review 时拒绝；缺正文或章纲时拒绝且不落盘。
- 返回的 counts 与 observations 的 assessment 统计一致。
- 阶段判定：有正文无 review → `review`；有 review → 仍为 `review`（本行不推进阶段），协议含 `story_review_chapter`，craft 含 `longform-writing`。
- 测试：`test/observation.test.mjs`（校验与错误码）、`test/chapter-review.test.mjs`（落盘、拒绝、counts）、`test/stage-context.test.mjs` 补 review 阶段；`test/host.test.mjs` 加工具。
- 实现与证据：implementation `packages/see-dsh-novel/src/core/observation.ts`；consumer `packages/see-dsh-novel/test/observation.test.mjs`；工具在 `src/pipelines/long/review-tool.ts`；realRun `artifacts/real-runs/chapter.review.json`。
- 真实运行：在 `work-empty-2` 会话按 review 阶段协议派发审稿子代理，提交至少一条带行号引用的 issue 观察与一条 unavailable 观察，核对落盘与 counts；再用同章号提交一次确认拒绝。

## Risks

- 审稿质量取决于子代理与注入的方法；宿主只保证证据与结构。
- 审稿记录只存 JSON；没有人类可读投影与面板。
- 阶段停在 `review` 直到后续的结算行；不自动推进下一章。
