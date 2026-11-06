# Agent Note: runtime.fidelity-audit —— 逐行保真对照与债登记

Status: proposed

## Problem

现有 30 行 `verified` 的判定依据是「实现 + 测试 + 真机回执」，没有逐行做「源工程行为 → 复刻行为」的不变量对照。按 `AGENTS.md` 保真工作法，源工程行为是规格：每行必须先提取可验证的不变量，再判定「行为等价／机制等价／保真债」。已经暴露的例子：

- `chapter.write` 缺 writer 的 governed／length／person／protagonist／rules／style 契约；
- `chapter.review` 没有把编号原文注入，审稿上下文只有 memo；
- `plan.outline` 曾经指向错误的源模块（章节规划缓存），后来删除；
- `plan.context-select`、`plan.compression` 的指令是新写的，不是移植。

这些说明「测试通过」不等于「行为一致」。

## Proposal

### 审计产物

1. `docs/fidelity-audit.md`：每行一节，固定四栏——
   - 源工程证据：`inkos:` 文件与行为（字段、顺序、拒绝、错误码、落盘格式）；
   - 可验证不变量：从源行为提炼的断言（可写成测试或核对项）；
   - 复刻现状：实现文件、测试、真实回执；
   - 判定：`等价`／`机制等价`（附 `docs/dsh-mapping.md` 偏差行）／`保真债`（附偿还位置）。
2. `docs/dsh-mapping.md`：补登所有「机制等价」的偏差（源行为 → DSH 落点 → 原因 → 验证）。
3. `docs/scope.md`：把所有「保真债」列成后续行，写清欠什么、由哪一行还。

### 审计批次与顺序

- A：P0 提案与建书（`proposal.*`、`runtime.commands`、`foundation.architect` 前置）；
- B：P1 基础设定（`foundation.*`）、真值写与 ready；
- C：运行时（`runtime.commit-safety`、`runtime.stage-context`、`runtime.work-lock`／`txn-format` 债）；
- D：P2 规划（`plan.retrieval`、`plan.context-select`、`plan.compression`、`plan.chapter`）；
- E：P3 写作与审稿（`chapter.write`、`chapter.review`）。

每批完成即给作者一份「缺什么、在哪还」的清单；不积攒到最后。

### 审计方法

- 每行先读源工程证据（实现、类型、prompt、测试），列出 5–15 条不变量；
- 再读复刻实现与测试，逐条判定；找不到证据的写「源行为不可观测」并附检索范围；
- 不修改业务代码；发现的小修（注释、字段名）留给对应行；
- 每行结论必须能落到「测试断言／真实回执／偏差行／scope 债行」之一，不允许只写「已核对」。

### 边界

- 本行只做审计与登记，不改行为；补齐由后续行执行；
- 不改 `capabilities.yaml` 的 `status`（审计不是运行证据）；
- `docs/fidelity-audit.md` 是审计记录，不是第二套状态表；状态仍以账本与 CI 为准。

## Alternatives considered

**直接在每行补提示词，不做审计。** 快。否掉：没有不变量清单，补完仍无法判断是否等价，而且会继续漏。

**只审 P3 两行。** 省力。否掉：P0–P2 是地基，提示词与字段偏差会一路传下去。

**用对话结论代替文档。** 否掉：保真的记忆不靠对话；规则与对照必须落盘。

## Acceptance criteria

- `docs/fidelity-audit.md` 覆盖全部已 `verified` 的行（当前 30 行）与待验的 `chapter.review`；每行四栏齐全，判定只能是三种之一。
- 所有「机制等价」在 `docs/dsh-mapping.md` 有对应偏差行；所有「保真债」在 `docs/scope.md` 有偿还行。
- 每行的不变量至少有一条落到测试或真实回执；没有证据的条目标「源行为不可观测」并写检索范围。
- 审计发现的错误映射（例如源模块指向错误）当批修正 `capabilities.yaml` 的 `source:`。
- 产物：`docs/fidelity-audit.md`、更新后的 `docs/dsh-mapping.md` 与 `docs/scope.md`；本行不进账本（治理工作，不产生运行时行为）。

## Risks

- 审计工作量与仓库规模相当，可能横跨多轮；按批次交付，避免一次做不完。
- 源工程部分行为依赖其运行时（Provider、数据库、CLI），只能判「不可观测」并写清检索范围，不能当作等价。
- 审计结论会暴露大量债，短期会拖慢新能力；这是把「测试通过」换成「行为一致」的代价。
