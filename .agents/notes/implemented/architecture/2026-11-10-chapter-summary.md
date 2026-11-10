# Agent Note: chapter.summary —— 结构化章节摘要

Status: implemented

## Problem

`chapter_summaries` 的状态表与投影已经播种（`state/chapter_summaries.json`、`chapter_summaries.md`），但没有写入路径：P4 第一行 `chapter.summary` 曾是 `missing`。

源工程把章节摘要放在结算里产出：settler 的工具 schema 带 `chapterSummary`（title／characters／events／stateChanges／hookActivity／mood／chapterType），`RuntimeStateDelta` 应用时校验章节匹配与重复行，再随状态快照落盘。本项目把 P4 拆成 summary → settle → finalize，本行先交付摘要的写入与投影，事实/伏笔结算留给下一行。

## 源工程证据

- `inkos/packages/core/src/agents/settler-tool.ts:21-62`：结算工具 schema 的 `chapterSummary` 字段就是七个维度（title、characters、events、stateChanges、hookActivity、mood、chapterType）。
- `inkos/packages/core/src/models/runtime-state.ts:39-56`：`ChapterSummaryRowSchema` 要求 `chapter` 为 ≥1 整数、`title` 非空，其余为字符串，且 `.strict()`；`ChapterSummariesStateSchema` 是 `{ rows }`。
- `inkos/packages/core/src/state/state-reducer.ts:195-213`：`applySummaryDelta` 按 chapter 排序；重复章节只在 `allowReapply`（重结算）时替换，否则校验错误；`:41-50` 校验章节号匹配与重复行。
- `inkos/packages/core/src/pipeline/runner.ts:1438-1450`：结算输出（含摘要）随章节一起持久化；摘要不是单独的可见步骤。

## Decision

### 写入：`writeChapterSummary`

`src/core/chapter-summary.ts`：

- 输入 `{ chapter, summary }`，`summary` 为七个字符串字段。
- 校验：`chapter` 为 ≥1 的整数；`title` 去空白后非空；其余字段必须是字符串（允许空串）；行内章号必须与参数一致。
- 前置：该章必须有正文与审稿记录（摘要发生在审稿之后）；缺任一都拒绝。
- 既有 `chapter_summaries.json`：文件缺失按空表；**内容非法时拒绝**，不用默认值覆盖损坏的状态。
- 写入：同一章的行存在时替换（修订后重审再写摘要就是重结算），按章号升序；一次 `commitFoundation` 写 `state/chapter_summaries.json` 与该表的 Markdown 投影。投影语言取 `readManifestLanguage(root) ?? 'zh'`（与其它状态投影一致）。
- 返回 `{ chapter, title, total, path }`。

### 工具：`story_summarize_chapter`

`src/pipelines/long/summary-tool.ts`：

- 参数：`chapter` 与嵌套的 `summary`（七个字段，schema 严格，不允许额外键）。
- 执行：`withWorkAction` 内调用 `writeChapterSummary`；输出 `{ chapter, title, total, path }`，渲染成一句回执。
- 摘要内容由主编派 settler 子代理按本章正文与审稿产出（源也是 settler 的产物），宿主只校验结构与写入。

### 阶段与面板

- `chapter-done` 协议增加一步：作者要求摘要/结算时，派 settler 子代理产出七字段，再调 `story_summarize_chapter`；**事实与伏笔结算仍待下一行**，摘要写完即停。
- 不新增面板动作：修订已经是 `chapter-done` 的根动作，摘要走对话/阶段协议；面板的 review 产物与摘要投影都能直接查看。

### 行与债务

- `capabilities.yaml` 的 `chapter.summary`：implementation 指向 `src/pipelines/long/summary-tool.ts`，consumer 指向 `test/chapter-summary.test.mjs`，realRun 指向 `artifacts/real-runs/chapter.summary.json`；状态由 `check-capabilities` 依据证据生成。
- `docs/fidelity-audit.md` 的 `chapter.summary` 段改为「机制等价（拆分登记）」；`docs/scope.md` 的 P4 描述同步。
- 源把摘要与 facts/hooks 放在同一个结算提交里；本行先写摘要，`chapter.settle` 已把三者收进同一提交（D32 收口）。

## Alternatives considered

- **只做 `chapter.settle`，把摘要并进去** — 少一个工具。否掉：账本已有 `chapter.summary` 行；摘要与事实/伏笔是两类产物，先做摘要能让面板先显示章节摘要，结算行再做事务合并。
- **审稿完成时自动写摘要** — 与源一致（结算自动）。否掉：摘要内容要模型产出，宿主不能在审稿工具里跑模型；阶段协议驱动是机制等价的落点。
- **摘要只存在审稿记录里** — 少一份状态。否掉：源有独立的 `chapter_summaries` 状态与投影；记忆检索（P2）也读这张表。
- **重复章节直接拒绝，不做替换** — 更贴近源的非重结算路径。否掉：修订后重审必须能重写摘要；用替换表达重结算，删除路径与排序仍与源一致。
- **重算投影而不是写文件** — 更“纯”。否掉：投影是模型与作者读的文件，必须与 JSON 同批落盘。

## Testing

- `test/chapter-summary.test.mjs`：七字段写入与投影、按章号排序（含手动播种的第二行）、同章替换、工具回执与行数、缺正文/缺审稿拒绝、非法章号/空标题/字段类型/坏 JSON 拒绝且不写。
- `test/stage-context.test.mjs`：`chapter-done` 协议含 `story_summarize_chapter`。
- `test/host.test.mjs`：工具清单包含 `story_summarize_chapter`。
- `pnpm run verify` 全绿；`artifacts/real-runs/chapter.summary.json` 记录写入与投影。

## Consequences

- 摘要质量取决于 settler 子代理；宿主只保证结构、章节匹配与不覆盖坏状态。
- 摘要在事实/伏笔结算之前写入；如果后续结算失败，摘要仍会存在，需要 `chapter.settle` 的重结算路径允许替换（本行已允许同章替换）。
- 源在结算事务里同时写 facts/hooks；本行单独写摘要是阶段性拆分，结算行落地后已把摘要并入同一提交。
- 不新增面板动作：摘要是对话/协议动作，面板只读地展示 `chapter_summaries.md` 与其他产物。
