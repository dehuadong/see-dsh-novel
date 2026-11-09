# Agent Note: panel.confirm —— 作者确认开始一章

Status: implemented

## Problem

`runtime.stage-context` 已经停在 `foundation-ready`，没有 workflow start 时不进入 plan；但写 workflow start 的入口还没有：`panel.confirm` 是 `missing`（D29）。当前 `StoryView` 只有「开始基础设定」「认可/退回」，没有「开始下一章」的作者确认面；命令面也没有一条写 start 的命令。结果是阶段永远停在 foundation-ready。

## 源工程证据

- `inkos/packages/core/src/interaction/action-envelope.ts:14-32`：`RequestedIntentSchema` 包含 `write_next`；`:46-48` 的 `WriteNextActionPayloadSchema` 只有 `chapterCount`（默认 1）。
- `inkos/packages/studio/src/shared/confirmed-production.ts:3-20,28-30`：`write_next` 是 confirmed production intent，只接受 button／slash／quick-action；free text 没有执行权。
- `inkos/packages/studio/src/api/server.ts`：只有 confirmed intent 才绑定并执行 `write_next`；确认卡/命令是作者动作。
- 源 Studio 的确认卡与 `BookDetail` 的 write-next 按钮是入口；`ChapterWorkspacePanel` 不替代确认。
- `agent-tools.ts:178-194` 只是 `propose_action` 的 15 个 workflow start 字面量，不含 `write_next`。
- 当前 DSH `StoryView`（`packages/see-dsh-novel/src/client/StoryView.tsx`）只有 foundation 状态与认可/退回；`client/index.ts` 的 `promptQueue`/`runCommand` 是面板到会话的入口。

## Decision

### 命令：`/story-write`

- 新增 `src/plugin/write-command.ts`，导出 `installWriteCommand(ctx)`；在 `agent.ts` 注册并加入 disposer 链。
- 命令不接受 `--chapter N`；只启动下一章（`current_state.chapter + 1`），`chapterCount` 固定 1，贴源 `WriteNextActionPayloadSchema` 的默认值。
- 新增 `core/workflow-start.ts` 的 `writeWorkflowStart(root, {chapter, instruction})` 只做低级写；**`startChapter` 放在命令层** `src/plugin/write-command.ts`，避免 `workflow-start.ts` import `pipelines/long/stages/index.ts` 形成环（stages 已经 import `workflowStartedSync`）。
- 命令层 `startChapter` 在**同一个 `withWorkAction` 锁内**：
  - 读 `current_state.chapter`，算下一章；
  - 用 `detectStage(root)` 判 `foundation-ready`（复用六项探针，不重写）；
  - 用 `chapterReviewPath(next)` 判 review；
  - 检查已有 start；
  - 调 `writeWorkflowStart` 写记录（嵌套 scope 复用锁）。
- `instruction` 固定为 `开始第 ${next} 章`（命令无参数；源 `write_next` 的 instruction 由请求携带，DSH 命令用最小可读说明）。
- `writeWorkflowStart` 保持为低级写：只接受显式 chapter，guard 是“任何已有 start 都拒绝”，不是“同章拒绝”。命令不得在锁外先算 chapter 再调用它。
- 成功后用 `invocation.agent.followup` 投一条：
  `{role:'user', source:{kind:'story-command', command:'story-write'}, content:'作者已确认开始第 N 章；按 story_next 进入 plan，不跳过审阅'}`
- 失败返回 `{kind:'error'}`，不写 start；锁竞争把 `BOOK_BUSY` 原文回执。
- 命令是作者确认，不再额外请求 approval；源 `write_next` 的确认就是命令/按钮本身。

### 面板：`panel.confirm`

- `StoryView` 增加两个资源锚点：
  - `workflowStart = dsh-resource://file/session/<id>/source/story/runtime/workflow-start.json`；
  - `review = dsh-resource://file/session/<id>/source/story/runtime/chapter-0001.review.json`。P1 面板固定第 1 章；`file` resource 只给 stat、不给正文，无法从 current_state 派生 currentChapter；动态章节/两列工作台归 P6 `panel.workbench` 的 `panel.index`（D30）。
- 按钮与状态：
  - foundation 未齐：保持「开始基础设定」；
  - foundation 齐、无 start、无 review：显示「开始下一章」可用；点击 `runCommand('/story-write')`；
  - start 已存在：显示「已开始」禁用；不重复写；
  - review 已存在：显示「本章完成」禁用；下一章需要 P4 结算/新章节，不在本行。
- 增加「稍后」按钮：只清提示，不调命令、不写 start；这是 D29 的取消路径。面板不弹 approval。
- 按钮禁用用 `aria-disabled` + 原因文案；提交中 spinner；失败显示命令错误（含 `BOOK_BUSY`）。面板不自行写文件，只调命令。
- 面板仍不承载只读产物浏览（`panel.workbench` P6）。

