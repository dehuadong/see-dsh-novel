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

## 批次 B：P1 基础设定与运行时

### foundation.architect

**源工程证据**：`agents/architect-tool.ts` 的四段 schema；`agents/architect.ts` 用 `buildFoundationProtocol` 组装 system prompt（book、外部指令 contextBlock、review feedback、语言前缀），并以 temperature 0.8 分阶段生成。

**可验证不变量**：四段字段（storyFrame／volumeMap；bookRules＋bookRulesData＋pendingHooks；cast index 至少一人；每卡一段文本）；architect 的 system prompt 含作品身份、外部指令、反馈与「不写正文」约束；基础设定缺任一段不算完成。

**复刻现状**：四段 tool schema 与源一致（`contract.ts`）；阶段协议只列四段顺序，**没有移植 architect 的 system prompt**（作品身份、外部指令、反馈块）。

**判定：保真债** — D6：architect system prompt 未注入；feedback／revise 提示也未实现。偿还：`foundation.architect` 行补阶段注入的 architect 契约文本。

### foundation.ready-check

**源工程证据**：`utils/outline-paths.ts` 的 `isBookFoundationComplete`：`book.json`、`story/outline/story_frame.md`、`volume_map.md`、`book_rules.md`、`book_rules.json`、`pending_hooks.md`，且任一角色目录至少一张卡。

**可验证不变量**：就绪 = 六类文件 + 至少一张角色卡；缺 `book_rules.json` 不算就绪。

**复刻现状**：`workProbes` 要求 story_frame、volume_map、book_rules.md、current_state.md、pending_hooks.md、chapter_summaries.md + 角色卡；**没有 `book_rules.json`**，多了 current_state 与 chapter_summaries。

**判定：保真债** — D7：就绪判据与源不一致；偿还：`foundation.ready-check` 行改成源的文件集（book.json 的对应物是 work.json，按存储映射处理）。

### foundation.control-docs

**源工程证据**：`manager.ts` 的 author_intent／current_focus 兜底；brief 原文进入外部上下文。

**可验证不变量**：文件缺失时写默认模板；author_intent 按 instruction 播种；current_focus 是默认聚焦文本。

**复刻现状**：`controlDocumentWrites` 的 author_intent 兜底与源逐字一致；current_focus 默认模板与测试覆盖。

**判定：等价**。

### foundation.hook-ledger

**源工程证据**：`models/runtime-state.ts` 的 Hook 字段（hookId、type、startChapter、status、lastAdvancedChapter、expectedPayoff、notes、dependsOn?、paysOffInArc?）。

**可验证不变量**：字段与可选性一致；未知字段拒绝；hookId/type 非空。

**复刻现状**：`core/hooks.ts` 字段一致，严格校验与测试覆盖。

**判定：等价**。

### foundation.rule-contract

**源工程证据**：`models/book-rules.ts`：`version: "2"`、严格对象、可选 protagonist／genreLock／narrativePerson／fanficMode、必填 prohibitions／enableFullCastTracking／allowedDeviations。

**可验证不变量**：写入时注入 version；读取严格校验未知字段。

**复刻现状**：`pipelines/long/book-rules.ts` 的版本与字段一致；测试覆盖严格解析。

**判定：等价**。

### foundation.truth-write

**源工程证据**：`interaction/truth-authority.ts` 的 8 个真值文件（author_intent、current_focus、outline 两份、book_rules、current_state、pending_hooks、chapter_summaries）。

**可验证不变量**：只允许写这 8 个文件；文件名大小写归一；未知文件拒绝。

**复刻现状**：`core/truth-files.ts` 的允许列表除 8 个外还含 `style_guide.md`、`parent_canon.md`、`fanfic_canon.md`。

**判定：保真债** — D8：允许列表比源宽；偿还：`foundation.truth-write` 行对齐 8 个文件，其余走各自能力。

### foundation.truth-projections

**源工程证据**：`state` 投影（current_state／pending_hooks／chapter_summaries）的列、排序与转义。

**可验证不变量**：排序稳定、文本转义、末尾换行；缺数据时输出表头。

**复刻现状**：`core/state-projections.ts` 有对应渲染与测试。

**判定：等价**（列集以测试为准）。

### runtime.commit-safety

**源工程证据**：`utils/atomic-file-set.ts`：事务目录前缀 `.inkos-file-txn-`；journal `{version:1,pid,phase:prepared|committed,entries:[{path,existed}]}`；按根串行化；失败回滚。

**可验证不变量**：journal 先于备份；existed 决定回滚删除/恢复；phase 两阶段；同根串行；崩溃后按 journal 恢复。

**复刻现状**：`core/commit.ts` 的 journal 字段与串行化一致；事务目录前缀是 `.staging-`。

**判定：保真债** — D9：事务目录前缀与源不同（磁盘可见）；偿还：`runtime.commit-safety` 行改为源前缀。

### runtime.stage-context

**源工程证据**：各角色在调用点组装 system prompt（architect／writer／planner／reviewer），方法来自已激活 Skill。

**可验证不变量**：方法随阶段注入；协议随阶段切换；同一阶段不出现别阶段协议。

