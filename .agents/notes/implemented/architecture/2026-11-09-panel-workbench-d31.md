# Agent Note: panel.workbench D31 —— 新作品简报与真机验收

Status: implemented

## Problem

`panel.workbench` 核心已交付，但还有 D31：新作品表单没有“简报正文”，`/story-init` 只接受 `--brief` 文件；工作台只在组件/索引级测试里验证过，没有真实 Web GUI 回执。P2/P3 的 plan/write/review 按钮仍 locked，不在本行放开。

## 源工程证据

- `inkos/packages/studio/src/pages/TruthFiles.tsx:115-168`：右栏用 `<pre>` 显示文件内容，并保留只读原因；不做 Markdown 渲染。DSH 的 `<pre>` 与源一致，因此 D31 不把 Markdown 渲染列为缺口。
- `inkos/packages/studio/src/components/ChapterWorkspacePanel.tsx`：动作前确认、失败回执；对应工作台轨道按钮/提示。
- `packages/see-dsh-novel/src/plugin/work-command.ts:28-45,139-167,255-272`：`/story-init` 当前解析 `--brief` 文件，`initWork` 用 instruction 一次提交。
- `packages/see-dsh-novel/src/core/init-work.ts`：立项是单次提交；不能先写简报文件再立项。
- `packages/see-dsh-novel/src/client/Workbench.tsx`：新作品表单目前只有标题/语言/章数/字数/题材/平台。

## Decision

### `/story-init --brief-text`

- 扩展 `WorkCreateArgs`：`briefText?: string`；新增 `--brief-text <encoded>` 选项。
- 编码：panel 用 `encodeURIComponent` 传一段文本，命令 `decodeURIComponent`；避免引号/空格破坏 token 解析。
- handler 的 instruction 优先级：
  1. `--brief-text` 解码后的正文（空串/坏编码直接报错，不回退）；
  2. `--brief` 文件内容；
  3. `Create <title>`。
- 不写临时简报文件；`initWork` 仍一次提交。`--brief` 文件路径保留。
- 表单增加“简报”textarea；`createWork` 把编码后的文本拼进 `/story-init`；失败显示命令错误。

### 真机验收

- 用当前 DSH Web GUI：`/story-index` → 面板显示阶段轨道/产物/右栏；新建作品 → foundation → 确认基础设定 → 开始下一章；检查禁用原因、新建表单、索引刷新。
- 记录 `artifacts/real-runs/panel.workbench.json`（`capabilities.yaml:393` 的既有 realRun，不新建 `-d31` 文件）。
- 真机发现的索引/读取/按钮问题在本行修。
- 若 64588 的 GUI 未加载新 `lib/client.js`，先重建/刷新，再验收。

### 阶段按钮

- `plan.chapter`、`chapter.write`、`chapter.review` 已在 `capabilities.yaml` verified；D31 把工作台 plan/write/review 节点从 locked 改为可用。
- 按钮通过 `advance` 提示 agent 调对应工具；仍不在每个工具上加 approval。
- 动态 currentChapter 由 `panel.index` 的 `currentChapter`/`nextChapter` 提供；review 锚点仍是第 1 章，P4 后随索引扩展。

## Alternatives considered

- **新增 `/story-new` JSON 命令** — 表单更直接。否掉：`/story-init` 已是 create_book 入口；加 `--brief-text` 保持一条命令，少一套解析。
- **先写临时简报文件再 initWork** — 实现简单。否掉：破 `initWork` 单次提交，留下半成品。
- **用 Markdown 渲染器** — 更像文档。否掉：源 `TruthFiles` 就是 `<pre>`；引入渲染器是自创差异，且带 XSS/依赖成本。
- **本行放开 P2/P3 按钮** — 面板更完整。采纳：`plan.chapter`/`chapter.write`/`chapter.review` 已 verified；按钮走 `advance` 提示，不逐工具 approval。

## Testing

- `test/work-command.test.mjs`：`--brief-text` 解码进入 instruction；`--brief` 文件仍可用；缺省 `Create <title>`；未知/空编码报错。
- `test/workbench.test.mjs`：简报 textarea、`newWorkCommand` 编码、失败回执；新作品表单。
- `test/panel-index.test.mjs` / `test/client.test.mjs`：索引/工作台回归；plan/write/review 动作可用。
- 真机回执：`artifacts/real-runs/panel.workbench.json`；至少一条 `/story-init` + `/story-index` + 面板读取。
- `pnpm run verify` 与 CI 双端通过。

## Consequences

- `--brief-text` 是 URI 编码；空串/坏编码要拒绝，不能静默变成缺省 instruction。
- 表单内容可能很长；命令输入行有长度限制，面板应限制并显示错误，不截断后提交。
- 真机没有浏览器自动化时只能记录会话/人工回执；不能把组件测试当成 GUI 证据。
- 64588 的 client 产物可能未热更新；验收前先构建/刷新。
- P2/P3 按钮已按 verified 放开；动作仍走 `advance`，不要误认为工作台直接写。
