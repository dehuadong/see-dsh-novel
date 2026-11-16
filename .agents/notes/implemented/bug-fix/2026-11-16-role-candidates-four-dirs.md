# Agent Note: plan.context-select —— planner／writer 的角色卡候选覆盖四个档位目录

Status: implemented

## Problem

章前规划的候选集与角色上下文口径不一致。`readCast` 现在读四个角色目录（`主要角色`、`次要角色`、`major`、`minor`），但候选生成只认两个中文目录：

- `packages/see-dsh-novel/src/core/context-package.ts` 的 `roleCandidates` 遍历 `Object.values(ROLE_DIR_NAMES)`，只列 `主要角色`／`次要角色`。
- 真实工作区 `E:\novelist\test-novel\t001`：角色上下文 12 张（含 `roles/major/苏晚星.md`），候选只有 11 张；写在英文目录的卡永远不能被 planner／writer 选中。

后果：作者或模型把人物档案写进 `roles/major`／`roles/minor` 时（源工程允许的档位目录），该卡能进上下文、能进确认摘要，却选不进本章上下文；规划阶段的「可选角色」与「已有角色」对不上。

## 源工程证据

- 源的候选枚举就是四个目录、**按「先两个中文档、再两个英文档」的平铺顺序**：`inkos/packages/core/src/agents/composer.ts:787` 的 `for (const tier of ["主要角色", "次要角色", "major", "minor"])`，逐个 `readdir`、文件名 `.sort()`，每个文件生成 `{ source: story/roles/<tier>/<file>, heading: 文件名去 .md, excerpt: 内容 trim }`；`ENOENT` 跳过、其它错误抛出（`:788-799`）。
- 之后由语义选择器挑子集，宿主只校验返回的 `source` 在候选里，未知 source 直接报错（`composer.ts:806-818`）。
- 角色卡的上下文读取面同样是四个目录（`inkos/packages/core/src/utils/outline-paths.ts:59-76`），与本仓库 2026-11-16 的 `readCast` 改动一致；候选面是当时漏掉的一半。

## Decision

- `context-package.ts` 的 `roleCandidates` 按源的平铺顺序枚举四个角色目录（`主要角色`、`次要角色`、`major`、`minor`），目录内按文件名排序；候选标题去掉 `.md`，`source` 仍为工作区相对路径，`id`／`selectionId` 为 `role:<source>`。
- `story-paths.ts` 增加 `ROLE_DIRS_IN_CANDIDATE_ORDER`：先中文两档、再英文两档；与按档位分组的 `ROLE_DIRS_BY_TIER`（人物档案用）共用同一份英文别名常量，两个顺序各自写明用途。
- 同名两份各自成候选、不去重；空卡不排除（源两者都不过滤）。
- 目录不存在按空处理；非 ENOENT 的目录级读失败照旧抛出。
- 不改 `readCast`、写入白名单、面板白名单、就绪判定、候选评分与分层、语义选择器协议。
## Design

- `story-paths.ts`：把英文别名提取为一个内部常量（`major: 'major'`／`minor: 'minor'`），`ROLE_DIRS_BY_TIER` 继续按档位分组供 `readCast` 使用；新增按源顺序平铺的目录表供候选枚举使用，两者派生自同一份别名常量。
- `context-package.ts`：`roleCandidates(root)` 改为遍历该平铺表，目录用 `join(root, STORY_ROLES_DIR, dirName)`；`source` 仍由 `relative(root, file)` 得到（自动带真实目录名）；删掉对 `ROLE_DIR_NAMES` 的依赖。其余字段（`id`、`selectionId`、`kind`、`excerpt`、`score`）不变；`title` 去掉 `.md` 后缀。
- 验证切入点：`test/context-package.test.mjs`——新用例自建别名目录（既有 `workspace()` 夹具只造中文目录，不能直接扩改，否则会打破「2 个候选」与 `protected` 的既有断言）；`pnpm run verify`。

