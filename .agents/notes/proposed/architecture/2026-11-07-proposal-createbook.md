# Agent Note: proposal.creative —— 提案字段对齐 createBook 与章长范围

Status: proposed

## Problem（D1／D2）

审计发现 `story_propose` 与源工程的 `propose_action` 不一致：

- 源 `propose_action`：顶层 `instruction`／`title`／`summary` 必填；`createBook` 是**嵌套对象**：`title`、`genre`、`platform`、`language`、`targetChapters`、`chapterWordCount`、`minChapterLength`、`maxChapterLength`；
- `create_book` 工具同样接受 `minChapterLength`／`maxChapterLength`；
- 复刻把字段扁平化，且没有最小／最大章长。

扁平化不是 DSH 机制强制（工具 schema 支持嵌套对象），最小／最大章长是源工程显式支持的产品字段。

## Proposal

### 提案工具

`story_propose` 参数改成：

```
{ title, summary, instruction, createBook: { title, genre?, platform?, language?, targetChapters?, chapterWordCount?, minChapterLength?, maxChapterLength? } }
```

- 顶层 `title`／`summary`／`instruction` 必填，`instruction` 自包含；
- `createBook` 必填（本工具只做 create_book）；`createBook.title` 非空；
- `targetChapters` 缺省 200；`chapterWordCount` 缺省按语言（中文 3000、英文 2000）；
- `minChapterLength`／`maxChapterLength` 若同时给出，`min <= max`，否则拒绝。

### 作品身份与落盘

`WorkMetadata` 增加可选 `minChapterLength`／`maxChapterLength`；`createWork` 与 `initWork` 透传；提案批准后写入 `work.json` 的 `metadata`。其余落盘（brief、author_intent、current_focus）不变。

### 调用方

- `skills/story-proposal/SKILL.md` 改成描述嵌套 `createBook`，并说明「作者明确给了章长区间时要落到 min/max」；
- 阶段协议 `proposal` 的调用说明同步；
- 工具描述说明四文件写入与字段结构。

### 不做

- 命令行入口不新增 `--min/--max`：源 CLI 的 `book create` 也没有这两个选项；
- 提案卡不展示 min/max（源卡片是 title／summary／instruction），字段只落盘。

## Alternatives considered

**保留扁平字段，只加 min/max。** 少改测试。否掉：源 schema 是嵌套 `createBook`；扁平化是审计确认的结构债。

**顶层同时接受扁平与嵌套。** 兼容旧调用。否掉：两套形状会让校验与文档分叉；工具只在预设内使用，没有外部兼容负担。

**把 min/max 默认成固定值。** 否掉：作者没给就是没有约束，不能自创产品限制。

## Acceptance criteria

- 合法提案：`story_propose({title, summary, instruction, createBook:{title, genre, platform, language, targetChapters, chapterWordCount, minChapterLength, maxChapterLength}})` 打开确认卡；批准后 `work.json` 的 `metadata` 含八个字段（含 min/max）。
- 缺 `createBook`、`createBook.title` 为空、`min > max`、负数章长时拒绝且不落盘。
- 缺省 `targetChapters`／`chapterWordCount` 仍为 200／语言默认；卡片文案不变（标题、分类语言规模、摘要、instruction）。
- 测试：`test/proposal.test.mjs` 改嵌套形状并补 min/max 与拒绝；`test/work-command.test.mjs` 不回归。
- 真实运行：在空工作区提案 `createBook` 含 `minChapterLength 2200`／`maxChapterLength 2800`，批准后核对 `work.json` 与四个文件。
- 实现与证据：implementation `packages/see-dsh-novel/src/core/proposal.ts`；consumer `packages/see-dsh-novel/test/proposal.test.mjs`；realRun `artifacts/real-runs/proposal.creative.json`（重录）与 `proposal.execution-brief.json`（重录）。

## Risks

- 工具参数形状变化会让旧提示词失效；技能与阶段协议同批更新。
- `min/max` 只落盘，尚无消费方（写作与审阅的篇幅判断仍是后续能力），本行不假装它们已生效。
- 提案卡不显示区间，作者只能从 instruction 看到；卡片字段若需要展示，属面板能力。
