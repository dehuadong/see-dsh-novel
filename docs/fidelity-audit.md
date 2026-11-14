# 保真审计

逐行对照源工程行为与复刻行为。判定只有三种：`等价`、`机制等价`（必须带 `docs/dsh-mapping.md` 偏差行）、`保真债`（必须带 `docs/scope.md` 偿还行）。

审计范围：账本中全部 `verified` 行与待验行；按 P0 → P1 → P2 → P3 → P4 → P5 → P6 分批。`###` 段必须覆盖 v1 P0–P6 的每一行；`missing` 行也写源证据与阻塞。

## 2026-11-14 实现审计（45 条 verified）

- 工件：[`../artifacts/implementation-audit/2026-11-14.md`](../artifacts/implementation-audit/2026-11-14.md)，逐行证据在 `artifacts/implementation-audit/rows/<id>.json`。
- 冻结：仓库 `e3b7886`，源 `inkos` `8433323`。
- 结论：等价 6、机制等价 13、保真债 26；realRun S 27、P 18、N 0；33 行有未关闭差异（见 [`scope.md`](scope.md) 的“2026-11-14 实现审计债” AU-01–AU-35）。
- 审计只读，不改 `capabilities.yaml` 状态；本节的 45 行判定表取代下方同名 `###` 段的旧判定；冲突以本表为准，旧段待按 AU 债修复。

**判定唯一表**：以下 45 行是当前判定；下方同名 `###` 段的旧判定已失效。