## Alternatives considered

- **只列两个中文目录，要求作者把卡写进规范目录。** 最强理由：候选集永远与「规范写入」一致，不必处理别名目录。否掉：源枚举四目录，作者手写的 `major` 卡在源里可选；收紧等于自创限制，且与 `readCast` 已经读四目录的事实冲突。
- **按档位分组顺序枚举（复用 `ROLE_DIRS_BY_TIER`）。** 最强理由：与 `readCast` 共用一张表，少一个导出。否掉：顺序与源不同（`主要角色, major, 次要角色, minor`），而候选顺序会原样进选择任务、决定模型看到的人物排列；为省一个导出改变可见顺序不划算。
- **枚举四目录并对同名去重。** 最强理由：避免同名两份都进候选、重复占选择预算。否掉：源不去重，去重会改变候选数量与模型可选集合，需要作者裁决并登记偏差。
- **从 `story-index.ts` 的角色条目派生候选。** 最强理由：复用既有索引，少一次目录遍历。否掉：索引是检索面（分块、可搜），候选需要每张卡整段 `excerpt` 与稳定 `source`；派生会把两套语义绑在一起。

## Consequences

- 只放在英文目录的卡现在出现在 planner／writer 的候选里，可选、可进本章 `selectedContext`；规划与上下文两个口径一致。
- 候选数量变化会改变上下文模式判定：`buildSelectionTasks` 先用 `completeFits` 判断整包是否放得下，候选变多可能让原本「整包」的工作区转为语义选择。判定只看总量、与顺序无关；这与源一致（源同样全量枚举四目录），不是偏差，但会影响既有工作区的规划提示长度。
- 同名双卡会让模型看到两个同名候选；源行为如此，取舍留待作者裁决。
- 空卡仍会成为候选（`cast` 会把空卡报成问题）；源不排除空卡，本项保持一致。
- 账本与证据：`plan.context-select` 的 real-run 重录；`docs/scope.md` 的 AU-15 剩余项 1 与 AU-20 行、`docs/fidelity-audit.md` 里「`roleCandidates`…仍是 AU-15 剩余子项」那句、以及 `artifacts/implementation-audit/rows/plan.context-select.json` 的偏差与限制记录，同批收窄（本项只关闭「候选读四目录」，`readCharacterContext` 格式与真实回执仍在 AU-15 名下）；`docs/dsh-mapping.md` 无变化（无新偏差）。
- `truth-files.ts` 的写入白名单用 `[...Object.values(ROLE_DIR_NAMES), 'major', 'minor']`：中文名已共用常量，英文名仍是字面量。本项不动它（写入白名单属另一行），`story-paths.ts` 的别名常量也不强求它改；两条列表未来若漂移，属 AU-15 的剩余项。


## Risks

- 候选变多会占用选择提示的长度预算，并可能把工作区从「整包」推到「语义选择」；源同样如此，若需截断属消费层决定，不在本项。
- 新增命名（平铺目录表）与 `ROLE_DIRS_BY_TIER` 并存，未来改别名要改一处常量、两处派生；两者同源，派生关系需在注释里写明。
- 同名双卡会让模型看到两个同名候选；这是源行为，未去重。

## Testing

- `test/context-package.test.mjs`：四目录候选顺序（`主要角色→次要角色→major→minor`，目录内按文件名排序）、英文目录同名卡各自成候选且可选中、别名目录内排序、英文目录空卡仍成候选；既有「2 个候选」`protected`／trace 断言不回归。
- 本次改动前，只放在 `roles/major` 的卡不会出现在候选里；新用例在改动前失败、改动后通过。
- `pnpm run verify` 见 `artifacts/real-runs/plan.context-select.json` 的当前计数（600 tests／599 pass／1 skipped）。
- 真实 DSH 会话回执未取得（作者 2026-11-16 决定暂不重跑）：记 BLOCKED，待下次真实运行补。