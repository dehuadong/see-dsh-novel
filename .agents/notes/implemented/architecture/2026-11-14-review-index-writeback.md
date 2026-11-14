# Agent Note: chapter.review —— 重审观察写回章节索引（D45）

Status: implemented

## Problem

D58 交付后，已发布章可以被恢复、修订或重开后复审；复审记录落 `source/story/runtime/chapter-NNNN.review.json`，但章节索引 `source/chapters/index.json` 仍停在上次结算/恢复时的观察。源工程的审稿路径在审完后把当次观察写回该章索引（`updatedAt` 与 `observations`），复刻没有这一步：作者重审后，索引里的 `manual-edit-review`、旧审稿观察或后代 `upstream-revision` 会一直保留，直到下一次修订/结算覆盖。

D45 的残余就是这一条：**已发布章重审后没有把当次 observations 写回索引**。D36 已随 D58 交付（恢复写索引观察），索引长度遥测（D35 已注销；`tokenUsage` 归 D60）与 D59（修订自动重结算）不在本行。

另有一处相邻但不同的问题：源 `resyncChapterStateAndAudit` 在重算后还会调用 `reviewChapter` 复审并刷新索引（`runner.ts:1238-1253`）；复刻的 `story_resettle_chapter` 按 D33 的既有合同只重建状态、不改正文/索引/workflow-start。因此重算后不会自动刷新索引观察，需要新观察时作者走 `story_review_chapter`（D58 入口），写回索引由本行覆盖。该差异登记在 `chapter.settle` 的偏差行，原因是 DSH 工具内不能跑审稿模型，自动复审由 D58 的审稿闸门承接。

## 源工程证据

- 源有两段审稿：`pipeline/chapter-review.ts:24-84` 的 `reviewChapterDraft` 在章节正文生成后、发布前审稿（`runner.ts:1340-1350` 调用），只返回观察，不碰章节索引；`pipeline/runner.ts:820-873` 的 `reviewChapter(bookId, chapterNumber)` 审已发布章，审完后读章节索引，把该章条目更新为 `{...ch, updatedAt: now, observations: [...result.observations]}` 并保存；`wordCount`、`provenance`、`title`、`createdAt` 不动。
- 同文件 `:852-867` 是上述 map/save，随后 `syncWorkSourceArtifacts` 接收 `source/chapters/index.json`；复刻的 work-source 同步已归 `artifact.identity` 的既有偏差，本行不新增。
- `inkos/packages/core/src/state/manager.ts:450-466` 的 `loadChapterIndex`：索引缺失但已有章节文件时报错；JSON 非数组或 schema 不符也报错。审稿读索引是严格读取。
- 源索引条目 `ChapterMeta` 的观察字段与审稿观察同形（code／summary／assessment／category／evidence／sourceRefs）；复刻的 `ChapterIndexEntry.observations` 已允许这些字段（`chapter-index.ts:24-26`），resolved 观察的 `sourceRefs` 是 `{sourceId, quote}`，与索引 schema 兼容。
- 复刻的草稿审稿对应源的 `reviewChapterDraft`：只落审稿记录、不写索引；已发布章审稿对应源的 `reviewChapter`：写回索引。

## Decision

### 范围与非目标

范围（`chapter.review` 一行）：

