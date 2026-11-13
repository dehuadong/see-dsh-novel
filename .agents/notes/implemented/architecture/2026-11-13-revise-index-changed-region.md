# Agent Note: 修订更新索引与回执

Status: implemented

## Problem

`story_revise_chapter` 曾只落盘新正文、归档旧稿、追加 artifact revision 并作废旧审稿，不更新 `source/chapters/index.json`，回执也没有实际改动区域。源工程的修订路径两者都做：

- `pipeline/runner.ts:1090-1120`：当前章条目更新 `wordCount`、`updatedAt`、`observations`、`provenance: "edited"`；所有章号大于当前章的条目更新 `updatedAt` 并把 `upstream-revision` 观察换成「第 N 章已重写，请重新检查本章与前文的连续性」；索引随章节写入。
- `harness/tools/longform-production.ts:285,307`：`revise_chapter` 回执带 `changedRegion`，形状来自 `utils/source-text.ts:31-37`（`scope: "contiguous_changed_region"`，前后各一段 `startLine`／`lineCount`／`content`／`truncated`）。

追溯评审记为 D45（索引与后代标记）与 D56（回执缺 `changedRegion`）。D36（恢复旧版的索引观察）属于 reopen 恢复路径，不在本行。

## 源工程证据

- `inkos/packages/core/src/pipeline/runner.ts:1090-1120`：当前章与后代条目的更新规则、语言相关的通知文案、`updatedAt` 取当前时间。
- `inkos/packages/core/src/pipeline/runner.ts:1156`：回执 `changedRegion: changedSourceRegion(正文, 修订后正文)`。
- `inkos/packages/core/src/utils/source-text.ts:31-37`：按行找最小连续改动区，`before`／`after` 各自截断到 2000 字符并标 `truncated`。
- `inkos/packages/core/src/interaction/edit-controller.ts:305-325` 是手动替换的另一条观察路径（`manual-edit-review`），不在本行。

## Decision

### 范围与非目标

- 范围：修订后更新章节索引的当前章条目与后代 `upstream-revision` 观察（含 `changed=false` 的索引刷新）；回执补 `changedRegion`；索引缺当前行时追加并登记偏差。
- 非目标：不改 `changed=false` 的归档/审稿作废/revision 写入（保持无改动）；不写 `lengthTelemetry`／`tokenUsage`（D35）；不改 artifact revision 内容（D42 的 `snapshotPath` 仍缺）；不处理恢复路径的索引观察（D36 留给 reopen 后续工作项）；不改定稿对 `provenance` 的覆盖（D45 的残余见下）。

### 交付行为

- 修订成功（`changed=true`）时，`chapters/index.json` 的当前章条目更新 `wordCount`（按作品语言计数）、`updatedAt`、`provenance: "edited"`；`observations` 清空（本次没有 post-revision 观察来源，旧观察不再对应当前正文）。
- 当前章条目不存在时（尚未定稿）追加一条：`createdAt = updatedAt = now`、`provenance: "edited"`、`observations: []`、标题取章节文档头。
- 章号更大的条目：`updatedAt = now`，`observations` 移除旧 `upstream-revision` 后追加一条 `{code:'upstream-revision', summary:<语言相关通知>, evidence: []}`；其它字段不变。
- 索引缺失或非法时在写盘前拒绝（与定稿/删除的严格读取一致）；祖先条目不变。
- 回执新增 `changedRegion`：`scope: "contiguous_changed_region"`，`before`／`after` 各含 `startLine`、`lineCount`、`content`（最多 2000 字符）、`truncated`；渲染文本序列化该对象。
- `changed=false`（正文与原文相同）仍按源的后置路径更新索引：当前章 `updatedAt`／`provenance: "edited"`／`observations: []`，`wordCount` 按正文重算；后代同样刷新并替换提醒。不归档、不写 revision、不作废审稿；回执返回空区域（`lineCount: 0`）。

### 决定与未决问题

- `observations` 清空：源用本次 reviser 产出的 post-revision 观察替换旧观察；复刻的修订工具没有该输入（重审观察在 `review.json`，定稿才进索引），保留旧观察会让索引与修订后正文不一致。`changed=false` 时 `review.json` 仍有效，索引的清空是「等下次审稿/定稿再填」的预期中间态。
- 索引缺当前行时追加：源在写章节时就写索引，复刻在定稿才写；这是 DSH 的定稿拆分导致的机制差异，登记 `dsh-mapping.md` 偏差行。
- `changed=false` 仍更新索引并返回空区域：源在 reviser 返回后即使正文未变也会重写索引（`runner.ts:1090-1138`）。
- D45 只在本行交付「修订落盘时的索引更新与后代标记」；重审→结算→定稿后 `finalizeChapter` 会把该行写成 `generated`，`edited` 不跨定稿，这条残余保留在 D45 描述里。
- 未决问题：无。

### 评审与批准证据

