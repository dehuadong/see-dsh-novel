# 保真审计

逐行对照源工程行为与复刻行为。判定只有三种：`等价`、`机制等价`（必须带 `docs/dsh-mapping.md` 偏差行）、`保真债`（必须带 `docs/scope.md` 偿还行）。

审计范围：账本中全部 `verified` 行与待验行；按 P0 → P1 → P2 → P3 分批。

---

## 批次 A：P0 提案与建书

### proposal.creative（提案确认卡）

**源工程证据**

- `agent/agent-tools.ts` 的 `propose_action`：`instruction`（必填、自包含）、`title`（必填）、`summary`（必填），`createBook` 为嵌套对象：`title`、`genre?`、`platform?`、`language?`、`targetChapters?`、`chapterWordCount?`、`minChapterLength?`、`maxChapterLength?`；
- `harness/tools/longform-production.ts` 的 `create_book`：`instruction` 必填；`title` 可选；`bookId`、`genre`、`platform`、`language`、`targetChapters`、`chapterWordCount`、`minChapterLength`、`maxChapterLength`；
- 确认卡：标题、摘要、instruction，作者确认后才执行。

**可验证不变量**

1. `instruction` 必填且自包含（标题、方向、目标与输出位置）。
2. `title`、`summary` 必填；卡片展示标题、摘要与 instruction。
3. 书目标规模字段包含总章数、单章字数、最小/最大章长。
4. 平台与篇幅必须进结构化字段，不能只留在 instruction 文本里。
5. 确认前不落盘。

**复刻现状**

- `core/proposal.ts`：`title`／`summary`／`instruction` 必填；卡片含标题、题材、平台、语言、规模与 instruction；
- 规模只有 `chapters`／`chapterWords`；无 `minChapterLength`／`maxChapterLength`；
- 字段是扁平的（`story_propose` 参数），没有 `createBook` 嵌套结构。

**判定：保真债**

- D1：缺 `minChapterLength`／`maxChapterLength`（源工程显式支持的范围约束）；偿还：`proposal.creative` 行补齐字段与落盘透传。
- D2：源工程的 `createBook` 嵌套结构被扁平化；DSH 工具 schema 支持嵌套对象，不存在机制强制；偿还：同 D1 一行内改为嵌套或补登偏差（二选一，需裁决）。

### proposal.execution-brief（执行说明与默认规模）

**源工程证据**

- `create_book` 的 `instruction` 是确认后要执行的原文；`runner.ts` 把 `externalContext` 写入 `story/brief.md`（原文）；
- `book/chapter` 默认：`chapterWordCount` 缺省按语言默认（中文 3000、英文 2000），`targetChapters` 缺省 200。

**可验证不变量**

1. `instruction` 原文写进 `story/brief.md`。
2. 缺省规模在批准时补齐，不在提案卡上编造。
3. `author_intent` 与 `current_focus` 按方向文档播种。

**复刻现状**

- `initWork` 一次提交写 `work.json`、`source/story/brief.md`（instruction 原文）、`author_intent`（trimEnd + 换行）、`current_focus`；
- 批准时补 `targetChapters ?? 200`、`chapterWordCount ?? defaultChapterLength(language)`。

**判定：等价**（规模字段的 `min/max` 债记在 `proposal.creative`）。

### runtime.commands（建书命令）

**源工程证据**

- `packages/cli/src/commands/book.ts` 的 `book create`：
  - `--title <title>` 必填；
  - `--genre` 默认 `xuanhuan`；
  - `--platform` 默认 `tomato`；
  - `--target-chapters` 默认 `200`；
  - `--chapter-words` 默认 `3000`；
  - `--brief <path>` 读文件作为 `externalContext`；
  - `--lang` 缺省由题材决定。

**可验证不变量**

1. 标题必填。
2. 未给规模时落 200 章 × 3000 字。
3. `--brief` 读文件，内容作为外部上下文。
4. 缺省题材/平台有源工程的默认值（xuanhuan／tomato），或明确登记为 DSH 命令的偏差。

**复刻现状**

- `/story-init`：位置参数标题、`--lang`／`--chapters`／`--words`／`--genre`／`--platform`／`--brief`；
- 缺省规模 200／3000；
- `--genre`／`--platform` 无默认值；`--brief` 相对工作区根读文件。

**判定：保真债**

- D3：选项名与源 CLI 不一致（`--target-chapters`／`--chapter-words` vs `--chapters`／`--words`）；CLI → DSH command 本身已登记为偏差，但选项名可在命令内兼容，不需新机制；偿还：`runtime.commands` 行补别名并同步文档与测试。
- D4：缺省题材/平台未对齐（源 `xuanhuan`／`tomato`）；偿还：同 D3。
- D5：`--brief` 的路径基准从进程 cwd 改为工作区根——已登记为机制等价偏差（`docs/dsh-mapping.md`）。

---

## 后续批次

- 批次 B（P1）：`foundation.*`、`runtime.commit-safety`、`runtime.stage-context`；
- 批次 C（P2）：`plan.*`；
- 批次 D（P3）：`chapter.write`、`chapter.review`。

每批完成后补齐本节并将债写入 `docs/scope.md`。
