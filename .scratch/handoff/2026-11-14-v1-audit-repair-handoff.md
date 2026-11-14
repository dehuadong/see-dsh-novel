# 交接：v1 审计修复（2026-11-14）

## 当前状态

- 仓库：`E:\see-dsh-novel`；分支 `main`；HEAD `c75463b`；工作树干净。
- 最近提交：
  - `f08b095` AU-22 续：planner 作者指令 + plan 复用/覆盖。
  - `8b319c5` AU-11：`/story-write` 作者附言。
  - `8b319c5` 之前的 AU-22/AU-11 修复。
- CI：`43587741717`（`f08b095`）ubuntu/windows 通过；`c75463b` 双端也通过。
- 测试：`pnpm run verify` = **542 tests，541 passed／1 skipped**。
- 账本：45 `verified`／14 `missing`；审计判定 6 等价／14 机制等价／25 保真债，32 行未关闭。

## 项目约束（先读）

1. [`AGENTS.md`](../../AGENTS.md)：源工程是 `inkos/`；行为等价优先；一个 PR 一个能力行；状态只来自证据；只用 DSH 运行时。
2. [`docs/AGENTS.md`](../../docs/AGENTS.md)：文档职责与粒度；实现过程归 Notes，回执归 real-runs，判定归 fidelity，债归 scope。
3. [`docs/scope.md`](../../docs/scope.md)：v1 边界与九阶段链路；v1 = 当前 45 条 verified。
4. [`docs/fidelity-audit.md`](../../docs/fidelity-audit.md)：45 行判定唯一表。
5. [`docs/dsh-mapping.md`](../../docs/dsh-mapping.md)：机制映射；偏差明细归档在 [`artifacts/implementation-audit/dsh-deviations.md`](../../artifacts/implementation-audit/dsh-deviations.md)。

## v1 定义

提案 → 立项/初始化 → 基础设定 → 全书/章前规划 → 正文 → 审稿 → 修订/清稿 → 摘要/结算/定稿 → 导出/备份。

- 只覆盖第 1 章定稿与导出/备份。
- `chapter.finalize` 并入 `chapter.settle`。
- P6 v1 仅 `artifact.identity`、`export.work`、`backup.restore`、`panel.workbench`；`materials.import`/`search.unified`/`panel.logs`/`panel.analysis` 在 v1 之后。

## 已完成的审计修复

| 行 | 结果 | Note |
|---|---|---|
| `chapter.settle` AU-26 | 关闭；strict 状态、status 映射 | [`2026-11-14-settle-state-strictness.md`](../../.agents/notes/implemented/architecture/2026-11-14-settle-state-strictness.md) |
| `chapter.revise` AU-25 | 关闭；长度硬校验/预算/delivery | [`2026-11-14-revise-length-budget.md`](../../.agents/notes/implemented/architecture/2026-11-14-revise-length-budget.md) |
| `chapter.write` AU-23 | 部分；草稿路径/契约/标题/回执；D61+safeChapterTitle 留债 | [`2026-11-14-write-draft-handoff.md`](../../.agents/notes/implemented/architecture/2026-11-14-write-draft-handoff.md) |
| `plan.context-select` AU-20 | 部分；上一章全文/强制 N-1/顺序/双语/strict；D24 留债 | [`2026-11-14-context-selection-fidelity.md`](../../.agents/notes/implemented/architecture/2026-11-14-context-selection-fidelity.md) |
| `chapter.review` AU-24 | 部分；重审/before-current/scope/unavailable/delivery/evidence；现场重编排留债 | [`2026-11-14-review-repeat-context.md`](../../.agents/notes/implemented/architecture/2026-11-14-review-repeat-context.md) |
| `plan.chapter` AU-22 | 部分；上一章段/空白/字节/planner 作者指令/plan 直调复用覆盖；阶段入口/索引进度留债 | [`2026-11-14-plan-chapter-inputs.md`](../../.agents/notes/implemented/architecture/2026-11-14-plan-chapter-inputs.md)、[`2026-11-14-planner-instruction-reuse.md`](../../.agents/notes/implemented/architecture/2026-11-14-planner-instruction-reuse.md) |
| `panel.confirm` AU-11 | 部分；`/story-write` 附言；chapterCount/真实会话留债 | [`2026-11-14-confirm-instruction-count.md`](../../.agents/notes/implemented/architecture/2026-11-14-confirm-instruction-count.md) |

