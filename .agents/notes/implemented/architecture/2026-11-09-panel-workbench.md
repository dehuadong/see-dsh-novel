# Agent Note: panel.workbench —— 完整作品工作台

Status: implemented

## Problem

现在的 `StoryView` 只是 foundation 状态卡：只有「开始基础设定」「认可/退回」，没有阶段导航、产物列表、内容区、禁用原因。源 Studio 的工作台由 `BookDetail`（书名/状态/章节/动作）、`TruthFiles`（左文件列表 + 右内容）、`ChapterWorkspacePanel`（章纲/版本/动作）、`ConfirmDialog`（动作前确认）组成。DSH 侧没有目录枚举，也没有文件正文的 resource 值，所以必须补一个只读索引和宿主读通道。

## 源工程证据

- `inkos/packages/studio/src/pages/BookDetail.tsx:24-58,90-145`：书名、状态、章节、下一章、动作。
- `inkos/packages/studio/src/pages/TruthFiles.tsx:8-70`：左文件列表、右内容、只读原因；`deriveFilePresentation`。
- `inkos/packages/studio/src/components/ChapterWorkspacePanel.tsx:14-113`：章纲、版本、动作提交、失败回执。
- `inkos/packages/studio/src/components/ConfirmDialog.tsx`：动作前确认。
- 当前 `packages/see-dsh-novel/src/client/StoryView.tsx`：固定六个文件、只有 foundation 卡；`useResource('file')` 的值是 `WorkspaceFileStat`，只有 stat，没有正文；`file` resource 本身不提供目录列表。
- DSH client 可用宿主文件 API：`deepseek-harness/packages/api/workspace-files/src/index.ts:234-329` 的 `read`/`list`，client 插件可注入 `remote.workspaceFiles.list`/`read`；client 不能直接写文件。

## Decision

### 一个面板，不是两个页面

`panel.workbench` 是目标面板，也是 `StoryView` 的下一形态。它同时承载：

- 只读展示：阶段、产物列表、产物内容、空状态、禁用原因；
- 动作面：阶段按钮、确认、提交回执。

`panel.confirm` 是确认语义/能力，不是第二张页面；现有 `/story-write`、开始下一章、稍后都收进工作台。按钮不直接写作品：client 通过 `runCommand`/`prompt` 交给宿主，宿主经工作锁与 commit 写入。这是 DSH 机制偏差，不是把工作台做成只读视图。

### 数据：`panel.index.json` + 宿主读

- 新增 `source/story/runtime/panel.index.json`，由宿主 `/story-index` 从文件重建：
  - `version`、`generatedAt`、`revision`；
  - `work`：title/status/language/currentChapter/nextChapter；
  - `stages`：id、label、status（done/current/locked）、summary、primaryAction；
  - `artifacts`：path、title、type、group、modifiedAt、bytes、revision、readonly；
  - `confirmation`：kind、state、reason。
- **保留索引的理由不是“client 不能列目录”**：`remote.workspaceFiles.list` 可以列；索引是为了把阶段、产物分组、确认状态收敛成一次宿主投影，避免 client 重算阶段协议，并让动作按钮和证据同源。索引不写能力状态；`capabilities.yaml` 仍是唯一状态表。
- **所有权**：`src/plugin/index-command.ts` 注册 `/story-index`；`src/core/panel-index.ts` 只做纯构建（输入 root，输出 index）。命令在 `withWorkAction` 锁内构建并原子写 `panel.index.json`；失败保留旧索引并把错误返回，面板显示“索引过期”，不把旧索引当新确认。
- **投影边界**：索引不是作品产物；`readArtifacts`、foundation digest、内容包、导出、备份必须排除 `source/story/runtime/panel.index.json`。索引写入只改这个运行时文件，不改作品内容；索引自身不可用时，作品写仍可继续。
- 面板通过 `useResource` 读 `panel.index.json` 的 stat（变更通知），索引正文由 `ViewInjected.readArtifact('panel.index.json')` 调宿主 `remote.workspaceFiles.read` 读取；右栏产物正文同样走 `readArtifact`。`list` 可用于索引重建和角色卡目录枚举，但面板不直接拼目录。
- `/story-index` 由 panel 在挂载/刷新/动作成功后调用；可重复执行；命令结果只写索引。

