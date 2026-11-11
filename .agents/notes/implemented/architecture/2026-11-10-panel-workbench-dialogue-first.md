# Agent Note: panel.workbench —— 对话立项、宿主投影的作品工作台

Status: implemented

## Problem

「作品」页原本是一张 foundation 状态卡：只有「开始基础设定」「查看待确认」「认可」「退回」「开始下一章」「稍后」。工作台组件与 `panel.index.json` 已经写出来，但真实桌面里从没进过工作台：索引文件存在（`.artifacts/work-real/source/story/runtime/panel.index.json`，生成于 2026-11-09 18:19），面板仍显示旧卡文本。索引读取失败被 `catch` 写进一个在旧卡分支不渲染的 notice，于是失败静默、回退旧卡，作者看不出是通道还是文件的问题。

上一版方向还有两个产品冲突。第一，把新作品做成面板表单并给 `/story-init` 加 `--brief-text`——立项只发生在对话（`story_propose`／`story_work_create`），面板不是第二个立项入口。第二，让面板在挂载/动作后调 `/story-index`——索引是宿主投影，写 action 成功后由宿主重建，作者不需要执行命令，面板也不该成为触发者。

## 源工程证据

- `inkos/packages/studio/src/pages/BookDetail.tsx:24-58,90-145`：书名、状态、章节、下一章；主操作是 `handleWriteNext`（`/books/:id/write-next`），另有重写、修订、导出、设置与删除。
- `inkos/packages/studio/src/pages/TruthFiles.tsx:8-70,115-168`：左侧文件列表、右侧 `<pre>` 正文、只读原因；不做 Markdown 渲染。
- `inkos/packages/studio/src/components/ChapterWorkspacePanel.tsx:14-113`：章纲、版本、动作提交、失败回执。
- `inkos/packages/studio/src/components/ConfirmDialog.tsx`：动作前确认；确认是作者动作，不是页面跳转。
- 复刻实现：`packages/see-dsh-novel/src/client/StoryView.tsx`（索引驱动）、`Workbench.tsx`（轨道/左导航/右详情）、`src/core/panel-index.ts`（纯构建）、`src/plugin/panel-projection.ts`（宿主投影）。
- DSH 机制：`file` resource 的值是 `WorkspaceFileStat`（`version` 是新鲜度令牌），正文走 `remote.workspaceFiles.read`；`session/created` 在新建与恢复共用同一流程里发出，`SessionHeader` 带 `cwd`、`agentPreset`、`delegationDepth`（`deepseek-harness/packages/core/session/src/types.ts:100-140`）；`withWorkAction` 是作品写的唯一锁边界（`src/core/work-mutation.ts`）。

## Decision

### 一个面板：对话的镜像 + 操作面

`panel.workbench` 是「作品」页的唯一形态，同时承载只读展示（阶段、产物、正文、禁用原因）和动作面（阶段按钮、确认、回执）。`panel.confirm`、`foundation.approval`、`panel.gate-resume`、`panel.foundation-start` 在面板上的入口都在工作台里，旧的状态卡不再作为第二套 UI 存在。

按钮不直接写作品：client 通过 `runCommand`／`prompt`／`advance` 交给宿主，宿主经工作锁与 commit 写入。

### 数据：宿主投影，面板只读

- `source/story/runtime/panel.index.json` 由 `buildPanelIndex` 从作品文件重建，格式版本 `4`；它不是状态表，不含能力状态（`version`／`generatedAt`／`revision`／`work`／`stages`／`artifacts`／`confirmation`／根级 `action`）。
- 投影时机有三处，只有第一处进作者流程：
  1. **作品写 action 成功后**：`withWorkAction` 在最外层成功返回前**就地**构建并原子写索引（动态 import `panel-index`，避开 `work-mutation → panel-index → stages → workflow-start → work-mutation` 的静态环）。投影跟着写 action 所在的进程走，不依赖跨进程观察者。
  2. **会话发布时**：根插件监听宿主 `session/created`；当 `delegationDepth` 为 0、`header.cwd` 下 `work.json` 存在，且索引缺失/读不通/格式版本过旧时，在 `withWorkAction` 锁内补建一次（同 root 去重）。判据只看工作区文件，不看会话头的 `agentPreset`——它是创建时的组成，会话后来换过预设时可能落后于界面上生效的预设（真机里 `work-real` 会话头写着 `standard`，面板却按 `see-dsh-novel` 注册）。新建与恢复都会触发，所以旧作品首次打开也有索引。
  3. **`/story-index`**：内部/测试兜底，手工重建；作者流程不依赖它，面板不调用它。
