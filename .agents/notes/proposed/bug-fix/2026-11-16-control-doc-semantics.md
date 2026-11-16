# Agent Note: panel.workbench —— 作者意图条目的语义标注

Status: proposed

## Problem

真实工作区 `E:\novelist\test-novel\t001` 里两份文件内容相同（347／348 字节，同一句话）：

- `source/story/brief.md`（`STORY_EXTERNAL_BRIEF`）＝立项时作者确认的那句指令原文。
- `source/story/author_intent.md`（控制文档）＝同一句话 + 换行。

作者看到「两份一样的文件」，不知道哪份是权威、以后该改哪份；面板又把 `author_intent.md` 显示为没有限定的「作者意图」，`brief.md` 不在白名单里、看不到用途。这不是缺陷：建书时没有独立的「长期意图」输入，源就用同一份外部上下文兜底。缺的是把语义讲清楚。

## 源工程证据

- 建书时先把外部上下文写成 `story/brief.md`：`inkos/packages/core/src/pipeline/runner.ts:472`（正式目录 `bookDir`，`commitAtomicFileSet`）与 `:494`（暂存目录 `stagingBookDir`，`writeFile`），内容都是 `effectiveExternalContext`。
- 随后初始化控制文档时用 `options.authorIntent ?? effectiveExternalContext`（`inkos/packages/core/src/pipeline/runner.ts:501`）；`inkos/packages/core/src/state/manager.ts:93-98` 的 `writeIfMissing` 只在文件缺失时写，所以 brief 与 author_intent 初始内容相同。
- 源的浏览器白名单不含 `story/brief.md`：`inkos/packages/studio/src/api/server.ts:3228-3232` 的 flat／outline 白名单里没有它，`author_intent.md` 在列；复刻 `panel-index.ts` 的 `TRUTH_FILES` 与之一致。因此「brief 不进面板」「两者初始相同」都是源行为；改变它们需要作者裁决并登记偏差。
- 补充边界：`source/brief.md`（`BRIEF_FILE`，`core/work.ts:344`）是另一条路径（`createWork` 收到 `intent` 时写），与本项讨论的 `source/story/brief.md` 不是同一文件；本工作区没有该文件。

## Proposal

### 范围与非目标

- 范围：面板上 `author_intent.md` 的显示名补上语义；测试断言；本 Note 记录两份文件的来源、用途与分叉规则。
- 非目标：不改建书种子行为（不把 author_intent 写成空模板）；不把 `source/story/brief.md` 加进面板白名单；不改 `BRIEF_FILE` 的写入路径；不改 `readControlDocs`；不改 `docs/dsh-mapping.md`（本项不产生机制偏差，纯展示标注）；**不升 `PANEL_INDEX_VERSION`**（标题是既有字段，形状不变）。
- 跨项边界：只动 `panel-index.ts` 的标题常量与面板测试，属 `panel.workbench` 一行；与角色卡两项无共享文件。

### 产品行为与验收

- 面板「基础设定」阶段的作者意图条目显示为 **「作者意图（长期方向）」**，路径、顺序、只读语义不变（D39 仍成立）。
- 语义写清：`source/story/brief.md` = 立项时作者确认的指令原文（外部上下文，供 planner／composer 使用，不进面板）；`source/story/author_intent.md` = 长期方向文档，建书时用同一句话兜底，之后可各自独立改写。
- 验收：`test/panel-index.test.mjs` 的 `buildPanelIndex()` 夹具补 `author_intent.md`，断言产物的 `title` 为「作者意图（长期方向）」（直接钉住 `panel-index.ts` 的常量）；`test/workbench.test.mjs` 保留渲染冒烟。`pnpm run verify` 通过；重录 `artifacts/real-runs/panel.workbench.json`（process-level 即可）。本项不依赖真实 DSH 会话。

### 决定与未决问题

- 决定（本规划，2026-11-16）：**不改种子行为**。源的 `options.authorIntent ?? effectiveExternalContext` 是明确行为；改成空模板会让长期方向在建书后为空，偏离复刻，需作者裁决并登记偏差。
- 决定：不扩面板白名单。源白名单不含 `story/brief.md`，加进去属于展示偏差。
- 决定：用显示名承载语义。`PanelArtifact` 只有 `title` 能承载（`class` 决定阶段可见性、`type` 决定渲染），加字段会改索引契约与客户端。
- 未决：无。

### 评审与批准证据

- 规划授权：用户 2026-11-16 输入 `/planning 批准，执行规划 统一规划：①角色卡工具契约 ②角色卡目录权威 ③工作区外读取边界 ④控制文档语义`。
- Plan Review：第 1 轮指出本 Note 原挂 `foundation.control-docs` 行不对（唯一代码改动在 `panel-index.ts`）、源证据里暂存/正式目录标反、且把 `dsh-mapping` 编辑混进纯展示项。已改挂 `panel.workbench`、改正 472/494 的归属、去掉改 mapping 的范围；第 5 轮终评通过：Standards／Architecture 第 4 轮 clean，Spec 第 5 轮 clean。
- 实施授权：未授予。

## Design

- `packages/see-dsh-novel/src/core/panel-index.ts` 的 `TRUTH_FILES`：`AUTHOR_INTENT_FILE` 的标题由 `作者意图` 改为 `作者意图（长期方向）`；条目顺序、路径、`readonly`、`PANEL_INDEX_VERSION`（保持 8）都不变。
- 验证切入点：`test/panel-index.test.mjs` 新增标题断言（夹具补 `author_intent.md`，走 `buildPanelIndex()`，能真的因常量未改而失败）；`test/workbench.test.mjs` 的渲染冒烟不改。

## Alternatives considered

- **建书时把 author_intent 写成空模板。** 最强理由：两份文件立刻不同，作者不再困惑。否掉：源明确用 `options.authorIntent ?? effectiveExternalContext` 兜底；改空模板偏离源，需要作者裁决与偏差登记——而本次问题是「没解释」，不是「行为错」。
- **把 `story/brief.md` 也列进面板。** 最强理由：作者能看到两份并自行比较。否掉：源白名单不含它；两份内容相同只会加重困惑，且扩展示集合是要登记的偏差。
- **给 `PanelArtifact` 加 `description` 字段。** 最强理由：比改标题表达得更完整。否掉：会改索引契约与客户端类型，还要升 `PANEL_INDEX_VERSION`；标题已足够表达。

## Acceptance criteria

1. 面板显示「作者意图（长期方向）」，路径与只读语义不变。
2. `test/panel-index.test.mjs` 通过 `buildPanelIndex()` 断言新标题；`test/workbench.test.mjs` 渲染冒烟通过；`pnpm run verify` 通过；`artifacts/real-runs/panel.workbench.json` 重录。
3. 本 Note 写明两份文件的来源与分叉规则，并引用源证据（`runner.ts:472/494/501`、`manager.ts:93-98`）。

## Risks

- 标题变长可能在窄栏换行；面板列表本来就是多行布局，可接受。
- 只改标题不改种子，作者仍会看到两份内容相同；文档必须明确「建书时同源、之后独立」，否则困惑仍在。
- 若日后作者要求「建书后 author_intent 留空」，那是一次需要裁决的行为变更，本项不覆盖。