### 布局：流程轨道 + 左右两栏

- 顶部：书名、状态、当前阶段面包屑、当前章、锁/确认状态、刷新索引。
- **阶段流程轨道**（全宽，位于顶部下方；滚动时保持可见）：
  - 按阶段顺序显示节点：提案 → 基础设定 → 章前规划 → 正文 → 审阅 → 结算；
  - 每个节点显示状态（✓ 已完成 / ● 当前 / ○ 未解锁）、一句话说明、**该阶段唯一主按钮**；
  - 当前阶段节点高亮，主按钮可用；已完成节点给「查看」；未解锁节点灰掉并显示原因；
  - 动作只出现在轨道节点，不在左栏或右栏重复。
- 左栏（只导航，不承载动作）：
  - 阶段节点与产物分组列表：基础设定（outline/volume map/rules/hooks/角色卡）、第 1 章（章前规划/正文/审阅/结算）；
  - 点击切换右栏查看；文件显示类型、更新时间、只读标记。
- 右栏（只查看/详情）：
  - 默认当前阶段总览：说明、已完成/还缺什么、确认状态、禁用原因；不再复制主按钮；
  - 产物页：Markdown 渲染、JSON 树/原文、路径、更新时间、revision/checksum、只读原因；
  - 空状态文案；「返回总览」。
- 无论右栏在总览还是产物页，流程轨道都保留；作者不需要回首页找按钮。

### 阶段动作

每个阶段只显示一个主按钮，固定在流程轨道节点上；按钮调用宿主命令/提示，不直接写：

| 阶段 | 主按钮 | 落点 |
| --- | --- | --- |
| proposal（无作品） | 新建作品 | 表单 → `/story-init` |
| foundation | 开始/继续基础设定 | `START_TEXT` 提示，模型调 foundation 工具 |
| foundation-ready | 确认基础设定 | `/story-approve` + resume（现有签核）；之后才出现开始下一章 |
| plan | 规划第 N 章 | `prompt` 阶段提示，模型调 `story_plan_chapter` |
| write | 写第 N 章 | `prompt` 阶段提示，模型调 `story_write_chapter` |
| review | 审阅第 N 章 | `prompt` 阶段提示，模型调 `story_review_chapter` |
| chapter-done | 本章完成 | 禁用；下一章等 P4/P6 |

**阶段与顺序**：本行属于 P6；P1 合同仍不实现 plan/write。工作台画出 plan/write/review 节点，但在 P2/P3 对应能力 verified 前为 locked/禁用并显示“阶段尚未交付”。核心工作台已交付；brief/Markdown/P2 动作是 D31。

`panel.confirm` 的「开始下一章」/「稍后」作为 `foundation-ready` 轨道节点的动作；确认成功后按钮变「已开始」，review 后变「本章完成」。如果 foundation 签核仍走 `/story-approve`，工作台把签核作为 foundation-ready 的主按钮，不把 plan/write 改成逐工具 approval。

### 按钮状态

- 可用：主色、hover、键盘 focus。
- 不可用：灰色、`aria-disabled`、可见原因；点击不派发。
- 加载：spinner + 「提交中…」；成功/失败有回执，不静默。
- 确认动作前显示：将写哪些文件、阶段、确认通道（面板/命令）；取消不写。
- 禁用原因至少包括：需先完成基础设定、需作者确认、正在运行、已锁定、已有审阅、P4 未结算。

### 新作品入口

- 无作品时，右栏显示新建表单：标题、语言、目标章数、单章字数、题材、平台、简报。
- 提交调 `/story-init`；不再要求作者先在对话里发命令。
- `/story-init` 当前接受 `--brief` 文件；本行给它加 `--brief-text`，解析后作为 `initWork` 的 `instruction` 直接进入同一次提交，不写临时简报文件。`initWork` 的单次提交契约不变；这是 `runtime.commands` 的依赖，不能在 client 直接写文件。

