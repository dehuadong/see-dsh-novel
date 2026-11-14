# Agent Note: 实现审计 —— 45 条 verified 与 plan-review-11 的 10 行

Status: implemented

## Problem

[`plan-review-11-designs-2026-11-11.md`](../../../../artifacts/plan-review-11-designs-2026-11-11.md) 是一次追溯设计评审：10 份设计全部“需修订”，5 份含 blocker，并列出 `source` 指错模块、虚假等价、未登记自创限制、过期/虚假证据、源行号错误、债务错位等横切问题。它明确不是状态表，也没有关闭能力。

之后继续交付了 D33–D60，但没有做实现后的行为审计。`check-capabilities` 只验证 implementation/consumer/realRun 字段；`verify-audit-coverage` 只验证 v1 行有审计段；两者都不验证行为等价。D61 的失败（把 `materials.import` 当触发点、扩成 `chapter.import` 全管线）说明 `verified` 不能当作保真证明。

本工作项做**只读审计**：逐行核对 45 条 `verified` 的源证据、实现、测试、realRun、偏差与债；对 plan-review-11 的 42 条 finding 逐条给现状。审计**不改产品代码**、**不改账本状态**；裁决写回 `docs/fidelity-audit.md` 的现有判定，债写回 `docs/scope.md`。审计工件只做证据索引，不做第二张状态表。

## 源工程证据

- 审计源：`inkos/` 各能力模块，逐行引用；冻结源版本 `inkos` 当前 checkout 的 `git rev-parse HEAD`。
- 方法参照：`AGENTS.md` 保真原则/工作法/铁律、`artifacts/plan-review-11-designs-2026-11-11.md` 的三轴与 42 条 finding。
- 被审证据：`capabilities.yaml` 45 条 verified、`docs/fidelity-audit.md`、`artifacts/real-runs/<id>.json`、`test/*.test.mjs`、`docs/dsh-mapping.md`。

## Decision

### 范围与非目标

范围：

1. **冻结 45 条 verified**：从当前 `capabilities.yaml` 生成 `artifacts/implementation-audit/verified-2026-11-14.txt`（id 一行一条，含审计前状态）；矩阵计数以该文件为准，审计中账本变化不改此清单。
2. **A 批 11 行**：plan-review-11 对应的 9 个账本行（`panel.workbench`、`chapter.revise`、`skill.references`、`chapter.summary`、`chapter.settle`、`chapter.reopen`、`chapter.move-delete`、`state.check`、`export.work`；`chapter.finalize` 已并入 `chapter.settle`，不另立行）+ 最近交付的 `chapter.write`、`chapter.review` = 11。B 批为其余 34 行。
3. **每行审计**：源行为（file:line）、复刻落点、tests、realRun 等级、偏差/债、裁决、证据限制。45 行全覆盖。
4. **42 条 finding 复核**：`artifacts/implementation-audit/plan-review-11-findings.md` 逐条列 `finding id / 原文摘要 / 现状 / 处置（已修/仍债/原 finding 有误/无法核实）`；不重写旧 Note。
5. **裁决写回属主**：等价/机制等价/保真债写回 `docs/fidelity-audit.md` 对应行；债号写回 `docs/scope.md`；偏差行写回 `docs/dsh-mapping.md`；账本状态**不动**（审计只读；`verified` 继续表示“三份证据存在”，不表示行为等价）。
6. **横切对账**：`source` 指向、realRun 是否描述旧行为、mapping 行、scope 债号与 audit 段一致性。

非目标：

- 不修复行为、不改产品代码、不新增工具、不跑真实模型会话。
- 不改 `capabilities.yaml` 的 45 条状态；审计不降级、不升级。
- 不建第二张状态表；审计工件只做证据索引与限制，判定以 `docs/fidelity-audit.md` 为准。
- 不重写已实现 Note；旧 Note 的错误另记“Note 债”在 finding 表，不夹带改写。

### 产品行为与验收

审计不改产品行为；交付物是 45 行证据矩阵、42 条 finding 现状、写回 audit/scope/mapping 的裁决与债。

