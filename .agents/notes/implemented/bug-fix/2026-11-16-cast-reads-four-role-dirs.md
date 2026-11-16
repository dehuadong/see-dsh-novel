# Agent Note: cast.single-authority —— 角色卡读取覆盖四个档位目录（AU-15 子项）

Status: implemented

## Problem

真实工作区 `E:\novelist\test-novel\t001` 有 12 张卡、11 个人：`roles/major/苏晚星.md` 与 `roles/主要角色/苏晚星.md` 同人。会话里模型在 `cast_documents` 失败后用 `story_truth_file` 写卡（`roles/苏晚星.md` 被拒、`roles/major/苏晚星.md` 通过）。

写入四档位是源行为；偏差在读取面：

| 读面 | 认哪些目录 | 证据 |
|---|---|---|
| `cast`（上下文注入） | 只认 `主要角色`、`次要角色` | `packages/see-dsh-novel/src/pipelines/long/cast.ts` 的 `readTier` 用 `ROLE_DIRS[tier]`（单目录） |
| `roleCandidates`（上下文候选） | 只认两个中文目录 | `packages/see-dsh-novel/src/core/context-package.ts:376` 用 `ROLE_DIR_NAMES` |
| 源工程读取 | 四个 | `inkos/packages/core/src/utils/outline-paths.ts:59-76` |
| 面板产物 | 四个 | `story-paths.ts` 的 `ROLE_TIER_DIRS` |

后果：写在 `major`／`minor` 的卡面板可见、能进确认摘要，却不进角色上下文，作者与模型都不知道它是死的。另有一处复刻自造的拒绝：`cast.ts` 在「同名跨档位」时把两张卡都丢掉并报「合并成一张再继续」，源不去重也不丢弃。

## 源工程证据

- 源读四档位：`inkos/packages/core/src/utils/outline-paths.ts:59-76`，`readRoleCards` 并行 `collectRoleDir(主要角色|次要角色|major|minor)`，结果直接拼接，不去重、不排目录优先级（并发收集，顺序不保证）。
- 源写四档位：`inkos/packages/core/src/harness/tools/longform-edits.ts:30` 的 `SAFE_ROLE_TRUTH_FILE_RE = /^roles\/(主要角色|次要角色|major|minor)\/[^/\\]+\.md$/u`；architect 自己只写两个中文目录（`agents/architect.ts:158`）。
- 因此「四个目录都可写」「同名可能两份」都是源行为；复刻偏离源的有两处：`cast` 只读两个中文目录，以及 `cast.ts` 自造的丢卡拒绝。

## Decision

- `readCast` 按 `story-paths.ts` 的 `ROLE_DIRS_BY_TIER` 读四个目录：`major` 档读 `主要角色` 再 `major`，`minor` 档读 `次要角色` 再 `minor`；同名双卡都返回、都进上下文。
- 删除自造的同名丢弃逻辑（`seen`／`conflicts` 与「各有一张卡」问题行）：源不去重、不丢弃，复刻不替作者挑一张。
- 目录表单一来源：`story-paths.ts` 新增 `STORY_ROLES_DIR`（角色卡根目录）、`ROLE_DIRS_BY_TIER`（档位 → 目录名，规范名在前），`ROLE_TIER_DIRS` 由它派生；`cast.ts` 不再自己写 `'source/story/roles'` 字面量。
- 目录不存在按空处理（源 `collectRoleDir` 忽略 ENOENT）；读失败与空卡仍记 `problems`，措辞带真实目录名。
- `contract.ts` 的角色目录表只用于**写入**（规范目录），注释同步改为「读取方认 `ROLE_DIRS_BY_TIER`」，避免「读写共用一张表」的过期说法。
- 不改写入白名单、`roleCandidates`、面板白名单、就绪判定、角色上下文格式与 `PANEL_INDEX_VERSION`。

## Design

- `story-paths.ts`：`STORY_ROLES_DIR = ${STORY_ROOT}/roles`；`ROLE_DIRS_BY_TIER = { major: [主要角色, major], minor: [次要角色, minor] }`；`ROLE_TIER_DIRS` 由分组表拍平派生（顺序不变）。
- `cast.ts`：`readTier` 遍历该档位的目录列表，逐个 `readdirSync`；ENOENT 跳过、其它错误记 `problems` 后继续下一个目录（源也是四个目录各自独立收集）；`path` 用真实目录名；`readCast` 只做排序，不再过滤同名。
- `contract.ts`：仅注释更新，`ROLE_DIRS` 仍是 `ROLE_DIR_NAMES`（写入规范目录），`roleCardPath` 行为不变。
- 验证切入点：`test/cast.test.mjs`（四目录各一张全读、只在别名目录的卡、同名双卡同档位与跨档位、英文目录空卡带真实路径、原同名丢弃用例改写）。

## Alternatives considered

- **收紧写入到两个中文目录并拒绝别名。** 最强理由：从源头不再产生同名双卡。否掉：源的白名单就是四档位（`longform-edits.ts:30`），收紧是自创限制，也治不了历史作品里已有的英文目录卡。
- **四目录读取并去重同名（保留丢卡逻辑）。** 最强理由：避免同名两份重复占预算。否掉：源不去重也不丢弃；保留旧逻辑会让「只放在 major 的卡」在重名时整对消失，比现状更糟。
- **维持两目录读取、只在面板标注「不生效」。** 最强理由：改动最小。否掉：源读四目录，维持现状等于把 AU-15 这条债继续挂；标注也治不了「上下文少一个人」。

## Consequences

- 只放在英文目录的卡现在进入角色上下文；真实工作区的 `roles/major/苏晚星.md` 不再静默失效。
- 同名双卡会重复占上下文预算，并出现两个同名 `[role:…]` 块——这是源行为的直接后果；要合并需另立工作项并登记偏差。
- 行为细节：规范目录读失败（非 ENOENT）时会继续读同档位的别名目录，而不是放弃整个档位——与源「四个目录各自独立收集」一致，旧实现会整档放弃。
- 账本与证据：`cast.single-authority` 的 `source` 改为 `inkos:packages/core/src/utils/outline-paths.ts + …/references/reference-context.ts`；`artifacts/real-runs/cast.single-authority.json` 重录；`docs/scope.md` 的 AU-15 收窄为剩余子项（`roleCandidates`、上下文格式、空卡/读失败对照、真实回执），不整行关闭。
- `truth-files.ts` 的别名列表仍是字面量（`[...Object.values(ROLE_DIR_NAMES), 'major', 'minor']`），与本项新增的分组表存在重复；它属写入白名单、源行为一致，留在 AU-15 剩余子项处理，不夹带进本 PR。
- 真实 DSH 会话回执未取得（本环境不能重启宿主），记为 BLOCKED，不冒充已验证。
- Implementation Review 的两条实质发现已修：目录表未单一来源（`cast.ts` 另写字面量）与落地批次缺同步（ledger `source`、real-run、scope AU-15、fidelity 判定）。

## Testing

- `test/cast.test.mjs` 新增/改写：四目录各一张全读、只在 `roles/major`／`roles/minor` 的卡进上下文、同名双卡（同档位与跨档位）都读入、英文目录空卡报问题并带真实路径、原「同名即丢弃」用例改写成「同名读两次」。
- `test/stage-context.test.mjs`、`test/host.test.mjs`：角色档案注入不回归。
- `pnpm run verify`：见 `artifacts/real-runs/cast.single-authority.json` 的当前计数。
