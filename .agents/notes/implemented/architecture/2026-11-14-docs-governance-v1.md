# Agent Note: 文档职责与 v1 边界治理

Status: implemented

## Problem

`scope.md`、`fidelity-audit.md`、`dsh-mapping.md` 与新增的 `artifacts/implementation-audit/` 混写了同一事实：scope 里有逐行判定与审计债，fidelity 里有状态与债，audit rows 里又有 verdict/debt，mapping 里夹带等价判断。结果是同一行有三份判定、两份债表，`verified` 被误读为“保真已验证”。

## Decision

1. **一个事实一个家**：
   - 状态与证据指针：`capabilities.yaml`；
   - 产品范围、阶段入口/出口、非目标、债：`docs/scope.md`；
   - 每行行为判定与跨能力不变量：`docs/fidelity-audit.md`；
   - 偏差（源→DSH→原因→验证）：`docs/dsh-mapping.md`；
   - 审计证据与限制：`artifacts/implementation-audit/`、`artifacts/real-runs/`；
   - 设计决定：`.agents/notes/`；
   - 历史评审：`artifacts/plan-review-11-*`。
2. **审计证据去判定**：`implementation-audit/rows/*.json` 只留 source/replica/tests/realRun/deviations/limitations；verdict 只在 `fidelity-audit.md` 的审计表，债只在 `scope.md`。
3. **v1 边界**：v1 = 长篇第一篇，提案 → 第 1 章定稿 → 导出/备份；能力集 = 当前 45 条 `verified`。`chapter.finalize` 并入 `chapter.settle`，不设独立行。
4. **P6 拆分**：v1 的 P6 只含 `artifact.identity`、`export.work`、`backup.restore`、`panel.workbench`；`materials.import`、`search.unified`、`panel.logs`、`panel.analysis` 与短篇/剧本/雷达/预演移出 v1。
5. **运行形态**：从 `scope.md` 移到 `dsh-mapping.md`（DSH 机制上下文，不是产品范围）。
6. **更新触发**：改行为→fidelity；改债→scope；改机制偏差→mapping；改证据→audit/real-runs；改状态→`check-capabilities -- --write`。

## Consequences

- `verified` 只表示三份证据字段存在，不等于行为等价；审计表是当前行为判定。
- scope 不再承载逐行判定；fidelity 不再承载债表；mapping 不再承载等价判断。
- 审计表 45 行：等价 6、机制等价 13、保真债 26；AU-01–AU-35（AU-10 关闭）保留在 scope。
- P6 扩展移出 v1 后，v1 出口不再被 `materials.import` 等 missing 行卡住；D61 仍待 `import_chapters`。

## Verification

- `docs/AGENTS.md` 增“文档职责（v1）”表与更新触发。
- `docs/scope.md` 增 9 阶段 v1 链路表、P6 拆分、运行形态移出。
- `docs/fidelity-audit.md` 审计表为唯一判定；同名节旧判定标失效。
- `artifacts/implementation-audit/rows/*.json` 无 verdict/debt；矩阵无判定/债。
- `docs/dsh-mapping.md` 增运行形态，只保留映射/偏差。
- `pnpm run verify-notes` 通过；`pnpm run verify` 505 passed／1 skipped。

## Alternatives considered

- **保留 audit rows 的 verdict/debt**：省一次脚本。否掉：第二状态表，与治理目标冲突。
- **把审计表放 audit 工件**：更集中。否掉：判定属主是 fidelity，audit 只做证据。
- **把 P6 missing 四行留在 v1**：更保守。否掉：用户确认 v1 只到第 1 章定稿/导出，链路不需要素材/检索/日志/分析。
- **把运行形态留在 scope**：少移动。否掉：它是 DSH 机制上下文，不属于产品范围。
