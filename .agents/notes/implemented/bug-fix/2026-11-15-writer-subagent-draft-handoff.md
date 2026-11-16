# Agent Note: chapter.write —— 正文不再作为主会话回答

Status: implemented

## Problem

2026-11-15 的真实会话里，主会话直接显示了第 1 章的整段正文。原因是 `story:stage` 的 write 协议第 4–5 步让主编把 writer 子代理的最终回答（整章正文）接过来，再调 `story_write_chapter`；`subagent` 的完成消息会把子代理的最终回答带回主会话，于是作者在对话里读到了正文。

源工程没有这个问题：源没有子代理；writer 在 pipeline 内部写作品，Studio 只在写作过程中把 `draft:delta` 流式显示在对话（`inkos/packages/studio/src/store/chat/parts-builder.ts:202-214`），正文最终进作品页（`ChapterWorkspacePanel.tsx:14-27`），不把整章当作主 agent 的最终回答。复刻多了一步「把正文当会话回答」，属于呈现偏差。

## Decision

- writer 子代理自己调用 `story_write_chapter` 把正文写进 `.drafts/chapter-0001.md`，只回传四行摘要（`标题：`、`字数：`、`草稿：`、`注意：`），不回传正文。真实会话的子代理已经调用过 `story_write_chapter`（child session `2a7f9fae`），工具对子代理可见，不需要兜底入口。
- 主会话在 write 阶段只显示这段四行摘要与子代理完成消息，不显示整章正文；正文从章节文档/面板读。
- writer 子代理落盘后，阶段会翻到 review；`story:stage` 与 `story:craft` 对「本会话已调用过 `story_write_chapter`」的 agent 改注入停止指令（`## 草稿已落盘` / `## Draft persisted`），不再注入章后审阅协议，避免子代理自己继续审稿。
- 主编不调用 `story_write_chapter` 传正文；主编核对 writer 摘要的标题、字数、草稿路径，并用 `glob` 确认草稿存在。
- 草稿写完后仍按原协议停；审稿、修订、结算不变。
- 范围：只改 write 阶段的 writer 交接方式与阶段协议。不改正文生成质量、审稿、修订、结算，不改 `story_write_chapter` 的落盘契约，不改面板正文阅读；源 `draft:delta` 的流式复刻另立工作项。
- 偏差登记：源没有子代理、正文进作品页；复刻改为「子代理落盘、主会话摘要」，结论在 `docs/dsh-mapping.md` 的「作者裁决偏差」，四段明细在 `artifacts/implementation-audit/dsh-deviations.md`，不计保真债。

## Design

`stages/index.ts` 的 write 协议第 4–5 步（zh/en 两支）改为：读章纲与上下文并派 writer；writer 调用 `story_write_chapter` 落盘并回传摘要；主编核对摘要的标题、字数、草稿路径，并用 `glob` 确认草稿存在，不读正文、不把正文复述到主会话。

阶段协议（zh/en）与主编的派发提示要求「writer 调 `story_write_chapter`、只回四行摘要」；`story_write_chapter` 的 `content` 入参和落盘契约不变。writer 子代理的共享契约（`writer.ts`）不加交接段，避免 composer 等其它子代理收到；工具可见性由真实会话证实（child session `2a7f9fae` 调用过 `story_write_chapter`），不再提供兜底入口。

阶段注入的硬停：`installStageContext` 只对**子代理会话**（`session.header.origin='subagent'` 或 `header.delegationDepth>0`）检查 `snapshotEvents`；出现 `tool/call` 名为 `story_write_chapter` 且当前阶段是 `review` 或 `chapter-done` 时，`story:stage` 返回停止指令、`story:craft` 返回空串；主编（根会话无这些标记）即使历史里调用过该工具也仍拿到审稿协议与 craft；普通审稿子代理没有这条调用，也仍拿到审稿协议。fork 的 `parentSession` 不作为判据，避免继承旧事件被误停。

## Alternatives considered

- **让主编自己写正文。** 否掉：会把整章正文变成主 agent 的流式回答，问题更大；源也是内部 writer 写。
- **子代理回传正文，但 UI 折叠。** 否掉：需要新的 UI 渲染通道，当前 subagent 的最终回答就是消息；且正文仍进会话历史。
- **保留现状，只提示作者「正文在面板」。** 否掉：正文已经显示，提示不能撤回。
- **复刻源 `draft:delta` 的写作流。** 否掉（本行）：那是另一个呈现能力；本行只解决「整章作为最终回答」。
- **主编把正文写进工具参数但子代理只回摘要。** 否掉：工具参数仍在主会话可见，正文还是会露出来。

## Consequences

- 行为由测试锁定：`test/stage-context.test.mjs` 断言 write 协议 zh/en 的四行摘要、`story_write_chapter` 落盘与「不复述正文」，并断言「已调用 `story_write_chapter` 的 agent 在 review 阶段收到停止指令、craft 为空；普通审稿子代理仍收到审稿协议」；`test/writer-contract.test.mjs` 保持六段、不加交接段（共享契约不变）。
- 代价：模型可能仍在摘要里夹带正文段落，验收以「主会话无整章正文」为准，必要时在协议/派发提示里限制摘要长度；源在写作中会流式显示 draft，本行让写作过程在主会话更安静，这是作者要求的呈现差异。
- 未决：是否在面板/对话复刻源 `draft:delta` 的流式写作显示，本行不做。
- 真实会话取证：本机没有 batch 会话使用的工作区，也不能在会话内重启宿主；「新会话写第 2 章、主会话无整章正文、writer 未审稿」的真实 DSH 会话回执未取得（BLOCKED）。当前证据是协议/测试与全量 verify，留到有真实会话时补。
