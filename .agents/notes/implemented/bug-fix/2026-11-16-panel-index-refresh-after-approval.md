# Agent Note: panel.workbench —— 确认后立刻重建面板索引

Status: implemented

## Problem

2026-11-16 的真实会话 `session-607ecdcb-5e6d-44ff-8c29-3a75c09fe026`（工作区 `E:\novelist\test-novel\t001`）里，作者在面板点了「确认基础设定」、会话也跑完了，面板仍停在「基础设定已齐，等待作者确认」与「确认基础设定 / 开始下一章 / 退回 / 查看待确认 / 稍后」这一排按钮上。

磁盘上的证据是确定的：`source/story/runtime/foundation-approval.json` 写于 09:27:34（`state: approved`，摘要与当前基础设定一致），而 `source/story/runtime/panel.index.json` 的 `generatedAt` 与 mtime 都停在 09:18:47，`confirmation` 仍是 `foundation-signoff/pending`。会话日志里 `/story-approve` 在 09:27:34 成功（`作者确认 foundation：33 个文件…`），之后模型调了 `story_gate` 与 `story_foundation_signoff`；后者走「记录已有效」的早退分支，不再写盘。

用当前代码对同一工作区重建索引，结果是 `confirmation: none/done`、foundation `done`、根动作 `start-chapter`，即**作品文件与投影逻辑都没问题，缺的是那一次投影写入**。`withWorkAction` 的投影是尽力而为：`projectPanel` 把任何异常都吞掉，所以这次写入没有发生，也没有任何记录；而客户端只在索引内容变化时才重读，于是面板一直显示旧按钮。

## Decision

- **三类确认动作在作品动作的锁内重建索引。** `/story-approve`、`/story-reject`、`story_foundation_signoff` 写状态后，在同一次 `withWorkAction`（`project: false`，避免重复投影）里调用 `refreshPanel`。重建落在锁内，避免释放锁后被并发动作覆盖。
- **「记录已有效」的早退分支同样重建。** 真实会话走的正是这条：名字已经在 `/story-approve` 写过，签核只做确认。该分支此前返回 `panelWarning: ''` 却不重建，等于对旧索引报「已定稿」；现在它也重建并如实回报。
- **失败只告警，不回滚确认。** `refreshPanel` 返回空串表示已刷新，否则返回「面板索引没能刷新（原因）；重新打开作品页或运行 `/story-index` 可恢复显示」。命令回执附这一行；签核工具经输出字段 `panelWarning` 带到渲染文本里。确认记录不回滚——面板是显示面，不能因为刷新失败而否认作者已做出的确认。
- **重试只针对瞬时错误。** `core/panel-index.ts` 的 `rebuildPanelIndexWithRetry` 只对 `EBUSY`／`EPERM`／`EAGAIN`／`EMFILE`／`ENFILE` 重试（最多 3 次），路径类型错误直接失败，不做无意义重试。
- **通用投影保持原语义。** `core/work-mutation.ts` 的 `projectPanel` 仍是动作成功后一次尝试、失败静默：多数动作不需要为面板显示失败，静默失败的可观测性缺口记为 D64。需要「失败也要让作者看见」的动作自己调 `pipelines/long/panel-refresh.ts`。

## 源工程证据与偏差

- 源工程 Studio 由宿主进程直接提供作品状态，确认由宿主执行 pending action 并在同一会话继续（`inkos/packages/studio/src/api/server.ts:4931-5013`；`inkos/packages/core/src/agent/agent-session.ts:1220-1267`），不存在「状态写了、界面读另一份文件」的窗口。
- 复刻的界面读磁盘上的 `panel.index.json`，它是投影而不是状态（见 [`2026-11-10-panel-workbench-dialogue-first.md`](../architecture/2026-11-10-panel-workbench-dialogue-first.md)），所以「状态写了但投影没写」会直接表现为按钮不退。偏差结论在 `docs/dsh-mapping.md` 的「面板投影的写入归属」行，四段明细在 `artifacts/implementation-audit/dsh-deviations.md`。
- 与 [`2026-11-15-panel-draft-and-foundation-change.md`](./2026-11-15-panel-draft-and-foundation-change.md) 的关系：那篇决定「已结算 + 确认失效只在顶部提示、不回退阶段轨」；本篇保证这些判断真的会出现在面板上。

## Alternatives considered

- **客户端在动作成功后自动跑 `/story-index`。** 最强理由是它不需要改宿主、也不依赖锁：面板读到的就是刚重建的文件。否掉的原因是它让面板成为投影触发者，与「投影由宿主在写 action 里完成」的既有决定冲突，并多一条并发写路径；作者也不该为一次确认手动补一步。
- **给面板加「刷新」按钮。** 最强理由是把恢复权交给作者、实现最省。否掉：这与已登记的「面板无刷新索引按钮」决定冲突，而且作者点完确认还要再点一次刷新，等于把宿主的缺陷外化成作者的步骤。
- **把投影失败升级为动作失败。** 最强理由是失败必须可见，失败即失败最直白。否掉：确认已经落盘，回滚它等于否认作者的确认；正确做法是动作成功、失败可见、给恢复入口。
- **只让通用投影带重试，确认路径照旧。** 最强理由是不新增调用点。否掉：通用投影失败照样静默，作者看到的仍是旧按钮，且重试无法让失败可见。
- **继续静默吞掉投影异常。** 否掉：这正是本次问题能持续存在而没有任何线索的原因。

## Consequences

- 作者点确认、退回或签核后，磁盘索引与作品文件在同一次作品动作内落定；面板下一次读取就离开确认状态。
- 索引写入失败不再无声：命令回执或签核文本里会有一句说明并指向 `/story-index`。代价是确认命令的回执在失败时可能比原来多一行；`SIGNOFF_OUTPUT` 多了一个必填字段 `panelWarning`（成功为空串）。
- 瞬时写入错误会重试两次（间隔 50ms、100ms），最坏多等 150ms；路径类型错误不重试。
- 通用写动作的投影失败仍无声（D64），面板可能显示旧索引；`/story-index` 仍是修复入口。
- 真实会话里那条旧索引已用 `rebuildPanelIndex` 就地重建（`generatedAt` 09:18:47 → 09:39:45，`confirmation` 变为 `none/done`），面板刷新后即可看到「开始下一章」。
- 未复现的根因：那次投影写入为什么没发生，日志里没有痕迹（旧代码静默吞异常）；本记录只覆盖「不再依赖那条静默路径」，不宣称已解释根因。D64 承接可观测性与复现用例。

## Testing

- `test/approval.test.mjs`：`/story-approve` 前索引为 `foundation-signoff/pending`，成功后同一文件变为 `none/done`、根动作 `start-chapter`；`/story-reject` 后索引变为退回态（foundation `current`、`confirm-foundation` 动作、文案含「作者退回了这一版基础设定」）；`story_foundation_signoff` 在「记录已有效」的早退分支也把 pending 索引重建为 `none/done`；把索引路径占成目录（写必失败）时，确认命令与签核工具都成功、回执含「面板索引没能刷新」与 `/story-index`，确认记录仍然有效，签核的说明出现在渲染文本里。
- `test/panel-index.test.mjs`、`test/panel-projection.test.mjs`：`rebuildPanelIndex`／预热路径行为不变。
- `pnpm run verify`：见 `artifacts/real-runs/panel.confirm.json` 的当前计数。