## 下一步：AU-18 `runtime.stage-context`

按依赖图，下一条做 AU-18，理由：

- AU-22 剩余项（阶段重规划入口、索引进度）需跨行/新命令，不是小补丁。
- AU-18 独立，直接决定 planner 输入质量：plan 创作方法、hook id 收窄、中英阶段协议、writer 绑定块。
- 当前 `craftSkillsFor('plan')` 为空；planner 契约注入全量 hook id；英文阶段协议仍中文。

依据：[`docs/scope.md`](../../docs/scope.md) AU-18 行、[`artifacts/implementation-audit/rows/runtime.stage-context.json`](../../artifacts/implementation-audit/rows/runtime.stage-context.json)。

计划入口：

```
/planning 批准，执行规划 runtime.stage-context 审计修复（AU-18）
```

## 之后优先级

1. AU-18：plan 技能/hook id/双语阶段协议。
2. AU-22 剩余：阶段 replan 入口、索引进度/detectStage。
3. AU-23 的 `safeChapterTitle`；D61 等 `chapter.import` 立项，不在 v1 前硬做。
4. AU-24 现场重编排 + unavailable 父代理兜底。
5. AU-19 trace id strict。
6. D24/P6 materials；chapterCount N>1。

## 未关闭的阻塞

- `chapter.import` 不存在 → D61 不能关。
- `materials.import`/`search.unified` 不存在 → D24 reference context 不能做。
- 真实 DSH 会话回执缺：AU-20/AU-22/AU-24/AU-11 均有 P 级 limitation，不要冒充 S。
- `detectStage` 仍 current_state+1；索引进度分叉未修。
- `chapterCount` N>1 未实现；单 start 按章授权。

## 工作流

1. 读 `AGENTS.md`、`docs/AGENTS.md`、`docs/scope.md`、`docs/fidelity-audit.md`。
2. 新工作项从 Discuss 开始；用户给 `/planning 批准，执行规划 {item}` 后加载 `planning`。
3. Plan Review 三轴通过后，等 `/implement 批准，执行实现 {item}`。
4. 实施后：Implementation Review（code-review 两轴）→ 修正 → `pnpm run verify` → commit/push → CI 双端。
5. 六处同步：Note、capabilities、fidelity、scope、mapping、real-runs。
6. 代码变更必须保持一行一 PR；跨行先拆或先立项。

## 验证命令

```powershell
cd E:\see-dsh-novel
pnpm run verify
pnpm run verify-notes
pnpm run check-capabilities
git status --short
gh run list --branch main --limit 1
```

## 常见坑

- 不要用 `process:*` 回执冒充真实 DSH 会话；S/P 级别按证据。
- 不要建第二套状态/判定表；判定只在 `fidelity-audit.md` 表，债只在 `scope.md`。
- 不要自创产品限制；源没有的收紧要么对齐源，要么记债。
- 不要提交 `.scratch/`；`.scratch/handoff/2026-11-13-next-d34-work.md` 是用户文件。
- 文档里避免字面 `\n`；PowerShell 替换容易引入，改完用 grep 检查。
- 一个 PR 不要混多个能力行；AU-22 续这种同能力行拆分可以，但不要顺手改别的行。

## Suggested skills

- `planning`：新工作项/Plan Review。
- `implement`：授权实施与 Implementation Review。
- `code-review`：Standards/Spec 两轴复核。
- `verify`：最终验收与 CI。
- `write-agent-notes`：新 Note 或旧 Note 取代/归档。
- `dsh-doc`：需要 DSH 插件/tool/command 机制事实时。
- `handoff`：再次交接。

## 交接文件

- 本文件：`.scratch/handoff/2026-11-14-v1-audit-repair-handoff.md`
- 既有用户交接：`.scratch/handoff/2026-11-13-next-d34-work.md`、`.scratch/handoff/2026-11-13-next-export-work.md`（不要覆盖）
