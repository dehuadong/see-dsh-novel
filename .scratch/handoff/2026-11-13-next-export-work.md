# Handoff: see-dsh-novel 下一步工作

日期：2026-11-13（Asia/Shanghai）
工作区：`E:\see-dsh-novel`（DSH 高保真复刻 `inkos/`）

## 当前状态

- 工作树干净；唯一未跟踪项是 `.agents/skills/handoff/`（技能文件，不入库）。
- HEAD：`235d9c6 feat(artifact.identity): 章节 revision 的不可变快照`。
- 验证基线：`pnpm run verify` 437 tests（Windows 436 pass + 1 skipped symlink；Linux 全过）；`check-capabilities` 46 verified / 14 missing；audit 覆盖 50 行；notes 78 篇。
- 最近提交顺序（最新在前）：
  - `235d9c6` artifact.identity（D42）
  - `782fef8` panel.workbench（D40/D41）
  - `deaee17` chapter.revise（D56；D45 收窄）
  - `239b6df` chapter.summary（D48）
  - `0b7d46d` state.check（D51）
  - `d1818a3` chapter.reopen（D43/D44/D55）
  - `1dbc89c` chapter.finalize（D49）
  - `7925d42` foundation.architect（初始章节索引）
- 注意：`a794670`（删除 implement-gate 状态）与 `7c265f4`（更新 AGENTS/GATES 门禁指令措辞）不是本对话产物，属外部提交。

## 必读的权威文件

- `AGENTS.md`、`docs/AGENTS.md`、`docs/agents/GATES.md`（门禁指令与工作流）
- `docs/scope.md`（剩余保真债，唯一债表）
- `docs/fidelity-audit.md`（逐能力判定）
- `docs/dsh-mapping.md`（机制等价与偏差登记）
- `capabilities.yaml`（唯一状态表；状态只能由 `check-capabilities --write` 生成）
- `.agents/notes/implemented/architecture/`（每个已交付能力的决定）
- `.scratch/handoff/`（本文件所在目录）

## 工作流（按当前 AGENTS/GATES）

1. Discuss → 用户给规划门禁：`/planning 批准，执行规划 {工作项}`（旧措辞「批准，使用技能 planning…」也应识别为同一门禁）。
2. 加载 `planning`：写 `.agents/notes/proposed/architecture/YYYY-MM-DD-<topic>.md`，含源工程证据、范围/非目标、验收、技术设计、备选；派独立子代理做 Plan Review（最多 5 轮，第 5 轮后必须由作者决定），修完后在 Note 记评审证据。
3. 用户给实现门禁：`/implement 批准，执行实现 {工作项}`。
4. 加载 `implement`：实现 + 聚焦测试 + `tsc` + `pnpm run verify`；派两个子代理做 Implementation Review（Standards / Spec 两轴），修完复审。
5. Verify：同批更新六处（Note 转 implemented、capabilities、audit、scope、mapping 若为机制等价、回执 `artifacts/real-runs/<id>.json`），跑校验，报告后由用户说「提交 {工作项} 实现」。
6. 提交只加本工单文件；`.agents/implement-gate.json`/state 等运行期文件不入库。

## 关键约定

- 保真优先：缺字段/产物/消费者/放宽校验是债，不是偏差；偏差仅 DSH 机制强制或源不可观测，且必须进 `dsh-mapping.md`；代码/注释不得标注源文件归属。
- `capabilities.yaml` 状态只由 `node scripts/check-capabilities.mjs --write` 生成。
- 行为变化行必须重录 real-run；旧回执不得描述新行为。
- Node 测试用 `node --import tsx --test`；完整验证用 `pnpm run verify`（含 notes、capabilities、audit、boundary、tests）。
- 本机 Windows 偶发 `ReplaceFileW EIO (Win32 1175)`，同一编辑重试即可。
- 当前文件策略 danger-full-access，不要传 `sandbox_permissions`。

## 剩余保真债（docs/scope.md）

| 债 | 内容 | 建议偿还 |
| --- | --- | --- |
| D50 | `export.work` EPUB 标题/语言与直写 | 下一个建议工作项 |
| D34 | `chapter.settle` 结算后自动校验 + reconciliation | 独立工作项 |
| D36 | `chapter.reopen` 恢复旧版不写索引观察（`provenance: edited`、`manual-edit-review`） | reopen 后续工作项 |
| D45（残余） | 修订写 `edited` 后，定稿又写成 `generated`，`edited` 不跨定稿 | `chapter.finalize` 保留 edited/观察 |
| D23／D54 | `skill.references` 参考边界校验 | 独立工作项 |
| D35 | 定稿遥测 `lengthTelemetry`/`tokenUsage`、superseded 清理 | 随 finalize/遥测 |
| D37 | 章节保存分步提交 | 架构级，较大 |

注：D33（基线重算）、D34（自动校验）是最深的两块；D50 是当前最小闭环。

## 建议的下一步

`export.work`（D50）。规划时先读：

- `docs/scope.md` D50
- `docs/fidelity-audit.md` 的 `export.work` 段
- `packages/see-dsh-novel/src/core/export.ts`、`src/plugin/export-command.ts`、`test/export.test.mjs`
- 源：`inkos/packages/core/src/interaction/export-artifact.ts`、`inkos/packages/core/src/__tests__` 内导出相关用例、`studio/src/api/server.ts:5606-5675`

然后按门禁：

```
/planning 批准，执行规划 export.work
```

## 建议技能

- `planning`：写 proposed Note 与派 Plan Review。
- `implement`：实现与 Implementation Review 编排。
- `code-review`：两轴（Standards / Spec）评审方法。
- `verify`：交付前验收与六处同步检查。
- `write-agent-notes`：Note 骨架、生命周期与链接校验；提交前 `pnpm run verify-notes`。
- `dsh-doc`：涉及 DSH 插件/slot/tool 机制时查本机 DSH 事实。