- Plan Review 第 1 轮：需修订（`changed=false` 的映射与源不符；索引缺行追加未登记偏差；D45 跨定稿的残余被过度注销；写入位置二选一未定；行切分未保留终止符、文案行号错）；已修正。
- Plan Review 第 2 轮：仍需修订（`changed=false` 应映射源的后置路径而非 reviser 前早退；Design 仍写「工具传入或内部读取」）；已改。
- Plan Review 第 3 轮：仍需修订（Design 仍写「只在 changed=true 出现」；`changed=false` 的后代标记未定；observations 清空与有效 review 的中间态未声明）；已改。
- Plan Review 第 4 轮：通过，无未解决 blocker/major。
- Implementation Review（Standards / Spec）：首轮各报 5／4 条；补渲染区域、索引拒绝/英文/截断断言、`IndexObservation` 类型、抽出 `revisedChapterIndex` 后复核通过。
- 批准与执行授权：2026-11-13，作者批准 `implement chapter.revise`。

## Design

### 索引更新

`src/core/chapter-document.ts` 的 `reviseChapterDocument` 读取 `readChapterIndexStrict(root)`，交给 `src/core/chapter-index.ts` 的 `revisedChapterIndex` 构造 `nextEntries`：

- 当前章：已存在则更新 `wordCount`／`updatedAt`／`observations`／`provenance: 'edited'`，保留 `createdAt`、`title`、以及可选遥测字段原样；不存在则追加新行（`title` 由文档头经 `chapterTitleOf`，`createdAt = updatedAt = now`）。
- 后代：`updatedAt = now`，`observations` 过滤 `upstream-revision` 后追加通知；`summary` 按 `work.language` 选中文或英文文案。
- 同一次 `commitFoundation` 写章节、归档、artifact revision、索引与（可选）workflow start。

索引观察类型收窄为 `IndexObservation`（`code`／`summary`／`evidence` 必填，其余可选），与源索引观察的形状一致。

### 改动区域

`src/core/revise.ts` 的 `changedRegion(before, after, maxChars = 2000)`：

- 行切分保留终止符（`/[^\n]*\n|[^\n]+$/g`）；按行前缀/后缀剥离，找最小连续区；前后各自 `slice(0, maxChars)` 并标 `truncated`。
- 正文用 `document.content` 与修订后的 `body`（都已去标题行）。
- `revise-tool.ts` 的 `ReviseResult`、输出 schema（`changedRegion` 必填）与渲染文本加入该字段，渲染文本序列化整个对象。

### 偏差登记

`docs/dsh-mapping.md` 的 `chapter.revise` 偏差行补：源在写章节时已有索引行，复刻定稿才写索引，修订遇到缺行时追加 `edited` 行；原因：DSH 把索引写入放在定稿；验证：修订后索引含当前行与后代观察。

### 兼容与失败行为

- 索引缺当前章行时追加，不要求先定稿；已有行保留 `createdAt`。
- 索引非法/缺失 → 修订在写盘前拒绝；旧正文与版本归档都不写。
- `changed=false` 跳过归档、revision、审稿作废与 workflow start，但提交索引刷新；回执返回空 `changedRegion`，`revisionId` 为空串。
- 测试 fixture 补种 `source/chapters/index.json`；`chapter-revise.test.mjs` 覆盖索引、后代、拒绝与区域。

## Alternatives considered

- **只在定稿时更新索引** — 少改修订路径。否掉：源在修订落盘时就更新，且会给后代加连续性提醒；等到定稿会丢失「哪些章受影响」。
- **保留旧 observations** — 少一次清空。否掉：旧观察描述的是修订前正文，保留会误导；源用新观察替换。
- **索引缺失时按章节文件重建** — 容错好。否掉：源严格读取并拒绝；重建会掩盖损坏。
- **回执只给文本摘要** — 实现简单。否掉：源回执的 `changedRegion` 是结构化的前后行区域，模型用它核对改动范围。
- **为 `changedRegion` 复用 diff 库** — 更精确。否掉：源就是最小连续行区，不需要引入依赖。

## Testing

- `test/chapter-revise.test.mjs`（18 例）：原有范围/构造/归档/revision 用例；索引当前章字段与 `createdAt` 保留、追加行标题、`wordCount`、后代 `upstream-revision` 与英文文案、缺索引/坏 JSON 拒绝且不写、`changed=false` 空区域、spot-fix 前后区域、2000 字符截断、渲染文本含区域。
- `test/host.test.mjs` 与 `test/stage-context.test.mjs` 回归。
- `pnpm run verify` 全绿：426 tests；`artifacts/real-runs/chapter.revise.json` 已按新行为重录。
- D56 已注销；D45 收窄为「定稿覆盖 edited」的残余；`dsh-mapping.md` 补追加索引行的偏差。

## Consequences

- 修订会创建或更新索引行；后续定稿会用审稿观察与 `generated` 覆盖当前行，`edited` 只保留到定稿（D45 残余）。
- 清空 observations 会丢掉旧审稿观察；正文已变，旧观察不再对应。
- 索引严格化会让没有索引的旧工作区无法修订；需要先补索引（与定稿/删除一致）。
- `changed=false` 现在也写索引（源行为），不再是完全无写盘；依赖旧「no-op 不写」的调用方会看到索引更新。
