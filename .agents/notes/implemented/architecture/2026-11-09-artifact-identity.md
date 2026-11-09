# Agent Note: artifact.identity —— 章节 revision、reviewedArtifact 与观察 target

Status: implemented

## Problem

`chapter.review` 的 D18 缺 `reviewedArtifact`；账本 `artifact.identity` 仍是 `missing`。上一版规划把章节 revision 写成 `source/artifacts/.../r1.md` 的副本，并在 current 存在时直接写 `reviewedArtifact`；对照 `agents/continuity.ts` 与 `models/observation.ts` 后，这两点都不对：

- 源章节 revision 的 `path` 就是章节文件本身（`continuity.ts:54-55`，`createCurrentArtifact` 用调用方 path）；没有副本。
- 源在写 `reviewedArtifact` 前比较 `chapterDocumentBody(current.bytes, chapterNumber, …)` 与本次被审正文（`continuity.ts:58-61`）；`chapterDocumentBody` 只剥掉**章号等于被审章**的标题，不是任意 `# ` 标题；不相等就**省略** `reviewedArtifact` 并继续审稿，不报错。
- 源 observation 的 `scope`、`targetHash`、`target{workId,artifactId,revisionId}` 是可选输出字段（`observation.ts:10-12`），但 `SourcedReviewToolSchema` 不接收它们（`agents/review-tool.ts:10-22`）；chapter audit 原样返回，模型不能提交。

## 源工程证据

