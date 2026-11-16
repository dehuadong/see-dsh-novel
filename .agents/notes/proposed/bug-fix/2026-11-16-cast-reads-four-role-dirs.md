# Agent Note: cast.single-authority —— 角色卡读取覆盖四个档位目录（AU-15 子项）

Status: proposed

## Problem

真实工作区 `E:\novelist\test-novel\t001` 有 **12 张卡、11 个人**：`roles/major/苏晚星.md` 与 `roles/主要角色/苏晚星.md` 同人。会话里模型在 `cast_documents` 失败后用 `story_truth_file` 写卡（`roles/苏晚星.md` 被拒、`roles/major/苏晚星.md` 通过）。

写入四档位是源行为；偏差在**读取面**：

| 读面 | 认哪些目录 | 证据 |
|---|---|---|
| `cast`（上下文注入） | 只认 `主要角色`、`次要角色` | `packages/see-dsh-novel/src/pipelines/long/cast.ts` 的 `readTier` 用 `ROLE_DIRS[tier]`（单目录） |
| `roleCandidates`（上下文候选） | 只认两个中文目录 | `packages/see-dsh-novel/src/core/context-package.ts:376` 用 `ROLE_DIR_NAMES` |
| 源工程读取 | **四个** | `inkos/packages/core/src/utils/outline-paths.ts:59-76` |
| 面板产物 | 四个 | `story-paths.ts` 的 `ROLE_TIER_DIRS` |

后果：写在 `major`／`minor` 的卡面板可见、能进确认摘要，却**不进角色上下文**；作者与模型都不知道它是死的。AU-15 记的正是这一条（以及其它子项）。

另有一处复刻自造的拒绝：`cast.ts:99-113` 在「同名跨档位」时把两张卡都丢掉并报「合并成一张再继续」。源 `readRoleCards` 不去重、不丢弃——这是 AU-15「同名跨档位处置按源」的欠账。

## 源工程证据

- 源读四档位：`inkos/packages/core/src/utils/outline-paths.ts:59-76`，`readRoleCards` 并行 `collectRoleDir(主要角色|次要角色|major|minor)`，结果直接拼接，**不去重、不按目录排优先级**（并发收集，顺序不保证）。
- 源写四档位：`inkos/packages/core/src/harness/tools/longform-edits.ts:30` 的 `SAFE_ROLE_TRUTH_FILE_RE = /^roles\/(主要角色|次要角色|major|minor)\/[^/\\]+\.md$/u`；architect 自己只写两个中文目录（`agents/architect.ts:158`）。
- 因此「四个目录都可写」「同名可能两份」都是源行为；复刻偏离源的有两处：`cast`／`roleCandidates` 只读两个中文目录，以及 `cast.ts` 自造的丢卡拒绝。

## Proposal

### 范围与非目标

- 范围：`cast.ts` 的读取覆盖四档位（`major` 档 = `主要角色` + `major`，`minor` 档 = `次要角色` + `minor`），删除自造的同名丢卡逻辑；目录名以 `story-paths.ts` 为唯一来源（保留 `ROLE_DIR_NAMES` 为规范名，新增英文别名常量与按档位分组的表，`ROLE_TIER_DIRS` 由分组表派生，不复制字面量）；更新受影响的测试。
- 非目标：不改写入白名单、`contract.ts` 的 `RoleTier`／`roleCardPath`、`truth-files.ts` 的别名列表、面板白名单、`ready-check`；不新增同名合并/冲突拒绝（源没有）；不改 `roleCandidates`（`plan.context-select` 行，AU-15 剩余子项）；不改角色上下文格式；不改 `PANEL_INDEX_VERSION`。
- 跨项边界：本项只动 `cast.ts`＋`story-paths.ts`＋测试，属 `cast.single-authority` 一行。`contract.ts` 与 `truth-files.ts` 不动：前者继续用 `ROLE_DIR_NAMES` 的规范名（写入路径不变），后者继续接受四档位（源行为）。`roleCandidates` 的英文目录读取留在 AU-15 剩余子项，不并入本 PR；`scope.md` 的 AU-15 行只收窄本项关闭的那一条。

### 产品行为与验收

- `cast` 读取四个目录：`major` 档按 `主要角色` 再 `major` 顺序串行读；`minor` 档同理。同名双卡**都读入**（源不去重），按名字排序后一起进入上下文。
- 目录不存在不算问题（源 `collectRoleDir` 同样忽略 ENOENT）；读失败、空卡仍记 `problems`，措辞里带真实目录名。
- 工作区 12 张卡时 `readCast` 返回 12 张（苏晚星两份），`renderCastContext` 里出现两次同名块——与源一致。
- 验收：`test/cast.test.mjs` 新增「只放在 `roles/major` 的卡也能读到」「四目录各一张时四张都读到」「同名双卡都读入且不再丢弃」；删除/改写原「同名即丢弃」用例（`:113`）；`pnpm run verify` 通过。