- **投影失败不影响动作结果**：`withWorkAction` 捕获异常（错误由面板的 `generatedAt` 与下一次动作暴露）；索引保持上一版；需要修复时走 `/story-index`。
- **投影边界**：索引不是作品产物；`readArtifacts`、foundation digest、内容包、导出、备份排除 `source/story/runtime/panel.index.json`（`core/artifacts.ts:56`）。
- **面板读取**：`useResource` 订阅 `panel.index.json` 的 stat；`version` 变化时用 `readArtifact` 重读正文。宿主的 `workspaceFiles.read` 按行分页、`offset` 从 1 开始，所以 `readArtifact` 从第 1 行开始逐页读到 `eof` 再拼接；读取/解析失败在面板显示具体原因（通道不可用、索引未生成、读取失败、JSON 解析失败），不把旧内容当新内容。
- **状态判定**：`work.json` 的 stat 决定「有没有作品」；无作品 → 对话引导；有作品而索引缺失 → 索引未生成。阶段、产物、确认状态一律来自索引，client 不重算阶段协议。
- **读通道解析**：`readArtifact` 按名取 `remote.workspaceFiles`；缺失时抛「workspaceFiles 通道不可用」，面板把它显示出来。
- **资源类型**：本包没有 `@deepseek-ai/dsh-api-workspace-files` 依赖，`ResourceProtocolMap` 里因此没有 `file`；`client/types.ts` 局部声明 `file` 的值形状（`absolutePath`／`version`／`bytes`），不新增运行时依赖。
- **宿主类型边界**：根插件用结构化类型接收上下文（`on`／`logger` 与 `{ header: { cwd, agentPreset, delegationDepth } }`），像 `core/types.ts` 的 `PluginContext` 一样只声明用到的成员，不 import `@deepseek-ai/dsh-session`；预热监听器走 `ctx.on` 注销。
- **根行职责**：包根行原本只负责让浏览器半边被解析到；投影与预热放进这一个宿主入口后，它成为宿主投影的唯一所有者（一个 profile 一个实例）。
- `/story-init` 仍是命令级立项入口（`--brief` 保留）；面板不提交它，也没有 `--brief-text`。

### 布局：阶段栏 + 产物列表 + 详情

- 顶部：书名、状态、当前章、`generatedAt`；没有「刷新索引」。
- 三列，一条导航轴：阶段栏（竖列，提案 → 基础设定 → 章前规划 → 正文 → 审阅 → 结算，✓／●／○ 与一句说明）→ 本阶段产物列表（只列该阶段的展示集合；运行时诊断收在默认折叠的分组里）→ 详情/正文。阶段只列一次，左栏不再重复阶段。
- 当前阶段的动作集中在右栏顶部的**动作条**：主动作 + 次动作 + 禁用原因 + 回执；阶段栏与产物列表都不放按钮。选中其它阶段查看产物时动作条不变，作者不需要回首页找按钮。
- 详情：默认显示选中阶段的说明与确认状态；产物页用 `<pre>`（与源 `TruthFiles` 一致）、路径、revision 与「返回阶段」；读取失败显示错误与「在对话里继续」出口。一章审完（没有当前阶段）时动作条显示「本章完成」与确认原因。

### 面板产物：显示哪些、怎么显示

