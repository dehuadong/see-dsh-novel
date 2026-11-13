# Agent Note: chapter.finalize —— 定稿：快照、章节索引与阶段推进

Status: implemented

## Problem

P4 的最后一行 `chapter.finalize` 曾是 `missing`。结算已经把四份状态与三份投影写进 `source/story/`，但还缺三样源工程在章节保存时一起写出的东西：

1. **逐章快照**：`source/story/snapshots/<chapter>/`（三份投影 + 四份状态 JSON），供回溯与后续的重结算基线；
2. **章节索引**：`source/chapters/index.json`（章号、标题、字数、观察、来源），源工程的 Studio 与章节列表读它；
3. **阶段推进**：定稿后作品状态从 `draft` 进入 `active`（源在每次 `saveChapter` 后、状态为 `outlining` 时改为 `active`，不按章号门控）。

没有这三样，P4 的出口与 D33 的“逐章快照”都没有落点。

## 源工程证据

- `inkos/packages/core/src/agents/writer.ts:364-450`：`saveChapter` 一次原子提交写章节文件、`story/current_state.md`、`story/pending_hooks.md`、`story/chapter_summaries.md`、四份 `story/state/*.json`、`story/snapshots/<chapter>/` 下同样的三份投影与四份状态 JSON，以及 `chapters/index.json`（章节元数据数组）；标题变化时删除被取代的章节文件。
- `inkos/packages/core/src/state/manager.ts:495-520`：`snapshotStateAt(bookDir, chapterNumber)` 把当前三份投影与 `state/*.json` 复制到 `story/snapshots/<chapterNumber>/`。
- `inkos/packages/core/src/pipeline/runner.ts:2106-2115`：`markBookActiveIfNeeded` 定义；`:1439` 在每次章节保存后调用，条件仅为 `status === "outlining"`（`chapter-persistence.ts:41`）。`:1424-1434` 是 truth-validation 观察合并，不是本函数。
- `inkos/packages/core/src/models/chapter.ts:5-16`：`ChapterMeta` 的字段——number、title、wordCount、createdAt、updatedAt、observations、provenance（`generated|imported|edited`）。

## Decision

### 核心：`finalizeChapter`

`src/core/finalize.ts`：

- 前置：本章有正文与审稿记录；状态已结算（`manifest.lastAppliedChapter === chapter`）；摘要表里有本章行。任缺都拒绝。
- 快照：`source/story/snapshots/<chapter>/` 写三份投影与 `state/` 下四份 JSON；内容取当前状态快照的渲染结果，不重新结算。
- 章节索引：读 `source/chapters/*.md`，解析标题与正文；`source/chapters/index.json` 写数组，entry 含 number、title、wordCount（`countChapterLength`）、createdAt／updatedAt（已有 entry 保留 createdAt，新 entry 用当前时间）、observations（取本章审稿记录，其它章取各自审稿记录，缺审稿则空数组）、provenance `generated`；按 number 排序。当前 `buildChapterIndex` 重建全部行并把各章 `updatedAt` 置 now，源 `saveChapter` 只替换本章 entry、其它行原样（`chapter-persistence.ts:23-40`），记 D49。缺索引时当前返回空数组重建、只查 number/title；源严格 `ChapterMetaSchema.parse`，并在索引缺失而章文件存在时拒绝（`manager.ts:456-461`），同记 D49。既有 `chapters/index.json` 解析失败时拒绝覆盖。
- 阶段推进：`work.json` 的 `status` 为 `draft` 时改为 `active`，更新 `updatedAt`；已是 `active` 不动。
- 一次 `commitFoundation` 写快照、索引与 `work.json`；返回 `{ chapter, snapshotPath, status, chapters }`。
- 幂等：重复定稿重写快照与整个索引数组，保留已有 createdAt；其它章的行会被重写、`updatedAt` 被置为当前时间（D49）。

### 工具：`story_finalize_chapter`

`src/pipelines/long/finalize-tool.ts`：

- 参数只有 `chapter`；执行在 `withWorkAction` 内调用 `finalizeChapter`。
- 输出 `{ chapter, snapshotPath, status, chapters }`，渲染成回执。

