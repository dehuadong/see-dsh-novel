# Agent Note: chapter.settle 状态读取严格化（AU-26）

Status: implemented

## Problem

2026-11-14 审计把 `chapter.settle` 判为保真债，AU-26 含状态 strict、status 激活与已登记的重算目标/探针差异：

1. 四份状态 JSON 的读取比源宽（共享 `validateChapterSummaries` 也影响 `story-index` 与 `plan.retrieval` 的读取）：源 `StateManifestSchema`／`HooksStateSchema`／`ChapterSummariesStateSchema`／`CurrentStateStateSchema` 都是 `.strict()`，且对 `schemaVersion`、`language`、`projectionVersion`、章号、字符串非空、hook 状态枚举有精确约束；复刻的 `isManifest`／`isFact`／`isCurrentState`／`validateChapterSummaries` 只查少数字段，未知字段、非整数 chapter、空 title 都能读入。
2. work.status 激活条件不同：源只在 `outlining→active`（`runner.ts:2106-2115`）；复刻在 `settle-tool.ts:261`／`finalize.ts:85` 把 `draft→active`。复刻没有 `outlining` 状态。

本行只修 `chapter.settle` 的状态读取与 status 激活；`chapter.write`／`review`／`revise` 另立。

## 源工程证据

- `models/runtime-state.ts:5-85`：`StateManifestSchema`（schemaVersion literal 2、language zh/en、lastAppliedChapter int≥0、projectionVersion int≥1，strict）、`HookRecordSchema`（hookId/type 非空、start/last int≥0、status 五值、expectedPayoff/notes 字符串、dependsOn/paysOffInArc 可选，strict）、`ChapterSummaryRowSchema`（chapter int≥1、title 非空、七字符串，strict）、`CurrentStateFactSchema`（subject/predicate/object 非空、validFromChapter/sourceChapter int≥0、validUntilChapter int≥0|null，strict）、`CurrentStateStateSchema`（chapter int≥0，strict）。
- `state/state-validator.ts:14-120`：四份 schema 解析后做重复 hook/summary、current_state.chapter 不超前 manifest 的跨文件校验。
- `pipeline/runner.ts:2106-2115`：仅在 `book.status === 'outlining'` 时写 `active`。
- 复刻：`core/state.ts:130-181` 的窄校验；`settle-tool.ts:261`、`finalize.ts:85` 的 `draft→active`。

## Decision

### 范围与非目标

范围（`chapter.settle` 单行；`state.ts` 的共享读取器是消费面）：

1. 新增 `core/state-schema.ts`：按源四份 schema 的 strict 形状实现 `validateManifest`／`validateHooks`／`validateChapterSummaries`／`validateCurrentState`；未知字段、类型不符、非整数、空串、章号越界都拒绝。
2. `core/state.ts` 的 `isManifest`／`isFact`／`isCurrentState`／`isChapterSummaries` 改用上述校验；`inspectState` 的 missing/invalid 契约不变（不 throwing），`readStateSnapshot` 仍对缺失/非法抛错。
3. `validateChapterSummaries` 保留为公共入口，内部用新校验；`validateHooks` 的 strict 字段补齐。
4. work.status：新增 `core/work-status.ts` 的 `activateWorkStatus(work)`，settle 与 finalize 共用；只做 `draft→active`。在 `dsh-deviations.md` 登记：复刻 `draft` 对应源 `outlining`；源在 chapter-persistence 激活、复刻在 settle/finalize 激活；复刻 `archived` 无源对应；源其余状态（incubating/paused/completed/dropped）归 AU-06。
5. 登记两条已有差异：`inspectState` 对损坏/缺失返回 missing/invalid 而源读取抛错（DSH finalize/recovery/reopen/settle 的探针需要）；`resettle` 目标章用 max(index,lastApplied,snapshot) 而源只取索引最后章（DSH 扣下态/索引落后的修复需要，见 D34 扣下态偏差）。两条都写验证：inspectState 用例覆盖 finalize/recovery/reopen/settle 探针；resettle 用例覆盖扣下/快照领先。两条写 `dsh-deviations.md`，不改变行为；AU-26 关闭以“已登记且测试覆盖”为准。
6. 测试与 realRun：新增 `state-schema.test` 覆盖四份 strict 拒绝/接受；`chapter-settle` 未知字段/非整数 chapter/空 title 拒绝，chapter 0 基线可读；settle 后 work.status=active；finalize 同；重新录制 `chapter.settle.json`。