### start 生命周期

- `story_review_chapter` 成功后 `clearWorkflowStart(root)`：一章的 workflow start 只覆盖本章；review 后阶段进入 `chapter-done`。清除失败时 review 仍算成功，但回执要带“start 未清除”的可见错误。
- `writeWorkflowStart` 单记录；已有任何 start 都拒绝；`clear` 使用 `commitFoundation` 删除。
- `chapter-done` 不自动开下一章；`current_state.chapter` 推进仍由 P4 `chapter.settle` 负责。

### 文档/账本

- `panel.confirm` 从 `missing` 实现；consumer 测试、realRun；D29 在完成后删除。
- `docs/scope.md` P1 出口：panel.confirm 可用；`docs/fidelity-audit.md` panel.confirm 的 D29 改等价；`dsh-mapping` 加 write_next 确认 → command/panel 行。
- `runtime.stage-context` 已实现，不重复改。
- 不在 `core/workflow-start.ts` 引入 stages；命令层负责 stage/review 校验，避免模块环。

## Alternatives considered

- **让模型自己调一个 `story_workflow_start` 工具** — 不需要命令。否掉：作者确认必须由作者动作/命令产生；模型自调等于自动推进。
- **面板直接写 workflow-start 文件** — 少一条命令。否掉：client 没有作品写权限，且会绕过工作锁/校验；所有写入走 host。
- **复用 `/story-init` 或 `/story-approve`** — 少新命令。否掉：`/story-init` 是建书，`/story-approve` 是 foundation 决定；workflow start 是另一条授权记录。
- **在每个 plan/write 工具上 approval** — 最严。否掉：源只确认 `write_next`；逐工具确认是自创限制。
- **本行同时实现只读工作台** — 一次做完。否掉：`panel.workbench` 是 P6 独立行；本行只做确认入口。

## Testing

- `/story-write` 在 foundation 齐、无 start、无 review 时写一章 start；不接受 `--chapter`；重复命令/未立项/无 foundation/已有 review 都拒绝且不写。
- 命令成功后 followup 一条 `{role:'user',source:{kind:'story-command',command:'story-write'}}` 消息；下一轮按 plan 走；不自动写正文。
- `StoryView` 的「开始下一章」只在 foundation 齐、无 start、无 review 时可用；start 后显示已开始；review 后显示本章完成；「稍后」不写 start；禁用有原因。
- 锁内 `startChapter` 完成 chapter/start/review 检查；另一个 start 持锁时 `/story-write` 返回 `BOOK_BUSY` 且不写。
- `story_review_chapter` 成功后清除 start；清除失败回执可见；`chapter-done` 停在阶段；下一章仍受 P4 限制。
- `installWriteCommand` 在 `agent.ts` 注册并加入 disposer；命令清单测试更新；`core/workflow-start.ts` 不 import stages，start 校验在命令层。
- 面板 review 锚点固定第 1 章；和命令的 `chapterReviewPath(next)` 在 P1（current=0）一致；P4 后的动态章节是 D30/P6，不是本行。
- 测试：`test/write-command.test.mjs`、`test/client.test.mjs` 按钮/稍后/禁用状态、`test/workflow-start.test.mjs` 生命周期、review 清除、锁竞争；真实回执 `/story-init` → 你好不自动 → 面板开始 → plan。
- D29 已删除；P1 面板固定第 1 章、动态章节/两列工作台登记为 D30（P6 `panel.workbench`）。
- `pnpm run verify` 与 CI 双端通过。
- 实施后：`/story-write`、`startChapter`、`StoryView` 开始下一章/稍后、review 清除 start；322 例；`artifacts/real-runs/panel.confirm.json` 为 process-level 回执。

## Consequences

- 命令和面板都要防重复点击/重复 start；`writeWorkflowStart` 的单记录是最后防线；`startChapter` 是唯一入口，不能在锁外先算 chapter。
- `followup` 的 source/role 必须是 `{role:'user', source:{kind:'story-command', command:'story-write'}}`；阶段已由 start 驱动，消息只负责叫醒。
- review 后清除 start 的顺序：先 review 落盘再清除；清除失败不应把 review 算失败，但要留下可见错误。
- `current_state.chapter` 未推进，所以「开始下一章」在 review 后不可用；面板固定第 1 章是 P1 已知限制，D30/P6 `panel.index` 解决。
- 面板资源是只读；不把「开始下一章」做成直接文件写；P1 不读文件正文。
- 不接受 `--chapter`：源 `write_next` 只有 `chapterCount`；面板/命令一次启动一章。