### 决定与未决问题

- **账本状态语义**：`verified` 只由三份证据字段推出，不能承载“保真已证明”。审计因此不降级；虚假等价以 audit 判定 + scope 债表达，避免 `check-capabilities` 在缺字段/回写之间振荡。
- **证据冻结**：45 条 id 与 `inkos`/仓库 commit 冻结；行号只作线索，行为以源码为准，每行记录 file:line 与测试命令。
- **realRun 分级**：`S` 需真实 DSH 会话证据（session id 非 `process:*` 且回执自述/日期/已知会话可对）；receipt seq 是可选锚点，不强制；`P` 为 process-level（回执自述或仅 `process:*`）；无会话证据标 `N`。P/N 不能单独支撑等价，必须配代码/测试；S 不足时记为证据限制。
- **42 条 finding 是独立清单**：plan-review 的 10 份设计不等于 10 个账本行；`chapter.finalize` 无账本行，归 `chapter.settle`。
- 未决问题：无。

### 评审与批准证据

- Plan Review 三轴：Standards／Spec／Architecture 均通过（多轮，最后一轮确认）。
- 关键收敛：不改账本状态；判定归 `fidelity-audit`；45 id 冻结；A=11/B=34；42 finding 用 `<设计>#F<n>`；S/P/N 分级；source 非 `inkos:` 记债。
- 作者裁决：先审计，不改行为。
- 批准实施：未给；执行授权：未给。

## Design

### 冻结与分批

- 生成 `verified-2026-11-14.txt`：45 个 id，来自审计开始时 YAML；记录 45 个 id；两个 HEAD 记在审计工件与 Note。
- A 批 11 行如上；B 批 34 行按账本行序，每批 6–8 行；C 批横切。
- 每行一个只读审计子代理（不给旧判定，先看源后看复刻），固定输出 schema；主代理复核并写矩阵。
- 批内退出：该批每行有裁决与证据；C 批依赖 A/B 完成，最后跑一致性检查。

### 证据矩阵（`artifacts/implementation-audit/2026-11-14.md`）

矩阵列：`id | realRun | tests | 债 | 证据链接`；判定表在 `docs/fidelity-audit.md` 的审计段，矩阵不写判定。

判定仍只有 `docs/fidelity-audit.md` 的三种：等价、机制等价、保真债；矩阵不新增第四种。

- 等价：源行为逐项对上；
- 机制等价：DSH 机制强制或源不可观测，必须有 `dsh-mapping.md` 偏差行与验证；
- 保真债：差异是行为/结构/限制，scope 写债号、owner、关闭判据；假等价不写 mapping（偏差只允许 DSH 强制/不可观测）。

`runtime.package-check` 的 source 是 `dsh-webnovel-writer:`，不在 `inkos/`，C 批按“source 证据错位”审计并记债，不得按普通 `inkos:` 行放行；`runtime.boundary-check` 的 `source: none:项目护栏` 按 `fidelity-audit.md` 现有判定复核，不另设“无源行为”类。

### 42 条 finding 表

从 plan-review-11 抽取 42 个 finding，编号用 `<设计>#F<n>`（F 号在每份设计内重起），逐条给：原文、现状证据、处置、Owner。处置只有 `已修`、`仍债（新/旧债号）`、`原 finding 有误（证据）`、`无法核实（限制）`、`Note 债（旧 Note 错误，另记债号）`。已修必须有实现/测试/file:line 证据。

### 横切对账（C 批）

- `source` 是否为 `inkos:` 真实位置；`none:` 只允许项目护栏行；`dsh-webnovel-writer:` 等其它前缀按 source 债登记。
- realRun 是否还在描述旧行为（日期/回执与当前代码不符）。
- `dsh-mapping` 行是否覆盖机制等价；债行是否只在 DSH 强制/不可观测时出现。
- scope 债号与 audit 判定一一对应；P4/P5 出口按审计结论重述。

### 同步清单

