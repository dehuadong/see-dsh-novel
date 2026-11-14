# Agent Note: 对账布尔判据写进工具与协议

Status: implemented

## Problem

`state.check` 的工具与阶段协议曾只要求提交 `reconciliationRequired` 布尔和报告，没有写清源工程的判据：

- 源 `agents/state-validator.ts:38-47` 的提示：`reconciliationRequired=true` 只在「换一份 truth projection 能消解不一致」时成立；章节内部或权威文档之间的矛盾只作观察，不授权再次结算。
- 源 `:82-92` 由布尔与报告生成 observation（`state-reconciliation` / `state-projection-review`）并返回；是否重结算由 `pipeline/chapter-truth-validation.ts:80-103` 判断，`validationFeedback` 在 `pipeline/chapter-state-recovery.ts:58-73`（`:69`）构造后传入重结算。

复刻只在 Note 里描述过工具行为，工具参数说明和 `chapter-done` 协议都缺这条判据，子代理可能把「正文与权威矛盾」误报成需要重算。追溯评审记为 D51。D34（结算不自动校验）当时保留，后来由 [D34：结算前的状态对账与 reconciliation](2026-11-14-chapter-settle-validation.md) 交付。

## Decision

### 范围与非目标

- 范围：把判据写进 `story_state_check` 的参数说明、工具描述与 `chapter-done` 阶段协议；补 schema 与阶段文本断言；同步已实现 Note 的判据段与 D51 链接。
- 非目标：不改工具写盘行为（仍只读）；不接自动校验/重结算（D34；已由 [D34：结算前的状态对账与 reconciliation](2026-11-14-chapter-settle-validation.md) 交付，本行不改它）；不检查模型判断是否正确（宿主只校验布尔与报告）。
- 不改报告必填错误码与 observation code 选择逻辑。

### 交付行为

- 工具 `description` 与 `reconciliationRequired` 参数说明写明：只有「换一份 truth projection 能消解」才为 true；正文/权威矛盾只作观察，不授权再次结算。
- `chapter-done` 第 8 步写明同一判据，子代理按它选择布尔。
- 工具仍是只读：不写状态、不写观察文件、不触发重结算。

### 决定与未决问题

- 判据是模型侧判断，宿主无法验证；本行只把源判据写进模型可见的说明与协议，不新增校验。
- 未决问题：无。

### 评审与批准证据

- Plan Review 第 1 轮：需修订（`validationFeedback` 的源证据归错文件；AC1 缺 schema 断言；未列已实现 Note 的判据段与链接同步）；已修正。
- Plan Review 第 2 轮：通过，无未解决 blocker/major。
- Implementation Review（Standards / Spec）：首轮各报 1／3 条；补 description 的「不授权」断言、参数说明改中文后复核通过。
- 批准与执行授权：2026-11-13，作者批准 `implement state.check`。

## Design

### 文本落点

- `src/pipelines/long/state-check-tool.ts`：`description`（英文，与工具面向模型的说明一致）与 `reconciliationRequired` 参数说明（中文，与同 schema 的其它参数一致）加入判据；`execute` 不变。
- `src/pipelines/long/stages/index.ts` 的 `chapter-done` 第 8 步：补「只有换一份真值投影（truth projection）能消解时才把 `reconciliationRequired` 置 true；正文/权威矛盾只作观察，不授权重结算」。
- `test/state-check.test.mjs` 断言工具 description 与参数说明；`test/stage-context.test.mjs` 断言阶段文本。
- 已实现 Note `2026-11-10-state-check.md`：D51 段改为已注销并链接本篇，不再重复判据正文。

### 兼容与失败行为

- 只是说明文字，行为与错误码不变。
- 误报仍可能发生；D34 的自动校验/重结算由 [D34：结算前的状态对账与 reconciliation](2026-11-14-chapter-settle-validation.md) 接上。

## Alternatives considered

- **让宿主校验布尔是否正确** — 更严格。否掉：这需要重新理解正文与权威，等于在宿主跑模型；源也是模型判断。
- **在工具里拒绝 `state-reconciliation` 观察** — 看似避免误报。否掉：源允许该 code，只是要求判据；拒绝会改行为。
- **只改 Note 不改工具/协议** — 改动最小。否掉：模型看不到 Note，判据必须出现在工具说明与阶段协议才生效。

## Testing

- `test/state-check.test.mjs`（6 例）：报告必填错误码；无重算观察；干净对账；只读不写；未结算/缺快照拒绝；工具 description 与参数说明含判据（含「只作观察／不授权再次结算」）。
- `test/stage-context.test.mjs`：`chapter-done` 文本含 `truth projection` 与「只作观察」。
- `pnpm run verify` 全绿：425 tests；`artifacts/real-runs/state.check.json` 已按新行为重录。
- D51 已从 `docs/scope.md` 注销，审计判定同步；D34 已由 [D34：结算前的状态对账与 reconciliation](2026-11-14-chapter-settle-validation.md) 交付。

## Consequences

- 说明文字不能保证模型判断正确；误报仍可能发生，D34 的自动校验/重结算已由 [D34：结算前的状态对账与 reconciliation](2026-11-14-chapter-settle-validation.md) 接上。
- 协议文本变长，但不增加工具调用步骤。
- 参数说明用中文、工具 description 用英文；同一 schema 内仍保持原有语言分工。
