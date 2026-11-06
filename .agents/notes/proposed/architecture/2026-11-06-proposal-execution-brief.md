# Agent Note: proposal.execution-brief —— instruction 与默认规模

Status: proposed

## Problem

复刻的提案只收标题、摘要与可选的章数字数，批准后写一份没有意图、没有规模基线的身份文件。源工程的长篇建书入口（`harness/tools/longform-production.ts:24-36`、`:135-155`）有两处复刻缺失：

- **instruction**：`create_book` 必填 `instruction`，作为 `externalContext` 传给 `initBook`；初始化把外部上下文写进 `story/brief.md`（`pipeline/runner.ts:493-500`），并把它作为 `author_intent` 的兜底（`runner.ts:498-502`）；
- **默认规模**：`targetChapters` 缺省 200，`chapterWordCount` 缺省按语言取 `defaultChapterLength`（中文 3000、英文 2000；`longform-production.ts:135-155`、`utils/length-metrics.ts`）。

复刻的提案没有 instruction，批准后也没有规模基线；`source/story/brief.md` 与 `author_intent` 都不会出现。缺目标章数会让后续卷/章规划无据可依。

## Proposal

### instruction 进入提案

`story_propose` 增加必填 `instruction`，与源工具同名同义：

- 校验：字符串且 trim 后非空；
- 确认卡按源格式：标题、摘要、空行、`Instruction: <原文>`；
- 批准时：`work.json` 与 `source/story/brief.md`（instruction 原文）同一次提交写入；同时按源行为把 instruction 作为 `author_intent` 的兜底（`controlDocumentWrites` 的 `authorIntent` 参数重新引入，只在建书时传），`current_focus` 仍写默认模板；
- 拒绝/取消：什么都不写。

### 默认规模

新增 `core/length.ts`：`DEFAULT_CHAPTER_LENGTH_ZH = 3000`、`DEFAULT_CHAPTER_LENGTH_EN = 2000`、`defaultChapterLength(language)`。

提案批准时（对齐 `create_book`）：

- `targetChapters = chapters ?? 200`；
- `chapterWordCount = chapterWords ?? defaultChapterLength(language)`；
- 写进 `work.json` 的 `metadata`；作者显式给值时用作者的。

`/story-init` 命令也补默认（对齐 CLI `book create`：固定 200／3000，不按语言分）；作者显式给值时用作者的。

### 与已落地部分的关系

- 确认通道与卡片渲染由 `proposal.creative` 拥有；本行只加 instruction、默认规模与建书时的两份文件（`story/brief.md`、`author_intent` 兜底）；
- `foundation.control-docs` 的 `controlDocumentWrites` 重新接受可选 `authorIntent`（只在建书时传），它的读取路径与默认模板行为不变；
- `proposal.creative` 的真实运行回执（当时「只有 work.json、没有 source/」）先于本行；本行落地时同批重跑一次提案批准的真实运行，并把 `artifacts/real-runs/proposal.creative.json` 更新到新行为（session、文件清单、回执），不留下过期证据。
- `/story-init` 的默认规模属于 `runtime.commands` 行（implementation `work-command.ts`、consumer `work-command.test.mjs`）；`artifacts/real-runs/runtime.commands.json` 原只有显式 90／2800 与「缺少标题」两例，本行落地时补一条「不传规模」的会话证据并把回执更新。

## Alternatives considered

**instruction 可选，缺省用 summary。** 少一个必填字段。否掉：源工程要求 instruction 自包含（标题、方向、目标、输出目录等），summary 说的是「确认后会发生什么」，两者不是一件事。

**instruction 存进 `metadata.intent`（create_work 的槽）。** 少写一份文件。否掉：`create_work.intent` 是作者立意，落 `source/brief.md`；`create_book.instruction` 是外部上下文，落 `source/story/brief.md` 并兜底 author_intent。两个槽不能混用，否则 foundation 会把「待执行的那句话」当成立意。

**默认规模只放 `story_work_create`。** 改动少。否掉：源工程的默认在 `create_book` 的 book 配置里；提案批准是更常用的建书入口，只在另一入口补会让经提案立项的作品没有基线。

**把 instruction 直接拼进摘要。** 少改卡片。否掉：源卡片单独一行 `Instruction:`；拼进摘要会让作者分不清「将来执行的那句话」与「确认后发生什么」。

## Acceptance criteria

- `story_propose` 缺 `instruction` 或只有空白时拒绝，且不写盘；卡片包含 `Instruction: <原文>` 一行。
- 批准后：`work.json` 的 `metadata.targetChapters` 默认 200、`metadata.chapterWordCount` 中文 3000／英文 2000；作者显式给值时用作者的值。
- 批准后：`source/story/brief.md` 与 instruction 逐字一致；`source/story/author_intent.md` 是 `instruction.trimEnd() + "\n"`（instruction 为空白时不可能出现，校验已拒绝）；`current_focus.md` 是语言默认模板。
- `work.json` 的 `metadata.intent` 不因本行变化（它属于 `story_work_create` 的 `intent`）。
- `test/proposal.test.mjs` 同批更新（instruction、默认规模、brief、author_intent）；新增 `test/length.test.mjs`；`test/work-command.test.mjs` 里 `/story-init` 的默认规模用例同批更新，`test/host.test.mjs` 的命令名/参数断言如受影响一并调整。
- `source/story/brief.md` 的路径常量进 `story-paths.ts`（`STORY_EXTERNAL_BRIEF`）；它的读取方是 P2 的外部上下文，不在本行，`docs/scope.md` 的 P2 说明写明。
- 实现与证据：implementation `packages/see-dsh-novel/src/core/proposal.ts` 与 `src/core/length.ts`；consumer `packages/see-dsh-novel/test/proposal.test.mjs`；写入路径在 `src/plugin/proposal-tool.ts`、`src/core/work.ts`（`createWork` 的额外写入）、`src/core/control-docs.ts`（`authorIntent` 兜底）与 `src/plugin/work-command.ts`（`/story-init` 默认规模）；realRun `artifacts/real-runs/proposal.execution-brief.json`。
- 真实运行：空工作区会话里调 `story_propose`（带 instruction）并批准，核对 `work.json` 的默认规模、`source/story/brief.md`、`author_intent` 与 `current_focus`；同一次运行更新 `proposal.creative` 的回执；再用缺 instruction 的调用确认被拒绝。

## Risks

- `proposal.creative` 的旧回执描述「只有 work.json、没有 source/」，与本行落地后的行为不一致；它证明的是确认通道，本行在其之上改写了写盘内容，差异在本行记录。
- `authorIntent` 参数从 control-docs 的读取路径上消失过一次，本行只为建书重新引入；读取路径不传它。
- 默认规模与源实现硬编码一致；改默认值需要源工程同步。
- instruction 原文进入卡片，过长时确认条会变长；源工程同样不截断。