源 Studio 的真值文件浏览器不是「目录里有什么就列什么」，而是一份**显式白名单**：`api/server.ts:3228-3240` 的 `TRUTH_FLAT_FILES`、`TRUTH_OUTLINE_FILES`、`RUNTIME_DIAGNOSTIC_FILE_RE`，`api/server.ts:4189-4203` 的列表构造（flat + outline + `roles/主要角色|次要角色|major|minor` + 运行时诊断），`api/server.ts:4175-4182` 给诊断文件标 `readonly: true` 与 `readonlyReason: "runtime-diagnostic"`；`pages/TruthFiles.tsx:119-129` 显示「运行时诊断文件」警示。`state/*.json`、`memory.db`、planner 上下文不在白名单里。

| 类别 | 文件 | 出现的阶段 | 呈现 |
| --- | --- | --- | --- |
| truth | `author_intent.md`、`current_focus.md`、`book_rules.md`、`book_rules.json`、`current_state.md`、`pending_hooks.md`、`chapter_summaries.md`、`style_guide.md`、`parent_canon.md`、`fanfic_canon.md`、`outline/story_frame.md`、`outline/volume_map.md`、`roles/**/*.md`、`source/brief.md`（立项原文）、`source/story/brief.md`（外部简报，存在时） | foundation | Markdown 用 `<pre>`；`book_rules.json` 用键值树 |
| chapter | `source/chapters/NNNN_*.md` | write、review | `<pre>`，标题取「第 N 章 + 文件名标题」 |
| plan | `runtime/chapter-NNNN.plan.json` | plan | 键值树 + 「原始 JSON」切换 |
| review | `runtime/chapter-NNNN.review.json` | review | 键值树 + 「原始 JSON」切换 |
| diagnostic | `runtime/chapter-NNNN.intent.md`、`.context.json`、`.trace.json`、`.planner-context.json` | plan、write、review | `<pre>` 原样，标「运行时诊断 · 只读」并给警示文案；列表里收进默认折叠的「运行时诊断」分组 |
| 不显示 | `state/*.json`（四份状态 JSON 与 manifest）、`memory.db`、`runtime/workflow-start.json`、`runtime/panel.index.json` | — | 不进入面板索引 |

- 面板产物集合与审批摘要的工件集合**分开**：摘要仍是 `source/story/` 下全量文件（`readArtifacts`，签核语义依赖它），面板另有展示集合；不是「目录里有什么就显示什么」。
- 不进面板的理由分三类：状态 JSON 是宿主投影的源、不是作者要读的文档；`memory.db` 是二进制、文本读面读不了；`workflow-start.json` 是流程记账，不是作品产物。
- 源白名单没有 `book_rules.json`、`source/brief.md`、`source/story/brief.md` 与 `.planner-context.json`；本节把它们列入是复刻差异，记 D41。
- `PanelArtifact` 用 `class`（truth／chapter／plan／review／diagnostic）与 `stages: PanelStage['id'][]`（可出现阶段）取代 `group`；归属由宿主投影给出，client 不重算阶段协议。索引版本升到 `4`，旧索引在会话发布时补建。
- 列表顺序：truth 按固定顺序（方向 → 大纲 → 规则 → 伏笔/摘要 → brief → 角色卡），chapter 按章号，plan／review／diagnostic 按章号；诊断始终是最后一组。
- 显示名用中文，不直接显示文件名：`story_frame.md` → 故事框架、`volume_map.md` → 分卷地图、`book_rules.md`／`.json` → 规则正文／规则数据、`pending_hooks.md` → 待回收伏笔、`current_state.md` → 当前状态、`chapter_summaries.md` → 章节摘要、`author_intent.md` → 作者意图、`current_focus.md` → 当前焦点；角色卡用角色名；章节用「第 N 章 · 标题」。真实路径仍显示在右栏详情顶部。
- 客户端兼容：读到旧索引（缺 `class`／`stages`）时按空阶段处理，不崩溃，等宿主补建到 v3 再显示。
- 键值树规则：顶层对象按键展开；嵌套对象/数组用可折叠块（`<details>`，深度 ≤1 默认展开，更深默认收起）；字符串按真实换行渲染；数组用序号；保留「原始 JSON」切换。诊断文件不树化，保持源工程原文。
- 偏差（记入 `docs/dsh-mapping.md` 的偏差登记）：
  - 源行为：白名单内所有文件统一 `<pre>`（`TruthFiles.tsx:168`）。复刻：作者产物的 JSON 给键值树并保留原始切换。原因：作者裁决——嵌套 JSON 的 `\n` 转义不可读。验证：workbench 测试断言键值树与原始切换。
  - 源行为：运行时诊断与其它文件同列，仅加警示。复刻：诊断文件默认收进折叠分组，选中后仍给同样的警示。原因：作者要求列表只显示作品产物，同时保留追溯能力。验证：测试断言默认折叠与警示文案。
