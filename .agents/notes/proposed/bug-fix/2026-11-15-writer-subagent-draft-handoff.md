# Agent Note: chapter.write —— 正文不再作为主会话回答

Status: proposed

## Problem

2026-11-15 的真实会话里，主会话直接显示了第 1 章的整段正文。原因是 `story:stage` 的 write 协议第 4–5 步让主编把 writer 子代理的最终回答（整章正文）接过来，再调 `story_write_chapter`；`subagent` 的完成消息会把子代理的最终回答带回主会话，于是作者在对话里读到了正文。

源工程没有这个问题：源没有子代理；writer 在 pipeline 内部写作品，Studio 只在写作过程中把 `draft:delta` 流式显示在对话（`inkos/packages/studio/src/store/chat/parts-builder.ts:202-214`），正文最终进作品页（`ChapterWorkspacePanel.tsx:14-27`），不把整章当作主 agent 的最终回答。复刻多了一步「把正文当会话回答」，属于呈现偏差。

## Proposal

### 范围与非目标

- 范围：write 阶段的 writer 子代理交接方式与阶段协议；writer 子代理写草稿、只回传摘要；主会话不再出现整章正文；测试与真实回执。
- 非目标：不改正文生成质量、审稿、修订、结算；不改 `story_write_chapter` 的落盘契约；不改面板正文阅读；不改变「写作中流式显示」这一源行为（若以后要复刻 draft:delta，另立）。
- 跨行消费者：`chapter.write`（本行）＋`runtime.stage-context` 的 write 协议（`stages/index.ts`）。实施时在 PR 说明。

### 产品行为与验收

- writer 子代理自己调用 `story_write_chapter` 把正文写进 `.drafts/chapter-0001.md`，只回传四行摘要（`标题：`、`字数：`、`草稿：`、`注意：`）；不回传正文。真实会话的子代理已经调用过 `story_write_chapter`（child session `2a7f9fae`），工具对子代理可见，不需要兜底入口。
- 主会话在 write 阶段只显示这段四行摘要与子代理完成消息，不显示整章正文；正文从章节文档/面板读。
- writer 子代理落盘后，阶段会翻到 review；`story:stage` 与 `story:craft` 对「本会话已调用过 `story_write_chapter`」的 agent 改注入停止指令（`## 草稿已落盘` / `## Draft persisted`），不再注入章后审阅协议，避免子代理自己继续审稿。
- 主编不调用 `story_write_chapter` 传正文；主编核对 writer 摘要的标题、字数、草稿路径，并用 `glob` 确认草稿存在。
- 草稿写完后仍按原协议停；审稿、修订、结算不变。
- 测试：`test/stage-context.test.mjs` 断言 write 协议 zh/en 的四行摘要、`story_write_chapter` 落盘与「不复述正文」，并断言「已调用 `story_write_chapter` 的 agent 在 review 阶段收到停止指令、craft 为空；普通审稿子代理仍收到审稿协议」；`test/writer-contract.test.mjs` 保持六段、不加交接段（共享契约不变）；真实会话回执记录「主会话消息里无整章正文、草稿存在、writer 子会话未审稿」。

### 决定与未决问题

- 决定（作者 2026-11-15）：正文不作为主会话回答；主会话只给摘要与路径。
- 未决：是否在面板/对话复刻源 `draft:delta` 的流式写作显示，本行不做。

### 评审与批准证据

- 本 Note 是 planning 绑定的工作项；评审/批准证据归本 Note。
- 批准与执行授权：`/implement 批准，执行实现 chapter.write 正文不再作为主会话回答`（2026-11-15，对话）。

## Design

`stages/index.ts` 的 write 协议第 4–5 步（zh/en 两支）改为：

1. 读章纲与上下文，派 writer 写正文；
2. writer 调用 `story_write_chapter` 落盘，回传摘要；
3. 主编核对 writer 摘要的标题、字数、草稿路径，并用 `glob` 确认草稿存在；不读正文、不把正文复述到主会话。

阶段协议（zh/en）与主编的派发提示要求「writer 调 `story_write_chapter`、只回四行摘要」；`story_write_chapter` 的 `content` 入参和落盘契约不变。writer 子代理的共享契约（`writer.ts`）不加交接段，避免 composer 等其它子代理收到；工具可见性由真实会话证实（child session `2a7f9fae` 调用过 `story_write_chapter`），不再提供兜底入口。

阶段注入的硬停：`installStageContext` 只对**子代理会话**（`session.header.origin='subagent'` 或 `header.delegationDepth>0`）检查 `snapshotEvents`；出现 `tool/call` 名为 `story_write_chapter` 且当前阶段是 `review` 或 `chapter-done` 时，`story:stage` 返回停止指令、`story:craft` 返回空串；主编（根会话无这些标记）即使历史里调用过该工具也仍拿到审稿协议与 craft；普通审稿子代理没有这条调用，也仍拿到审稿协议。fork 的 `parentSession` 不作为判据，避免继承旧事件被误停。

主代理在 write 阶段结束时只向作者报告摘要；需要阅读正文时走面板/作品页。

## Alternatives considered

- **让主编自己写正文。** 否掉：会把整章正文变成主 agent 的流式回答，问题更大；源也是内部 writer 写。
- **子代理回传正文，但 UI 折叠。** 否掉：需要新的 UI 渲染通道，当前 subagent 的最终回答就是消息；且正文仍进会话历史。
- **保留现状，只提示作者「正文在面板」。** 否掉：正文已经显示，提示不能撤回。
- **复刻源 `draft:delta` 的写作流。** 否掉（本行）：那是另一个呈现能力；本行只解决「整章作为最终回答」。
- **主编把正文写进工具参数但子代理只回摘要。** 否掉：工具参数仍在主会话可见，正文还是会露出来。

## Acceptance criteria

1. write 阶段主会话不再出现整章正文；只出现四行摘要（标题/字数/草稿路径/注意）与子代理完成消息。
2. writer 子代理调用 `story_write_chapter` 落盘；草稿存在、审稿可继续；主编不依赖自己看不到的子代理工具回执。
3. write 协议的 zh/en 两支都改为「writer 落盘、只回传摘要」，不再要求主编传入正文。
4. 测试覆盖 1–3；真实会话回执记录主会话无整章正文、草稿存在、writer 子会话未审稿。
5. writer 子会话落盘后只收到停止指令，不进入审稿；审稿子代理仍收到审稿协议与 craft。
6. 偏差记录：源没有子代理、正文进作品页；复刻改为「子代理落盘、主会话摘要」。按 `docs/AGENTS.md` 的属主，偏差结论写进 `docs/dsh-mapping.md` 的「作者裁决偏差」行，四段明细写进 `artifacts/implementation-audit/dsh-deviations.md`；同时把 `docs/dsh-mapping.md:5` 的偏差来源扩为「DSH 机制／源不可观测／作者裁决（2026-11-15 授权记录）」三类，不计保真债。

## 待实测（batch）

- 新会话（`see-dsh-novel`）在 `D:\workspace\see-dsh-novel-runtime` 跑第 2 章：主会话不出现整章正文；writer 子会话只回四行摘要、落盘后不再审稿；草稿存在，审稿可继续。
- 当前只有协议/测试证据（`stage-context` 15/15、全量 verify 551/550/1），没有真实会话回执；本轮按作者要求把实测留到后面一起做。

## Risks

- 模型可能仍在摘要里夹带正文段落；验收以「主会话无整章正文」为准，必要时在协议/派发提示里限制摘要长度。
- 源在写作中会流式显示 draft；本行会让写作过程在主会话更安静，这是作者要求的呈现差异，需在偏差表登记。
