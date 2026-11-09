# Agent Note: runtime.stage-context —— 阶段描述与 workflow start 边界

Status: implemented

## Problem

当前 `story:stage` 把“当前阶段”写成每轮强制流程：foundation 完成即自动进入 plan → write → review，普通问候也会触发工具链。源工程没有这种阶段自动推进；它的作者门禁是 **workflow start**（`create_book`、`write_next` 等），确认后才跑 workflow 内部步骤。D28 同时牵涉 `runtime.stage-context` 与 `panel.confirm`：阶段上下文只描述，workflow start 负责授权；没有 start 就不进入下一阶段。

## 源工程证据

- `inkos/packages/core/src/agents/`：architect／planner／writer／reviewer 的 system prompt 是角色方法，不是“每轮必须执行下一节点”的编排。
- `inkos/packages/core/src/agent/agent-tools.ts:178-194`：`propose_action` 只枚举 15 个 workflow start；没有 plan/write/revise 的逐工具确认。
- `inkos/packages/studio/src/shared/confirmed-production.ts`：`write_next` 是 confirmed production intent；确认的是启动一章生产，不是 plan/write 每一步。
- `inkos/packages/studio/src/api/server.ts`：confirmed intent 绑定后 host 才执行对应 workflow；未确认不启动。
- DSH 现有 `runtime.stage-context`（`stages/index.ts`）只按工作区文件判定阶段并注入协议；它没有“workflow start”状态，也没有工具入口拒绝。

## Decision

### 阶段上下文只描述，不启动

- `renderStageProtocol` 改为“当前阶段职责 + 产物 + 本阶段完成条件”，删除“目标：按顺序调…”这类强制口径，追加：
  - 作者只是问候/讨论时先正常回答，不改作品；
  - 本阶段完成即停，不自动进入下一阶段；
  - 下一阶段必须由 workflow start 触发。
- 阶段协议仍按阶段注入方法/契约；`story_next` 仍是只读路牌。

### workflow start 记录

- 新增 `core/workflow-start.ts`：
  - 路径 `source/story/runtime/workflow-start.json`；
  - 记录 `{version:1, action:'write_next', chapter, instruction, createdAt}`；
  - `readWorkflowStart(root)`、`writeWorkflowStart(root, input)`、`clearWorkflowStart(root)`、`workflowStarted(root, chapter)`；
  - 同一章只有一个 start；写入前禁止已有未消费的 start；章节 workflow 完成（review 落盘）后可清除。
- start 是**授权记录**，不是第二套状态表；它只说明“作者确认启动这一章的 workflow”，阶段和产物仍由文件判定。
- 第一阶段（foundation）由 `/story-init` 命令/`story_work_create` 启动；foundation 完成后不自动写 start。

### 阶段判定

`detectStage`/`StageFacts` 扩展：

- 基础设定未齐 → `foundation`；
- 基础设定齐、无当前章 `workflow start` → `foundation-ready`（新阶段；协议：等待作者确认/开始下一章，不规划不写）；
- 有 start、无本章 plan → `plan`；
- 有 plan、无本章正文 → `write`；
- 有正文、无本章 review → `review`；
- 有 review → `chapter-done`（新阶段；停下，等待作者开下一章或结算）。

阶段上下文对 `foundation-ready`/`chapter-done` 只给“下一步由 panel.confirm/命令发起 workflow start”，不给 plan/write 指令。

`story_next` 与面板路牌同步：foundation 齐后 `story_next` 的 `next` 指向 `panel.confirm` 的 workflow start（不再指向 `story_gate`）；review 完成后指向下一章 start 或结算，不自动进 plan。`story_next` 仍是只读；它只报下一步，不写 start。

### 工具准入

- `story_plan_chapter` 与 `story_write_chapter` 在入口检查 `workflowStarted(root, chapter)`；没有 start 直接拒绝，错误提示“先由作者确认开始本章 workflow”。
- `story_review_chapter` 在 start 与正文存在时允许；不在每个 plan/write 步骤上再加 approval。
- work-lock 仍包 action 入口；start 检查在锁内，避免两个进程同时读/写 start。