**复刻现状**：`stages/index.ts` 注册 `story:stage`／`story:craft`，按工作区阶段注入。

**判定：机制等价**（DSH 用 `systemPrompt.context()` 替代源调用点拼装；已在 `docs/dsh-mapping.md`「方法注入」行登记）。

## 批次 C：P2 章前规划

### plan.retrieval

**源工程证据**：`retrieval/local-search.ts` 的 `retrieval_documents`（scope、kind、source、title/body 与各自 tokens、metadata、content_hash）、FTS5 索引、BM25 排序、`buildMatchQuery` 的分词规则。

**复刻现状**：`core/search-index.ts` 用 `retrieval_documents` + `retrieval_fts`，按 scope/kind 过滤、BM25 排序、内容哈希增量；CJK 用逐字加空格 + 短语匹配（源是 unicode61 分词）；文档类型只有 hook／summary／role／material／outline。

**判定：保真债** — D10：分词与文档类型与源不同（CJK 逐字 vs unicode61；缺 skill 参考资料等 scope）。偿还：`plan.retrieval` 行对齐分词与来源类型。

### plan.context-select

**源工程证据**：`agents/composer.ts` 的固定来源（方向、风格指南、大纲、上一章、runtime chapter memo、parent/fanfic canon）、四个选择器（memory／role／state／outline）、预算与 `ChapterTrace` 七字段。

**复刻现状**：`core/context-package.ts` 用**一个** composer 指令做四类选择，protected 只有 current_focus／author_intent／大纲；无 style_guide、上一章正文、chapter_memo、parent/fanfic canon；trace 有七字段但 retrieval 候选结构与源不同。

**判定：保真债** — D11：固定来源缺项；D12：四个选择器合并为一个子代理任务（源是同一 ComposerAgent 的四类选择，但上下文与提示分开）；偿还：`plan.context-select` 行补齐固定来源与选择提示。

### plan.compression

**源工程证据**：`composer.ts` 用模型 context window 计算可用输入预算，超预算时用 LLM 压缩 compressible，protected 超预算直接报错，压缩结果写 trace.compression。

**复刻现状**：`assembleContext` 的预算来自调用方传入的 `contextWindowTokens`／`reservedOutputTokens`；压缩文本由调用方传入；protected 超预算报错一致；trace.compression 六字段一致。

**判定：保真债** — D13：窗口与压缩文本由调用方手填，宿主没有从模型信息推导窗口、也没有把 compressible 交给子代理压缩的固定路径。偿还：`plan.compression` 行接模型窗口并固定压缩任务协议。

### plan.chapter

**源工程证据**：`agents/planner.ts` 的 system prompt（"把 governed context 编译为章节 memo，不写正文，方法来自 Skill"）、user message 分段（指令／上下文／上一章／字数遥测）、memo 三字段、intent 投影；`runner.ts` 按持久进度取下一章、可复用已存 plan。

**复刻现状**：memo 三字段与 intent 投影一致；规划方法与流程在 `story:stage`／`story-plan`；**没有 planner system prompt 与 user message 的注入**；章节连续性按 `current_state.chapter + 1`，已有 plan 拒绝（源可复用）。

**判定：保真债** — D14：planner 提示词未注入；D15：重规划／复用语义与源不同。偿还：`plan.chapter` 行补提示词与 plan 复用语义。

## 批次 D：P3 写作与审稿

### chapter.write

**源工程证据**：`agents/writer.ts` 的 `buildWriterSystemPrompt`：作品身份、governed contract、length contract（目标、计数口径）、narrative person、protagonist 规则、book rules 与 style guide 权威块；WriterAgent 返回标题与正文。

**复刻现状**：`story_write_chapter` 只校验章纲、标题、正文并落盘；标题由模型传入；writer 子代理的提示由主编临场拼，缺少上述契约块。

**判定：保真债** — D16：writer system prompt 的五个契约块未注入；标题生成契约未对齐。偿还：`chapter.write` 行补 writer 提示与标题规则。

### chapter.review

**源工程证据**：审稿 system prompt 要求按审稿 Skill 与权威上下文审查、提交编号原文证据；宿主把 `governed-context` 与 `chapter-N` 一起编号；审计失败生成 `unavailable` 观察；`reviewedArtifact` 记录被审版本。

**复刻现状**：`story_review_chapter` 校验观察并落盘；来源只有章节正文与章纲 memo；**编号原文没有注入**，模型需自己读取；没有 `reviewedArtifact`。

**判定：保真债** — D17：编号原文与完整上下文未注入；D18：`reviewedArtifact` 缺失（依赖 `artifact.identity` 行）。偿还：`chapter.review` 行补注入，版本记录跟随 `artifact.identity`。

## 后续批次

- ~~批次 B（P1）~~：已完成。
- ~~批次 C（P2）~~：已完成。
- ~~批次 D（P3）~~：已完成。
- 批次 C（P2）：`plan.*`；
- 批次 D（P3）：`chapter.write`、`chapter.review`。

每批完成后补齐本节并将债写入 `docs/scope.md`。
