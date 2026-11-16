# Agent Note: panel.workbench —— 结算前正文、确认提示与基础设定变更

Status: implemented

## Problem

batch 会话 `session-409ea38c-8d47-4c0b-aea9-1e07cad238d2` 暴露三处面板问题。

1. **结算前看不到正文。** 源 Studio 在写作时把 `draft:delta` 流式写进聊天（`inkos/packages/studio/src/api/server.ts:5104,5276` 广播，`inkos/packages/studio/src/store/chat/parts-builder.ts:202-214` 追加到消息），作者可以边写边读；源码的 `ChapterWorkspacePanel` 只列 brief/plan/versions，不列首版草稿（`inkos/packages/studio/src/components/ChapterWorkspacePanel.tsx:14-27`；版本源 `inkos/packages/core/src/state/chapter-workspace.ts:61-110`），但聊天有。复刻按作者决定把正文从主会话移走后，聊天这个阅读面没了，面板又只显示 `source/chapters` 的已发布章，作者只能在结算后读正文。
2. **结算后被基础设定确认「回退」。** 第 2 章已结算（`current_state=2`，`source/chapters` 有第 1、2 章），但作者在结算前「补卷章」修改了 `volume_map.md`，确认摘要失效；`chapterSettled` 依赖基础设定确认有效，于是阶段轨退回 foundation current，正文/审阅/结算都显示未完成。结算事实不应该被基础设定确认状态回退。
3. **同一句确认在每个阶段重复。** `panel.index.json` 只有一个索引级 `confirmation`，`Workbench.tsx` 在公共详情区无条件渲染；切到正文、审阅、结算都显示同一句。基础设定失效时还保留了「确认基础设定 / 开始下一章 / 退回 / 查看待确认 / 稍后」五连排；开始下一章本身可以留着，但五连排和重复确认行是误导。

## Decision

- **结算前草稿是面板产物。** `write`/`review` 阶段且 `.drafts/chapter-NNNN.md` 存在时，产物列表出现「第 N 章 · 草稿」（`class: 'draft'`，`stages: ['write','review']`，order 210，只读）。同一章已出现在 `source/chapters` 时不再给草稿行，一章只有一份正文；结算删除草稿后改由章节产物显示。草稿行在详情里带一句「草稿：这一章还没有结算发布」的警示。
- **结算事实与基础设定确认解耦。** `chapterSettled = stage === 'foundation-ready' && currentChapter >= 1`，不再看确认是否有效；已结算时 proposal/foundation/plan/write/review/settle 全部 `done`，根动作恒为「开始下一章」。基础设定状态由 `foundation-approval.ts` 的 `foundationApprovalState(root)` 提供：`none`（从未确认）、`approved`（摘要命中）、`stale`（确认后改过）、`rejected`（作者退回）。`gate.ts` 的 `isFoundationApproved` 判定不变。
- **基础设定失效只拦「开始下一章」。** 已结算且 `approved` 时无提示；`stale`/`rejected`/`none` 时阶段轨保持六阶段 done、根动作仍是可点的「开始下一章」，只在顶部给一次性提示，三种文案都以「开始下一章前请 `/story-approve` 重新确认（或确认）」收尾，并分别说明「确认后修改过 / 已退回 / 尚未确认」。不出现五连排，也不把阶段退回 foundation current。首次 `foundation-ready`（`currentChapter=0`）保持原行为：待确认时五个动作（`stale`/`rejected` 记录同样显示确认动作与对应提示），已确认时根动作「开始下一章」。
- **确认提示只在面板顶部出现一次。** 客户端把索引级 `confirmation` 渲染在页头下、三列上方；选中正文/审阅/结算时不在详情底部重复。`foundation-signoff` 直接显示 `reason`，其余 kind 保持「确认：kind · state」说明。
- **开始下一章走带处理器回执的命令通道。** `StoryView` 用 `executeCommand` 派发 `/story-write`，把拒绝文本（例如「基础设定在确认后改过，确认已失效；先 `/story-approve` 重新确认」）显示在动作条，而不是落到通用「提交失败」。`write-command.ts` 的拒绝文案只指 `/story-approve`，不再指一个已结算状态下不存在的面板按钮。
- **索引版本 8。** `PANEL_INDEX_VERSION`、host/client 两份 `panel-types.ts`、夹具同步；旧 v7 索引在会话创建或下一次作品写动作时重建。

既有决定的关系（三篇都保留并互链）：

- [`2026-11-15-panel-settled-projection.md`](./2026-11-15-panel-settled-projection.md)：已结算仍六阶段 done 不变；本篇取代它「已结算 confirmation 只按 approved 显示」的用法——`stale`/`rejected`/`none` 用同一 `confirmation` 通道给顶部一次性提示，但不把阶段退回 foundation current。
- [`2026-11-15-mandatory-foundation-signoff.md`](../feature/2026-11-15-mandatory-foundation-signoff.md)：本篇取代它「已结算 + 记录失效 → 面板回到 foundation 确认」——改为阶段保持 done、只在顶部提示；`/story-write` 的命令门禁不变。
- [`2026-11-10-panel-workbench-dialogue-first.md`](../architecture/2026-11-10-panel-workbench-dialogue-first.md)：本篇取代「每个阶段详情底部都显示确认状态」——确认提示只在面板顶部一次；动作条仍按阶段/根动作渲染。