### 行与债务

- `capabilities.yaml:387` 的 `panel.workbench` 从 missing 到实现；implementation 指向 `packages/see-dsh-novel/src/client/StoryView.tsx` + `packages/see-dsh-novel/src/plugin/index-command.ts`；consumer 指向 `test/panel-workbench.test.mjs`；realRun 指向 `artifacts/real-runs/panel.workbench.json`。
- `/story-index` 不是独立能力行，它是 `panel.workbench` 的宿主投影实现；不新增 `capabilities.yaml` 行。
- `panel.confirm` 的 workflow start 已实现；新作品表单的 create_book 入口在本行接入。
- `runtime.client-ui` 的“工作台”债与 `panel.workbench` 同步；`panel.workbench` 不再被描述为纯只读；核心已交付，D31 记录 brief/Markdown/P2 动作。

## Alternatives considered

- **保持 foundation 卡 + 另做只读面板** — 少改。否掉：源 Studio 的工作台本身就是操作面；两页面会把确认和产物浏览割裂。
- **client 直接读目录** — 简单。否掉：DSH client 没有文件系统；只能读宿主索引/读 API。
- **`useResource` 的 file 值直接给正文** — 最省事。否掉：`file` 值是 `WorkspaceFileStat`，没有 content；需要 `remote.workspaceFiles.read`。
- **索引由 client 自己拼** — 快。否掉：client 自己拼目录/阶段会重复阶段协议并和宿主判定分叉；索引必须宿主从文件重建。
- **把 plan/write/review 做成逐工具 approval** — 安全。否掉：源只确认 workflow start；逐工具 approval 是自创限制。

## Testing

- `test/panel-index.test.mjs`：从真实工作区生成 stages/artifacts；`panel.index.json` 被 `readArtifacts` 排除；无作品 → proposal。
- `test/workbench.test.mjs`：阶段轨道、左导航、产物列表、新建表单；动作只出现在轨道节点；产物正文用 `<pre>` 渲染。
- `test/client.test.mjs`：`StoryView` 的资源/按钮/错误回执；新增 panel index 锚点。
- `/story-index`：命令注册；索引在 `withWorkAction` 锁内构建并写文件；旧索引保留。
- 动作：开始基础设定、确认基础设定、开始下一章；plan/write/review 在 P2/P3 前 locked。
- 右栏内容：宿主 `remote.workspaceFiles.read`；读取失败显示错误。
- 真实回执：`artifacts/real-runs/panel.workbench.json` 是 process-level 组件/索引测试；**不是**完整 DSH 会话，也没有 brief/Markdown 全流程。
- D31：简报正文、Markdown 渲染、P2/P3 阶段按钮、动态 currentChapter 仍待补。

## Consequences

- `panel.index.json` 是投影，不是状态表；任何字段都从文件重建，不能作为新能力的判据。它必须被 `readArtifacts`/digest/export 排除，否则会污染基础设定摘要或导出。
- 索引可能过期；面板显示 `generatedAt`，动作后/刷新时重生成；不能把过期索引当成作者确认。
- 索引命令在锁内重建，失败保留旧索引；旧索引只能展示，不能当成新阶段/新确认。
- 按钮不直接写作品；client 通过宿主命令/提示，宿主持锁/commit。工作台是操作面，不是写盘层。
- 新作品表单需要 `/story-init` 的 `--brief-text`；简报作为 `instruction` 进入同一 `initWork` 提交，不能先写临时文件。
- 右栏正文必须用宿主读 API；`useResource` 只负责 stat/变更通知。`list` 本身可用；索引存在的理由是阶段/分组投影，不是能力缺失。
- P4 `chapter.settle` 仍未实现；`chapter-done` 的下一章入口在 P4 前不可用。
- P6 实施时，P2/P3 未 verified 的 plan/write/review 按钮必须 locked/禁用，不能因为面板先做出来就越过阶段合同。
