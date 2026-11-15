# Agent Note: chapter.settle —— 结算的显式确认

Status: proposed

## Problem

结算现在是「作者在会话里说一句『结算』，主编按阶段协议开始两阶段结算」：没有工具级校验，也没有面板动作。作者于 2026-11-15 决定：**结算必须由作者显式确认**，不能自动，也不能只靠对话语义。

源工程没有这道门禁：`write_next` 一次确认后，pipeline 在同一动作里跑 写→审→结算→落盘（`inkos/packages/core/src/pipeline/runner.ts:1326-1440`）；Studio 的章节入口是 `write-next`／review／revise（`studio/src/api/server.ts:3328、5555、5586`），没有 settle 动作。复刻已经因 DSH 机制把结算拆成「提案 → state-check → 带 validation 提交」两阶段（已登记）；本行增加作者显式确认，属于**作者决定的产品偏差**：源 = 自动结算；复刻 = 作者确认后两阶段结算。

**本行只覆盖首版结算（`story_settle_chapter`）**。修订提交（`story_commit_revision`）与扣下后的重算（`story_resettle_chapter`）是另外两条修复路径，各有自己的入口，不纳入本门禁。

既有结算实现见 [`2026-11-10-chapter-settle.md`](../../implemented/architecture/2026-11-10-chapter-settle.md) 与 [`2026-11-14-chapter-settle-validation.md`](../../implemented/architecture/2026-11-14-chapter-settle-validation.md)，面板入口见 [`2026-11-09-panel-confirm.md`](../../implemented/architecture/2026-11-09-panel-confirm.md)。

## Proposal

### 范围与非目标

- 范围：新增 `/story-settle` 命令与面板「结算本章」动作；宿主写 `.drafts/settle-approval-NNNN.json`（只含章号与作者标记）；`story_settle_chapter` 的提案与提交要求匹配标记，提交事务消费；阶段协议中英两份；测试与回执；作者裁决偏差登记。
- 非目标：不改两阶段结算的 delta、对账、发布语义；不覆盖修订提交与重算；不绑定正文摘要（作者确认的是「现在结算本章」，不是某一版正文）；不新增审批服务；不写 `source/`。
- 跨行消费者：`chapter.settle`（本行）＋`panel.workbench`（结算按钮）＋`runtime.stage-context`（chapter-done 中英协议）。

### 产品行为与验收

- `/story-settle` 只在「首版审稿完成、尚未结算」时成功：`stage === 'chapter-done' && !facts.revisionReviewed && !facts.chapterPublished`；章号取 `facts.reviewTarget || facts.currentChapter + 1`；校验该章有审稿记录。
- 命令写 `.drafts/settle-approval-NNNN.json`，内容 `{version:1, chapter, source:'author', at}`；不写 `.drafts/settlement-*.json`，不改状态。
- 没有匹配标记时，`story_settle_chapter` 的提案拒绝，错误指向 `/story-settle` 或面板「结算本章」；不写提案。
- 有匹配标记时，提案与提交按现有两阶段流程；提交事务删除标记（`published` 与 `held` 都算发布，都消费）；事务前抛错保留标记，允许重试。
- 修订待提交 / 已发布扣下时 `/story-settle` 拒绝，分别指向修订提交与重算；这两态不显示结算按钮。
- 面板首版 `chapter-done` 的根动作改为「结算本章」，执行 `/story-settle`；修订动作仍在阶段协议与命令入口。
- chapter-done 协议中英都改成「只有作者 `/story-settle` 或面板确认后，才按两阶段结算」，不再把对话里的「结算」当触发。
- 测试：无标记拒绝、有标记通过、提交消费、章号不匹配拒绝、修订/扣下/非 chapter-done 拒绝、面板动作、中英协议；真实会话一次确认后结算。

### 决定与未决问题

- 决定（作者 2026-11-15）：首版结算需要显式确认；不绑定正文版本。
- 未决：修订/重算是否也要显式确认，本行不做；若作者要，另立工作项。

### 评审与批准证据

- 批准与执行授权：`/implement 批准，执行实现 chapter.settle 结算的显式确认（面板按钮 + /story-settle + .drafts 确认标记，首版结算）`（2026-11-15，对话）。
- 本 Note 是 planning 绑定的工作项；评审/批准证据归本工作项。

## Design

新增 `packages/see-dsh-novel/src/core/settle-approval.ts`：