- 章节正文加入面板：源在章节页／`ChapterWorkspacePanel` 展示正文，不在真值文件列表里；面板把它归到 write／review 阶段，不改动 `readArtifacts` 的摘要集合。
- 源真值文件浏览器可编辑（Edit/Save 与 PUT 落盘）；复刻所有产物只读，作者裁决 v1 保留只读，记 D39。

### 阶段动作

| 阶段 | 主按钮 | 次级动作 | 落点 |
| --- | --- | --- | --- |
| proposal（无作品） | 无 | 无 | 对话里立项；面板只显示引导 |
| foundation | 开始基础设定 | 无 | `START_TEXT` 提示，模型调 foundation 工具 |
| foundation-ready | 确认基础设定 | 开始下一章、退回、查看待确认、稍后 | `/story-approve` + resume；`/story-write`；`/story-reject`；`/story-review`；稍后只清提示 |
| plan | 规划第 N 章 | 无 | `advance` 提示，模型调 `story_plan_chapter` |
| write | 写第 N 章 | 无 | `advance` 提示，模型调 `story_write_chapter` |
| review | 审阅第 N 章 | 无 | `advance` 提示，模型调 `story_review_chapter` |
| chapter-done | 修订本章 | 无 | `advance` 提示，模型调 `story_revise_chapter`；结算入口归 P4 协议 |

- `foundation-ready` 同时保留五个动作：索引是文件投影，看不到会话里的签核回执，因此不做「签核后自动切换」的顺序化；主动作按既有决定仍是签核，前进入口作为次动作常驻。
- 面板是 `panel.confirm`、`foundation.approval`、`panel.gate-resume`、`panel.foundation-start` 的唯一 UI 入口；旧卡删除时这些动作原样搬进动作条，consumer 断言保留。
- 动作条只呈现当前阶段的动作，与当前选中的产物无关。源 Studio 有删除本章按钮；复刻当前只有对话入口，作者裁决补面板动作，记 D40。
- 索引形状：`PanelStage.action` 是主按钮（`PanelAction | null`），`secondary` 是次按钮（`PanelAction[]`，0–4）；索引根级 `action` 承载 `chapter-done` 的「修订本章」，阶段动作仍只在 `PanelStage.action`；host 与 client 两份类型定义同批维护。
- 禁用原因至少包括：需先完成基础设定、正在运行、已锁定、P4 未结算；`aria-disabled` + 可见原因，点击不派发。

### 无作品

无作品时不给任何表单，不调 `/story-init`；面板只显示「在对话里描述作品」的引导。立项与提案发生在对话。

### 不做

- 面板新建表单、`--brief-text`、面板提交 `/story-init`。
- 作者可见的 `/story-index` 步骤和面板上的「刷新索引」。
- Markdown 渲染（源就是 `<pre>`）。
- 把索引当状态表或新能力判据。

### 行与债务

