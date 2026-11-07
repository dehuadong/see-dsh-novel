# Agent Note: foundation.ready-check —— 就绪判据对齐源工程

Status: proposed

## Problem（D7）

审计发现就绪判据与源工程不一致：

- 源 `utils/outline-paths.ts` 的 `isBookFoundationComplete` 要求：`book.json`、`story/outline/story_frame.md`、`story/outline/volume_map.md`、`story/book_rules.md`、`story/book_rules.json`、`story/pending_hooks.md`，且 `roles/主要角色` 或 `roles/次要角色` 至少一张卡；
- 复刻 `workProbes` 要求 story_frame、volume_map、book_rules.md、**current_state.md**、pending_hooks.md、**chapter_summaries.md** + 角色卡，**没有 book_rules.json**。

结果是：缺规则数据的作品会被判「就绪」，而状态/摘要文件反而成了阻塞项。

## Proposal

### 判据

`core/work.ts` 的就绪文件集改成与源一致：

- `source/story/outline/story_frame.md`
- `source/story/outline/volume_map.md`
- `source/story/book_rules.md`
- `source/story/book_rules.json`
- `source/story/pending_hooks.md`
- 至少一张角色卡（主要或次要目录）

`current_state.md` 与 `chapter_summaries.md` 仍是基础设定产物与阶段上下文来源，但**不再作为就绪门槛**。

`work.json` 对应源的 `book.json`，沿用现有的存储映射，不新增文件。

### 阶段判定

`stages/index.ts` 的同步探针使用同一组文件：`foundation` 阶段在规则数据或缺角色卡时保持；`plan` 阶段只在六类文件齐全、规则数据可读时进入。

### 工具与投影

- `story_next` 的 `foundation`／`ready` 判定随 `workProbes` 变化；
- `story_gate` 的文件计数与摘要不受影响；
- `story_foundation_details` 已写 `book_rules.json`，无需改写入侧。

## Alternatives considered

**保留 current_state／chapter_summaries 作为门槛。** 否掉：源工程不以它们判就绪；它们的缺失由对应工具补，不应阻塞签核。

**只加 book_rules.json，不删多余门槛。** 否掉：多出的门槛仍会让「源工程认为就绪」的作品停在 foundation。

**把状态文件写进 book_rules.json。** 否掉：文件职责不同，源工程是分开的。

## Acceptance criteria

- `workProbes` 在「五份文件 + 至少一张卡」时 `ready`，缺 `book_rules.json` 时未就绪，只有 `current_state.md`／`chapter_summaries.md` 缺失时仍 `ready`。
- `stages` 的同步阶段判定与 `workProbes` 一致：缺规则数据 → `foundation`；齐 → `plan`。
- 过渡：已有作品若因本次收紧从 `ready` 落回 `foundation`，`story_next` 明确指出缺 `book_rules.json` 并可用 `story_truth_file` 补写。
- 测试：`test/ready-check.test.mjs` 更新文件集与两类边界（缺 json、缺状态文件）；`test/stage-context.test.mjs` 的 foundation 夹具补 `book_rules.json`。
- 真实运行：在只有基础设定（无 plan、无正文）的工作区调 `story_next`，回执 `ready`；删除 `book_rules.json` 后再调，回执 `foundation` 并点名缺失文件。
- 实现与证据：implementation `packages/see-dsh-novel/src/core/work.ts`；consumer `packages/see-dsh-novel/test/ready-check.test.mjs`；realRun `artifacts/real-runs/foundation.ready-check.json`（重录）。

## Risks

- 已有 `verified` 作品可能因缺 `book_rules.json` 回到 `foundation`；这是正确行为，需要在回执里说明补写路径。
- 状态与摘要不再参与就绪判断，签核后若缺失，规划阶段必须自行报错；`plan` 阶段契约已要求章纲与上下文，不依赖它们存在。