1. **已发布章审稿写回索引**：当被审章存在已发布文档（`loadChapterDocument` 非空）时，在写审稿记录的同一个 `commitFoundation` 里更新 `chapters/index.json` 的该章条目：`updatedAt` 置 now，`observations` 整体替换为本次 resolved 观察；其余字段（`title`、`wordCount`、`createdAt`、`provenance`、`lengthTelemetry`、`tokenUsage`）原样保留。
2. **严格读取**：已发布章审稿前用 `readChapterIndexStrict` 读索引；索引缺失（但章节文件在）、坏 JSON 或 schema 不符时拒绝审稿，且不写审稿记录（与源 `loadChapterIndex` 一致）。
3. **只更新已有行**：索引里没有该章条目时不补行、不改该章条目（源的 `map` 无匹配即内容不变；复刻不重写索引文件），审稿记录仍落盘。
4. **空字段拒绝**：观察的 `code`、`summary` 为空串，或显式 `sourceRefs[].quote === ''`，按 `REVIEW_SOURCE_REQUIRED` 拒绝；显式空白引文（只有空格）不额外收紧（源 `models/observation.ts:5-6,13` 的 `min(1)` 只拒空串；按行号解析出空白由 `models/observation.ts:39-41` 拒绝）。否则空字段会不经校验写进索引，而索引严格读取拒绝空 `code`／`summary`／`quote`，整份索引会不可读。这是本行必须一并修掉的校验缺口。
5. **草稿审稿不变**：草稿（只有 `.drafts/*.md`）审稿不读也不写索引；索引仍由结算发布写。
6. **同一次提交**：审稿记录与索引写在同一 `commitFoundation`；任一失败整批回滚。

非目标：

- 不改 `wordCount`／`provenance`／`title`／`createdAt`（源审稿只动 `updatedAt` 与 `observations`）。
- 不补缺失的索引行、不重建索引、不修索引 schema。
- 不改结算/恢复/修订；不碰 D35（已由后续注销）、D59、D58 的回退与 start 机制。
- 不新增工具或阶段；`story_review_chapter` 参数与回执字段不变。
- 不把 `sourceRefs` 的行号写进索引（resolved 观察已只有 `sourceId`＋`quote`）。

### 产品行为与验收

- 作者重审已发布章后，索引该章 `observations` 就是本次审稿的观察，`updatedAt` 变为本次时间；标题、字数、来源、创建时间不变。
- 作者重审草稿时，索引不出现该章的新条目或新观察。
- 索引缺失/损坏时，审稿被拒绝并说明先修复索引；不留下只有审稿记录、没有索引的中间态。
- 已发布章在索引里没有条目（旧工作区）时，审稿仍成功，但索引不被改写。
- 判定以「## Acceptance criteria」为准。

### 决定与未决问题

- **只对已发布章写回**：源的草稿审稿（`reviewChapterDraft`）在生成流程内只返回观察、不碰索引，索引由落盘时写（`chapter-persistence.ts:31`）；复刻的草稿审稿若写索引，会提前把未发布章写进 `chapters/index.json`，破坏「结算发布才进索引」的既有合同与 `story_recover` 的缺口判据。因此按 `reviewSources` 的 `published` 分流。
- **观察整体替换而不是追加**：源 `observations: [...result.observations]` 是替换；这样重审后旧的 `manual-edit-review`／旧审稿观察被清掉，留下当次结果。
- **不更新 `wordCount`／`provenance`**：源审稿只动 `updatedAt` 与 `observations`；字数与来源由修订/结算维护。
- **严格读取**：源 `loadChapterIndex` 对「索引缺失但章节在」报错；复刻沿用 `readChapterIndexStrict`，避免审稿静默跳过索引。
- **只更新已有行**：源 `index.map` 找不到该章时无变化；复刻不追加，避免掩盖索引缺口。
- **空字段必须拒绝**：源用 schema `min(1)` 拒绝空 `code`／`summary`（`models/observation.ts:5-6`）和空 `quote`（`:13`）；复刻现在只查 `source.includes(quote)`，空串会通过，写回索引后会让整份索引不可读。本行在 `resolveObservationSources` 对 `code === ''`、`summary === ''`、显式 `quote === ''` 补拒绝；显式空白引文不额外收紧。
- **重算的自动复审不并入**：源 `resyncChapterStateAndAudit` 在重算后调用 `reviewChapter`（`runner.ts:1238-1253`）；复刻的重算按 D33 合同只重建状态、不改正文/索引/workflow-start，重审走 `story_review_chapter`（D58 入口），写回由 D45 覆盖。该差异登记到 `chapter.settle` 的偏差行，原因是 DSH 工具内不能跑审稿模型。
- 未决问题：无。