- `settleApprovalPath(chapter)`：`.drafts/settle-approval-<4位>.json`（`.drafts` 已被 `readArtifacts`/备份排除）。
- `readSettleApproval(root, chapter)`：strict 读；`chapter` 必须匹配；损坏返回 null 并在工具错误里提示删除后重跑 `/story-settle`。
- `writeSettleApproval(root, chapter)`：`commitFile` 写 marker。
- `clearSettleApproval(root, chapter)`：删除（测试/清理）；结算事务用 `deletes` 直接删。

新增 `packages/see-dsh-novel/src/plugin/settle-command.ts` 并在 `plugin/agent.ts` 注册 `/story-settle`：`withWorkAction` 内 `detectStage`，守卫首版 `chapter-done`；读审稿记录；写 marker；followup「作者已确认结算第 N 章；按阶段协议先提案，再派 state-check，最后带 validation 提交」。followup 失败时返回「marker 已写、下一轮没起来」，保留 marker。

`settle-tool.ts`：`proposeSettlement` 开头 `readSettleApproval(root, chapter)`，缺失即抛错；`commitSettlement` 再校验一次；`commitFoundation` 的 `deletes` 加 `settleApprovalPath(chapter)`，使 `published`/`held` 都消费，事务前抛错不消费。

`panel-index.ts`：首版 `chapter-done` 的根 `action` 改为 `settle-chapter`「结算本章」；`StoryView.tsx` 的 `handleAction` 增加 `settle-chapter` → `command('结算本章', '/story-settle')`。修订/扣下态保持现状（根动作修订本章）。

阶段协议 `stages/index.ts` 的 chapter-done zh/en 两支改为确认触发；保留 settler 增量、提案、state-check、带 validation 提交的步骤。

## Alternatives considered

- **保持语义门禁（作者说一句『结算』）。** 否掉：作者要的是显式确认；语义触发没有宿主校验。
- **按源自动结算。** 否掉：作者已明确选择显式确认。
- **意图绑定正文摘要。** 否掉：作者确认的是「现在结算」，不是某一版正文；绑定摘要会把改稿后的重审变成另一次确认，超出本轮范围。
- **把 marker 放 `source/story/runtime`。** 否掉：它会进 `readArtifacts` 签核摘要与备份；`.drafts` 天然排除，且结算事务会清掉。
- **覆盖修订提交与重算。** 否掉（本行）：两条路径各有自己的命令/工具，混成一个授权模型会扩大范围。

## Acceptance criteria

1. 无 marker 时 `story_settle_chapter` 提案拒绝，不写提案，错误指向 `/story-settle`。
2. `/story-settle` 只在首版 `chapter-done` 成功；修订/扣下/其他阶段拒绝并给对应入口。
3. marker 章号匹配；`published` 与 `held` 都在事务内消费；事务前失败保留。
4. 面板首版 `chapter-done` 显示「结算本章」，点击执行 `/story-settle`；修订/扣下态不显示结算。
5. chapter-done 协议 zh/en 都要求作者确认，不再把「结算」二字当触发。
6. 测试覆盖 1–5；真实会话回执一次确认后结算。
7. 偏差：源自动结算；复刻首版结算显式确认（作者决定 2026-11-15）。记入 `docs/dsh-mapping.md` 的「作者裁决偏差」与 `dsh-deviations.md` 明细。
8. 账本：`chapter.settle` 的 implementation/consumer 加 `settle-command.ts`、`settle-approval.ts`；重录 `chapter.settle.json`、`panel.workbench.json`、`runtime.stage-context.json`；`check-capabilities -- --write`。

## 待实测（batch）

- 新会话在第 1 章 `chapter-done`：不 `/story-settle` 时 `story_settle_chapter` 被拒；`/story-settle` 后跑完两阶段结算；面板「结算本章」执行同一命令。
- 修订待提交/扣下态不出现「结算本章」。

## Risks

- marker 在 `.drafts`：备份/摘要天然排除，但 `reopen`/`delete` 清理 `.drafts` 时会一并删除；这是可接受的（作者需要重新确认）。
- 只覆盖首版结算；修订/重算仍走各自命令，若作者要求也要显式确认，另立工作项。
- 跨行改动（panel.workbench 动作、runtime.stage-context 协议）需 PR 说明。
- 模型仍可能在作者未点按钮时调用 `story_settle_chapter`，但工具会拒绝；协议也要求先确认。