| id | 判定 | AU | 逐行证据 |
| --- | --- | --- | --- |
| runtime.load | 机制等价 |  | [json](../artifacts/implementation-audit/rows/runtime.load.json) |
| runtime.agent-tools | 保真债 | AU-01 | [json](../artifacts/implementation-audit/rows/runtime.agent-tools.json) |
| skill.references | 保真债 | AU-02 | [json](../artifacts/implementation-audit/rows/skill.references.json) |
| runtime.client-ui | 机制等价 | AU-03 | [json](../artifacts/implementation-audit/rows/runtime.client-ui.json) |
| runtime.package-check | 机制等价 | AU-04 | [json](../artifacts/implementation-audit/rows/runtime.package-check.json) |
| runtime.boundary-check | 机制等价 | AU-05 | [json](../artifacts/implementation-audit/rows/runtime.boundary-check.json) |
| runtime.session-binding | 保真债 | AU-06 | [json](../artifacts/implementation-audit/rows/runtime.session-binding.json) |
| runtime.commands | 保真债 | AU-07 | [json](../artifacts/implementation-audit/rows/runtime.commands.json) |
| runtime.telemetry | 机制等价 |  | [json](../artifacts/implementation-audit/rows/runtime.telemetry.json) |
| runtime.recovery | 保真债 | AU-08 | [json](../artifacts/implementation-audit/rows/runtime.recovery.json) |
| proposal.creative | 保真债 | AU-09 | [json](../artifacts/implementation-audit/rows/proposal.creative.json) |
| panel.gate-resume | 机制等价 |  | [json](../artifacts/implementation-audit/rows/panel.gate-resume.json) |
| panel.foundation-start | 机制等价 |  | [json](../artifacts/implementation-audit/rows/panel.foundation-start.json) |
| panel.confirm | 机制等价 | AU-11 | [json](../artifacts/implementation-audit/rows/panel.confirm.json) |
| foundation.architect | 保真债 | AU-12 | [json](../artifacts/implementation-audit/rows/foundation.architect.json) |
| foundation.hooks | 保真债 | AU-13 | [json](../artifacts/implementation-audit/rows/foundation.hooks.json) |
| foundation.approval | 保真债 | AU-14 | [json](../artifacts/implementation-audit/rows/foundation.approval.json) |
| cast.single-authority | 保真债 | AU-15 | [json](../artifacts/implementation-audit/rows/cast.single-authority.json) |
| foundation.rule-contract | 等价 |  | [json](../artifacts/implementation-audit/rows/foundation.rule-contract.json) |
| foundation.ready-check | 等价 |  | [json](../artifacts/implementation-audit/rows/foundation.ready-check.json) |
| foundation.truth-projections | 保真债 | AU-32 | [json](../artifacts/implementation-audit/rows/foundation.truth-projections.json) |
| foundation.truth-write | 保真债 | AU-34 | [json](../artifacts/implementation-audit/rows/foundation.truth-write.json) |
| foundation.control-docs | 保真债 | AU-16 | [json](../artifacts/implementation-audit/rows/foundation.control-docs.json) |
| foundation.hook-ledger | 等价 |  | [json](../artifacts/implementation-audit/rows/foundation.hook-ledger.json) |
| runtime.commit-safety | 保真债 | AU-33 | [json](../artifacts/implementation-audit/rows/runtime.commit-safety.json) |
| runtime.work-lock | 保真债 | AU-17 | [json](../artifacts/implementation-audit/rows/runtime.work-lock.json) |
| runtime.stage-context | 保真债 | AU-18 | [json](../artifacts/implementation-audit/rows/runtime.stage-context.json) |
| runtime.txn-format | 等价 |  | [json](../artifacts/implementation-audit/rows/runtime.txn-format.json) |
| proposal.execution-brief | 等价 |  | [json](../artifacts/implementation-audit/rows/proposal.execution-brief.json) |
| plan.retrieval | 保真债 | AU-19 | [json](../artifacts/implementation-audit/rows/plan.retrieval.json) |
| plan.context-select | 保真债 | AU-20 | [json](../artifacts/implementation-audit/rows/plan.context-select.json) |
| plan.compression | 保真债 | AU-21 | [json](../artifacts/implementation-audit/rows/plan.compression.json) |
| plan.chapter | 保真债 | AU-22 | [json](../artifacts/implementation-audit/rows/plan.chapter.json) |
| chapter.write | 保真债 | AU-23 | [json](../artifacts/implementation-audit/rows/chapter.write.json) |
| chapter.review | 保真债 | AU-24 | [json](../artifacts/implementation-audit/rows/chapter.review.json) |
| chapter.revise | 保真债 | AU-25 | [json](../artifacts/implementation-audit/rows/chapter.revise.json) |
| chapter.summary | 保真债 | AU-35 | [json](../artifacts/implementation-audit/rows/chapter.summary.json) |
| chapter.settle | 机制等价 |  | [json](../artifacts/implementation-audit/rows/chapter.settle.json) |
| chapter.reopen | 机制等价 | AU-27 | [json](../artifacts/implementation-audit/rows/chapter.reopen.json) |
| chapter.move-delete | 等价 |  | [json](../artifacts/implementation-audit/rows/chapter.move-delete.json) |
| state.check | 机制等价 |  | [json](../artifacts/implementation-audit/rows/state.check.json) |
| artifact.identity | 保真债 | AU-28 | [json](../artifacts/implementation-audit/rows/artifact.identity.json) |
| export.work | 机制等价 | AU-29 | [json](../artifacts/implementation-audit/rows/export.work.json) |
| backup.restore | 机制等价 | AU-30 | [json](../artifacts/implementation-audit/rows/backup.restore.json) |
| panel.workbench | 保真债 | AU-31 | [json](../artifacts/implementation-audit/rows/panel.workbench.json) |


## 跨能力不变量

行级判定之外，以下不变量必须由阶段出口同时验证；每条绑定源工程证据、DSH 落点与验证位置。

1. **workflow start 确认**：源 `propose_action` 只枚举 15 个 workflow start（`agent/agent-tools.ts:178-194`）；`write_next` 是 confirmed production intent（`studio/src/shared/confirmed-production.ts`）；plan/write/revise 是内部步骤。DSH 的 approval／面板／命令只确认 workflow start，不逐工具确认；未确认不启动 workflow。
2. **阶段停点**：源没有“阶段 prompt 自动推进”；DSH `systemPrompt.context` 只描述当前阶段。普通问候/讨论不改作品；workflow start 由作者动作触发；阶段完成必须停下；工具入口拒绝没有 workflow start 的跨阶段写入。
3. **作品边界**：源 `works/<id>`、`WorkManifest`、`state` 锁与原子文件集 → DSH 一个工作区一部作品、`work.json`、`runtime.work-lock`／`commit`；跨作品隔离；失败不留半写。
4. **证据同一**：会话日志、telemetry、realRun、面板展示来自同一证据；`capabilities.yaml` 状态只由 `check-capabilities` 依据证据生成。
5. **上下文同一**：模型窗口、预算、检索候选、压缩、`ChapterTrace` 七字段、review 来源同一基准；不静默截断。
6. **产物同一**：章节文档、artifact revision、`reviewedArtifact`、review 证据指向同一被审版本；写/审/改不跨 revision。
7. **面板/命令一致**：面板按钮、`/story-*` 命令、原生 approval 不出现三套 decision；`panel.confirm` 拥有确认语义，`panel.workbench` 是读取 + 动作面；确认状态由宿主的 `detectStage` 与 approval 回执产生，面板动作与命令走同一宿主入口。

