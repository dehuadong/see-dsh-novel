# Agent Note: panel.workbench —— 结算前正文、确认提示与基础设定变更

Status: proposed

## Problem

batch 会话 `session-409ea38c-8d47-4c0b-aea9-1e07cad238d2` 暴露三处面板问题：

1. **结算前看不到正文。** 源 Studio 在写作时把 `draft:delta` 流式写进聊天（`inkos/packages/studio/src/api/server.ts:5104,5276` 广播，`inkos/packages/studio/src/store/chat/parts-builder.ts:202-214` 追加到消息），作者可以边写边读；源码的 `ChapterWorkspacePanel` 只列 brief/plan/versions，不列首版草稿（`inkos/packages/studio/src/components/ChapterWorkspacePanel.tsx:14-27`；版本源 `inkos/packages/core/src/state/chapter-workspace.ts:61-110`），但聊天有。复刻按作者决定把正文从主会话移走后，聊天这个阅读面没了，面板又只显示 `source/chapters` 的已发布章，作者只能在结算后读正文。
2. **结算后被基础设定确认「回退」。** 第 2 章已结算（`current_state=2`，`source/chapters` 有第 1、2 章），但作者在结算前「补卷章」修改了 `volume_map.md`，确认摘要失效；`chapterSettled` 依赖基础设定确认有效，于是阶段轨退回 foundation current，正文/审阅/结算都显示未完成。**结算事实不应该被基础设定确认状态回退。**
3. **同一句确认在每个阶段重复。** `panel.index.json` 只有一个索引级 `confirmation`，`Workbench.tsx:259-266` 在公共详情区无条件渲染；切到正文、审阅、结算都显示同一句。基础设定失效时还保留了「确认基础设定 / 开始下一章 / 退回 / 查看待确认 / 稍后」五连排；开始下一章本身可以留着，但五连排和重复确认行是误导。

## Proposal

### 范围与非目标

- 范围：面板在 `write`/`review` 显示只读草稿；把「章节结算」与「基础设定确认」解耦；基础设定确认失效只在「开始下一章」时生效；确认提示改为只显示一次；已结算不退回 foundation current、不出现五连排。
- 非目标：不改结算门禁、不改 foundation 摘要口径、不改 chapter.write 的摘要交接、不做面板内编辑、不把草稿复制到 `source/`。**修订提案的正文阅读面另立工作项**（本次只覆盖首版 `.drafts/chapter-NNNN.md`；修订提案 `.drafts/revision-NNNN.json` 的只读展示不在本行）。
- 跨行：`panel.workbench`（投影/动作/客户端）+ `foundation.approval`（只读 `foundationApprovalState` helper；gate/命令行为不变）+ `panel.confirm`（`/story-write` 的拒绝文案改为只指 `/story-approve`，行为变化需重录 `panel.confirm.json`）。草稿可见性是作者裁决的产品偏差，记入 `dsh-mapping` 作者裁决表。

### 既有决定与取代

本篇部分取代以下三处投影/确认事实，三篇都保留并互链（旧篇同批加修订横幅、改事实）：

- [`2026-11-15-panel-settled-projection.md`](./2026-11-15-panel-settled-projection.md)：已结算仍六阶段 done 不变；本篇取代它「confirmation 只按 foundation-signoff 显示」的用法——基础设定 stale/rejected 时用同一 `confirmation` 通道给一次性提示，但不再把阶段退回 foundation current。
- [`2026-11-15-mandatory-foundation-signoff.md`](../feature/2026-11-15-mandatory-foundation-signoff.md)：本篇取代它 AC5「已结算 + 记录失效 → 面板回到 foundation 确认」——改为阶段保持 done，只在顶部提示「开始下一章前重新确认」；`/story-write` 的命令门禁不变。
- [`2026-11-10-panel-workbench-dialogue-first.md`](../../implemented/architecture/2026-11-10-panel-workbench-dialogue-first.md)：本篇取代「每个阶段详情底部都显示确认状态」——确认提示只在面板顶部显示一次；动作条仍按阶段/根动作渲染。

### 产品行为与验收

**A. 结算前草稿**

- `write`/`review` 阶段且 `.drafts/chapter-NNNN.md` 存在时（草稿落盘后 `detectStage` 已是 `review`），产物列表出现「第 N 章 · 草稿」，readonly，stages `['write','review']`；点击显示草稿全文。写作中的流式显示只有源有，复刻是落盘后读（见 AC7）。
- 结算后草稿删除，改为显示 `source/chapters` 的章节产物；同一章不同时出现两份正文。
- 草稿必须明确标注「草稿」，不能显示成已发布章节。

**B. 结算事实与基础设定确认解耦**