- `harness/contracts.ts`：
  - `WorkResourceIdSchema`：1..120、无首尾空白、不含控制字符/`/\\:*?"'`{}<>|`、`..` 任意位置、`.`/`..`；
  - `HarnessIdSchema`：1..128、文件安全；
  - `ArtifactRevisionSchema`：`id`、`parentRevisionId: string|null`、`path`、`snapshotPath?`、`contentType`、`status: candidate|current|superseded`、`checksum`、`byteLength`、`episodeId?`、`createdAt`；
  - `ArtifactManifestSchema`：`id`、`kind`、`currentRevisionId: string|null`、`revisions`、`metadata`；恰好一个 current，`currentRevisionId` 必须指向 current。
- `harness/artifact-revisions.ts`：
  - `createCurrentArtifact` 只造 manifest，path 由调用方给；
  - `stageArtifactRevision` 对通用 artifact 写 revision 文件并更新 manifest；`parentRevisionId` 取上一 current；
  - `promoteArtifactRevision` 只切 current 并标 superseded。
- `agents/continuity.ts`：
  - 找 `source/chapters/<NNNN>_` 前缀的 current revision；
  - 读 revision bytes，`chapterDocumentBody` 后与本次 `chapterContent` 比较；
  - 源 `utils/chapter-document.ts` 的 `chapterDocumentBody(content, number, …)`：只剥掉 `chapterDocumentHeading(number, title, language)` 或 `readChapterHeading(line)?.number === number` 的标题；别的章号标题保留。
  - 相等才写 `reviewedArtifact`；缺失/不相等时省略，审稿继续；
  - `categoryRequired` 依 comparison；`scope`/`targetHash`/`target` 是 observation 输出可选字段，不是模型入参。
- `models/observation.ts`：`ObservationSchema` 的 `scope`、`targetHash`、`target` 可选；`sourceRefs` 是 `{sourceId, quote}` strict 数组。

## Decision

### 章节 artifact：path 就是章节文件

- manifest 放 `source/artifacts/manifest.json`（作品内容根下的可重建索引；源把 artifacts 嵌在 `WorkManifest`，复刻 `work.json` 是身份文件，独立 manifest 登记为 DSH 单工作区结构差异）。
- 章节 artifact：
  - artifactId `chapter-<NNNN>`；kind `chapter`；revisionId `r1`（后续 `r2`…）；
  - `ArtifactRevision.path` = `source/chapters/<NNNN>_<title>.md`（章节文件本身）；**不复制** revision 文件；
  - `parentRevisionId` 取上一 current；`snapshotPath?` 按源保留可选；`checksum`/`byteLength` 按章节文件 bytes；`contentType: text/markdown`；`status: current`；
  - artifact metadata 可记 `chapter` 号，但不再造第二份正文。
- `writeChapterDocument` 在写章节文档的同一次 `commitFoundation` 里调用 `createCurrentArtifact`/`stageArtifactRevision` 的 manifest-only 路径；章节首版拒绝覆盖不变；后续修订 `r2+` 不在本行但 store 允许。
- `readArtifactRevision(workId, artifactId, revisionId)` 从 revision.path 读文件；路径必须留在作品根内；workId 从 `work.json` 取，跨作品由单工作区隔离。

### manifest 不变量

- `currentRevisionId` 为 null 或指向恰好一个 `status: current` 的 revision；多于一个 current、当前 id 不指向它、parent 不存在都报错。
- `promoteArtifactRevision` 只切 current，旧 current 标 superseded；candidate 可存在但不 current。
- ID/路径按源 schema：`WorkResourceIdSchema` 用于 artifactId/workId，`HarnessIdSchema` 用于 revisionId；`..` 任意位置、首尾空白、控制字符、绝对路径都拒绝。
- `snapshotPath` 与 `parentRevisionId` 是字段契约；`parentRevisionId` 由 stage/promote 写入，`snapshotPath` 可选不伪造。

### 标题归一化

- `chapter-document.ts` 增加 `chapterBodyForChapter(content, chapter, language)`：只剥掉水平 1 级标题，且该标题解析出的章号等于 `chapter`（或等于生成的 `chapterDocumentHeading(chapter, '', language)`）；章号不匹配的标题保留。
- `renderChapterDocument`／`writeChapterDocument`、`loadChapterDocument`、`readCurrentChapterBody`、`reviewChapter` 的 revision/正文比较都用 `chapterBodyForChapter`；`chapterBody`（任意标题）不再用于章节身份/渲染路径。
- 测试：章号 2 的标题放在 `chapter-1` 文件中时，revision 与正文都保留该标题，字节比较不会误通过；写章节时错误章号的标题也保留。

### 审稿集成与 D18

- `reviewChapter`：
  - 找当前章 artifact 的 current revision（revision.path 以 `source/chapters/<NNNN>_` 开头且 `.md`）；
  - 读 revision bytes，用 `chapterBodyForChapter(bytes, chapter, language)` 后与本次被审章节正文（同样 number-aware）比较；
  - 相等 → `reviewedArtifact: {workId, artifactId, revisionId}`；
  - 缺失/不相等 → **省略** `reviewedArtifact`，审稿继续（源的 `continuity.ts:56,60`）；
  - 不比较时不用路径/哈希冒充。
- `ReviewRecord.reviewedArtifact` 可选；`reviewedArtifact` 由宿主从 artifact store 取，模型不能传；`story_review_chapter` 不接受该参数。
- `Observation`／`ObservationInput` 增加可选 `scope`、`targetHash`、`target`（`target` 三字段为字符串）；`story_review_chapter` 的 schema **不接收**这些字段，chapter review 不生成它们；仅其他 artifact review 的宿主路径可以带。现有 assessment/sourceRefs 行为不变。
- D18 在本行偿还：只有 number-aware 字节校验通过的 review 记录才带 `reviewedArtifact`；没有 artifact 的旧工作区仍可审稿，但记录无 identity（源行为）。

### 账本与结构差异

- `chapter.review` 的 implementation/consumer 更新为 `chapter-review.ts`／`review-tool.ts` 与 `chapter-review.test.mjs`／`review-tool.test.mjs`，不再只指 `observation.ts`。
- `docs/dsh-mapping.md` 登记：源 `WorkManifest.artifacts` → 复刻 `source/artifacts/manifest.json`；章节 revision path 直接用章节文件，不复制。
- 审计 `chapter.review` D18 标偿还；范围表删除 D18。`artifact.identity` 行更新实现/consumer/realRun。

## Alternatives considered

- **复制 revision 文件到 `source/artifacts/...`** — 最强理由：贴源 `stageArtifactRevision` 的写文件路径。否掉：源章节 revision 的 path 就是章节文件；复制会产生两份正文，且审稿字节校验要对副本，容易静默标错版本。
- **current 存在就写 reviewedArtifact** — 最强理由：简单。否掉：源在字节不相等时省略；不校验会把旧副本标成被审版本。
- **缺 revision 时拒绝审稿** — 最强理由：保证 identity。否掉：源省略 `reviewedArtifact` 继续审稿；拒绝是行为反转。
- **用哈希/路径冒充 reviewedArtifact** — 最强理由：不改存储。否掉：源字段是 artifactId/revisionId；哈希不是 artifact identity。
- **把 artifacts 嵌入 `work.json`** — 最强理由：贴 WorkManifest。否掉：`work.json` 是身份文件，产物可重建；独立 manifest 更符合复刻的存储边界。

## Testing

- 章节 artifact revision 的 `path` 是章节文件，不复制；manifest 的 current 恰好一个，`currentRevisionId`/parent/status/checksum/byteLength 正确；ID/路径按源 schema 拒绝越界。
- `writeChapterDocument` 写章节与 manifest 同一次提交；章节首版拒绝覆盖。
- `reviewChapter` 只在 revision bytes 用 `chapterBodyForChapter` 处理后等于被审正文时写 `reviewedArtifact`；缺失/不相等时省略并继续审稿；模型不能传 reviewedArtifact，也不能传 observation 的 `scope`/`targetHash`/`target`。
- Observation 的 `scope`/`targetHash`/`target` 只能是宿主/其他 artifact review 的可选输出；`story_review_chapter` schema 不接收；现有 sourceRefs/assessment 行为不变。
- `chapter.review` 账本实现/consumer 更新；D18 标偿还；`docs/dsh-mapping.md` 登记 manifest 位置与 path 使用方式。
- 测试：artifact store 的 current/promote/parent/snapshot/ID/path；chapter write 生成 manifest；review 三种情况（匹配写 identity、缺失省略、字节不匹配省略）；observation target 字段；账本。
- 真机：写一章 → 审稿 → review record 的 `reviewedArtifact` 指向章节 current revision；另一个工作区不串 id。
- `pnpm run verify` 与 CI 双端通过。
- `pnpm run verify` 305 例通过；`test/artifact-store.test.mjs` 覆盖 stage/promote/current、checksum、parent、路径/ID；`test/chapter-document.test.mjs` 覆盖 number-aware 标题；`test/chapter-review.test.mjs` 覆盖 reviewedArtifact 与无 artifact 省略；`test/review-tool.test.mjs` 覆盖 sourceRefs 对象 schema。
- 真机：写一章生成 `chapter-<NNNN>` 的 r1 current revision；审稿读取 current revision 并写 `reviewedArtifact`；D18 已偿还。

## Consequences

- 章节文件是唯一正文；manifest 只是索引，删除 manifest 可重建；审稿读章节文件，不读副本。
- 独立 manifest 是结构差异，必须在 dsh-mapping 登记，不能写成源 WorkManifest 等价。
- `reviewedArtifact` 可省略；D18 的“偿还”是能力可用，不是每个 review 必有 identity；审计要写清。
- `snapshotPath` 目前可选且不生成；`parentRevisionId` 由 store 生成，不能用模型输入。