验证位置：1/2 见 `runtime.stage-context`／`foundation.approval`／`panel.confirm`；3 见 `runtime.session-binding`／`runtime.work-lock`／`runtime.commit-safety`；4 见 `runtime.telemetry`／`check-capabilities`；5 见 `plan.*`；6 见 `chapter.write`／`chapter.review`／`artifact.identity`；7 见 `workbench.test.mjs`／`client.test.mjs` 的动作派发断言与 `panel.confirm` 测试。

---

## 批次 A：P0 运行时骨架

### runtime.load

判定与证据见上方「2026-11-14 实现审计」表；旧段已归档到审计 rows。

### runtime.agent-tools

判定与证据见上方「2026-11-14 实现审计」表；旧段已归档到审计 rows。

### runtime.client-ui

判定与证据见上方「2026-11-14 实现审计」表；旧段已归档到审计 rows。

### runtime.package-check

判定与证据见上方「2026-11-14 实现审计」表；旧段已归档到审计 rows。

### runtime.boundary-check

判定与证据见上方「2026-11-14 实现审计」表；旧段已归档到审计 rows。

### skill.references

判定与证据见上方「2026-11-14 实现审计」表；旧段已归档到审计 rows。

## 批次 B：P1 创意、立项与基础设定

### runtime.session-binding

判定与证据见上方「2026-11-14 实现审计」表；旧段已归档到审计 rows。

### runtime.commands（建书命令）

判定与证据见上方「2026-11-14 实现审计」表；旧段已归档到审计 rows。

### runtime.telemetry

判定与证据见上方「2026-11-14 实现审计」表；旧段已归档到审计 rows。

### runtime.recovery

判定与证据见上方「2026-11-14 实现审计」表；旧段已归档到审计 rows。

### proposal.creative（提案确认卡）

判定与证据见上方「2026-11-14 实现审计」表；旧段已归档到审计 rows。

### panel.gate-resume

判定与证据见上方「2026-11-14 实现审计」表；旧段已归档到审计 rows。

### panel.foundation-start

判定与证据见上方「2026-11-14 实现审计」表；旧段已归档到审计 rows。

### foundation.architect

判定与证据见上方「2026-11-14 实现审计」表；旧段已归档到审计 rows。

### foundation.hooks

判定与证据见上方「2026-11-14 实现审计」表；旧段已归档到审计 rows。

### foundation.approval

判定与证据见上方「2026-11-14 实现审计」表；旧段已归档到审计 rows。

### cast.single-authority

判定与证据见上方「2026-11-14 实现审计」表；旧段已归档到审计 rows。

### foundation.rule-contract

判定与证据见上方「2026-11-14 实现审计」表；旧段已归档到审计 rows。

### foundation.ready-check

判定与证据见上方「2026-11-14 实现审计」表；旧段已归档到审计 rows。

### foundation.truth-projections

判定与证据见上方「2026-11-14 实现审计」表；旧段已归档到审计 rows。

### foundation.control-docs

判定与证据见上方「2026-11-14 实现审计」表；旧段已归档到审计 rows。

### foundation.truth-write

判定与证据见上方「2026-11-14 实现审计」表；旧段已归档到审计 rows。

### foundation.hook-ledger

判定与证据见上方「2026-11-14 实现审计」表；旧段已归档到审计 rows。

### runtime.commit-safety

判定与证据见上方「2026-11-14 实现审计」表；旧段已归档到审计 rows。

### runtime.work-lock

判定与证据见上方「2026-11-14 实现审计」表；旧段已归档到审计 rows。

### runtime.stage-context

判定与证据见上方「2026-11-14 实现审计」表；旧段已归档到审计 rows。

### runtime.txn-format

判定与证据见上方「2026-11-14 实现审计」表；旧段已归档到审计 rows。

### proposal.execution-brief（执行说明与默认规模）

判定与证据见上方「2026-11-14 实现审计」表；旧段已归档到审计 rows。

### panel.confirm

判定与证据见上方「2026-11-14 实现审计」表；旧段已归档到审计 rows。

