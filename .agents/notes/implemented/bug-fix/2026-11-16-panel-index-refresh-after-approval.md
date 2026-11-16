# Agent Note: panel.workbench —— 确认后立刻重建面板索引

Status: implemented

## Problem

2026-11-16 的真实会话 `session-607ecdcb-5e6d-44ff-8c29-3a75c09fe026`（工作区 `E:\novelist\test-novel\t001`）里，作者在面板点了「确认基础设定」、会话也跑完了，面板仍停在「基础设定已齐，等待作者确认」与「确认基础设定 / 开始下一章 / 退回 / 查看待确认 / 稍后」这一排按钮上。

磁盘上的证据是确定的：`source/story/runtime/foundation-approval.json` 写于 09:27:34（`state: approved`，摘要与当前基础设定一致），而 `source/story/runtime/panel.index.json` 的 `generatedAt` 与 mtime 都停在 09:18:47，`confirmation` 仍是 `foundation-signoff/pending`。会话日志里 `/story-approve` 在 09:27:34 成功（`作者确认 foundation：33 个文件…`），之后模型调了 `story_gate` 与 `story_foundation_signoff`；后者走「记录已有效」的早退分支，不再写盘。

用当前代码对同一工作区重建索引，结果是 `confirmation: none/done`、foundation `done`、根动作 `start-chapter`，即**作品文件与投影逻辑都没问题，缺的是那一次投影写入**。`withWorkAction` 的投影是尽力而为：`projectPanel` 把任何异常都吞掉，所以这次写入没有发生，也没有任何记录；而客户端只在索引内容变化时才重读，于是面板一直显示旧按钮。

## Decision

- **确认类命令自己重建索引并报告失败。** `/story-approve` 与 `/story-reject` 以 `{ project: false }` 调用 `withWorkAction`（避免同一次动作写两遍索引），动作成功后调 `refreshPanelIndex(root)`：内部最多重试 3 次，仍失败时把一句「面板索引没能刷新（原因）；重新打开作品页或运行 `/story-index` 可恢复显示」附在命令回执末尾。确认本身不回滚——面板是显示面，不能因为刷新失败而否认作者已经做出的确认。
- **`story_foundation_signoff` 同样处理。** 它写记录后也调 `refreshPanelIndex`，失败说明经输出字段 `panelWarning` 出现在工具回执里；`SIGNOFF_OUTPUT` 增加可选的 `panelWarning`。
- **通用投影也重试用尽。** `core/work-mutation.ts` 的 `projectPanel` 改为最多 3 次尝试（每次间隔 50ms、100ms），仍失败保持旧索引并由下一次动作或 `/story-index` 修复；它继续不改变动作结果，因为多数动作不需要为面板显示失败。
- **`rebuildPanelIndex` 是唯一的重建入口。** `core/panel-index.ts` 导出 `rebuildPanelIndex`（构建 + 写入，失败抛出）与 `refreshPanelIndex`（重试 + 返回说明）；`plugin/panel-projection.ts` 的预热与 `/story-index` 走同一条路径。
- 范围：只改「确认状态变化后索引如何落到磁盘」。不改索引内容与阶段投影口径，不改确认闸门与回执格式，不改 `/story-write` 校验。

## 源工程证据与偏差

- 源工程 Studio 的确认由宿主执行 pending action，并在同一会话里继续（`inkos/packages/studio/src/api/server.ts:4931-5013`；`agent-session.ts:1220-1267`）；面板与状态读的是同一份宿主状态，不存在「确认写了一个地方、界面读另一个地方」的窗口。
- 复刻的界面读的是磁盘上的 `panel.index.json`，它是投影而不是状态（见 [`2026-11-10-panel-workbench-dialogue-first.md`](../architecture/2026-11-10-panel-workbench-dialogue-first.md)），所以「状态写了但投影没写」会直接表现为按钮不退。这次修复让确认类动作把「状态 + 投影」当成一次动作的两半，属于投影机制内的修正，不新增产品限制，也不改变与源的等价判定。
- 与 [`2026-11-15-panel-draft-and-foundation-change.md`](./2026-11-15-panel-draft-and-foundation-change.md) 的关系：那篇决定「已结算 + 确认失效只在顶部提示、不回退阶段轨」；本篇保证这些判断真的会出现在面板上，两者合起来才是作者看到的最终行为。

## Alternatives considered

- **只让客户端轮询索引。** 否掉：磁盘上的索引本身就是旧的，轮询只会反复读到同一份旧内容；根因在写入侧。
- **客户端在动作成功后自动跑 `/story-index`。** 否掉：那会让面板成为投影触发者，与「投影由宿主在写 action 里完成」的既有决定冲突，并多一条并发写路径。
- **给面板加「刷新」按钮。** 否掉：作者不该为一次确认手动补一步；而且这与已登记的「面板无刷新索引按钮」冲突。
- **把投影失败升级为动作失败。** 否掉：确认已经落盘，回滚它等于否认作者的确认；正确做法是动作成功、失败可见、给恢复入口。
- **继续静默吞掉投影异常。** 否掉：这正是本次问题能持续存在而没有任何线索的原因。

## Consequences

- `/story-approve`、`/story-reject`、`story_foundation_signoff` 成功后，磁盘索引与作品文件在同一动作内一致；面板下一次读取就离开确认状态。
- 索引写入失败不再无声：命令回执或工具回执里会有一句说明并指向 `/story-index`，作者不用猜。代价是命令回执可能比原来多一行。
- 通用动作的投影多了重试，最坏情况为两次 50/100ms 等待；动作结果不受影响。
- 同一动作不再重复投影（确认命令传 `project: false`），索引写入次数从「动作 + 可能的重建」降为一次。
- 兜底：真实会话里那条已失效的旧索引已用 `rebuildPanelIndex` 就地重建（`generatedAt` 09:18:47 → 09:39:45，`confirmation` 变为 `none/done`），面板刷新后即可看到「开始下一章」。

## Testing

- `test/approval.test.mjs`：`/story-approve` 前索引为 `foundation-signoff/pending`，命令成功后同一文件变为 `none/done`、根动作 `start-chapter`、foundation `done`；把索引路径占成目录（写必失败）时命令仍成功、回执含「面板索引没能刷新」与 `/story-index`，且确认记录仍然有效；`story_foundation_signoff` 的回执含 `panelWarning`（成功为空串）。
- `test/panel-index.test.mjs`、`test/panel-projection.test.mjs`：`rebuildPanelIndex` / 预热路径行为不变。
- `pnpm run verify`：579 tests／578 pass／1 skip。
