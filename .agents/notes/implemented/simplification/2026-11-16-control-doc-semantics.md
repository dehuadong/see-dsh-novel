# Agent Note: panel.workbench —— 作者意图条目的语义标注

Status: implemented

## Problem

真实工作区 `E:\novelist\test-novel\t001` 里两份文件内容相同（347／348 字节，同一句话）：

- `source/story/brief.md`（`STORY_EXTERNAL_BRIEF`）＝立项时作者确认的那句指令原文。
- `source/story/author_intent.md`（控制文档）＝同一句话 + 换行。

作者看到「两份一样的文件」，不知道哪份是权威、以后该改哪份；面板又把 `author_intent.md` 显示为没有限定的「作者意图」，`brief.md` 不在白名单里、看不到用途。建书时没有独立的「长期意图」输入，源就用同一份外部上下文兜底——缺的是把语义讲清楚。

## 源工程证据

- 建书时先把外部上下文写成 `story/brief.md`：`inkos/packages/core/src/pipeline/runner.ts:472`（正式目录 `bookDir`，`commitAtomicFileSet`）与 `:494`（暂存目录 `stagingBookDir`，`writeFile`），内容都是 `effectiveExternalContext`。
- 随后初始化控制文档时用 `options.authorIntent ?? effectiveExternalContext`（`inkos/packages/core/src/pipeline/runner.ts:501`）；`inkos/packages/core/src/state/manager.ts:93-98` 的 `writeIfMissing` 只在文件缺失时写，所以 brief 与 author_intent 初始内容相同。
- 源的浏览器白名单不含 `story/brief.md`：`inkos/packages/studio/src/api/server.ts:3228-3232` 的 flat／outline 白名单里没有它，`author_intent.md` 在列；复刻 `panel-index.ts` 的 `TRUTH_FILES` 与之一致。
- 边界：`source/brief.md`（`BRIEF_FILE`，`core/work.ts:344`）是另一条路径（`createWork` 收到 `intent` 时写），与本项讨论的 `source/story/brief.md` 不是同一文件。

## Decision

- 面板「基础设定」的作者意图条目显示为 **「作者意图（长期方向）」**；路径、顺序（100）、只读语义与索引版本都不变。
- 语义：`source/story/brief.md` = 立项时作者确认的指令原文（外部上下文，供 planner／composer 使用，不进面板）；`source/story/author_intent.md` = 长期方向文档，建书时用同一句话兜底，之后可各自独立改写。
- 不改建书种子行为，不把 `story/brief.md` 加进面板白名单，不改 `readControlDocs`，不改 `PANEL_INDEX_VERSION`（保持 8）。

## Design

- `packages/see-dsh-novel/src/core/panel-index.ts` 的 `TRUTH_FILES`：`AUTHOR_INTENT_FILE` 的标题改为「作者意图（长期方向）」，其余行与顺序不动。
- 验证切入点：`test/panel-index.test.mjs` 的夹具补 `source/story/author_intent.md`，走 `buildPanelIndex()` 断言标题与只读标志（常量若被改回，断言必红）；`test/workbench.test.mjs` 保持渲染冒烟。
- `Workbench` 原样渲染 `title`，组件不改。

## Alternatives considered

- **建书时把 author_intent 写成空模板。** 最强理由：两份文件立刻不同，作者不再困惑。否掉：源明确用 `options.authorIntent ?? effectiveExternalContext` 兜底；改空模板偏离源，需要作者裁决与偏差登记——而这次问题是「没解释」，不是「行为错」。
- **把 `story/brief.md` 也列进面板。** 最强理由：作者能看到两份并自行比较。否掉：源白名单不含它；两份内容相同只会加重困惑，且扩展示集合是要登记的偏差。
- **给 `PanelArtifact` 加 `description` 字段。** 最强理由：比改标题表达得更完整。否掉：会改索引契约与客户端类型，还要升 `PANEL_INDEX_VERSION`；标题已足够表达。

## Consequences

- 作者在面板上能直接看出这条是「长期方向」，与不进面板的立项原文区分开。
- 只改标题不改种子，两份文件在建书时仍相同；区别靠显示名与本文档说明承载。
- 账本与证据：`panel.workbench` 的 real-run 重录（process-level）；`fidelity-audit.md` 判定不变（展示标注，非行为偏差）；`scope.md` 与 `dsh-mapping.md` 无变化（不新增债、不新增偏差）。
- 已知边界：若日后作者要求「建书后 author_intent 留空」，那是一次需要裁决的行为变更，本项不覆盖。
- Implementation Review 的发现已修：real-run 未重录（已重录）；Note 生命周期未推进且 `bug-fix` 分类与「这不是缺陷」矛盾（已转 `implemented/simplification/`）；只读语义缺断言（已补）。

## Testing

- `test/panel-index.test.mjs`：夹具含 `source/story/author_intent.md`，断言标题为「作者意图（长期方向）」且 `readonly` 为真。
- `pnpm run verify`：见 `artifacts/real-runs/panel.workbench.json` 的当前计数。
