# Agent Note: chapter.review —— 证据化审稿：观察校验与审稿记录

Status: implemented

## Problem

正文首版落盘后没有审稿。源工程由审稿 agent 产出 `AuditResult`（`models/observation.ts`）：每条观察有 `code`／`summary`／`assessment`（issue／resolved／unavailable／observation）／`category`／`sourceRefs`；`sourceRefs` 必须指向给定编号原文中的确切行或逐字引文，宿主用 `resolveObservationSources` 解析并校验，空行、越界、引文不匹配都报错；审计不可用时记 `unavailable` 观察而不是整章失败（`pipeline/chapter-review.ts`）。

## Decision

`packages/see-dsh-novel/src/core/observation.ts`：

- `ObservationInput`／`Observation`：`code`、`summary`、`assessment`、`category?`、`evidence[]`、`sourceRefs[{sourceId, quote}]`；
- `numberSourceLines`：给原文加 `行号 | 内容`；
- `resolveObservationSources`：逐字 quote 校验；只给 `startLine`／`endLine` 时取对应行拼 quote；越界报 `REVIEW_SOURCE_RANGE_INVALID`，空行报 `REVIEW_SOURCE_REQUIRED`，未知来源报 `REVIEW_SOURCE_UNKNOWN`，引文不在原文报 `REVIEW_SOURCE_MISMATCH`；非 `unavailable` 观察缺 `sourceRefs` 报 `REVIEW_SOURCE_REQUIRED`；
- `countObservations`：按 assessment 统计。

`src/core/chapter-review.ts`：

- `reviewSources(root, chapter)`：`chapter-<N>` 是章节文档正文，`governed-context` 是章纲 memo；缺正文或章纲时报错；
- `reviewChapter(root, {chapter, summary, observations})`：summary 非空、同章已有审稿记录拒绝、观察经校验后写 `source/story/runtime/chapter-XXXX.review.json`（`{version:1, chapter, summary, observations, counts}`，一次 `commitFoundation`）；
- `loadChapterReview`：缺文件返回 `null`。

`src/pipelines/long/review-tool.ts` 的 `story_review_chapter`：章节必须有章纲与正文；返回 `{chapter, path, counts}`。

阶段：`detectStage` 在「有章纲、有正文」后进入 `review`，协议要求「读正文与章纲 → 每条观察带证据 → 调 `story_review_chapter`」；`story:craft` 在 `review` 阶段注入**独立的审稿技能** `story-review`（含 `references/review-matrix.md`）。审稿方法与写作方法分开，与源工程一致。

## Alternatives considered

**不校验引文。** 否掉：证据校验是源工程审稿的核心。

**审稿失败整章报错。** 否掉：源工程用 `unavailable` 观察让流程继续。

**把审稿方法塞进 `longform-writing`。** 否掉：审稿标准随题材与读者变化，与写作方法不同；独立 `story-review` 技能更清楚，也避免写作方法在审稿阶段被误用。

**审稿 Markdown 投影。** 本行只存 JSON，人类可读投影留给面板/后续能力。

## Consequences

收益：审稿观察必须带可核对的原文证据；同章只能审一次；审稿记录可被后续修订与结算消费。

验证见 `test/observation.test.mjs`（校验与五类错误码、unavailable 例外、counts）与 `test/chapter-review.test.mjs`（落盘、counts、重复拒绝、缺正文/章纲拒绝）；`test/stage-context.test.mjs` 覆盖 review 阶段与 `story-review` 的注入。

代价与已知限制：

- 审稿质量取决于撰写观察的模型；宿主只保证证据与结构。
- 同章只能审一次；重审留给修订能力。
- 阶段停在 `review`，不自动推进下一章（结算行负责推进）。
