# Agent Note: chapter.reopen —— 重开与回滚

Status: implemented

> 后续更新（2026-11-14）：D45（重审观察写回索引）已由 [chapter.review —— 重审观察写回章节索引](2026-11-14-review-index-writeback.md) 注销。

> 后续更新（2026-11-14）：D36／D58 已由 [chapter.reopen —— 重开与恢复的闭环](2026-11-14-chapter-reopen-closure.md) 注销；恢复写索引观察与复审 start，重开从第 N-1 章快照回退。本文以下描述保留当时交付范围。

## Problem

P5 的第一行 `chapter.reopen` 曾是 `missing`。已定稿的章节没有回头路：正文只能被修订覆盖，历史版本只写不读；作者想把一章退回重写或恢复某个旧版本时，没有工具可用，面板也只能显示当前稿。

源工程把“章节重开/恢复”做成两件事：版本归档（`archiveChapterVersion`）与显式替换（`chapter-replace`，版本来源 `restore`）。恢复时清掉该章的运行时文件、记一条人工编辑观察，正文回到选中版本。

## 源工程证据

- `inkos/packages/core/src/state/chapter-workspace.ts:61-130`：版本 id 形如 `<13 位时间戳>_<来源>_<uuid>`，来源是 `manual|agent|revision|regeneration|restore`；目录 `chapters/.versions/<NNNN>/`；`listChapterVersions` 按时间倒序，`readChapterVersion` 只认合法 id。
- `inkos/packages/studio/src/api/server.ts:3026-3051`：版本列表（`:3034-3037` 的 `GET …/workspace` 返回 versions）；`:3132-3145` 读取版本；`:3147-3178` 的 `POST …/versions/:versionId/restore` 走 `chapter-replace`、版本来源 `restore`。
- `inkos/packages/core/src/interaction/edit-controller.ts:335-378`（`chapter-replace`）：正文去空白后不能为空、不能与当前完全相同；先把当前正文归档为指定来源，再写回替换文本；`clearChapterRuntimeFiles`（`:288-291`）删除 `story/runtime/chapter-NNNN.*`，但保留 `chapter-NNNN.user-brief.md`；章节索引追加一条人工编辑观察并更新字数。该入口对任意章可用，不改运行时状态。

## Decision

### 版本读取

`src/core/chapter-versions.ts`：

- `listChapterVersions(root, chapter)`：读 `source/chapters/.versions/<NNNN>/`，只认 `<13 位时间戳>_<来源>_<uuid>.md`；返回 `{ id, chapter, source, createdAt, characterCount }`，按 createdAt 倒序。
- `readChapterVersion(root, chapter, versionId)`：id 不合法或文件缺失都拒绝。
- 现有修订归档（`<ts>_revision_<uuid>`）天然落在同一命名规则里，不需要迁移。

### 重开

`src/core/reopen.ts` 的 `reopenChapter(root, chapter, options)`：

- 前置：本章是**最后已结算的一章**（`manifest.lastAppliedChapter === chapter`）。源 `chapter-replace` 对任意章可用且不动运行时状态；复刻把「重开回退」限制为最后一章（D33），恢复旧版也继承该限制（D44，作者裁决解耦）。
- 有 `versionId`：读该版本；正文与当前相同则拒绝（源的“already has the supplied content”）；把当前正文归档为 `restore`；替换章节文件。
- 无 `versionId`：只重开，不改正文（作者接着用修订/重写）。
- 清运行时：删除该章审稿记录与章纲 `chapter-NNNN.plan.json`；源清 `chapter-NNNN.*`、只保留 user-brief，当前仍残留 intent/planner-context/context/trace，记 D43。
- 重开授权：没有 start 时写 `workflow-start.json`（`instruction: 重开第 N 章`）；已有本章 start 就沿用。
- 状态回退：`manifest.lastAppliedChapter` 与 `current_state.chapter` 回到 `chapter-1`；删除该章摘要行（源不删，记 D43）；**facts/hooks 不回退**（没有按快照重算，D33），重开后的再次结算按增量应用。
- 一次 `commitFoundation` 写章节、归档、删除与状态文件。
- 返回 `{ chapter, versionId, archived, removed, stage }`。

