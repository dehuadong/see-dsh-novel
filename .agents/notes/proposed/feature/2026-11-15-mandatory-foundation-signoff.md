# Agent Note: foundation.approval —— 开章前的基础设定确认

Status: proposed

> 2026-11-15 后续：本篇「已结算 + 记录失效 → 面板回到 foundation 确认」由 [`2026-11-15-panel-draft-and-foundation-change.md`](../bug-fix/2026-11-15-panel-draft-and-foundation-change.md) 取代——界面保持六阶段 done、根动作「开始下一章」，只在顶部提示重新确认；`/story-write` 命令门禁不变。

## Problem

基础设定的作者确认闸门已经存在（`story_foundation_signoff`／`/story-approve`／面板「确认基础设定」），但它只是会话回执，且 `/story-write` 不检查：作者没点确认、只跑 `/story-write` 就开始写第 1 章（2026-11-15 真实会话）。

作者于 2026-11-15 决定：**全书计划（基础设定）经作者确认之前，不能开始任何一章**；不只第 1 章，第 2 卷第 1 章同样要先确认。确认是作品级的，基础设定改了才需要重新确认；章节写入不影响它。

源工程没有这道门禁：源在写章前只检查基础设定完整（`inkos/packages/core/src/pipeline/runner.ts:1266-1270`），作者确认一次 `write_next`（`confirmed-production.ts:3-32`；`agent-session.ts:717-725`；入口 `server.ts:3328-3351`）后直接跑完整章。故本行是**作者决定的产品偏差**：源 = 完整性 + `write_next` 确认；复刻 = 作品级基础设定确认 + 每次开章检查。

既有闸门实现见 [`2026-11-04-foundation-approval-gate.md`](../../implemented/architecture/2026-11-04-foundation-approval-gate.md)，面板确认入口见 [`2026-11-09-panel-confirm.md`](../../implemented/architecture/2026-11-09-panel-confirm.md)。

## Proposal

### 范围与非目标

- 范围：新增作品级「基础设定确认」记录；`/story-approve` 写入确认、`/story-reject` 写入退回墓碑、`story_foundation_signoff` 成功后写入；`/story-write` 每次开章前校验记录与当前基础设定摘要；foundation-ready 协议（zh/en）；面板读取记录；测试与真实回执；作者裁决偏差登记。
- 非目标：不改章节级 workflow start；不改签核的两条通道与回执格式；不把章节状态/runtime 纳入摘要；不把确认写进 `work.json`；不改变面板结算投影（`panel.workbench` 另项）。
- 跨行消费者：`foundation.approval`（本行）＋`panel.confirm` 的 `/story-approve`、`/story-reject`、`/story-write`（`commands.ts`、`write-command.ts`）＋`runtime.stage-context` 的 foundation-ready 文本＋`panel.workbench` 的确认读取。实施时在 PR 说明。

### 产品行为与验收

- 作品级记录：`source/story/runtime/foundation-approval.json`，含 `version`、`state`（approved／rejected）、`digest`、`approvedAt`、`files`。`digest` 只覆盖基础设定：故事框架、分卷地图、本书规则（md／json）、角色卡；**不含** `pending_hooks.md`、`state/`、章节 runtime、快照、章节摘要。
- `/story-approve` 写 approved 记录（摘要按当前基础设定）；`/story-reject` 写 rejected 记录（保留墓碑，旧会话回执不能重建确认）；`story_foundation_signoff` 成功写 approved 记录。记录跨会话有效。
- `/story-write` 在**任何章节**开写前检查：记录存在且 `digest` 等于当前基础设定摘要；否则拒绝，文本指向 `/story-approve`。没有确认、基础设定改过、退回后都拒绝。
- 第 2 章及以后：基础设定未变则直接通过；分卷地图等基础设定改了则要求重新确认（第 2 卷第 1 章同样适用）。
- 面板 `foundation-ready`：有有效记录时不再显示「确认基础设定」，显示根动作「开始下一章」；没有记录时保持确认动作与「开始下一章」次动作（按钮可点，命令会拦）。已结算后基础设定记录失效（改过分卷地图等）时，面板保持六阶段完成与「开始下一章」，只在顶部提示「开始下一章前请重新确认」（后续 panel 工作项接管）。
- foundation-ready 协议 zh/en：先 `/story-approve`（或面板确认基础设定），再 `/story-write`；不再出现「直接说开始」的邀请。
- 测试：记录读写、摘要稳定性与 `readArtifacts` 排除；改分卷地图后摘要变化；删章/结算不影响记录；`/story-write` 无记录拒绝、有记录通过、改基础设定后拒绝、退回后拒绝、重新确认后通过、第 2 章有效记录通过；`/story-approve` 写、`/story-reject` 写退回记录、signoff 写；面板待确认/已确认/已结算后失效三态；中英协议。
- 真实回执：一次无确认被拒、一次确认后开写；第 2 章用有效记录直接开写。

### 决定与未决问题

- 决定（作者 2026-11-15）：作品级确认，任何章节开写前检查；基础设定变了才重新确认。
- 未决：无。

### 评审与批准证据

- 既有规划评审发现「只拦第 1 章」与「会话回执跨会话失效」；本版按作者「第 2 卷也要」改为作品级记录，待实现内复核。
- 批准与执行授权：`/implement 批准，执行实现 foundation.approval 开章前的基础设定确认（作品级，第 2 卷也生效）`（2026-11-15，对话）。
- 本 Note 是 planning 绑定的工作项；评审/批准证据归本工作项。

