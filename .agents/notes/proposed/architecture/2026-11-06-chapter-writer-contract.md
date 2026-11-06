# Agent Note: chapter.write —— writer 契约注入与标题规则

Status: proposed

## Problem（D16）

审计发现 `chapter.write` 只落盘，writer 子代理的提示由主编临场拼。源工程 `agents/writer.ts` 的 `buildWriterSystemPrompt` 固定包含六段：

1. 作品身份（题材、平台、语言）；
2. 权威顺序（当前指令与 memo 决定本章；既成事实、禁令、已选上下文、真实 hook id 必须保留；卷纲只在无冲突时兜底；memo 每项要求都要落地；不重复开 hook、不改叙事承诺）；
3. 字数契约（用户目标字数，保持场景完整，不机械注水或裁切）；
4. 叙事人称（`bookRules.narrativePerson` 存在时，持久约束优先于模型默认）；
5. 主角权威（`protagonist` 的名字、性格锁、行为约束，以及全书禁忌）；
6. 权威文本块：`book_rules.md` 与 `style_guide.md` 全文。

标题规则：writer 工具提交的 `title` 不含章号前缀，章号由宿主在章节文档头里加。

复刻侧这六段都没有稳定注入，标题也没有拒绝章号前缀。

## Proposal

### writer 契约：`src/pipelines/long/stages/writer.ts`

`renderWriterContract(root)`（同步读盘）：

- 读 `work.json`：题材、平台、语言、目标章数、每章字数（缺省用语言默认章长）；
- 读 `source/story/book_rules.json`（严格解析）：`narrativePerson`、`protagonist`、`prohibitions`；
- 读 `source/story/book_rules.md` 与 `source/story/style_guide.md`（存在时整份进入权威块）；
- 读当前章的 `chapter-XXXX.intent.md`（`loadChapterPlan` 的等价同步读）与 plan body，作为「本章章纲」；
- 输出六段固定顺序的文本（中文作品中文、英文作品英文），空段省略。

### 注入与标题

- `installStageContext` 的 `story:stage` 在 `write` 阶段把 writer 契约拼在协议之后；
- `story_write_chapter` 增加标题校验：`title` 不得以 `第N章`／`Chapter N` 开头（大小写不敏感），否则拒绝并提示「标题不要带章号前缀」。

### 上下文来源

契约里的「已选上下文」指本行可读取的章纲与方向文档；完整 `ContextPackage` 的注入依赖 `plan.context-select` 的后续债（D11），本行不假装已有。

## Alternatives considered

**把 writer 契约写成技能。** 否掉：六段是阶段契约（权威、字数、人称、主角、规则、风格），不是创作方法；方法仍由 `longform-writing` 注入。

**每轮让主编拼契约。** 否掉：审计发现的正是这个不稳定点。

**标题由宿主统一生成。** 否掉：源工程由 writer 提交标题（不含章号），宿主只加文档头。

## Acceptance criteria

- `write` 阶段 `story:stage` 文本含：权威顺序、字数（目标与「保持场景完整」）、叙事人称（有则）、主角权威（有则）、`book_rules.md` 正文、`style_guide.md` 正文（存在时）、本章章纲。
- 无 `narrativePerson`／`protagonist`／`style_guide` 时对应段落省略，不输出空标题。
- 英文作品输出英文六段。
- `story_write_chapter` 拒绝以 `第1章`／`Chapter 1` 开头的标题，且不落盘。
- 测试：`test/writer-contract.test.mjs` 覆盖六段、缺省省略、英文版；`test/chapter-document.test.mjs` 或工具测试覆盖标题前缀拒绝。
- 真实运行：在 write 阶段工作区发一句「列出你收到的 writer 契约六段与本章字数目标」，逐项核对。
- 实现与证据：implementation `packages/see-dsh-novel/src/pipelines/long/stages/writer.ts`；consumer `packages/see-dsh-novel/test/writer-contract.test.mjs`；realRun `artifacts/real-runs/chapter.write.json`（重录）。

## Risks

- writer 契约增加 write 阶段上下文约 1–3KB（book rules／style guide 全文）；
- 完整上下文包注入仍未解决（D11），契约里只列出可读来源；
- 规则卡损坏时对应段省略并保留其余段，不阻断写作。
