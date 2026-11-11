# Agent Note: state.check —— 只读语义对账

Status: implemented

## Problem

P5 的最后一行 `state.check` 曾是 `missing`。作者与主编都无法在结算后核对“投影是否忠实于本章”：`current_state`／`pending_hooks` 与上一章快照、章纲、权威文档之间是否存在矛盾、漏写或时间线错位，目前只能靠人读文件。

源工程的 `StateValidatorAgent` 是一个模型侧校验器：把上一份与新的状态／伏笔卡片、本章正文、权威上下文交给模型，模型提交 `reconciliationRequired` 布尔值与证据报告；布尔值与报告构成 findings，用于决定是否重结算。DSH 宿主工具不能直接跑模型，对账由子代理产出、宿主只做结果校验与回执；这不构成自动校验的机制障碍，自动路径仍记 D34。

## 源工程证据

- `inkos/packages/core/src/agents/state-validator.ts:23-95`：`validate(chapterContent, chapterNumber, oldState, newState, oldHooks, newHooks, language, authorityContext)`；旧新一致时直接返回 `consistent`；否则模型提交 `state-validation-tool` 的布尔值与 Markdown 报告；`reconciliationRequired && !report.trim()` 返回 `STATE_RECONCILIATION_REASON_REQUIRED`；报告非空时产出一条观察，code 为 `state-reconciliation` 或 `state-projection-review`。
- `inkos/packages/core/src/agents/state-validation-tool.ts`：`reconciliationRequired` 布尔与 `reportMarkdown` 的参数 schema。
- `inkos/packages/core/src/agents/state-validator.ts:47`：布尔判据——只有换一份 truth projection 能消解不一致时才置 `true`；章节内部或权威文档之间的矛盾只作观察，不授权再次结算。
- `inkos/packages/core/src/pipeline/chapter-truth-validation.ts:39-104`：校验发生在结算之后；`!consistent || reconciliationRequired` 时进入 `reconcileChapterStateAfterReview`，带 `validationFeedback` 重结算。
- `inkos/packages/core/src/pipeline/chapter-state-recovery.ts`：重结算路径消费这批 findings。

## Decision

### 工具：`story_state_check`

`src/pipelines/long/state-check-tool.ts`：

- 参数：`chapter`、`reconciliationRequired`（布尔）、`reportMarkdown`（Markdown 证据报告）。
- 前置：本章有正文；本章已结算（`manifest.lastAppliedChapter >= chapter`）；上一章快照（`source/story/snapshots/<chapter-1>/state/manifest.json`）存在。
- 校验：
  - `reconciliationRequired === true` 且 `reportMarkdown.trim() === ''` → 拒绝，错误带 `STATE_RECONCILIATION_REASON_REQUIRED`（与源一致）；
  - 其余情况：不写任何文件，返回 `{ chapter, consistent: !reconciliationRequired, reconciliationRequired, observations }`；
  - 观察只有一条：报告非空时 code 为 `state-reconciliation`／`state-projection-review`，summary 为报告正文（源同）。
- 证据装载由主编/子代理完成：调用方先读本章正文、当前状态与投影、上一章快照、`story_frame`／`book_rules`／`chapter_summaries`，把结论按布尔 + 报告提交；工具本身只校验与回执。

### 阶段与面板

- `chapter-done` 协议：作者要求核对状态时，派 state-check 子代理读证据并提交 `reconciliationRequired` 与报告，再调 `story_state_check`；findings 只回作者，不自动重结算。
- 面板不加动作：对账走对话。

### 范围与非目标

- 只读：不写状态、不写观察文件、不触发重结算。
- 不把对账接进 `chapter.settle` 的自动流程；那是 D34 的偿还（在 `chapter.settle` 增加校验步骤与 reconciliation 重试），本行只交付“可随时核对的只读入口”。
- 源 `validate` 的布尔判据（仅换投影可消解才置 `true`）未写入阶段协议，`state-reconciliation`／`state-projection-review` 的选码因此缺依据，记 D51。
- 不做静态 schema 校验（损坏由 `inspectState`／各写入工具拒绝，已有机制），本行只做语义对账结果。

### 偏差与债务

- 无新的机制偏差：对账的模型部分由 DSH 子代理产出，宿主只校验结果。
- D34 保持：`chapter.settle` 的写入没有接状态校验与 reconciliation；本行不改变结算路径，D34 的偿还位置是 `chapter.settle`。
- D51：源布尔判据未进协议；账本 `source:` 已改指 `agents/state-validator.ts`。

## Alternatives considered

- **宿主静态检查状态 schema 与快照一致性** — 不需要模型。否掉：源对账是语义判断（事实是否被正文支持、伏笔是否一致），静态检查替代不了；D34 的判定已写明不能由静态校验替代。
- **让 `story_state_check` 自己调子代理跑模型** — 一次调用完成。否掉：DSH 工具不能派子代理；模型输出必须由主编派发。
- **把 findings 写进审稿记录或状态文件** — 可追溯。否掉：源只把观察用于当次对账与重结算决策，不落盘；写进审稿记录会污染 review 的语义。
- **对账后自动重结算** — 更接近源。否掉：重结算需要 settler 模型产出 delta，超出本行；D34 单独偿还。
- **不做工具，只写进协议让主编自己判断** — 最小。否掉：插件没有可验证的入口，findings 的必填报告与错误码无法保证。

## Testing

- `test/state-check.test.mjs`：报告必填错误码、`state-projection-review`／`state-reconciliation` 两种 code、`consistent` 与布尔相反、只读（调用前后文件集合与状态内容不变）、未结算与缺快照拒绝。
- `test/host.test.mjs`：工具清单包含 `story_state_check`。
- `test/stage-context.test.mjs`：现有文件没有「`chapter-done` 协议含 `story_state_check`」的断言（D51 同批补）。
- `pnpm run verify` 全绿；回执记录一次对账。

## Consequences

- 对账质量取决于子代理；宿主只保证布尔与报告的必填关系，与源一致。
- 上一章快照在旧作品里可能缺失（`snapshots/0/` 是 foundation 新写的）；缺快照时拒绝而不是伪造基线。
- 只读入口不会自动修复问题；作者看到 findings 后仍要回到重开/修订/重结算流程。
- 自动校验与带反馈重结算仍未接（D34）；本行不改变结算工具的行为。