## Design

新增 `packages/see-dsh-novel/src/core/foundation-approval.ts`：

- `foundationApprovalFiles(root)`：固定 `story_frame.md`、`volume_map.md`、`book_rules.md`、`book_rules.json`，加 `source/story/roles/**/*.md`；排序、去重。
- `foundationApprovalDigest(root)`：逐文件把相对路径、字节长度、内容喂 sha256；无文件时返回空串。
- `readFoundationApproval(root)` / `isFoundationApproved(root)` / `writeFoundationApproval(root, expectedDigest?)` / `rejectFoundationApproval(root)` / `clearFoundationApproval(root)`；记录写用 `commitFile`，清除只用于测试/清理（ENOENT 忽略）。
- 记录路径 `source/story/runtime/foundation-approval.json`；不进面板展示集合。

命令：`pipelines/long/commands.ts` 的 `approve` 在返回标记前写 approved 记录；`reject` 写 rejected 记录（不清空）。`gate.ts` 的 `story_foundation_signoff` 命中 approved 记录时直接放行，rejected 记录时拒绝，否则走原有两条通道并写 approved；写入用询问前的摘要比对。命令与工具都在 `withWorkAction` 锁内写，避免与 `/story-write` 竞态。

`plugin/write-command.ts`：`startChapter` 在 `withWorkAction` 内、`detectStage` 之后调用 `isFoundationApproved(root)`；不通过就抛错；通过才写 workflow start。错误文本区分「没有记录 / 记录已失效（基础设定改过）」两类。

`stages/index.ts` foundation-ready 文本（zh/en）改成「先 `/story-approve` 或面板确认，再 `/story-write`」；面板 `panel-index.ts` 读 `isFoundationApproved`：`foundation-ready` 且已确认时 foundation `done`、根动作 `start-chapter`、confirmation `none/done`；未确认时保持现有确认动作。

## Alternatives considered

- **只拦第 1 章。** 否掉：作者明确第 2 卷第 1 章也要；只拦第 1 章在新卷开写时会漏。
- **继续用会话回执。** 否掉：回执按会话，换会话/面板确认后读不到；作品级记录才能跨会话。
- **用全量 `source/story` 摘要。** 否掉：章节写入会改摘要，导致每章都要重新确认；只覆盖基础设定文件。
- **把确认写进 `work.json`。** 否掉：确认是操作痕迹，不是作品身份；放 runtime 记录，删作品时随之消失。
- **在面板置灰「开始下一章」。** 否掉：命令层校验是权威；按钮保持可点，失败给错误。

## Acceptance criteria

1. `/story-approve` 写 approved 记录；`/story-reject` 写 rejected 记录；`story_foundation_signoff` 写 approved 记录。
2. `/story-write` 在任何章节开写前校验记录与摘要；无记录/失效时拒绝且不写 workflow start。
3. 基础设定（分卷地图等）改动后旧记录失效；重新 `/story-approve` 后通过。
4. 第 2 章及以后用有效记录直接通过；删章/结算不使记录失效。
5. 面板 `foundation-ready`：有记录时 foundation done、根动作「开始下一章」、无确认动作；无记录时保持确认。
6. foundation-ready 协议 zh/en 都要求先确认再 `/story-write`。
7. 测试覆盖 1–6；真实回执覆盖拒绝/通过/第 2 章。
8. 偏差：源仅完整性 + `write_next` 确认；复刻作品级基础设定确认（作者决定 2026-11-15）。按 `docs/AGENTS.md` 属主写进 `docs/dsh-mapping.md` 的「作者裁决偏差」行与 `dsh-deviations.md` 明细；`docs/dsh-mapping.md:5` 的来源扩为三类，不计保真债。
9. 账本：`foundation.approval` 的 `source` 修正到 `agent-tools.ts`／`action-envelope.ts`／`confirmed-production.ts`／`agent-session.ts`／`server.ts`；implementation 加 `foundation-approval.ts`；重录 `foundation.approval.json`、`panel.confirm.json`、`runtime.stage-context.json`、`panel.workbench.json`；`check-capabilities -- --write`。
10. AU-14：子项 1（作者裁决 + source 修正 + 偏差登记）由本行关闭；子项 2 不采用；子项 3（自由文本无执行权 / actionSource）仍开，归 `panel.confirm`。

## 待实测（batch）

- 新会话无确认时 `/story-write` 被拒；`/story-approve` 后第 1 章开写；第 1 章结算后 `/story-write` 第 2 章直接通过；改分卷地图后再次 `/story-write` 被拒，重新确认后通过。
- 面板：确认前后 `foundation-ready` 的主动作与根动作变化。

## Risks

- 新增落盘文件 `foundation-approval.json` 被 `readArtifacts` 排除，签核回执摘要不因它变化；本门禁用自己的基础设定摘要。旧 Note 的「回执只在会话里／不写作品目录」已被本行取代并互链。
- 旧作品没有记录：第一次 `/story-write` 会要求补 `/story-approve`；符合作者决定。
- 跨行改动（commands/gate/stage 文本/panel）需 PR 说明；不批准则门禁与面板无法一致。
- 作品被删除/重建时记录随 runtime 消失；无需额外清理。