- `chapterSettled = stage === 'foundation-ready' && currentChapter >= 1`，不看基础设定确认是否有效。
- 已结算时 proposal/foundation/plan/write/review/settle 全部 `done`；章节产物照常显示。第 2 章结算后不再因为 `volume_map` 改动回退阶段轨。
- 基础设定状态独立为 `none`（从未确认）、`approved`（有效）、`stale`（确认后改过）、`rejected`（已退回）。

**C. 基础设定失效只拦「开始下一章」**

- 已结算 + `approved`：根动作「开始下一章」，无基础设定提示。
- 已结算 + `stale`/`rejected`/`none`：阶段轨保持六阶段 done，根动作仍是「开始下一章」（按钮不置灰，沿用既有「命令层校验」决定）；顶部一次性提示说明「基础设定在确认后修改过/已退回/尚未确认，开始下一章前请 `/story-approve`」。不出现「确认基础设定/退回/查看待确认/稍后」五连排，也不把阶段退回 foundation current。
- `/story-approve` 后，下一次投影清除提示；`/story-write` 直到确认有效才放行（命令门禁不变）。
- 首次 foundation-ready（`currentChapter=0`）保持原行为：待确认时五个动作；已确认时根动作「开始下一章」。
- **不再出现**已结算上下文中的「确认基础设定/开始下一章/退回/查看待确认/稍后」五连排。

**D. 确认提示只显示一次**

- `confirmation` 仍由宿主投影提供，但客户端只在**面板顶部（页头下、三列上方）**渲染一次，不在每个阶段详情底部重复；首次 foundation-ready 的动作不变，只把提示位置统一到顶部。
- `confirmation.reason` 区分：首次从未确认（「基础设定已齐，等待作者确认」）、已结算但从未确认（「基础设定尚未确认；开始下一章前请 `/story-approve`」）、确认后改过（「基础设定在确认后修改过；开始下一章前请重新确认」）、已退回（「作者退回了这一版基础设定；开始下一章前请重新确认」）。

### 决定与未决问题

- 决定（作者 2026-11-15）：结算前必须能读草稿；第 2 章结算不因为补卷章回退；基础设定失效只影响开始下一章，面板只提示、不换根动作、不置灰。
- 未决：无。

### 评审与批准证据

- Plan Review：2026-11-15 多轮（Standards/Spec/Architecture），终评 PASS；首轮指出旧决定未互链、根动作隐藏未授权、账本/版本缺失、草稿偏差错位，后续按「保留开始下一章、顶部提示、v8、三篇互链」收敛。
- 批准：待用户。
- 执行授权：待用户。
- 本 Note 是 planning 绑定的工作项。

## Design

`panel-index.ts`：

- `foundationApprovalState(root)` 下沉到 `foundation-approval.ts`，由 `panel-index` 使用；`gate.ts` 现有判定不变，避免 foundation.approval 行为/证据变化。
- `chapterSettled = stage === 'foundation-ready' && currentChapter >= 1`（移除 `foundationApproved` 依赖）；状态映射先短路 chapterSettled → 六阶段全 done；`foundationAwaitingSignoff = stage === 'foundation-ready' && currentChapter === 0 && foundationState !== 'approved'`，不能让首次 stale/rejected 掉成 locked。B 与 Design 使用同一公式，不再写「以及已发布章的存在」。
- 根动作：`chapterSettled` → `start-chapter`（不论 foundationState；按钮不置灰）；`chapter-done` 首版 → `settle-chapter`；修订/扣下 → `revise-chapter`；首次 foundation-ready 待确认 → 现有五动作。
- `confirmation` 分支顺序：仅在 `stage === 'foundation-ready'` 时按 `rejected` → `stale` → `(chapterSettled || 首次) && foundationState === 'approved'` → `none/done` → `chapterSettled && none` → `foundation-signoff/pending`「尚未确认，开始下一章前请 `/story-approve`」 → 首次 `none` →「基础设定已齐，等待作者确认」；plan/write/review/chapter-done 仍保留现有 workflow-start/chapter/proposal 文案，stale/rejected 不顶掉「本章 workflow 已开始/审稿已落盘」。已结算的 stale/rejected/none 返回 `foundation-signoff/pending` + 对应 reason，但不改阶段/根动作。
- 草稿产物：`buildPanelArtifacts` 在 write/review 且 `.drafts/chapter-NNNN.md` 存在时追加 `class:'draft'` 行；`PanelArtifact['class']` 增加 `draft`，`DISPLAY_STAGES.draft = ['write','review']`；草稿 order 用 210（排在 `source/chapters` 之后、诊断之前），按章号排序。
- `PANEL_INDEX_VERSION` 升到 8；两份 `panel-types.ts` 的 `version` 字面量、`panel-index.ts` 常量、`panel-index`/`panel-projection`/`workbench`/`client` 夹具的 7 全部改 8；旧 v7 索引在会话创建/下一次写动作重建。

客户端：