### 工具

`src/pipelines/long/reopen-tool.ts`：

- `story_chapter_versions({chapter})`：只读列出该章版本（id、来源、时间、字数）。
- `story_reopen_chapter({chapter, versionId?})`：执行重开/恢复。`chapter` 必须当前是最后一章。
- 两个工具都注册在写作预设里；面板不加动作，重开走对话。

### 阶段与面板

- 重开后阶段回到 `plan`（start 有、章纲删了、正文还在）；作者重新规划本章。作者要求整章重写时，`plan` 协议指向 `story_revise_chapter`，不再尝试首次写作；只想恢复旧版时走恢复分支，不回退状态指针。
- 面板不新增动作：`chapter-done` 的根动作仍是修订，重开走对话；版本列表不进面板。

### 偏差与债务

- 恢复与重开已分流：恢复只换正文并清运行时、不动状态；重开把两个指针退回 `chapter-1` 并删除摘要行，facts/hooks 留待重结算。登记在 `docs/dsh-mapping.md`。
- D33：更早章节重开被拒绝；同章重开后的重结算按增量，旧 facts 可能残留；恢复旧版后的状态重建（源 `requiresTruthRebuild`）仍无等价流程。
- D36：不写索引 `provenance: edited` 与 `manual-edit-review` 观察；偿还位置改为 `chapter.revise` 的索引写入（D45 同批）。
- D43／D44／D55 已由 [重开与版本恢复分开](2026-11-13-reopen-restore-split.md) 注销。

## Alternatives considered

- **重开只改正文、不动状态指针** — 最贴近源恢复。否掉：`detectStage` 用 `current_state.chapter` 找下一章，指针不回退就会判到下一章，审稿与重结算都无法回到本章。
- **重开时用快照回退 facts/hooks** — 更完整。否掉：v1 只有章节 1 的快照，且结算还没接基线重算（D33）；先做指针回退并在 D33 记录。
- **把重开并进修订** — 少一个工具。否掉：修订要求正文有变化才写；重开允许“先退回再改”，还能恢复历史版本。
- **保留章纲、只删审稿** — 更省一次规划。否掉：源恢复清掉该章运行时文件；保留旧纲会让“重开”仍按旧计划写，作者没有机会改方向。
- **面板加“重开”动作** — 可见性更好。否掉：P5 的面板动作面还没设计；先走对话，避免在会话外造第二套章节 UI。

## Testing

- `test/chapter-reopen.test.mjs`（7 例）：版本列表倒序与非法 id 忽略、读取版本；重开清全部 `chapter-NNNN.*`（保留 user-brief）、指针回退到 0、摘要行删除、start 写入/沿用、阶段回到 `plan`；任意章恢复归档当前正文且不动状态与摘要；更早章恢复；同内容拒绝且不写；非法版本 id 拒绝。
- `test/host.test.mjs`：工具清单包含 `story_chapter_versions` 与 `story_reopen_chapter`。
- `test/stage-context.test.mjs`：`plan` 段的条件修订指令与 `chapter-done` 的两个重开工具。
- `pnpm run verify` 全绿；回执记录重开与版本恢复。

## Consequences

- facts/hooks 不回退：重开后的当前状态可能仍带旧章事实，直到重结算按增量替换；D33 的基线重算是根治。
- 删除章纲后必须重新规划才能审稿；作者如果只想改几个字，修订路径仍更合适。重开后的「整章重写」当前不可达（D55）。
- 版本 id 解析与修订归档共用一套命名；新增来源时必须同步 `CHAPTER_VERSION_SOURCES`，否则列表会漏。
- 重开只对最后一章有效；逐章快照已由 `chapter.finalize` 写出，仍未接按快照的基线重算（D33）；恢复旧版应按作者裁决与重开回退解耦（D44）。
- 恢复/重开不更新 `chapters/index.json` 的 `provenance: edited` 与 `manual-edit-review` 观察（D36）。