- `capabilities.yaml` 的 `panel.workbench` 描述不含「新建入口」；`implementation` 指向 `client/StoryView.tsx`，`consumer` 指向 `test/workbench.test.mjs`，投影与客户端覆盖另见审计段；`realRun` 为 `artifacts/real-runs/panel.workbench.json` 的进程级证据。
- `panel.confirm`、`foundation.approval`、`panel.gate-resume`、`panel.foundation-start` 行为不变，只换面板落点；它们的 consumer 测试保留原断言。
- `docs/dsh-mapping.md` 的面板段改为「确认语义在 `panel.confirm`；工作台是读取 + 动作面；动作经宿主命令/提示」，并新增两条展示偏差行（JSON 键值树、诊断折叠）。
- `docs/fidelity-audit.md` 的 `panel.workbench` 判定改为机制等价；`docs/scope.md` 的 D31 由作者裁定关闭（不做桌面回执，以进程级测试为交付证据）。
- 与源 Studio 的差距记 D39（真值文件只读）、D40（缺删除动作）、D41（白名单多 4 项）；D40 已裁决补动作。
- 索引版本 4（chapter-done 根动作随 `chapter.revise` 加入）：`PANEL_INDEX_VERSION`、`panel-types.ts` ×2 与投影的格式检查同批更新。

## Alternatives considered

- **面板挂载/动作后调 `/story-index`**（上一版决定）— 打开即有索引。否掉：面板成为投影触发者，失败时最容易静默回退旧卡；写 action 后重建能同时覆盖命令与工具两条写入路径。
- **会话装配时预热索引** — 不需要新事件。否掉：装配处在首个 turn，拿不到工作区根；旧会话首次打开可能长时间没有索引。
- **client 自己拼目录与阶段** — 省一个宿主命令。否掉：client 重算阶段协议会和宿主判定分叉，动作按钮与证据不同源。
- **面板表单立项并提交 `/story-init`**（上一版决定）— 少一次对话。否掉：立项是作者的创作意图收敛，只发生在对话；面板给表单会造出第二个立项入口。
- **保留旧状态卡与工作台两套 UI** — 改动最小。否掉：同一状态两个入口、两套判定，确认与产物继续割裂。
- **动作放在阶段节点里**（上一版布局）— 每个阶段的动作与它的节点一一对应。否掉：`foundation-ready` 一个节点塞五个按钮，阶段栏与左栏又各列一遍阶段，一屏两个导航；动作条把「在哪一步」和「能做什么」分开，节点只回答前者。
- **`useResource` 的 file 值直接给正文** — 最省事。否掉：值是 `WorkspaceFileStat`，没有 content。
- **把 plan/write/review 做成逐工具 approval** — 更严。否掉：源只确认 `write_next`；逐工具 approval 是自创限制。
- **面板直接列目录**（当前实现）— 实现最省。否掉：`state/*.json`、`memory.db`、planner 上下文都进了列表，章节正文反而进不来；源的显式白名单已经回答了「哪些算作品产物」。
- **按扩展名过滤** — 比白名单省事。否掉：`state/*.json` 仍是 `.json`，过滤不掉。
- **运行时诊断完全不显示** — 列表最干净。否掉：等于删掉源工程保留的追溯能力；改成默认折叠，需要时仍可展开原文。
- **所有 JSON 都键值树** — 统一。否掉：上下文与 trace 是给排查用的原文，树化后反而难和日志对照。
- **严格统一 `<pre>`（完全贴源）** — 无需偏差登记。否掉：作者明确指出嵌套 JSON 的转义不可读；键值树保留原文切换，代价是一条展示偏差。

## Testing