### 评审与批准证据

- Plan Review 第 1 轮（Standards／Spec／Architecture 三线独立）：Standards 报 2 major（源有草稿审稿的证据错、审计/旧笔记同步漏项）＋2 minor（work-source 同步、AC5 字节不变）；Spec 报 1 major（空引文写回会让索引不可读）＋2 minor（注销清单、fixture/AC 可判定性）；Architecture 报 2 major（fixture 无索引会让现有用例全败、resettle 的自动复审会让 D45 无法真正关闭）＋2 minor（重复读取、草稿审稿证据）。已修：草稿/已发布分流证据、空 `code`/`summary`/`quote` 校验、fixture 补索引、`reviewSources` 返回 `{sources,published}`、resettle 自动复审登记为 `chapter.settle` 偏差、同步清单补 audit 三处与 9 篇旧 Note。
- 第 2 轮：Standards 指出源草稿审稿证据与结论仍矛盾、空引文规则过严、audit `chapter.settle` 未同步；Spec 指出「源没有草稿审稿」残留与空引文证据错位；Architecture 同样指出两处矛盾。已修：改为「源草稿审稿只返回观察、不写索引，索引由落盘写」；只拒显式 `quote === ''`（对齐源 `min(1)`）；补 audit/批次表/归档 Note 同步。
- 第 3 轮：Spec 指出空 `code`/`summary` 同样会让索引不可读；Standards 指出 resettle 偏差原因不应写成「工具内不能跑审稿模型」。最终写成「DSH 工具内不能跑审稿模型；自动复审由 D58 审稿闸门承接」，并把可观测后果写入 Risks/审计/评审证据。
- 第 4 轮：Architecture 通过；Spec 通过；Standards 修正最后两处措辞后通过。
- 作者裁决范围：2026-11-14，D45 作为 `chapter.review` 后续工作项执行。
- D33 重算合同：重算只重建状态，不改正文/索引/workflow-start；重算后的新观察由作者显式复审产生（D58 入口），不在重算内自动跑审稿。本行据此把重算的自动复审列为 `chapter.settle` 的偏差记录，不并入 D45。
- 作者批准实施（2026-11-14）：`/implement 批准，执行实现 D45`；执行授权覆盖实施、Implementation Review、范围内修正与 Verify。

## Design

### 审稿写回（core/chapter-review.ts）

- `reviewSources` 改为返回 `{ sources, published }`：一次读取决定草稿/已发布分支，避免 `reviewChapter` 再读一次文档造成判据漂移。
- `reviewChapter` 在 `reviewSources` 之后按 `published` 分流：
  - `published === true` 时 `const index = await readChapterIndexStrict(root)`；`const updated = reviewedChapterIndex(index, { chapter, observations, now })`（`core/chapter-index.ts` 的索引属主 helper，只更新该章 `updatedAt` 与 `observations`，无该章条目返回 null）；`updated !== null` 时把 `{ relativePath: CHAPTER_INDEX_PATH, content: JSON.stringify(updated, null, 2) + '\n' }` 与审稿记录一起写。
  - `published === false`（草稿）不读索引、不写索引。
- `resolveObservationSources` 在返回前拒绝空 `code`／`summary` 与显式 `quote === ''`（分别带 field/observationCode 与 instructions）；显式空白引文不额外收紧，按行号解析出空白仍走既有 `trim() === ''` 拒绝。这样索引写回不会引入空字段。
- 复用 `resolveObservationSources` 产出的 `Observation[]`；其字段与索引 schema 兼容。不再额外映射。
- `write` 集合：审稿记录 + 可选索引；一次 `commitFoundation`。审稿记录写失败或索引写失败都整批回滚。
- 返回值不变（`path`／`counts`／`observations`）；`review-tool` 回执不变。

### 失败行为