- `Workbench.tsx` 把 `index.confirmation` 从公共详情底部移到面板顶部只渲染一次；确认行不随选中阶段重复。
- 动作条按根/阶段动作渲染；已结算仍给 `start-chapter`，不新增根动作。`StoryView` 的 `start-chapter` 改用 `executeCommand`（与导出一致），让 `/story-write` 的拒绝文本（先 `/story-approve`）可见；`write-command.ts` 的拒绝文案去掉“面板确认基础设定”指路（已结算时没有该按钮），改为只指 `/story-approve`。
- 草稿产物用现有 `readArtifact` 读取；`dsh-api-workspace-files` 的 `read` 接受工作区相对路径，`.drafts/chapter-NNNN.md` 是普通 UTF-8 文件，无需新增资源注册。Risks 不再把资源白名单列为未决。

## Alternatives considered

- **恢复主会话正文。** 否掉：与作者刚定的「主会话只摘要」冲突；阅读面应由面板承担。
- **把草稿复制到 `source/story/runtime`。** 否掉：进签核摘要/备份，结算后还要清两份。
- **继续让 `chapterSettled` 依赖基础设定确认。** 否掉：结算事实与确认状态是两件事；这正是「第 2 章结算后还确认基础设定」的根因。
- **基础设定失效时仍给「开始下一章」。** 选定：沿用既有「按钮可点、命令层校验」决定，面板不新造门禁；顶部提示 `/story-approve`，点击由 `/story-write` 拒绝并给出可见原因。
- **确认行继续在每个阶段显示。** 否掉：它是索引级事实，重复显示误导。

## Acceptance criteria

1. 草稿落盘后（结算删除前）面板出现「第 N 章 · 草稿」，可只读查看；结算后消失，章节产物出现。
2. 第 2 章已结算后，即使 `volume_map` 改过，阶段轨仍六阶段 done，不退回 foundation current。
3. 已结算 + 基础设定 `stale`/`rejected`/`none`：六阶段仍 done，根动作仍是「开始下一章」，顶部提示区分「确认后改过/已退回/尚未确认，开始下一章前请 `/story-approve`」；不再出现五连排。
4. `/story-approve` 后提示消失，`/story-write` 放行；不确认时开始下一章被命令拒绝，且客户端用 `executeCommand` 把「先 /story-approve」的拒绝文本显示出来（不落到通用「提交失败」）。
5. 首次 foundation-ready 行为不变；确认行只显示一次（`Workbench` 测试切三个阶段断言只出现一次）。
6. 测试覆盖 1–5；真实会话回执覆盖「第 3 章落盘后在正文/审阅读草稿」与「补卷章后第 2 章仍完成、重新确认后开始第 3 章」。测试文件点名 `panel-index.test.mjs`（已结算 stale 与 none 两个夹具、draft 产物）、`panel-projection.test.mjs`（v7→v8）、`client.test.mjs`（start-chapter 拒绝文本、settle 派发）、`workbench.test.mjs`（确认行唯一）。
7. 偏差：源 = 聊天里流式 `draft:delta`（写作中可边写边读）；复刻 = 落盘后面板只读草稿、主会话只摘要。按作者裁决写进 `dsh-mapping` 作者裁决表，并在 `dsh-deviations.md` 写四段明细。
8. 账本/证据：`panel.workbench` 的 real-run 重录、`panel.confirm`（`/story-write` 拒绝文案变化）的 real-run 重录、`capabilities.yaml` 的 implementation/consumer/realRun 同步、`check-capabilities -- --write`、`fidelity-audit` 与审计行更新；`PANEL_INDEX_VERSION=8`，host/client 两份类型同步。
9. 同批更新三篇旧 Note 的事实与入站链接：`panel-settled-projection`（v8、已结算 stale 用顶层提示）、`mandatory-foundation-signoff`（已结算不再回退）、`panel-workbench-dialogue-first`（确认行顶部一次、版本 8）；`verify-notes` 通过。

## 待实测（batch）

- 下一次写作（第 3 章）草稿落盘后，在正文/审阅标签读草稿；结算后草稿消失、章节出现（第 2 章已结算、`.drafts` 为空，不能再用第 2 章取证）。
- 修改 `volume_map.md` 后：第 2 章仍显示完成，根动作仍是「开始下一章」，顶部提示「确认后修改过」；`/story-approve` 后提示消失，`/story-write` 可开第 3 章。
- 确认行只出现一次，不在正文/审阅/结算详情重复；面板索引 v8 在新会话/写动作后重建。

## Risks

- `.drafts` 读取已核实：`dsh-api-workspace-files` 的 `read` 接受工作区相对路径，隐藏目录限制只作用于 `search`；无需新增资源注册。若未来资源策略变化，再单独处理。
- 保留「开始下一章」可点、由命令层拒绝是既有决定；作者可能先看到错误，顶部提示负责解释。不改成置灰或换根动作，避免新的未裁决限制。
- 本行不改结算门禁；结算前草稿可见不改变发布事务。