### 阶段与面板

- `chapter-done` 协议：作者要求定稿时调 `story_finalize_chapter`；定稿后本章闭环，下一章仍待后续能力。
- 面板不新增动作：定稿走对话/阶段协议；快照不在面板白名单里，章节索引不进面板。
- 定稿后阶段仍是 `chapter-done`；作品状态变为 `active`。

### 拆分：保真债 D37

- 源在结算后一次 `saveChapter` 提交章节、状态、快照与索引；复刻按工具边界拆成「写作/修订落章节 → 审稿 → 结算落状态 → 定稿补快照与索引」。按 `AGENTS.md`，流程拆分是保真债不是机制偏差：记 D37（`docs/scope.md`），`docs/dsh-mapping.md` 不登记，也不声称与源等价；跨工具的崩溃窗口由重新定稿补齐。

### 行与债务

- `capabilities.yaml` 的 `chapter.finalize`：implementation 指向 `src/pipelines/long/finalize-tool.ts`，consumer 指向 `test/chapter-finalize.test.mjs`，realRun 指向 `artifacts/real-runs/chapter.finalize.json`。
- D33：快照落地后，`state.check`／后续阶段可以用 `story/snapshots/<chapter>/` 做基线重结算；本行只负责写快照，不改结算的重算逻辑。
- D49（索引全量重建、缺索引重建、宽松校验）已由 [定稿只更新本章索引行](2026-11-13-chapter-finalize-index.md) 注销；D35／D37 保留。

## Alternatives considered

- **把快照并进结算工具** — 少一个工具。否掉：源快照是“章节保存”的产物，定稿是独立一行；并进结算会让“结算但未定稿”也留下快照，状态语义混淆。
- **不写 `chapters/index.json`，继续按文件发现章节** — 复刻现状更简单。否掉：这是源工程的可见产物（Studio 章节列表读它），缺产物是保真债；本行补上。
- **快照只写 Markdown 投影** — 更省。否掉：源快照同时写四份状态 JSON，供机器回溯；只写 Markdown 不够。
- **定稿后把 work 标成 `archived`** — 更强“完成”。否掉：源是 `outlining → active`，archived 不在源状态里，属于自创限制。
- **定稿时重建全部章节索引** — 更一致。否掉：索引要与已有 entry 的 createdAt 合并，重建会丢时间；只更新本章行并保留其它行。当前实现与该选择相反：`buildChapterIndex` 重建全部行并改写他章 `updatedAt`，记 D49。

## Testing

- `test/chapter-finalize.test.mjs`：快照七个文件与当前状态一致、索引字段与排序、`draft→active`、重复定稿保留 createdAt、未结算/缺审稿/坏索引拒绝。索引只有单章用例，多章 `updatedAt` 改写没有断言（D49）。
- `test/host.test.mjs`：工具清单包含 `story_finalize_chapter`。
- `test/stage-context.test.mjs`：`chapter-done` 协议包含 `story_finalize_chapter`。
- `pnpm run verify` 全绿；回执记录一次定稿与快照内容。

## Consequences

- 快照内容取定稿时刻的当前状态；若结算与定稿之间又写了状态，以当前状态为准（源的 `snapshotStateAt` 也是保存时刻的副本）。
- 章节索引的 observations 来自审稿记录；多章时其它章缺审稿会写空数组。
- 定稿不改变阶段，下一章规划仍要等对应阶段能力。
- 跨“结算—定稿”的崩溃窗口会留下没有快照的已结算状态；再调一次定稿即可补齐。
- 章节索引缺 `lengthTelemetry`／`tokenUsage`；标题变化触发的 superseded 文件清理在当前流程不可达（D35）。
- 章节保存在源是一次原子提交，复刻分步提交；中间态没有快照与索引，崩溃后再定稿补齐（D37）。
- 删除与对账消费上一章快照（`delete-chapter.ts:58-65`、`state-check-tool.ts:91-93`）；定稿不要求前章已定稿，第 1 章未定稿就定稿第 2 章时，删除/对账会因缺上一章快照失败。
