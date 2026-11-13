# Agent Note: 工作台删除动作与白名单对齐

Status: implemented

## Problem

工作台（`panel.workbench`）曾有两处与源工程的章节工作台不一致：

- 删除动作：源 `ChapterWorkspacePanel.tsx:132-164` 在章节工作台提供「删除本章」按钮，确认后 `DELETE /books/:id/chapters/:num` 调 `deleteLatestChapter`（`studio/src/api/server.ts:3180-3186`）；复刻的面板只有对话动作，没有删除入口（D40）。
- 白名单：源真值文件浏览器只列 `author_intent.md`、`current_focus.md`、`book_rules.md`、`current_state.md`、`pending_hooks.md`、`chapter_summaries.md`、`style_guide.md`、`parent_canon.md`、`fanfic_canon.md`、`outline/story_frame.md`、`outline/volume_map.md`、角色卡与 `runtime/chapter-NNNN.{intent.md,plan.json,context.json,trace.json}`（`studio/src/api/server.ts:3228-3247,4189-4203`）。复刻面板多列了 `book_rules.json`、`source/brief.md`、`source/story/brief.md` 与 `.planner-context.json`（D41）。
- 真值文件编辑：源 `TruthFiles` 有 Edit/Save 与 PUT；复刻全部 `readonly`。作者已裁决 v1 保留只读，D39 保留，不在本行。

## 源工程证据

- `inkos/packages/studio/src/components/ChapterWorkspacePanel.tsx:132-164`：`deleteChapter` 先 `window.confirm` 再 `DELETE /books/:id/chapters/:chapterNumber`，成功后刷新章节与工作台。
- `inkos/packages/studio/src/api/server.ts:3180-3186`：删除端点只调 `deleteLatestChapter` 并广播 `chapter:deleted`；中章由核心拒绝。
- `inkos/packages/studio/src/api/server.ts:3231`：flat 白名单含 `fanfic_canon.md`；`:3228-3247` 定义 flat/outline/runtime 正则；`:4189-4203` 加入角色卡目录。
- `inkos/packages/studio/src/api/server.ts:3038-3046`：`latestChapter` 取章节索引的最大章号，`canDelete: num === latestChapter`。
- `inkos/packages/studio/src/hooks/use-i18n.ts:70-71`：删除按钮与确认文案。

## Decision

### 范围与非目标

- 范围：工作台页头在章节索引有最新章时增加「删除本章」（内联二次确认后执行）；新增 `/story-delete` 宿主命令调用 `deleteLatestChapter`；把面板展示白名单对齐源工程。
- 非目标：不补真值文件编辑（D39，作者裁决 v1 只读）；不改删除核心语义；不加新建表单、不作废审稿、不改会话协议。
- 删除仍只允许最新章，中章拒绝由核心保持。

### 交付行为

- 工作台的页头（导出控件旁）在章节索引的最新章 ≥1 时出现「删除本章」；位置与源页头删除按钮一致。
- 点击进入内联确认（「只允许删除最新章。确认删除并回滚到上一章状态？」＋确认／取消）；取消恢复按钮，不发命令；会话运行或提交中按钮禁用。
- 确认后执行 `/story-delete`：宿主在作品锁内读章节索引的最新章号，调 `deleteLatestChapter`（原文进 `.trash/`、状态与索引回滚），成功后工作台重新读索引并显示上一章的阶段。
- 命令提交后面板统一显示「已提交；结果显示在『对话』里」：DSH 的命令注入面只回 `matched`，拿不到 `kind:'error'` 的文本，面板不判断成功或失败。
- 面板白名单不再出现 `book_rules.json`、`source/brief.md`、`source/story/brief.md`、`.planner-context.json`；其余展示集合、诊断折叠与键值树不变。

### 决定与未决问题

- 删除入口走宿主命令而不是把提示投回会话：源是直接 API 调核心，命令能保持「确认后立即删除」且不依赖模型遵守提示。
- 用内联确认而不是 `window.confirm`：DSH 客户端没有使用浏览器确认框的既有面，内联确认可测试且不依赖 webview。
- 命令不带参数：读章节索引的最新章号；核心再校验「必须最新章」。这与源 `DELETE /chapters/:num` 的 `canDelete` 同源。
- `work.latestChapter` 来自章节索引；面板投影内 try/catch，索引缺失或损坏按 0，不让面板整体失败。
- 未决问题：无。

### 评审与批准证据

- Plan Review 第 1 轮：需修订（`planner-context` 的正则未改、命令错误文本到不了面板、动作落点与 scope 裁决冲突、`latestChapter` 与 `current_state` 双源、`window.confirm` 不可用）；已修正。
- Plan Review 第 2 轮：仍需修订（命令失败仍会被报成成功；坏索引会让投影失败；旧 Note／mapping 未列入同批）；已修正。
- Plan Review 第 3 轮：仍需修订（`readChapterIndex` 并非宽松读，兜底须在投影内；客户端段仍写通用失败提示；Risks 残留 `window.confirm`）；已修正。
- Plan Review 第 4 轮：仍需修订（兼容段仍写通用失败提示）；已改。
- Plan Review 第 5 轮：通过，无未解决 blocker/major。
- Implementation Review（Standards / Spec）：首轮各报 3／3 条；恢复 `fanfic_canon` 白名单、删除命令进锁、旧索引补 `latestChapter`、补 brief 缺失断言与 busy 禁用后复核通过。
- 批准与执行授权：2026-11-13，作者批准 `implement panel.workbench`。

