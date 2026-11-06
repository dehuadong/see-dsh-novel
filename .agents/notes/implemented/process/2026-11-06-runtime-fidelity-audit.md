# Agent Note: runtime.fidelity-audit —— 逐行保真对照与债登记

Status: implemented

## Problem

现有 30 行 `verified` 的判定依据是「实现 + 测试 + 真机回执」，没有逐行做「源工程行为 → 复刻行为」的不变量对照。按 `AGENTS.md` 保真工作法，源工程行为是规格：每行必须先提取可验证的不变量，再判定「行为等价／机制等价／保真债」。已经暴露的例子：

- `chapter.write` 缺 writer 的 governed／length／person／protagonist／rules／style 契约；
- `chapter.review` 没有把编号原文注入，审稿上下文只有 memo；
- `plan.outline` 曾经指向错误的源模块（章节规划缓存），后来删除；
- `plan.context-select`、`plan.compression` 的指令是新写的，不是移植。

这些说明「测试通过」不等于「行为一致」。

## Decision

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

## Consequences

审计产物：`docs/fidelity-audit.md`（P0–P3 四批，30 行 verified 与 1 行待验）；债项写进 `docs/scope.md`。

发现 18 条保真债（D1–D18），集中在三类：

- 提示词层：architect、planner、writer、reviewer 的 system prompt 与契约块没有移植（D6、D14、D16、D17）；
- 契约层：提案缺 min/max 章长、ready 判据文件集、truth 允许列表、事务目录前缀、命令选项与默认值（D1–D5、D7–D9）；
- 机制层：检索分词与来源类型、上下文固定来源与选择器拆分、压缩窗口来源、plan 复用、reviewedArtifact（D10–D13、D15、D18）。

判定为等价的只有：`proposal.execution-brief`、`foundation.control-docs`、`foundation.hook-ledger`、`foundation.rule-contract`、`foundation.truth-projections`。`runtime.stage-context` 是机制等价，沿用 `docs/dsh-mapping.md` 的「方法注入」行。

后续按债项逐行补齐；补齐前不把对应行视为行为等价。