- 已发布章 + 索引缺失/坏 JSON/schema 不符：`readChapterIndexStrict` 抛错，审稿不落盘（包括审稿记录）；错误信息沿用索引模块的「先修复索引」。
- 已发布章 + 索引无该章条目：审稿记录落盘，索引文件不变。
- 草稿：不触发索引读取，行为与今天一致。
- 索引写失败：`commitFoundation` 回滚审稿记录与索引。

### 同步清单（六处）

1. `capabilities.yaml`：`chapter.review` 的 title 补「重审写回索引」，implementation 不变，realRun 重录；`check-capabilities -- --write`。
2. `docs/fidelity-audit.md`：`chapter.review` 段补「已发布章审稿写回 `updatedAt`／`observations`，草稿不写」；判定 D45 注销；`chapter.revise:408` 的「保真债 D45／D59」改为只留 D59；`chapter.reopen:440` 的 D45 残余句改为已注销；`chapter.settle:424/426` 补「重算不自动复审」并链 `dsh-mapping` 的新偏差行；批次表 E/F（`:532-533`）的「出口待债」去掉 D45。
3. `docs/scope.md`：删 D45 行；P4/P5 出口与依赖句改成只剩 D60/D61；D45 相关行移除。
4. `docs/dsh-mapping.md`：不改（该文件没有 D45 引用）；新增 `chapter.settle` 的「重算后自动复审」偏差行（源 `resyncChapterStateAndAudit` → DSH 只重建状态、重审走 D58 入口 → 工具内不能跑审稿模型 → `chapter-settle` 测试）。
5. `artifacts/real-runs/chapter.review.json`：重录，写清已发布/草稿/缺索引/缺行四条路径。
6. 本 Note 转 implemented；所有 D45 引用改为注销或链本 Note：`2026-11-10-chapter-reopen.md`、`2026-11-13-reopen-restore-split.md`、`2026-11-13-revise-index-changed-region.md`、`2026-11-14-chapter-reopen-closure.md`、`2026-11-10-chapter-revise.md`、`2026-11-11-chapter-revise-multirange.md`、`2026-11-13-chapter-settle-baseline.md`、`2026-11-13-chapter-atomic-save.md`、`2026-11-13-chapter-finalize-index.md`（archived，若改需遵守归档只读；不改则在审计注明历史）。

### 验证切入点

- `test/chapter-review.test.mjs`：fixture 现在有已发布章但没有 `index.json`，实施时给该 workspace 补第 1 章索引行（已发布用例），另开一个 workspace 测「索引缺失拒绝」；新增用例覆盖索引写回（`updatedAt` 区间、观察替换、其它字段保留）、草稿不写索引、索引无行、坏 JSON/schema 拒绝、空 code/summary/quote 拒绝。
- `test/chapter-reopen.test.mjs`：恢复（写 `manual-edit-review`）→复审后索引观察被本次结果替换、`manual-edit-review` 消失、`updatedAt` 前进；`wordCount`／`provenance` 仍是恢复时的值。
- `test/chapter-settle.test.mjs`：结算发布仍写索引；草稿审稿不提前写索引；重算不改正文/索引的既有断言保持。
- 文本断言：协议/回执不变，无需改。

## Verification

1. 已发布章审稿：索引该章 `updatedAt` 落在本次审稿的提交前/后时间区间内，`observations` 等于本次 resolved 观察（顺序、code／summary／assessment／category／evidence／sourceRefs 一致）。
2. 已发布章审稿不改 `title`、`wordCount`、`createdAt`、`provenance`、`lengthTelemetry`、`tokenUsage`。
3. 草稿审稿：`chapters/index.json` 不出现该章新条目、不新增观察；审稿记录照常落盘。
4. 已发布章 + 索引缺失/坏 JSON/schema 不符：审稿被拒绝，`chapter-NNNN.review.json` 不存在；错误说明先修复索引。
5. 已发布章 + 索引无该章条目：审稿记录落盘，该章条目内容不变（复刻不重写索引文件）。
6. 恢复（`manual-edit-review`）→复审：索引观察被本次结果替换，`manual-edit-review` 消失，`updatedAt` 前进；`wordCount`／`provenance` 保持恢复时的值。
7. 审稿记录与索引在同一次 `commitFoundation` 中写；提交失败时两者都不留（由提交层原子性保证，不承诺黑盒注入写失败）。
8. 空 `code`、空 `summary`、显式空 `quote`（`quote: ''`）的观察按 `REVIEW_SOURCE_REQUIRED` 拒绝，不落审稿记录、不写索引；显式空白引文不被额外拒绝。
9. D45 从 `docs/scope.md` 注销；审计判定改为等价；realRun、Note 转化、旧笔记引用与 `chapter.settle` 的重算复审偏差同步；`pnpm run verify` 全绿；CI 双端通过。