- `test/panel-index.test.mjs`：索引版本 3、`panel.index.json` 不作为产物、`foundation-ready` 的主按钮与四个次级动作、无作品时提案阶段无动作；面板产物只收白名单（`state/*.json`、`memory.db`、`workflow-start.json` 不出现），章节正文归 write／review，运行时诊断归 diagnostic。
- `test/panel-projection.test.mjs`：写 action 成功后索引重建一次；嵌套 action 只重建一次；`project: false` 不重建；投影抛错不改动作结果；预热补建缺失索引、跳过最新索引、重建旧格式、忽略子代理与无 `work.json` 的目录；`session/created` 监听器不抛错且把补建失败写日志。
- `test/workbench.test.mjs`：动作只在动作条里且每个只出现一次；阶段栏只负责导航；产物列表只列选中阶段的产物；运行时诊断收在折叠分组；没有表单与「刷新索引」；提交中禁用全部动作；产物正文与无作品引导；一章审完时显示「本章完成」；作者产物的 JSON 有键值树与「原始 JSON」切换，诊断文件保持 `<pre>`。
- `test/client.test.mjs`：索引驱动渲染与 `generatedAt`；stat 版本变化重读；读取失败可见且不回退旧卡；无作品引导；无索引时保留「开始基础设定」；五个 `foundation-ready` 动作与三个阶段动作的派发；退回不唤醒；确认后 resume；运行中禁用；产物读取失败可见；换会话清空索引；双击只派发一次；`readArtifact` 从第 1 页读起并逐页拼接；缺通道时的错误。
- `/story-index`：命令仍注册并在锁内重建，`project: false` 避免重复投影。
- 真实回执：`artifacts/real-runs/panel.workbench.json` 记录当前行为的进程级证据；作者裁定不做桌面回执（D31 关闭）。

## Consequences

- `panel.index.json` 是投影，不是状态表；任何字段都从文件重建，不能作为新能力的判据。它必须被 `readArtifacts`/digest/export 排除，否则会污染基础设定摘要或导出。
- 投影依赖 `withWorkAction` 边界；绕过它的新写入会留下过期索引，必须走同一边界。
- 投影失败不阻塞作品写与会话打开，但面板可能显示旧版本；`generatedAt` 可见，`/story-index` 是修复路径。
- 投影只在执行写入的进程里发生；另一个 DSH 实例写同一部作品时，本进程的索引会停在上一版，直到下次写 action 或重开会话。
- 面板读取依赖宿主的 `remote.workspaceFiles`；通道不可用时面板显示原因而不是空面板。
- 按钮不直接写作品；client 通过宿主命令/提示，宿主持锁/commit。工作台是操作面，不是写盘层。
- 布局只有一条导航轴：阶段只列一次，切换阶段决定左栏列哪些产物；动作集中在动作条，阶段节点与产物列表都不放按钮。
- 动作条只跟随当前阶段，不跟随选中的产物；作者查看旧产物时仍能直接执行当前阶段动作。
- 面板产物是白名单，不是目录镜像：`state/*.json`、`memory.db`、`workflow-start.json` 不出现；新增作品文件要显式加进展示集合才会出现。
- 面板展示集合与审批摘要集合分开，摘要仍是 `source/story/` 全量；给面板增删文件不影响签核有效性。
- 索引版本 4（原 2）；旧索引在会话发布时补建，客户端的 `normalizeIndex` 仍兼容缺 `secondary`／`stages` 的旧形状。
- 章节正文进入面板后，`source/chapters/` 变成只读展示路径；面板仍不写文件。
- 键值树只渲染当前选中的文件；大 JSON 用折叠块控制首屏长度，展开与「原始 JSON」都不丢信息。
- 运行时诊断默认折叠不删除能力：展开后仍是 `<pre>` 原文与同一条只读警示。
- 无作品没有表单；立项只发生在对话；`/story-init` 只是命令级兜底。
- `session/created` 监听器必须保持同步非阻塞：同步抛错会回滚会话创建，补建一律异步并自行捕获。
- 文件监视不可用时（`notices.ready === false`）索引缺失不会自动出现；面板显示索引未生成，`/story-index` 仍是兜底。
- `chapter-done` 的「修订本章」入口由 `chapter.revise` 提供；结算与定稿由 P4 工具承接。
- 2026-11-09 的 `panel.workbench` 与 `panel-workbench-d31` 两篇 Note 被本 Note 完全取代并删除，避免第二份设计权威。
