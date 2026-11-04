# Agent Note: 能力账本与证据驱动的状态生成

Status: implemented

## Problem

交接单要求「状态只来自证据」，但项目里同时存在三种会被当成进度信号的东西：能力清单、交付盘点、验收标记。三者一旦并存，最先腐化的是状态——改代码的人忘记同步表格，读表格的人以为功能已存在。

需要一个只有两种状态、无法被人工升级、且与真实运行证据绑定的账本。

## Decision

`capabilities.yaml` 是唯一的能力账本，全量、只追加、不删除。状态只有 `missing` 与 `verified`。

每行八个字段：`id`、`title`、`reference`、`dsh`、`implementation`、`consumer`、`realRun`、`status`。`dsh` 记录 DSH 落点（`subagents`、`tools.register`、`storage` 等），`reference` 记录参考落点，`implementation` 与 `consumer` 是仓库内相对路径，`realRun` 指向 `artifacts/real-runs/<id>.json`。

`scripts/check-capabilities.mjs` 是唯一能让一行变成 `verified` 的入口：

- 人工只能写 `missing`；手写 `verified` 会被校验拒绝，并报出缺口。
- `verified` 需要三份证据同时成立：`implementation` 路径存在、`consumer` 路径存在、`realRun` 回执存在且含 `date`（`yyyy-mm-dd`）、`sessionId`、`tests.passed === true` 与非空 `receipts`。
- `--write` 依据证据重算状态：缺证据的 `verified` 被打回 `missing`，证据齐备的 `missing` 升为 `verified`，并把默认回执路径写进 `realRun`。
- 不带 `--write` 时，账本状态与证据推出的状态不一致即失败，因此 CI 能拦住手写升级。

CI 在每次 push / PR 跑 `npm run verify`，先校验 Note 树，再校验账本。能力从 `missing` 变成 `verified` 的提交必须同时带上实现、消费者测试与真实运行回执。

账本行序就是推进顺序：取第一行 `missing` 即为下一项工作。P0–P7 的阶段表归 [`docs/scope.md`](../../../../docs/scope.md)，账本不重复记录阶段，避免两处顺序各自腐化。

## 参考证据的边界

账本的 `reference` 字段记录参考落点，用于定位可对照的行为，属于计划工件。实现代码、注释、prompt 与正文不写来源说明：复用参考工程的文案、结构或数据形状时，按本项目口径命名与放置。两条规则分工明确——账本记录「对照什么」，代码不记录「抄自哪里」。

## Alternatives considered

**用 GitHub Issues 或 Projects 追踪能力状态。** 最接近团队习惯，状态流转与看板开箱可用。否掉的原因是状态会落在平台而非仓库：离线读不到、评审看不到 diff、无法在 CI 里机械校验，最终还是要人工同步回代码库。

**保留三态（`missing` / `in-progress` / `verified`）。** 中间态看起来更诚实，实际是给「做了一半」一个免于交付的落脚点，且 `in-progress` 与证据无关，只能靠人自述。两种状态的约束迫使每一步都交付到可验证为止。

**只用 `title` 与 `status` 的极简账本。** 更轻，但丢失了 DSH 落点与消费者指针，无法回答「这项能力落在哪个服务、由谁验证」，也就无法执行「一个 PR 一个纵向能力」。

**让校验脚本顺带跑测试并回填结果。** 省一次手工记录，但把测试执行、证据写入与状态生成耦合在一个脚本里，测试失败时状态含义变得含混。回执由工作项记录，脚本只认回执。

## Consequences

收益：状态只可能因为证据出现而变化；评审看账本 diff 就知道哪项能力被推进；参考落点与 DSH 落点并排，新的 Agent 不必重新考古。

代价：每条能力要维护真实运行回执，成本高于勾选表格；`artifacts/real-runs/` 需要随代码提交，不能依赖本地留档。`--write` 会重排 YAML 注释块以外的内容，手写格式不被保留。

首次校验接入时，账本 38 条全部 `missing`，校验输出 `verified 0`，属预期基线。
