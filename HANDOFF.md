# HANDOFF — 当前班次交接

交接件按班次重写：只写「现在在哪、下一步做什么、别踩哪些坑」。持续结论在 `docs/`、`.agents/notes/implemented/` 与 `capabilities.yaml`；本文件不复制它们，只给接手人一条最短路径。

最近更新：2026-11-16（提交 `7fe144a` 之后）。

## 仓库状态

- 分支 `main`，最新提交 `7fe144a`，工作区干净（除 `.scratch/`）。
- 全量 `pnpm run verify`：602 tests／601 pass／1 skipped（symlink）；CI `verify (ubuntu-latest)` 与 `verify (windows-latest)` 均 success。
- `lib/` 已于 14:06 重建（agent.js 540306B）；**宿主尚未重启**，运行中的 DSH 仍是旧 bundle。

## 本会话已交付（按提交）

| 提交 | 内容 |
|---|---|
| `debadce` | 结算前草稿与基础设定确认变更提示（会话早段） |
| `1894d62` `1453902` `8641f7f` | 面板确认后索引不刷新：确认路径锁内重建、可见告警、评审修正 |
| `c6ab94d` | 角色卡工具契约可发现性（描述/字段说明/缺卡错误一次列全） |
| `fcd6ed6` | cast 读四档位目录、删除自造的同名丢弃 |
| `a9c5f01` | 阶段协议通用段加「读写留在工作区」 |
| `acf46d9` | 面板「作者意图（长期方向）」 |
| `ca4520c` `cf72e26` | 角色候选按源顺序覆盖四档位（真实工作区 12 候选回执） |
| `5904da9` `a0c802b` | 人物档案上下文两段式贴源（去自造标记、`trim()`） |
| `7fe144a` | 坏卡处置登记为机制偏差，AU-15 代码项关闭 |

对应 Note 均在 `.agents/notes/implemented/`：`2026-11-16-{cast-documents-contract,cast-reads-four-role-dirs,out-of-workspace-reads,control-doc-semantics,role-candidates-four-dirs,cast-context-format,cast-blockers,panel-index-refresh-after-approval}.md`。

## 待你决定/待环境

1. **重启宿主**才能让上述行为生效：profile 的 `node_modules/see-dsh-novel` 是指向仓库的 Junction，`lib/` 已更新，无需重装，只需重启。
2. 以下验收项因「不重跑真实会话」仍是 BLOCKED，已在回执与 Note 里记明，不是遗漏：
   - `foundation.architect`：契约修正后不再反复猜参数（观察项）。
   - `cast.single-authority`：真实会话下的角色档案形态；AU-15 剩余三类回执（英文作品／英文目录／空卡与读失败）。
   - `runtime.stage-context`：会话中不再出现工作区外读取（观察项）。
3. 未决产品问题（需要你裁决，目前按现状登记）：坏卡是否必须挡住写作。源在 plan／write 对空卡是宽容的，加闸门属新产品限制，见 `.agents/notes/implemented/bug-fix/2026-11-16-cast-blockers.md`。

## 下一步任务（按建议顺序）

### 1（推荐）AU-27 `chapter.reopen`：恢复分支补 trim 与空正文拒绝

- 源：`inkos/packages/core/src/interaction/edit-controller.ts:337-345` —— `fullText.trim()`，空则抛 `Chapter replacement requires fullText.`；内容相同则抛 `already has the supplied content`。
- 复刻：`packages/see-dsh-novel/src/core/reopen.ts:130-135` 的 `restoreChapter` 既不 trim 也不拒空正文（只有空白内容的归档版本会被写成空章）；相同内容已拒。
- 另半：恢复会新增 artifact revision，属未登记偏差，补进 `docs/dsh-mapping.md`；重录 `artifacts/real-runs/chapter.reopen.json`。
- 指令：`/planning 批准，执行规划 章节恢复分支补齐 trim 与空正文拒绝`

### 2 AU-17 `runtime.work-lock`：stale 基准对齐

- 源回退 `startedAt`，复刻回退文件 mtime；行为差异可测，不需要真实会话。
- 指令：`/planning 批准，执行规划 作品锁 stale 基准与源对齐`

### 3 过期回执批量重录（纯证据，不改行为）

- AU-03 `runtime.client-ui`（9325B/8 例 → 43507B/34 例）、AU-04 `runtime.package-check`、AU-05 `runtime.boundary-check`（33→100 文件）、AU-32 `foundation.truth-projections`、AU-34 `foundation.truth-write`、AU-35 `chapter.summary`。
- 指令：`/planning 批准，执行规划 过期回执批量重录`

### 不建议现在动

- AU-20（D24 book reference）依赖 P6 的 `materials.import`／`search.unified`；AU-19、AU-21 分别卡在检索面与真压缩的会话回执。

## 工作方式提醒（本项目特有，容易踩）

- 门禁：规划要 `/planning 批准，执行规划 {工作项}`，实施要 `/implement 批准，执行实现 {工作项}`；「确认／可以」不算授权；Discuss 里不落规划工件。
- 先查源工程再动手：`inkos/` 是规格；提案必须带源证据（文件:行 + 行为）。
- 六处同步：Note 生命周期、`capabilities.yaml`（含 `check-capabilities -- --write` 与 real-run 重录）、`fidelity-audit.md`、`scope.md`、`dsh-mapping.md`（+ `dsh-deviations.md` 四段）、CI 双平台。
- 跨行交付要显式声明（例如 ① 与 ③ 同改 `stages/index.ts` 的不同行），PR 说明单列。
- 不要用弹窗把可判断的问题推回给用户；只有真正的产品/风险裁决才问，且一轮问完。
- `pnpm run verify` 在本机需要 full access（tsx/esbuild 在沙箱下 spawn 会 EPERM）。