## 源工程证据与偏差

- 正文阅读面：源 = 聊天流式 `draft:delta`（写作中可边写边读）；复刻 = 落盘后面板只读草稿、主会话只给摘要。按作者 2026-11-15 裁决登记为产品偏差：结论在 `docs/dsh-mapping.md` 的「作者裁决偏差」，四段明细在 `artifacts/implementation-audit/dsh-deviations.md`。
- 阶段动作条、顶部确认提示与「结算事实不回退」：源没有这套阶段动作条（检索范围 `ChapterWorkspacePanel.tsx`、`ChapterReader.tsx`、`BookDetail.tsx`），属复刻自己的投影与呈现，不改变与源的等价判定。
- 草稿路径复用 `core/chapter-draft.ts` 的 `draftPath`/`DRAFT_DIR`，不新增资源注册；`.drafts` 不在 `readArtifacts`/签核摘要/备份里，草稿出现不改变发布事务。

## Alternatives considered

- **恢复主会话正文。** 否掉：与作者刚定的「主会话只摘要」冲突；阅读面应由面板承担。
- **把草稿复制到 `source/story/runtime`。** 否掉：进签核摘要/备份，结算后还要清两份。
- **继续让 `chapterSettled` 依赖基础设定确认。** 否掉：结算事实与确认状态是两件事；这正是「第 2 章结算后还确认基础设定」的根因。
- **基础设定失效时把「开始下一章」置灰或换根动作。** 否掉：沿用既有「按钮可点、命令层校验」决定，面板不新造门禁；顶部提示 `/story-approve`，点击由 `/story-write` 拒绝并给出可见原因。
- **确认行继续在每个阶段显示。** 否掉：它是索引级事实，重复显示误导。
- **为草稿新增独立的「草稿」阶段或新动作。** 否掉：阶段由工作区状态判定，草稿只是 write/review 阶段的产物。

## Consequences

- 作者读正文的时机从「写作中流式」变成「writer 落盘后」，这是偏差的可见代价；结算删除草稿后同一位置改显示已发布章节。
- 基础设定在确认后又被修改时，面板只提示、不阻挡；作者点「开始下一章」会看到 `/story-write` 的拒绝文本。提示会一直显示到下一次 `/story-approve`，每次投影都重新判断。
- 索引升到 8：已打开的会话在重建前仍显示 v7；缺口由会话发布/下一次写动作的补建覆盖。v8 只加 `draft` 类别与新的确认文案，没有字段迁移，`normalizeIndex` 不改。
- 旧 Note 的事实已在同批更新：`panel-settled-projection`（v8、已结算失效用顶部提示）、`mandatory-foundation-signoff`（已结算不再回退）、`panel-workbench-dialogue-first`（确认行顶部一次、版本 8）。
- 账本与证据：`panel.workbench`、`panel.confirm`、`foundation.approval` 三个 real-run 重录；`capabilities.yaml` 的 implementation 指针不变，`foundation.approval` 的 consumer 从 `approval.test.mjs` 改为 `foundation-approval.test.mjs`（新的四态单测是当前证据），另两行 consumer 不变；`fidelity-audit` 三行判定不变（AU-31、AU-11、AU-14 仍开）。
- 已知残留：`foundation-ready` 阶段协议仍写「作者用 `/story-approve`（或面板「确认基础设定」）」；已结算时该按钮不存在，模型可能提到不存在的入口。改阶段协议要连 `runtime.stage-context` 的回执一起重录，留给后续工作项。
- 真实会话取证：本机没有 batch 会话使用的工作区（`D:\workspace\see-dsh-novel-runtime`），也不能在会话内重启宿主，所以「第 3 章落盘后读草稿」「补卷章后第 2 章仍完成、重新确认后开始第 3 章」两条真实 DSH 会话回执未取得（BLOCKED）；当前证据是 `pnpm run verify`（577 tests／576 pass／1 skip）与进程级投影测试。

## Testing

- `test/panel-index.test.mjs`：v8；已结算 + `stale`/`rejected`/`none` 三种夹具都保持六阶段 done、根动作 `start-chapter`、`confirmation` 为对应的 `foundation-signoff/pending`（文案含 `/story-approve`），基础设定节点无动作/无次动作；首次 `foundation-ready` + `stale`/`rejected` 仍给确认动作与四个次动作；已确认时清除提示；草稿产物（`class: 'draft'`、`stages: ['write','review']`、标题「第 N 章 · 草稿」、排在章纲之前、发布后不再出现）。
- `test/foundation-approval.test.mjs`：`foundationApprovalState` 的 none/approved/stale/rejected 四态与墓碑优先。
- `test/panel-projection.test.mjs`：v7 旧格式重建为 v8。
- `test/workbench.test.mjs`：确认提示只出现一次且不在阶段详情里重复（含已结算六阶段 done 的 `stale` 提示夹具）；草稿行与只读警示。
- `test/client.test.mjs`：开始下一章走能取回命令回执的执行器，拒绝文本直接显示，不落到通用「提交失败」。
- `test/write-command.test.mjs`：无确认/退回/失效三种拒绝文案都含 `/story-approve` 且不提「面板」。
