# Agent Note: foundation.ready-check —— 就绪判据复核与阶段探针统一

Status: implemented

## Problem

审计曾记录 D7：认为 `workProbes` 用 current_state／chapter_summaries 代替 `book_rules.json`，与源 `isBookFoundationComplete` 不一致，导致「缺规则数据的作品被判就绪」。

实施时逐项复核发现：**D7 的前提不成立**。`workProbes` 实际是七项——`work.json`（对应 `book.json`）、`story_frame.md`、`volume_map.md`、`book_rules.md`、`book_rules.json`、`pending_hooks.md`、至少一张角色卡——与源完全一致；`current_state.md`／`chapter_summaries.md` 本来就不参与就绪判据。

真正的不一致在阶段探针：`stages` 的同步判定用 `current_state.md`／`chapter_summaries.md` 顶替 `book_rules.json`，会出现「`story_next` 说 ready、阶段上下文却停在 foundation」的分叉。

## Decision

- 撤回 D7 与 `docs/scope.md` 中的对应债项；
- `stages/index.ts` 的 `FOUNDATION_FILES` 改成与 `workProbes` 相同的一组：frame、volume_map、book_rules.md、book_rules.json、pending_hooks；状态与摘要文件仍由基础设定写入，但不再作为阶段门槛；
- `story_next` 的判定保持不变：大纲缺 → foundation；规则/伏笔缺 → draft（下一步 `story_foundation_details`）；只剩角色卡 → draft（下一步 `story_foundation_cast_index`）；全齐 → ready；
- `story_next` 回执补充「下一步：…」，让阶段与动作同时可见。

## Alternatives considered

**按原审计把 `workProbes` 改成六项文件集。** 否掉：复核证明它本来是对的，改反而会与源不一致。

**保留阶段探针的状态/摘要门槛。** 否掉：这会让同一工作区出现两个互相矛盾的阶段判断。

**让 `story_next` 和阶段探针共用一个异步函数。** 更彻底。否掉：`systemPrompt.context` 的文本提供函数是同步的；两处各自同步读同一组文件，用测试锁一致。

## Consequences

收益：`story_next` 与阶段上下文使用同一组就绪文件，不再分叉；回执同时给出阶段与下一步。

验证见 `test/ready-check.test.mjs`（七项与边界）与 `test/stage-context.test.mjs`（foundation 夹具含 `book_rules.json`）；真实运行证明齐全时 `ready`、移除 `book_rules.json` 时 `draft`（下一步 `story_foundation_details`）。

代价与已知限制：

- 状态/摘要文件缺失不再阻塞就绪，若规划阶段需要它们，由对应工具自行报错；
- 两处判据是两份同步读盘代码，靠测试而不是类型保证一致。
