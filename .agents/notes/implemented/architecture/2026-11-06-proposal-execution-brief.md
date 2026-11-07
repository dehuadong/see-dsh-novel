# Agent Note: proposal.execution-brief —— instruction 与默认规模

Status: implemented

## Problem

复刻的提案只收标题、摘要与可选的章数字数，批准后写一份没有意图、没有规模基线的身份文件。源工程的长篇建书入口（`harness/tools/longform-production.ts:24-36`、`:135-155`）有两处复刻缺失：

- **instruction**：`create_book` 必填 `instruction`，作为 `externalContext` 传给 `initBook`；初始化把外部上下文写进 `story/brief.md`（`pipeline/runner.ts:493-500`），并把它作为 `author_intent` 的兜底（`runner.ts:498-502`）；
- **默认规模**：`targetChapters` 缺省 200，`chapterWordCount` 缺省按语言取 `defaultChapterLength`（中文 3000、英文 2000；`longform-production.ts:135-155`、`utils/length-metrics.ts`）。

复刻的提案没有 instruction，批准后也没有规模基线；`source/story/brief.md` 与 `author_intent` 都不会出现。缺目标章数会让后续卷/章规划无据可依。

## Decision

### instruction 进入提案

`story_propose` 增加必填 `instruction`，与源工具同名同义：

- 校验：字符串且 trim 后非空；
- 确认卡按源格式：标题、摘要、空行、`Instruction: <原文>`；
- 批准时：`work.json` 与 `source/story/brief.md`（instruction 原文）同一次提交写入；同时按源行为把 instruction 作为 `author_intent` 的兜底（`controlDocumentWrites` 的 `authorIntent` 参数重新引入，只在建书时传），`current_focus` 仍写默认模板；
- 拒绝/取消：什么都不写。

### 默认规模

新增 `core/length.ts`：`DEFAULT_CHAPTER_LENGTH_ZH = 3000`、`DEFAULT_CHAPTER_LENGTH_EN = 2000`、`defaultChapterLength(language)`。

提案批准时（对齐 `create_book`）：

- `createBook.targetChapters ?? 200`；
- `createBook.chapterWordCount ?? defaultChapterLength(language)`；
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

## Consequences

收益：提案与命令两条建书入口都有了「作者确认后要执行的那句话」与规模基线。提案卡片按源格式多一段 `Instruction: …`；批准时同一次提交写 `work.json`、`source/story/brief.md`、`author_intent`（instruction 兜底）与 `current_focus` 默认模板；章数缺省 200，单章字数中文 3000、英文 2000。`/story-init` 不带规模参数时按 CLI 的 200／3000 落盘。

落地：`packages/see-dsh-novel/src/core/length.ts`、`src/core/proposal.ts`（instruction 与默认规模、卡片）、`src/plugin/proposal-tool.ts`（`createWork` + 外部上下文 + 方向兜底）、`src/core/control-docs.ts`（可选的 `authorIntent`）、`src/core/work.ts`（`createWork` 的 `extraWrites`）、`src/plugin/work-command.ts`（命令默认规模）、`src/core/story-paths.ts`（`STORY_EXTERNAL_BRIEF`）。

验证见 `test/proposal.test.mjs`（instruction 必填、卡片、默认规模、brief/author_intent/current_focus、拒绝不写盘）、`test/work-command.test.mjs`（命令默认 200／3000）、`test/length.test.mjs`。

### 代价与已知限制

- `proposal.creative` 的旧回执描述「只有 work.json、没有 source/」；本行落地后重跑一次提案批准并更新该回执。
- `/story-init` 的默认规模证据补在 `runtime.commands` 的回执里（新增「不带规模参数」一例）。
- `source/story/brief.md` 的读取方是 P2 的外部上下文，目前只有写方与字节校验。
- `authorIntent` 只为建书路径重新引入；读取路径不传它。
