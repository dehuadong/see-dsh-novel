# Agent Note: chapter.review 的 sourceRefs 契约与 D18 边界

Status: implemented

## Problem

真机 `session-e96508fc-aff4-48b4-a934-5b70e4519e06` 的 review 阶段失败：`story_review_chapter` 返回 `REVIEW_SOURCE_UNKNOWN`，位置 `/observations/0/sourceRefs/0`。观察里 `sourceRefs` 实际传的是字符串 `"governed-context:13"`，而宿主 `resolveObservationSources` 读的是 `reference.sourceId`；`review-tool.ts` 的 `observations` schema 只有 `items: {type:'object'}`，没有给 `sourceRefs` 声明字段，模型因此可以传字符串，直到宿主才报未知来源。

审计 D18 是另一件事：`reviewedArtifact` 缺失，偿还位置是 `artifact.identity` 行。`artifact.identity` 在账本里仍是 `missing`（`virtual path、artifactId/revision、跨作品隔离`），所以本行不能凭空生成 `{workId, artifactId, revisionId}`，也不能用内容哈希冒充。

## 源工程证据

- `models/observation.ts` 的 `ObservationSchema`：`code` 非空、`summary`、`assessment` 枚举（issue／resolved／unavailable／observation，可选）、`category`、`evidence`、`sourceRefs` 是 `{sourceId, quote}` 的数组（strict）；审稿提交的 `ReviewSourceSubmission` 允许 `sourceId` + `quote?`／`startLine?`／`endLine?`，由 `resolveObservationSources` 解析成逐字 `quote`。
- `pipeline/chapter-review.ts` / `continuity.ts`：审计结果带 `reviewedArtifact: {workId, artifactId, revisionId}`，来自被审产物 revision；没有 artifact identity 时不能生成。
- 复刻的 `reviewSources` 已提供 `chapter-N` 与 `governed-context` 两个来源；`resolveObservationSources` 已实现 `REVIEW_SOURCE_UNKNOWN`／`RANGE_INVALID`／`REQUIRED`／`MISMATCH`。

## Decision

### sourceRefs 工具契约

- `review-tool.ts` 的 `observations` schema 补全：
  - 每条观察要求 `code`／`summary`／`assessment`；`assessment` 枚举；`category` 枚举；`evidence` 字符串数组；
  - `sourceRefs` 是对象数组：`sourceId` 必填字符串，`quote`／`startLine`／`endLine` 可选；`additionalProperties: false`；
  - 这样模型传 `"governed-context:13"` 时在工具入参就被 schema 拒绝，模型可据错误重试；宿主不再把格式错误降级成 `REVIEW_SOURCE_UNKNOWN`。
- `review-tool.ts` 的描述明确 `sourceRefs` 是对象，不是 `sourceId:line` 字符串。
- `reviewChapter`／`resolveObservationSources` 的宿主校验保留：对象里 sourceId 不存在仍是 `REVIEW_SOURCE_UNKNOWN`；行号越界、空行、引文不匹配仍按源错误码。

### D18 边界

- `ReviewRecord` 增加可选 `reviewedArtifact?: { workId: string, artifactId: string, revisionId: string }`，`reviewChapter` 接受并校验（三者非空、同一次 review 内一致），但本行**不生成**：
  - 没有 `artifact.identity` 行，拿不到真实的 artifact/revision；
  - 不用内容哈希、章节路径或 `review-<N>` 冒充 artifact identity。
- D18 保持未偿还，偿还位置仍是 `artifact.identity`；审计 `chapter.review` 行把 D18 的阻塞写清楚，不把本行算作已偿还。
- `artifact.identity` 落地后，审稿行只需从被审章节的 revision 填入 `reviewedArtifact`；本行先把字段与校验位置留好。

## Alternatives considered

- **接受 `"sourceId:line"` 字符串并解析。** 最强理由：模型已经这样传，兼容能少一次重试。否掉：源 schema 的 sourceRefs 是对象；字符串解析会把格式错误藏起来，且 `sourceId` 里含冒号时歧义。
- **在 `reviewChapter` 里把字符串当未知来源继续报错。** 最强理由：不改工具。否掉：模型直到执行才失败，错误码误导成来源不存在；应在工具入参就拒绝。
- **用章节内容哈希冒充 reviewedArtifact。** 最强理由：至少能记录被审版本。否掉：源字段是 `{workId, artifactId, revisionId}`，哈希不是 artifact identity；会制造假等价。
- **本行顺带实现 artifact.identity。** 最强理由：能一次还 D18。否掉：那是独立能力行（账本 `missing`），需要 artifact revision 存储与跨作品隔离，不是审稿行。

## Testing

- `story_review_chapter` 的 JSON schema 对 `observations` 与 `sourceRefs` 有完整字段与枚举；字符串 sourceRefs 在工具入参被拒绝，模型收到可重试的 schema 错误。
- 正常对象 sourceRefs（sourceId + quote 或 startLine/endLine）仍通过；`REVIEW_SOURCE_UNKNOWN` 只用于对象里 sourceId 真的不在 `chapter-N`／`governed-context`。
- `ReviewRecord.reviewedArtifact` 可选字段存在且有校验；本行不生成值；D18 仍记为未偿还，偿还位置 `artifact.identity`。
- 测试：review-tool schema 拒绝字符串 sourceRefs；observation 五类错误码与 unavailable 例外保持；`chapter-review` 落盘与重复拒绝保持。
- 真机：一次 review 用对象 sourceRefs 成功落盘；不再出现 `sourceRefs: ["governed-context:13"]` 这种输入。
- 审计/范围/账本/笔记/realRun 同步；`pnpm run verify` 与 CI 双端通过。
- `pnpm run verify` 301 例通过；`test/review-tool.test.mjs` 断言 observations/sourceRefs schema；`test/chapter-review.test.mjs` 覆盖 reviewedArtifact 记录与空 id 拒绝、五类校验与重复拒绝。
- 真机 review 用对象 sourceRefs 成功落盘；D18 `reviewedArtifact` 的真实值仍等 `artifact.identity`，不在本行生成。

## Consequences

- 严格 schema 可能让模型第一次调用失败；错误文案要说明 `sourceRefs` 是对象数组、字段名与可选行号。
- `reviewedArtifact` 字段留而未用，读者可能误以为 D18 已偿还；审计与 Note 必须明确“字段位留好，值等 artifact.identity”。
- `reviewSources` 的 `governed-context` 仍是章纲 memo，不是整份 package；引用来源仍以编号原文为准，本行不改来源集合。
- 工具 schema 与宿主校验是两道口；测试要覆盖“schema 拒绝”和“宿主拒绝未知 sourceId”两条，不把二者混成一个错误。