## 批次 C：P2 章前规划

### plan.retrieval

判定与证据见上方「2026-11-14 实现审计」表；旧段已归档到审计 rows。

### plan.context-select

判定与证据见上方「2026-11-14 实现审计」表；旧段已归档到审计 rows。

### plan.compression

判定与证据见上方「2026-11-14 实现审计」表；旧段已归档到审计 rows。

### plan.chapter

判定与证据见上方「2026-11-14 实现审计」表；旧段已归档到审计 rows。

## 批次 D：P3 正文生产

### chapter.write

判定与证据见上方「2026-11-14 实现审计」表；旧段已归档到审计 rows。

### chapter.review

判定与证据见上方「2026-11-14 实现审计」表；旧段已归档到审计 rows。

### chapter.revise

判定与证据见上方「2026-11-14 实现审计」表；旧段已归档到审计 rows。

## 批次 E：P4 结算与定稿

### chapter.summary

判定与证据见上方「2026-11-14 实现审计」表；旧段已归档到审计 rows。

### chapter.settle

判定与证据见上方「2026-11-14 实现审计」表；旧段已归档到审计 rows。

### chapter.finalize

**已并入 `chapter.settle`**：结算即发布，一次提交写章节、三份投影、四份状态 JSON、`snapshots/<chapter>` 七份、`chapters/index.json` 与 active；不再有独立定稿工具。恢复补齐的索引条目写 `lengthTelemetry`（源口径）；`tokenUsage` 由发布路径的 usage 文件写入（D60 注销）。

## 批次 F：P5 章节运维与对账

### chapter.reopen

判定与证据见上方「2026-11-14 实现审计」表；旧段已归档到审计 rows。

### chapter.move-delete

判定与证据见上方「2026-11-14 实现审计」表；旧段已归档到审计 rows。

### state.check

判定与证据见上方「2026-11-14 实现审计」表；旧段已归档到审计 rows。

## 批次 G：P6 产物与工作台

### artifact.identity

判定与证据见上方「2026-11-14 实现审计」表；旧段已归档到审计 rows。

### export.work

判定与证据见上方「2026-11-14 实现审计」表；旧段已归档到审计 rows。

### backup.restore

判定与证据见上方「2026-11-14 实现审计」表；旧段已归档到审计 rows。

### materials.import

**源工程证据**：源素材导入与 reference context。

**复刻现状**：未实现；行 missing；D22/D24 依赖它。

**判定：保真债（未立债号）** — P6 行 missing。

### search.unified

**源工程证据**：源记忆／素材／技能统一检索。

**复刻现状**：未实现；行 missing；D22/D24 依赖它。

**判定：保真债（未立债号）** — P6 行 missing。

### panel.workbench

判定与证据见上方「2026-11-14 实现审计」表；旧段已归档到审计 rows。

### panel.logs

**源工程证据**：Studio `components/` 的调用日志。

**复刻现状**：未实现；行 missing。

**判定：保真债（未立债号）** — P6 行 missing。

### panel.analysis

**源工程证据**：Studio `pages/` 的分析/节奏。

**复刻现状**：未实现；行 missing。

**判定：保真债（未立债号）** — P6 行 missing。

## 批次进度

| 批次 | 阶段 | 能力行 | 状态 |
| --- | --- | --- | --- |
| A | P0 运行时骨架 | 6 | 完成 |
| B | P1 创意、立项与基础设定 | 23 | 完成 |
| C | P2 章前规划 | 4 | 完成 |
| D | P3 正文生产 | 3 | 完成 |
| E | P4 结算与定稿 | 3 | 行 verified；出口待债（D61） |
| F | P5 章节运维与对账 | 3 | 行 verified；出口待债（D61） |
| G | P6 产物与工作台 | 4 | v1 四行完成；D57 保留 |

阶段合同与出口见 [`scope.md`](scope.md)；能力状态只由 `check-capabilities` 生成。P4／P5 的债未偿还前出口不成立，详见 scope 的「已知的次序偏差」。

## v1 之外

`materials.import`、`search.unified`、`panel.logs`、`panel.analysis` 与 `short.*`、`script.*`、`radar.topic`、`forecast.plot` 不在 v1 P0–P6 出口；账本保留 `missing`，对应源模块另行规划。它们不要求 `###` 审计段；不得借“补齐”混进当前阶段。