非目标：

- 不扩 `WORK_STATUSES`（6 值）——那是 AU-06 的 `work.json` 身份债，不在本行。
- 不改 `inspectState` 的 missing/invalid 返回语义；不把只读探针变成 throwing。
- 不改 `chapter.write`／`review`／`revise`；不做 D61/import。
- 不改跨文件不变量（已在 `describeStateInconsistencies`）。

### 产品行为与验收

- 四份状态 JSON 出现未知字段、非整数 chapter、空 title、非法 hook 状态时，结算/重算/状态核对拒绝，错误指向文件；字段级 issues 由 state-schema 返回；第 0 章基线（chapter=0）仍合法。
- settle 发布后 work.status 从 draft 变 active；finalize 同样；源 `outlining` 只在 mapping 中映射。
- 旧工作区若带未知字段，按源行为拒绝；契约测试覆盖。

### 决定与未决问题

- **strict 但不 throwing 的读探针**：`inspectState` 仍返回 missing/invalid，供 finalize/recovery/reopen/settle 使用；只有 `readStateSnapshot` 与结算前置拒绝。这样不改变现有调用方。
- **chapter 0 合法**：manifest/current_state/facts/hooks 的章号 min 0；只有 summary row min 1。审计里“int≥1”是错误理解，按源修正。
- **status 只映射不扩枚举**：本行只修 activation；源六状态与复刻三状态的差异留在 AU-06，不混入。
- 未决问题：无。

### 评审与批准证据

- Plan Review 三轴：Standards／Spec／Architecture 均通过（多轮）。
- 作者授权：AU-26 单行。
- 作者批准实施：`/implement 批准，执行实现 chapter.settle 审计修复（AU-26）`。

## Design

### core/state-schema.ts

- `isExactObject(value, keys)`：非数组对象，键集合完全相等；未知/缺失都 false。
- 四个校验器统一返回 `{ ok: true, value } | { ok: false, issues: Array<{ path, message }> }`，不抛错；`inspectState` 用 `.ok`，`readStateSnapshot` 把 issues 拼进错误。
- `validateManifest`：schemaVersion===2、language zh/en、lastAppliedChapter int≥0、projectionVersion int≥1。
- `validateHooks`：hooks 数组；每条严格 7 必填+2 可选；status 枚举；start/last int≥0；hookId/type 非空；dependsOn 每项非空；paysOffInArc 字符串可选。复用现有 `validateHooks` 的 id/状态规则与 `HOOK_FIELD_SET`，只补缺失的 strict 字段。
- `validateChapterSummaries`：rows 数组；每条恰好 8 键；chapter int≥1；title 非空；其余 string。
- `validateCurrentState`：chapter int≥0；facts 数组；每条恰好 6 键；subject/predicate/object 非空；`validFromChapter`／`sourceChapter` int≥0；`validUntilChapter` int≥0|null。
- `core/state.ts` 的 predicates 调用这些；`validateChapterSummaries` 导出保持。

### work-status.ts

- `activateWorkStatus(work): Work`：status==='draft' ? active : status；不更新 updatedAt（由调用方写 now）。
- settle/finalize 改用；`dsh-deviations.md` 加 status 映射与激活位置；`dsh-mapping.md` 只链到归档。

### 测试

