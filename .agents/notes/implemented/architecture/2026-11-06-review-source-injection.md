# Agent Note: chapter.review —— 编号原文注入与证据基准

Status: implemented

## Problem（D17）

审计发现 `chapter.review` 只校验观察，没有把编号原文交给审稿方：模型自己读文件，行号基准、去标题行规则与宿主校验可能不一致，导致误报 `REVIEW_SOURCE_MISMATCH` 或不敢引用。

## Decision

`packages/see-dsh-novel/src/pipelines/long/stages/review.ts` 的 `renderReviewContract(root)`（同步读盘）：

- 当前章 = `current_state.chapter + 1`；章节正文用 `chapterBody` 去掉标题行；
- 章纲取 `chapterPlanPath` 的 memo body；
- 输出审稿要求（code／assessment／summary／sourceRefs、证据只能来自编号来源、字数由宿主计算、observations 可为空、缺对照用 unavailable）与两块编号来源：`## 来源 chapter-N`、`## 来源 governed-context`，都用 `numberSourceLines` 编号；
- 缺正文或章纲时返回空串；英文作品输出英文要求。

`stages/index.ts` 在 `review` 阶段把契约拼进 `story:stage`；协议补「引文只能引用注入的编号来源」。审稿方法仍由 `story-review` 主动注入。

## Alternatives considered

**只在工具描述里写「请引用原文」。** 否掉：行号基准仍不统一。

**整章原文重复注入。** 否掉：编号来源只出现一次。

**工具回显解析结果。** 保留错误码即可；回显不解决模型侧基准。

## Consequences

收益：审稿方与宿主使用同一份编号原文；观察的行号引用可以直接通过校验，错误码只在真的引用错时出现。

验证见 `test/review-contract.test.mjs`（要求、两块编号来源、去标题行、英文、缺文件空串）与 `test/stage-context.test.mjs`（review 阶段含编号来源）。

代价与已知限制：

- review 阶段上下文增加一章正文与章纲（约 3–6KB）；
- 超长章没有裁剪，留给 `plan.compression` 的后续；
- `reviewedArtifact`（D18）仍缺，依赖 `artifact.identity` 行。