## Design

### 面板索引

`src/core/panel-index.ts`：

- `TRUTH_FILES` 去掉 `STORY_RULES_JSON`、`BRIEF_FILE`、`STORY_EXTERNAL_BRIEF`；保留 `STORY_FANFIC_CANON_MD`。
- `DIAGNOSTIC_LABELS` 去掉 `planner-context`，运行时展示正则也去掉它。
- `work` 增加 `latestChapter`：`panel-index` 内用 try/catch 包住 `readChapterIndex`，缺失或坏 JSON／非数组／坏记录都按 0 继续投影，避免面板整体失败；共享读取不放宽。`currentChapter` 保持 `current_state.chapter` 语义。
- `PANEL_INDEX_VERSION` 升到 5；同步 `src/panel-types.ts` 与 `src/client/panel-types.ts`。

### 宿主命令

`src/plugin/delete-command.ts`：

- 命令名 `story-delete`，无参数；在 `withWorkAction` 内读 `chapters/index.json` 的最大章号（与面板同源），调 `deleteLatestChapter`；返回 `{ kind: 'success', text }` 或 `{ kind: 'error', text }`，由 DSH 显示在对话里。
- `src/plugin/agent.ts` 安装并释放；`test/host.test.mjs` 命令清单加入 `story-delete`。

### 客户端动作

- `src/client/Workbench.tsx`：页头在 `index.work !== null && index.work.latestChapter >= 1` 时渲染「删除本章」；点击进入内联确认（`confirmingDelete` 状态），确认调用 `onAction({ id: 'delete-chapter', ... })`，取消复位；`busy`／`running` 时禁用。
- `src/client/StoryView.tsx`：`normalizeIndex` 为旧索引补 `latestChapter: 0`；`handleAction` 对 `delete-chapter` 调 `command('删除本章', '/story-delete')`；面板只显示「已提交，结果在对话里」。

### 兼容与失败行为

- 旧索引缺 `latestChapter` 时在 `normalizeIndex` 补 0，按钮隐藏；宿主下次写入/发布重建。
- 删除命令失败不改任何文件；命令错误文本由 DSH 显示在对话里，面板不判断成功或失败。
- 白名单移除的文件仍可被宿主读取/工具使用；`StoryView` 的 `hasFoundation` 锚点不变（仍看 `book_rules.json` 是否存在）。

## Alternatives considered

- **把「删除本章」做成提示投回会话** — 复用现有动作通道。否掉：源是直接删除 API；提示要等模型调工具，多一轮且可能被忽略。
- **在客户端插件里直接调用删除核心** — 少一个命令。否掉：client 插件拿不到宿主文件写权限，且删除要作品锁与索引重建。
- **保留额外白名单项并在 mapping 登记** — 少改代码。否掉：源白名单明确不含它们，且两项是重复/内部文件，保留只会让面板噪声更大。
- **补真值文件编辑** — 更贴源。否掉：作者已裁决 v1 只读，D39 保留为后续工作。
- **用 `window.confirm`** — 与源一致。否掉：DSH 客户端没有该既有面，内联确认更可测。

## Testing

- `test/panel-index.test.mjs`（5 例）：索引 v5、展示集合与审批摘要分离、四项与 `planner-context` 不出现、`fanfic_canon` 仍显示、`latestChapter` 与坏索引按 0、foundation-ready 动作、提案无动作。
- `test/workbench.test.mjs`（11 例）：页头删除与内联确认/取消、busy 禁用、动作条、阶段导航、诊断折叠、JSON 键值树、无作品引导。
- `test/client.test.mjs`（29 例）：`/story-delete` 映射与「已提交」提示、确认/阶段动作、版本重读。
- `test/delete-command.test.mjs`（2 例）：删除最新章并回滚、空工作区按错误返回。
- `test/host.test.mjs`：命令清单含 `story-delete`；`test/panel-projection.test.mjs`：索引版本 5。
- `pnpm run verify` 全绿：433 tests；`artifacts/real-runs/panel.workbench.json` 已按新行为重录。
- D40／D41 已从 `docs/scope.md` 注销；D39 保留。

## Consequences

- 删除是不可逆动作（原文进 `.trash/` 可恢复）；确认文案保留「回滚到上一章」提示。
- 面板不判断命令成败，失败原因只出现在对话里；作者需要看对话确认是否删除。
- 移除白名单项后，面板不再提供 `book_rules.json` 的 JSON 视图；规则正文仍展示。
- D39 仍保留：真值文件只读，作者不能在工作台编辑真值文件。