### 决定与未决问题

- 决定（2026-11-16）：**读四目录 + 删除自造丢卡**。依据：源读四目录、写四目录、不去重；保留丢卡等于把自造限制留在债里。
- 决定：读取顺序为「中文目录在前、英文目录在后」，这是复刻自己的确定性选择（源并发收集不保证顺序），实现与测试只保证「四目录都被读到 + 按名字排序」，不声称与源顺序一致。
- 决定：同名双卡不合并、不报错；若作者日后要求合并或提示，另立工作项。
- 未决：AU-15 的其余子项（`roleCandidates` 英文目录、上下文格式、空卡处置、就绪判定口径）不在本项。

### 评审与批准证据

- 规划授权：用户 2026-11-16 输入 `/planning 批准，执行规划 统一规划：①角色卡工具契约 ②角色卡目录权威 ③工作区外读取边界 ④控制文档语义`。
- Plan Review 第 1 轮：原稿（写入规范化＋冲突拒绝＋就绪同集合）与源证据不符且跨四个能力行；第 2 轮：指出与 `cast.ts:99-113` 既有丢卡冲突、顺序断言不成立、目录表仍会分叉、`ringRegex` 行号错、未计 `roleCandidates`、未更新 ledger `source`。本稿按上述逐条修正，第 5 轮终评通过：Standards／Architecture 第 4 轮 clean，Spec 第 5 轮 clean。
- 实施授权：未授予。

## Design

- `story-paths.ts`：`ROLE_DIR_NAMES` 保持规范名；新增 `ROLE_DIR_ALIASES = { major: 'major', minor: 'minor' }` 与按档位分组的 `ROLE_DIRS_BY_TIER`（由上面两者派生），`ROLE_TIER_DIRS` 由分组表拍平派生。不复制「主要角色」等字面量，`contract.ts:25` 的 `ROLE_DIRS` 与 `truth-files.ts:55` 的别名列表保持原样（写入路径与白名单不变）。
- `cast.ts`：`readTier` 改为遍历 `ROLE_DIRS_BY_TIER[tier]`，`path`／`problems` 用实际目录名；删除 `:99-113` 的 `seen`／`conflicts` 段与对应 `problems` 文案，并同步 `:4-8`、`:90-93` 两处仍宣称「跨档位丢弃」的注释。
- 验证切入点：`test/cast.test.mjs`；`test/stage-context.test.mjs`／`test/host.test.mjs` 的角色档案注入不回归。

## Alternatives considered

- **收紧写入到两个中文目录并拒绝别名。** 最强理由：从源头不再产生同名双卡。否掉：源的白名单就是四档位（`longform-edits.ts:30`），收紧是自创限制，也治不了历史作品里已有的英文目录卡。
- **四目录读取并去重同名（保留现有丢卡逻辑）。** 最强理由：避免同名两份重复占预算。否掉：源不去重也不丢弃；保留现有逻辑会让「只放在 major 的卡」若与中文目录重名就整对消失，比现状更糟。
- **维持两目录读取、只在面板标注「不生效」。** 最强理由：改动最小。否掉：源读四目录，维持现状等于把 AU-15 这条债继续挂；标注也治不了「上下文少一个人」。

## Acceptance criteria

1. `cast` 读取四档位；只放在英文目录的卡进入角色上下文。
2. 同名双卡都读入（不再丢弃、不再报冲突），排序稳定。
3. 测试覆盖 1–2；原「同名即丢弃」用例改写；`pnpm run verify` 通过。
4. 重录 `artifacts/real-runs/cast.single-authority.json`（process-level + 真实工作区读取回执，注明无真实 DSH 会话则记 BLOCKED）；`docs/scope.md` 的 AU-15 行收窄；ledger 的 `source` 改为 `inkos:packages/core/src/utils/outline-paths.ts`。
5. 真实工作区 `E:\novelist\test-novel\t001` 的读取回执：12 张卡全部读入（含同名两份）。

## Risks

- 同名双卡进上下文会重复占预算；这是源行为的直接后果，合并需另立工作项并登记偏差。
- 目录表若不在 `story-paths.ts` 统一，`cast.ts`／`panel-index.ts`／`work.ts`／`truth-files.ts` 会继续漂移；实现时以该文件为唯一来源。
- 本项只补读取面，不改写入；模型仍可能写出英文目录卡，但至少不再静默失效。