### panel.confirm（依赖）

`runtime.stage-context` 只读 start；写 start 的 `panel.confirm`（P1）已实现 `/story-write` + `StoryView` 开始下一章；两行分开交付；本行测试用 fixture 写 start。

### 文档/账本

- `docs/scope.md` P1 合同：`runtime.stage-context` 的出口包含“无 workflow start 不进入 plan”；`panel.confirm` 是写 start 的入口；D28/D29 已偿还。
- `docs/fidelity-audit.md` `runtime.stage-context` 改为等价；`panel.confirm` 的 D29 改为等价，D30 记录 P6 工作台。
- `docs/dsh-mapping.md` 增加 workflow start 记录/阶段停点映射。
- `capabilities.yaml` `runtime.stage-context` consumer 更新；`panel.confirm` 的 implementation/consumer 在下一行。

## Alternatives considered

- **只在 prompt 加“请停下”** — 零状态。否掉：模型可以忽略；截图的自动 plan/write 证明 prompt 不是准入。
- **把 foundation 签核当 workflow start** — 复用现有 `story_gate`。否掉：源 `propose_action` 没有 foundation 后签核；`write_next` 才是启动一章的 workflow start。foundation 签核是 DSH 额外面，不能替代。
- **在每个 plan/write 工具都请求 approval** — 最严。否掉：源只确认 workflow start；逐工具 approval 是自创限制。
- **把 workflow start 放进 `capabilities.yaml` 状态** — 直观。否掉：状态表只由证据生成；start 是 action 授权记录，不是能力状态。
- **让 stage context 直接写 start** — 少一行。否掉：阶段上下文是只读注入；写授权必须由 panel.confirm/命令完成。

## Testing

- foundation 完成后，无 workflow start 时 `detectStage` 返回 `foundation-ready`，阶段上下文不包含 plan/write 指令；普通问候不产生文件写入。
- `story_plan_chapter`/`story_write_chapter` 无 start 时拒绝；写 start 后进入 plan，plan 完成进入 write，正文完成进入 review，review 后 `chapter-done` 停下。
- workflow start 记录字段/路径/单章唯一；review 后可清除；坏记录/过期 chapter 报错。
- 测试：`test/stage-context.test.mjs`（foundation-ready、start→plan、chapter-done、问候不写）；`test/workflow-start.test.mjs`；`test/plan-tool.test.mjs`/`write-tool` 拒绝无 start；work-lock 回归。
- 真机：`/story-init` 后只发「你好」不自动 plan/write；panel.confirm/命令写 start 后才 plan；这是 `panel.confirm` 完成后的联合回执。
- `pnpm run verify` 与 CI 双端通过。
- 实施后：`core/workflow-start.ts`、`stages/index.ts` 的 foundation-ready/chapter-done、plan/write/review start 准入；`pnpm test` 318 例；`artifacts/real-runs/runtime.stage-context.json` 记录 process-level 回执（非 DSH 会话）。`panel.confirm` 仍是 D29，未在本行实现。

## Consequences

- `chapter-done` 是本章终点：`current_state.chapter` 的推进/结算仍是 P4 `chapter.settle`，本行不实现；因此下一章在 P4 前不可达，`story_next` 的 ready 路牌只是 foundation 级，不是下一章入口。这是本行的限制，不是已完成。
- `create_book` 这一腿由 `/story-init`/`story_work_create` 直接启动；命令本身是作者动作，不写 `workflow-start`。`workflow-start` 只记录一章的 `write_next`。源 `create_book` 的 confirmed intent 由命令/创建入口承担。
- `story_next` 仍是 foundation 级路牌（ready → panel.confirm）；`runtime.stage-context` 是实际阶段判定。两者在 P4 结算/下一章接入前不完全重合。
- `panel.confirm` 已实现（D29 偿还）；P1 面板固定第 1 章，D30/P6 `panel.workbench` 解决动态章节。
