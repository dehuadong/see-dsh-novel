# Agent Note: chapter.write —— writer 契约注入与标题规则

Status: implemented

## Problem（D16）

审计发现 `chapter.write` 只落盘，writer 子代理的提示由主编临场拼。源工程 `agents/writer.ts` 的 `buildWriterSystemPrompt` 固定包含：作品身份、权威顺序、字数、叙事人称、主角权威（含全书禁忌）、`book_rules.md` 与 `style_guide.md` 权威块；标题由 writer 提交且不含章号前缀。

## Decision

`packages/see-dsh-novel/src/pipelines/long/stages/writer.ts` 的 `renderWriterContract(root)`（同步读盘）：

- 读 `work.json`（语言、目标字数，缺省回退语言默认章长）；
- 读 `source/story/book_rules.json` 的 `narrativePerson`／`protagonist`／`prohibitions`；
- 读 `book_rules.md`、`style_guide.md`（存在时整份进入权威块）；
- 读当前章（`current_state.chapter + 1`）的 plan 与 `intent.md` 作为「本章章纲」；
- 输出固定顺序六段：权威顺序、字数、叙事人称、主角权威、本书规则、风格指南、本章章纲；空段省略；中英两版。

`stages/index.ts` 在 `write` 阶段把契约拼在阶段协议之后，与 foundation 的架构契约同一注入路径。

`story_write_chapter` 拒绝以 `第N章`／`Chapter N` 开头的标题（大小写不敏感），章号前缀由章节文档头提供。

## Alternatives considered

**写成技能。** 否掉：六段是阶段契约，方法仍由 `longform-writing` 注入。

**主编每轮手拼。** 否掉：审计发现的正是这个不稳定点。

**宿主统一生成标题。** 否掉：源工程由 writer 提交标题，宿主只加文档头。

## Consequences

收益：write 阶段每轮都能看到六段 writer 契约与本章字数目标；标题不再重复章号前缀。

验证见 `test/writer-contract.test.mjs`（中文六段、缺省省略、英文版）与 `test/stage-context.test.mjs`（write 阶段含权威顺序与字数）。

代价与已知限制：

- write 阶段上下文增加约 1–3KB（book rules／style guide 全文）；
- 完整 `ContextPackage` 仍未注入（D11）；契约只列可读来源与章纲；
- `book_rules.json` 损坏时主角／人称段省略，其余段保留。