- `state-schema.test.mjs`（新增）：四份合法样本读入；未知字段、非整数 chapter、空 title、非法 hook status 各自 invalid；chapter 0 合法。
- `chapter-settle.test.mjs`：坏状态文件拒绝且不写；chapter 0 基线结算第 1 章通过；发布后 work.status active。
- `finalize` 回归：恢复补齐后 status active。
- `resettle`/`state.check` 回归：strict 拒绝坏文件，正常通过。

### 同步

- `fidelity-audit.md`：`chapter.settle` 已是机制等价，清 AU-26 债号；不重写判定。
- `scope.md`：删 AU-26 行（保留 AU 编号不重排，标注关闭）。
- `dsh-deviations.md`：加 status 映射/激活位置与 inspectState/resettle 目标差异；`dsh-mapping.md` 只链到归档。
- chapter.summary.json`／`plan.retrieval.json` 的 limitations 中“读取比源松”改为“已随 AU-26 的共享 strict 修复；AU-19 其余项仍在”；fidelity 的 plan.retrieval 维持保真债 AU-19，不整行关闭。
- `capabilities.yaml`：不改状态；realRun 重录。
- Note 转 implemented；`verify-notes`。

## Alternatives considered

- **直接抛错的 inspectState**：更严格。否掉：finalize/recovery/reopen 依赖 missing/invalid 返回，会改调用契约。
- **扩大 WORK_STATUSES 到 6 值**：更贴源。否掉：属 AU-06 身份 schema，需要迁移 work.json 与 UI；本行只登记映射。
- **summary chapter 也允许 0**：看似统一。否掉：源 summary row min 1，必须拒。
- **只加测试不改校验**：省事。否掉：未知字段仍能读入，AU-26 不成立。

## Consequences

- **旧工作区 strict**：带未知字段的状态会被拒；与源一致。错误信息指向文件；字段级 issues 由 state-schema 返回；`story_recover` 只补缺失、不修 invalid，作者需按错误手工修复，不做静默迁移。
- **hook 规则重复**：现有 `validateHooks` 有 id/状态规则，新 strict 层不能放宽；已复用 `HOOK_FIELD_SET`。
- **status 映射不是完整枚举**：源六状态与复刻三状态的差异留在 AU-06，不因此宣称 status 完全等价。
- **共享读取器**：`state.ts` 被 reopen/resettle/state-check 使用，已跑全量回归。

## Verification

1. 四份状态 JSON 的 strict 校验与源字段/边界一致：manifest schemaVersion 2/language/lastApplied int≥0/projectionVersion int≥1；hooks 七必填+两可选、status 五值；summary chapter int≥1/title 非空/七字符串；current_state chapter int≥0/fact 六字段；未知字段拒绝。
2. `inspectState` 仍返回 missing/invalid，不抛；`readStateSnapshot` 与结算前置仍拒绝缺失/非法。
3. chapter 0 的当前状态与 `snapshots/0` 通过 strict；结算第 1 章可读状态，resettle/state-check 可读快照 0；summary chapter 0 拒绝。
4. settle 与 finalize 发布后 work.status 为 active；`dsh-deviations.md` 有 draft↔outlining、激活位置、archived 无源、六状态缺口，以及 inspectState/resettle 目标差异；mapping 只链接。
5. `chapter.settle` 的 AU-26 关闭（含 resettle 目标差异已登记）；fidelity 维持机制等价，清 AU-26 债号；scope 标记 AU-26 关闭。
6. 测试覆盖 strict 拒绝/接受、chapter 0、settle/finalize status；real-run 重录；`pnpm run verify` 通过；CI 由交付后 Verify 回填。

## 实施记录

- Plan Review 三轴：Standards／Spec／Architecture 均通过（多轮）。
- 实施：`state-schema.ts`、`state.ts` strict 谓词、`work-status.ts`、settle/finalize 共用；`state-schema.test` 与 chapter-settle 拒绝/chapter0 用例。
- 验证：`pnpm run verify` 511 passed／1 skipped；CI 待提交后回填。