1. `artifacts/implementation-audit/verified-2026-11-14.txt`、`2026-11-14.md`、`plan-review-11-findings.md`（证据/限制，不是状态表）。
2. `docs/fidelity-audit.md`：逐行判定与证据链接。
3. `docs/scope.md`：债号、owner、关闭判据；出口重述。
4. `docs/dsh-mapping.md`：仅机制等价行。
5. 本 Note 转 implemented，链审计工件。
6. 照六处跑 `pnpm run check-capabilities -- --write`（应无操作），断言仍 45/14；再跑 `pnpm run verify`、`verify-audit-coverage`、`verify-notes`、CI 双端。

### 验证切入点

- `verified-2026-11-14.txt` 行数=45，与审计开始时的 YAML 一致；矩阵 id 集合与它完全相等。
- A=11、B=34 的并集=45，无重复无遗漏。
- 42 条 finding 每条有处置；`已修` 有 file:line 或测试名；`仍债` 有 scope 债号。
- 每个“机制等价”有 mapping 行；“保真债”无 mapping、有债号；“等价”有逐项源对照；不可观测归入保真债或机制等价并写限制。
- 账本 45 条状态未变；`check-capabilities` 仍 45 verified / 14 missing。
- `pnpm run verify` 全绿；CI 双端。

## Alternatives considered

- **改账本状态降级**：更直观。否掉：`check-capabilities` 由三字段反推 verified，只改 status 会失败，`--write` 会翻回；清空字段会丢证据且需额外授权。
- **用审计工件做状态表**：方便。否掉：违反“一个事实一个家”/铁律 2；判定归 `fidelity-audit`。
- **只审 10 行**：更小。否掉：用户要求 45 条；未点名的行也可能虚假等价。
- **只跑测试/CI**：最快。否掉：测试通过不等于源等价。
- **审计中顺手修行为**：省事。否掉：只读审计，修复另立工作项。

## Consequences

- 45 行中 26 行为保真债、13 行机制等价、6 行等价；34 行有未关闭差异，已写 `docs/scope.md` 的 AU-01–AU-35。
- `verified` 不代表保真；审计只读，未改账本状态，P4/P5 出口不能再按旧 `verified` 直接放行。
- 42 条 plan-review finding：37 已修、4 仍债、1 Note 债、0 有误/无法核实；6 处“未能核实”中 3 已消解、3 仍无法核实。
- 真实会话不足：S 27、P 18；S 行也只在少数行留有可复核会话头，不能替代逐行源对照。

## Verification

1. 冻结文件含 45 个审计前 verified id；矩阵 id 集合与冻结文件完全一致，A=11、B=34 无重复遗漏。
2. 每行含源 file:line、复刻 file:line、tests、realRun 等级（S/P/N）、偏差/债、证据链接、证据限制。
3. 42 条 plan-review finding（`<设计>#F<n>`）全部有“原文→现状→处置→owner”，与原文 42 行集合相等。
4. 判定与 `docs/fidelity-audit.md` 三类一致；审计矩阵只做证据索引，判定属主为 audit。
5. `capabilities.yaml` 的 45 条状态未变；`check-capabilities` 仍 45/14。
6. 审计工件与 rows JSON 已入仓；`pnpm run verify`、`verify-audit-coverage`、`verify-notes` 通过。
7. 真实会话证据不足的行已标 P/N 与限制，未以测试通过代替等价。

## 实施记录

- 冻结清单：[`verified-2026-11-14.txt`](../../../../artifacts/implementation-audit/verified-2026-11-14.txt)；矩阵：[`2026-11-14.md`](../../../../artifacts/implementation-audit/2026-11-14.md)；逐行证据：`artifacts/implementation-audit/rows/<id>.json`。
- plan-review finding 复核：[`plan-review-11-findings.md`](../../../../artifacts/implementation-audit/plan-review-11-findings.md)。
- `pnpm run verify`：505 passed／1 skipped；CI `43569305960` 双端通过（提交 `e287531`）；`check-capabilities` 45 verified/14 missing；`verify-audit-coverage` 49 行有审计段。
- 审计未改动产品代码与账本状态；发现的行为差异以 AU 债记录，修复另立工作项。