## 实施记录

- Plan Review 三轴：Standards／Spec／Architecture 均通过（第 4 轮确认）。
- Implementation Review 第 1 轮：Standards 报 3 major（realRun 计数、批准证据、偏差原因）＋3 minor（旧证据、引用、覆盖声明）；Spec 通过，另报覆盖缺口（`lengthTelemetry`/`tokenUsage` 未测、observations 未全等、空白引文未测）与 Design 表述。已修：realRun 490、批准证据、偏差原因改 DSH 机制、旧 Note/归档说明、引用改正；索引写回下沉 `reviewedChapterIndex`；补 schema/空白引文/时间区间/字段时间/全等断言。
- Implementation Review 第 2 轮：Standards 通过（余两项不阻塞判断：`updatedAt` notEqual 改 `>=`；空 code/summary 复用 `REVIEW_SOURCE_REQUIRED` 的命名问题保留）；Spec 通过。
- 验证：`pnpm run verify` 通过（490 passed／1 skipped symlink）；`verify-notes`、`check-capabilities`、`verify-audit-coverage` 通过；CI `43552345981` 的 `verify (ubuntu-latest)` 与 `verify (windows-latest)` 均通过（提交 `2468272`）。
## Alternatives considered

- **草稿审稿也写索引**：能让审稿后索引立刻有观察。否掉：源的草稿审稿只返回观察、索引在落盘时写；复刻提前写会让未发布章进入索引，破坏 `story_recover` 的「已发布未入索引」判据。
- **追加观察而不是替换**：保留历史。否掉：源是 `observations: [...result.observations]` 替换；追加会让旧 `manual-edit-review` 与旧审稿观察一直残留。
- **顺手更新 `wordCount`／`provenance`**：索引更一致。否掉：源审稿只动 `updatedAt` 与 `observations`；字数/来源由修订与结算维护。
- **索引缺失时跳过写回、只落审稿记录**：不阻断复审。否掉：源 `loadChapterIndex` 在章节存在但索引缺失时报错；跳过会掩盖缺口。
- **索引无行时补一行**：让观察有处可写。否掉：源 `map` 无匹配即无变化；补行会掩盖「已发布未入索引」的缺口。

## Consequences
收益：重审后索引立即反映本次观察，旧的 manual-edit-review/旧审稿观察不再残留；代价见下。

- **索引严格读取**：已发布章所在工作区若索引缺失/损坏，审稿会被拒绝；错误会指向修复索引，不会留下半份状态。旧工作区需先修复索引（与 `story_recover` 的出口一致）。
- **观察替换**：重审会清掉索引里此前的 `manual-edit-review` 与旧审稿观察；这是源行为，也是 D45 的目的。若作者只想补一条观察而不想替换，应在一次审稿里提交完整观察集。
- **索引体积**：观察的 `sourceRefs.quote` 会进索引；长引文会增大索引。源同样写入，本行不截断。
- **草稿边界**：草稿审稿不写索引；草稿在结算发布前索引仍无该章，属既有合同。
- **重算不自动复审**：`story_resettle_chapter` 只重建状态，不写复审 start、不刷新索引观察（D33 重算合同）；作者要新观察时必须显式走 D58 复审入口。该后果已写入 `chapter.settle` 的偏差行与审计。

