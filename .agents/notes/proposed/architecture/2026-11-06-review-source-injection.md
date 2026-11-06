# Agent Note: chapter.review —— 编号原文注入与证据基准

Status: proposed

## Problem（D17）

审计发现 `chapter.review` 只校验观察，没有把编号原文交给审稿方。源工程在审稿调用里把 `governed-context` 与 `chapter-N` 一起编号后放进消息，模型引用的是宿主给的编号行；复刻侧模型自己读 `source/chapters/*.md` 与章纲，行号基准、去标题行规则与宿主校验可能不一致——同一句引文在两边行号不同时，校验会误报 `REVIEW_SOURCE_MISMATCH`，或者模型干脆不敢引用。

## Proposal

### 审稿契约：`src/pipelines/long/stages/review.ts`

`renderReviewContract(root)`（同步读盘）：

- 当前章 = `current_state.chapter + 1`；读章节文档（复用 `chapter-document` 的去标题行逻辑）与章纲 memo；
- 输出：
  1. 审稿要求：按随阶段提供的审稿方法；每条观察给 `code`、`assessment`（issue／resolved／observation／unavailable）、`summary` 与 `sourceRefs`；证据必须来自下面两块编号来源；不估算字数，字数由宿主计算；`observations` 可以为空；不把「无法对照」写成正文缺陷，用 `unavailable`；
  2. `## 来源 chapter-N` + `numberSourceLines(正文)`；
  3. `## 来源 governed-context` + `numberSourceLines(章纲 memo)`。
- 缺章节文档或章纲时返回空串（阶段协议仍会给出提示）。

### 注入与阶段协议

- `installStageContext` 在 `review` 阶段把契约拼在协议之后（与 foundation／write 同一路径）；
- `review` 阶段协议补一句：「证据只能引用注入的编号来源；引用时用 sourceId 与 `startLine`／`endLine` 或逐字 quote」。

### 不做

- `reviewedArtifact`（D18）依赖 `artifact.identity` 行，本行不造伪版本号；
- 审稿后自动修订：属 `chapter.revise`。

## Alternatives considered

**只在工具描述里写「请引用原文」。** 否掉：模型仍要自己计算行号，基准不一致的问题没解决。

**把整章原文重复注入两次（协议与契约各一份）。** 否掉：重复占上下文；编号来源只出现一次。

**由工具在提交时把行号解析结果回显。** 保留校验错误码即可；回显不解决模型侧的行号基准。

## Acceptance criteria

- `review` 阶段 `story:stage` 文本含：审稿要求、`## 来源 chapter-1` 编号行（从 1 开始、与章节正文一致、不含标题行）、`## 来源 governed-context` 编号行。
- 没有章节文档或章纲时契约返回空串，阶段协议仍在。
- 英文作品输出英文审稿要求，编号来源不变。
- 测试：`test/review-contract.test.mjs` 覆盖编号、两来源、缺文件；`test/stage-context.test.mjs` 补 review 阶段的编号来源断言。
- 真实运行：在 review 阶段工作区发「贴出编号来源的前三行」，再提交一条引用该行号的观察并落盘；核对记录里的 quote 与注入的行一致。
- 实现与证据：implementation `packages/see-dsh-novel/src/pipelines/long/stages/review.ts`；consumer `packages/see-dsh-novel/test/review-contract.test.mjs`；realRun `artifacts/real-runs/chapter.review.json`（重录）。

## Risks

- 注入整章 + 章纲会增加 review 阶段上下文（一章约 3–6KB）；
- 长章可能超过模型窗口，届时需要裁剪策略（属 `plan.compression` 的后续）；
- 模型若仍引用未注入的文件名，校验会按 `REVIEW_SOURCE_UNKNOWN` 拒绝，这是期望行为。
