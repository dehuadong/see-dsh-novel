# 保真审计

逐行对照源工程行为与复刻行为。判定只有三种：`等价`、`机制等价`（必须带 `docs/dsh-mapping.md` 偏差行）、`保真债`（必须带 `docs/scope.md` 偿还行）。

审计范围：账本中全部 `verified` 行与待验行；按 P0 → P1 → P2 → P3 分批。`###` 段必须覆盖 v1 P0–P6 的每一行；`missing` 行也写源证据与阻塞。

## 跨能力不变量

行级判定之外，以下不变量必须由阶段出口同时验证；每条绑定源工程证据、DSH 落点与验证位置。

1. **workflow start 确认**：源 `propose_action` 只枚举 15 个 workflow start（`agent/agent-tools.ts:178-194`）；`write_next` 是 confirmed production intent（`studio/src/shared/confirmed-production.ts`）；plan/write/revise 是内部步骤。DSH 的 approval／面板／命令只确认 workflow start，不逐工具确认；未确认不启动 workflow。
2. **阶段停点**：源没有“阶段 prompt 自动推进”；DSH `systemPrompt.context` 只描述当前阶段。普通问候/讨论不改作品；workflow start 由作者动作触发；阶段完成必须停下；工具入口拒绝没有 workflow start 的跨阶段写入。
3. **作品边界**：源 `works/<id>`、`WorkManifest`、`state` 锁与原子文件集 → DSH 一个工作区一部作品、`work.json`、`runtime.work-lock`／`commit`；跨作品隔离；失败不留半写。
4. **证据同一**：会话日志、telemetry、realRun、面板展示来自同一证据；`capabilities.yaml` 状态只由 `check-capabilities` 依据证据生成。
5. **上下文同一**：模型窗口、预算、检索候选、压缩、`ChapterTrace` 七字段、review 来源同一基准；不静默截断。
6. **产物同一**：章节文档、artifact revision、`reviewedArtifact`、review 证据指向同一被审版本；写/审/改不跨 revision。
7. **面板/命令一致**：面板按钮、`/story-*` 命令、原生 approval 不出现三套 decision；`panel.confirm`（P1）与只读 `panel.workbench`（P6）职责分开，面板只读同一证据。

验证位置：1/2 见 `runtime.stage-context`／`foundation.approval`／`panel.confirm`；3 见 `runtime.session-binding`／`runtime.work-lock`／`runtime.commit-safety`；4 见 `runtime.telemetry`／`check-capabilities`；5 见 `plan.*`；6 见 `chapter.write`／`chapter.review`／`artifact.identity`；7 见 `panel.*` 与 `StoryView`。

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

- `core/proposal.ts`：顶层 `title`（卡片标题）／`summary`／`instruction` 与必填的 `createBook` 嵌套对象；
- `createBook` 含 `title`、`genre`、`platform`、`language`、`targetChapters`、`chapterWordCount`、`minChapterLength`、`maxChapterLength`；卡片标题与作品标题分开；
- 缺省规模在批准时补齐（200／语言默认章长）；`min`／`max` 只要求各自 ≥1，不校验顺序（与源一致）。

**判定：等价（D1／D2 已偿还）** — 嵌套形状与章长区间已落地，回执见 `artifacts/real-runs/proposal.creative.json`。

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
  - `--target-chapters` 默认 `200`，`--chapter-words` 默认 `3000`；
  - `--brief <path>` 读文件作为 `externalContext`；
  - `--lang` 取 `resolveCliLanguage(opts.lang ?? config.language)`：显式值按 `zh*`／`en*` 前缀归一，不匹配再读项目语言与宿主 locale，最后缺省 `zh`；
  - `targetChapters`／`chapterWordCount` 用 `parseInt(…, 10)`；
  - action 调 `createBookFoundationTool`，由 `pipeline.initBook` 生成基础设定；
  - 已有目录先判 `isCompleteBookDirectory`，不完整就删除重建。
- `packages/cli/package.json` 依赖 commander：重复选项后者覆盖，支持 `--flag=value`。

**可验证不变量**

1. 标题必填。
2. 未给规模时落 200 章 × 3000 字；未给题材/平台时落 `xuanhuan`／`tomato`；未给语言时落 `zh`。
3. 源选项名 `--target-chapters`／`--chapter-words` 可用；`--chapters`／`--words` 是别名。
4. 解析接受 `--flag=value`、重复后者覆盖、`parseInt` 前导整数；空值按源行为分开。
5. `--brief` 读文件，内容作为外部上下文；`--brief=` 视为没有简报。
6. `--lang` 按前缀归一，未知值回退 `zh`。
7. 源命令一次完成身份与基础设定；已有完整作品拒绝，不完整作品删除重建。

**复刻现状**

- `/story-init`：位置参数标题；源名与短别名都可用；支持 `--flag=value`、重复后者覆盖、`parseInt` 前导整数；空值矩阵与源一致。
- 缺省规模 200／3000、题材 `xuanhuan`、平台 `tomato`、语言 `zh`。
- `--lang` 按前缀归一，未知值回退 `zh`。
- `--brief` 相对工作区根读文件；`--brief=` 用 `Create <标题>`。
- 命令只写身份、`story/brief.md` 与方向文档；基础设定由 `story_next`／面板阶段继续。
- 已有 `work.json` 一律拒绝，不删除工作区。

**判定：机制等价**

- D3／D4：已偿还。源名与别名同表、缺省题材/平台随 `work.json` 落盘；同批补了 `--lang` 前缀归一与 `parseInt` 读取。
- D19：已偿还。`/story-init` 成功后用 `agent.followup` 投一条基础设定指令；命令立即返回「已启动」，基础设定在下一轮完成。源命令同步等待，复刻异步启动，机制差异登记在 `docs/dsh-mapping.md`。
- D20：已偿还。显式 `--lang` → `inkos.json.language`（缺字段按源默认 `zh`）→ `INKOS_LOCALE`／`LC_ALL`／`LC_MESSAGES`／`LANG` → `zh`；显式未知值跳过 config。
- D21：已偿还。完整作品拒绝；不完整作品删除 `source/` 与根 `work.json` 后重建；不删工作区根。源删整个 workDir，复刻删除集不同，登记在 `docs/dsh-mapping.md`。
- D5：`--brief` 的路径基准从进程 cwd 改为工作区根——已登记为机制等价偏差（`docs/dsh-mapping.md`）。

---

## 批次 B：P1 基础设定与运行时

### foundation.architect

**源工程证据**：`agents/architect-tool.ts` 的四段 schema；`agents/architect.ts` 用 `buildFoundationProtocol` 组装 system prompt（book、外部指令 contextBlock、review feedback、语言前缀），并以 temperature 0.8 分阶段生成。

**可验证不变量**：四段字段（storyFrame／volumeMap；bookRules＋bookRulesData＋pendingHooks；cast index 至少一人；每卡一段文本）；architect 的 system prompt 含作品身份、外部指令、反馈与「不写正文」约束；基础设定缺任一段不算完成。

**复刻现状**：四段 tool schema 与源一致（`contract.ts`）；阶段协议只列四段顺序，**没有移植 architect 的 system prompt**（作品身份、外部指令、反馈块）。

**判定：机制等价（D6 已偿还）** — 架构契约（元信息、外部指令、提交要求）与四步依赖已由 `stages/architect.ts` 注入 `foundation` 阶段；「已激活的专业 Skill」在 DSH 落点是阶段主动注入的 `longform-writing`，已在 `docs/dsh-mapping.md`「方法注入」行覆盖。review feedback 与 import／fanfic 变体仍属后续能力。

### foundation.ready-check

**源工程证据**：`utils/outline-paths.ts` 的 `isBookFoundationComplete`：`book.json`、`story/outline/story_frame.md`、`volume_map.md`、`book_rules.md`、`book_rules.json`、`pending_hooks.md`，且任一角色目录至少一张卡。

**可验证不变量**：就绪 = 六类文件 + 至少一张角色卡；缺 `book_rules.json` 不算就绪。

**复刻现状**：`workProbes` 要求 story_frame、volume_map、book_rules.md、current_state.md、pending_hooks.md、chapter_summaries.md + 角色卡；**没有 `book_rules.json`**，多了 current_state 与 chapter_summaries。

**判定：等价（D7 不成立）** — `workProbes` 的七项与源一致：work.json（对应 book.json）、story_frame、volume_map、book_rules.md、book_rules.json、pending_hooks、至少一张角色卡；current_state／chapter_summaries 不参与判据。审计最初把它误记为六项，复核后撤回。

**附带发现**：`stages` 的同步探针曾用 current_state／chapter_summaries 代替 book_rules.json，与 `workProbes` 不一致；本行已把两处统一为同一组文件。

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

**源工程证据**：`harness/tools/longform-edits.ts` 的 `write_truth_file` 白名单：9 个平铺文件（author_intent、current_focus、book_rules、style_guide、parent_canon、fanfic_canon、current_state、pending_hooks、chapter_summaries）、2 个 outline、4 种角色目录。`interaction/truth-authority.ts` 的 8 项集合是 `edit-controller` 的 `truth-file-edit` 分类表，不是写入白名单。

**可验证不变量**：只允许写这份 9＋2＋角色目录的 allowlist；平铺与 outline 名字大小写不敏感并落规范小写，角色卡保留原名；未知文件拒绝。

**复刻现状**：`core/truth-files.ts` 的 `FLAT_NAMES`／`OUTLINE_NAMES`／`ROLE_TIERS` 与源逐项一致；`test/truth-file.test.mjs` 覆盖三份平铺文件、两份 outline 与两种角色目录。

**判定：等价**。`truth-authority.ts` 的 8 项集合属于 `truth-file-edit` 事务，不是本行的写入白名单。

### foundation.truth-projections

**源工程证据**：`state` 投影（current_state／pending_hooks／chapter_summaries）的列、排序与转义。

**可验证不变量**：排序稳定、文本转义、末尾换行；缺数据时输出表头。

**复刻现状**：`core/state-projections.ts` 有对应渲染与测试。

**判定：等价**（列集以测试为准）。

### runtime.commit-safety

**源工程证据**：`utils/atomic-file-set.ts` 的路径包含校验、按根 `serialize`、`prepared` 日志先行、`existed` 回滚判据、回滚失败保留事务目录并把 pid 改成 0。

**可验证不变量**：越界路径拒绝；重复写、写删冲突、目录/子路径重叠拒绝；同根提交串行；journal 先于备份；`existed` 决定回滚删除/恢复；回滚失败保留现场；`committed` 写失败进入回滚。

**复刻现状**：`core/commit.ts` 的 `safeRelativePath`、冲突检查、`withCommitQueue`、`entries[].existed` 与失败留痕与源一致；事务目录/日志/备份/阶段由 `runtime.txn-format` 承接。

**判定：等价**。事务格式由 `runtime.txn-format` 拥有，本行不含该债。

### runtime.txn-format

**源工程证据**：`utils/atomic-file-set.ts`：`PREFIX = ".inkos-file-txn-"`；事务目录在 `rootDir` 用 `mkdtemp` 创建；`staged/`＋`backup/`；`JournalSchema` 为 `{version:1,pid,phase:"prepared"|"committed",entries:[{path,existed}]}`；目标 `rename` 到 backup；staged 写入 rename 到位；死 `prepared` 回滚、`committed` 清理；`recoverRoot` 扫作品根。

**可验证不变量**：事务目录在作品根且以前缀识别；布局是 `staged/`＋`backup/`；日志只含 `entries` 与两阶段；备份用 rename（删除项由移动生效）；`committed` 写失败回滚；死 `prepared` 一律回滚，死 `committed` 只清理；活属主与无日志不动。

**复刻现状**：`core/commit.ts` 的 `TXN_PREFIX`、`CommitJournal`、`recoverDeadTransactions` 与 `core/recovery.ts` 的根目录扫描/报告/修复；`test/txn-format.test.mjs` 覆盖根事务、entries、旧 `.staging-*` 不扫描，`test/recovery.test.mjs` 覆盖两种阶段。

**判定：等价**。旧 `.staging-*` 与旧日志不迁移；预发布格式不做兼容层。

### runtime.stage-context

**源工程证据**：各角色在调用点组装 system prompt（architect／writer／planner／reviewer），方法来自已激活 Skill。

**可验证不变量**：方法随阶段注入；协议随阶段切换；同一阶段不出现别阶段协议。

**复刻现状**：`stages/index.ts` 注册 `story:stage`／`story:craft`，按工作区阶段注入。

**判定：保真债 D28** — 阶段注入机制等价（DSH `systemPrompt.context()`）；但当前阶段协议把“当前阶段”当每轮强制推进，源工程是 workflow start 确认。偿还 P1：阶段协议只描述，完成一段停下；作者发起 `write_next` 才进入下一阶段；不在每个 write 工具上加 approval。

## 批次 C：P2 章前规划

### plan.retrieval

**源工程证据**：`retrieval/local-search.ts` 的 tokenizer（NFKC/lower、`Intl.Segmenter`、汉字 bigram、连字符复合词）、`retrieval_documents`＋external-content FTS5、`bm25(…, 5.0, 1.0)` 与 `score = -rank`、metadata 与含 metadata 的 content_hash；`utils/memory-retrieval.ts` 的 `story-memory` 三类型（hook／chapter-summary／volume-summary）、hook 状态过滤、source anchor 与 metadata。素材/技能引用是各自 scope（`materials/retrieve.ts`、`agent/skill-tool.ts`）。

**可验证不变量**：tokenizer 与 match query 按源（引号 OR，无前缀通配）；external-content FTS5 的 schema/触发器；BM25 权重 5／1 与 `-rank`；故事记忆三类型、hook 过滤、summary 六字段、volume 分节。

**复刻现状**：`core/search-index.ts` 与 `core/story-index.ts` 已按源重写；scope `story-memory`、库 `source/story/memory.db`；角色/大纲/素材仍以 FTS 过渡候选供给 `collectCandidates`；技能引用没有 query 入口。

**判定：保真债** — D10 已偿还；D22 已缩小为素材：角色／大纲的过渡候选已由 `plan.context-select` 接管，素材仍留到 P6（偿还：`materials.import`／`search.unified`）；D23 归 `skill.references`：缺 `use_skill.query` 的技能参考检索（偿还：新行/工具）。

### plan.context-select

**源工程证据**：`agents/composer.ts` 的两次 composer——planner 的 `selectTaskContext`（无 memo，`plannerInputs` 来自 planner 包并追加 `runtime/previous_chapter`）与 writer 的 `composeChapter`（有 memo，写 `context.json`／`trace.json`）；固定来源 current_focus／author_intent／style_guide／parent_canon／fanfic_canon／chapter_memo／current_state facts／outline 两文件分节／role cards／referenced hooks，及 protected／compressible 分层；memory 一条提示、role／state／story-frame／volume-map 分别调用；`completeContextWithinBudget` 的全收分支；`buildGovernedTrace` 的 plannerInputs／composerInputs／tokenBudget。

**可验证不变量**：planner pass 在 memo 之前、writer pass 在 plan 之后；固定来源整份；五类任务各自提示与候选；0/1 自动仅限 role／state／outline，memory 有候选即调模型；complete 分支不调 subagent；plannerInputs 含 previous_chapter，composerInputs 是 intent.md；retrieval 完整形状。

**复刻现状**：`core/context-package.ts`／`src/pipelines/long/context-tool.ts` 已实现两 pass、固定来源、五类任务、complete／semantic、planner-context／context／trace 落盘；`src/pipelines/long/stages/writer.ts` 注入 selectedContext；role／outline 从 `story-index` 删除，素材保留。

**判定：保真债** — D11／D12 已偿还；D24：book reference 上下文未实现（偿还：P6 的 materials／search.unified）；D25 已由 `plan.compression` 偿还。

### plan.compression

**源工程证据**：`composer.ts` 的 `contextBudgetFromClient`（模型 contextWindow + defaults.maxTokens）、`applyContextBudgetIfNeeded`（protected 不压、compressible 超预算交给 `SemanticContextCompilerAgent`、trace 六字段）与 `SemanticContextCompilerAgent`（按 semantic input budget 分块、逐块 Markdown、合并后重压一次、仍超报错）；memory 的 `groupMemoryCandidates` 按 `semanticInputBudget` 分组。

**复刻现状**：`core/context-package.ts` 从模型信息派生预算；D25 memory 分组与超长 excerpt 切块；超预算返回 `compressionTask`（chunks、maxInputTokens、language）；候选与压缩分块由 `core/context-spool.ts` 落 runtime 任务文件，`story_context_candidates` 只返回句柄，`story_context_task`／`story_context_compression_task` 一次读一个；trace.compression 按源六字段（`compiledSource` 为 `runtime/compiled-compressible-context`、压缩前 token、`budgetTokens=max(1, available-protected)`）。

**判定：保真债** — D13、D25 行为已偿还；D26：大 compressible 夹具已写出 task spool，但主模型读取 2.3MB task 时卡死，真压缩真机回执未取得；压缩行为由 core 测试与 spool 测试覆盖，证据缺口保留。

### plan.chapter

**源工程证据**：`agents/planner.ts` 的 system prompt（"把 governed context 编译为章节 memo，不写正文，方法来自 Skill"）、user message 分段（指令／上下文／上一章／字数遥测）、memo 三字段、intent 投影；`runner.ts` 按持久进度取下一章、可复用已存 plan。

**复刻现状**：memo 三字段与 intent 投影一致；规划方法与流程在 `story:stage`／`story-plan`；planner system prompt 与 user message 已注入；`plannerInputs` 由 planner-context 推导；章节连续性按 `current_state.chapter + 1`，已有 plan 返回 `reused: true`。

**判定：机制等价（D14／D15 已偿还）** — planner 契约（方法句、memo 请求骨架、上一章结尾、hook id）已注入 `plan` 阶段；`story_plan_chapter` 命中已有 plan 时返回 `reused: true` 且不覆盖，与源缓存语义一致。上一章只取末尾 2000 字（源取全文）与进度来源仍属残余。

## 批次 D：P3 写作与审稿

### chapter.write

**源工程证据**：`agents/writer.ts` 的 `buildWriterSystemPrompt`：作品身份、governed contract、length contract（目标、计数口径）、narrative person、protagonist 规则、book rules 与 style guide 权威块；WriterAgent 返回标题与正文。

**复刻现状**：`story_write_chapter` 只校验章纲、标题、正文并落盘；标题由模型传入；writer 子代理的提示由主编临场拼，缺少上述契约块。

**判定：机制等价（D16 已偿还）** — 六段 writer 契约（权威／字数／人称／主角／规则／风格）与本章章纲由 `stages/writer.ts` 注入 write 阶段；writer pass 的 `context.json` selectedContext 也已注入；标题拒绝章号前缀。

### chapter.review

**源工程证据**：审稿 system prompt 要求按审稿 Skill 与权威上下文审查、提交编号原文证据；宿主把 `governed-context` 与 `chapter-N` 一起编号；审计失败生成 `unavailable` 观察；`reviewedArtifact` 记录被审版本。

**复刻现状**：`story_review_chapter` 校验观察并落盘；来源为章节正文与章纲 memo；`sourceRefs` 工具 schema 已收紧为对象数组；`reviewedArtifact` 由 artifact store 的 current revision 填充，number-aware 标题归一化后字节不匹配则省略；没有 artifact 的旧工作区仍可审稿，但记录无 identity。

**判定：等价（D17、D18 已偿还）** — 编号原文与章纲由 `stages/review.ts` 注入；`sourceRefs` 字符串在入参被拒绝；`reviewedArtifact` 来自 `source/artifacts/manifest.json` 的 `chapter-<NNNN>` current revision，且只在 revision bytes 与被审正文一致时写入。

### artifact.identity

**源工程证据**：`harness/artifact-revisions.ts` 的 `createCurrentArtifact`／`stageArtifactRevision`／`promoteArtifactRevision`、`contracts.ts` 的 manifest/revision 不变量与 `WorkResourceIdSchema`／`RelativeArtifactPathSchema`；章节 revision 的 path 直接指向 `source/chapters/...`，`agents/continuity.ts` 用 current revision 生成 `reviewedArtifact`。

**复刻现状**：`core/artifact-store.ts` 用 `source/artifacts/manifest.json` 记录 chapter artifact 的 `r1` current revision，path 指向章节文件；`writeChapterDocument` 同一次提交写章节与 manifest；`reviewChapter` 读取 current revision 并写 `reviewedArtifact`；checksum/byteLength/current/parent/superseded/ID/路径校验与源一致。

**判定：等价** — 章节产物 identity 与 review 消费已接通；manifest 是独立索引而非 WorkManifest 内嵌，登记在 `dsh-mapping.md`。

### runtime.load

**源工程证据**：`inkos/packages/core/src/harness/runtime.ts` 装载 profile／bundle、注册工具与 client。

**复刻现状**：`packages/see-dsh-novel` 的 bundle/preset 由 DSH 加载；`host.test.mjs` 断言工具、命令、context 与 client 注册。

**判定：机制等价** — DSH bundle/preset 替代源自建 runtime；验证 `host.test.mjs` 与 `runtime.load.json`。

### runtime.agent-tools

**源工程证据**：`inkos/packages/core/src/harness/builtin-profiles.ts` 的写作 profile 工具面；通用写工具不开放，内容写入走 `story_*`。

**复刻现状**：`cordis.patch.yml` 组合 preset；`agent-tools.test.mjs` 校验 persona、只读、检索、技能、子代理、ask-user、todo、jobs、压缩；不注册通用写工具。

**判定：机制等价** — DSH preset plugins 与 skills 承载；无内容写入旁路。

### runtime.client-ui

**源工程证据**：`inkos/packages/studio/` 的页面、确认卡与文件浏览；DSH 用 client 插件 + slots。

**复刻现状**：`client/index.ts` 注册 slot 与 React 构建；当前只有 foundation 状态卡，尚无阶段时间线/产物浏览；`panel.confirm`/`panel.workbench` 仍是 missing。

**判定：保真债 D28** — UI 基线与数据面存在，但工作台/确认面未交付；偿还 P1 `panel.confirm`、P6 `panel.workbench`。

### runtime.package-check

**源工程证据**：`dsh-webnovel-writer:packages/bundle/scripts/pack-check.mjs` 校验 tarball files／exports／patch。

**复刻现状**：`src/tools/packaging.ts` 与 `packaging.test.mjs`；`check-package` 在 verify 中执行。

**判定：机制等价** — DSH 打包检查；无产品行为差异。

### runtime.boundary-check

**源工程证据**：项目护栏：源码不得 import 源工程，`@deepseek-ai` 只允许预设与前端 type-only 引用。

**复刻现状**：`src/tools/boundary.ts`、`source-boundary.test.mjs`、`check-boundary`。

**判定：机制等价** — 项目护栏，不是源产品功能。

### runtime.session-binding

**源工程证据**：`inkos/packages/core/src/harness/session-binding.ts` 用 `works/<id>` 与 session 绑定；一个工作区一部作品。

**复刻现状**：`work.json` 在工作区根，`workingDirectory` 绑定会话；面板从会话读取作品身份；跨作品隔离由工作区边界。

**判定：机制等价** — 源多作品目录改为一个工作区；无跨作品路径。

### runtime.telemetry

**源工程证据**：源 pipeline／agent 记录 usage、耗时、失败回执。

**复刻现状**：DSH session 日志记录 usage／耗时／失败；`story_*` 工具回执可追溯；没有独立遥测存储。

**判定：机制等价** — DSH session 日志替代源 telemetry；面板/审计读取同一日志。

### runtime.recovery

**源工程证据**：源 `state` 重建索引与故障恢复。

**复刻现状**：`core/recovery.ts` 自检与重建，`recovery` 测试覆盖；作品内容文档可重建索引。

**判定：机制等价** — DSH 文件状态 + 恢复函数；无独立数据库。

### panel.gate-resume

**源工程证据**：Studio 确认卡确认后继续；退回是停止信号。

**复刻现状**：`StoryView` 的认可/退回调用 `/story-approve`／`/story-reject`，`panel.gate-resume` 把「继续」投回会话；当前只覆盖 foundation decision，不覆盖 workflow start。

**判定：保真债 D28** — 确认-继续通道存在，但 action/workflow start 面未接。

### panel.foundation-start

**源工程证据**：Studio 的创作入口在立项后启动基础设定。

**复刻现状**：`StoryView` 的「开始基础设定」投一条开工指令；`panel.foundation-start` 有回执与失败提示。

**判定：机制等价** — DSH 会话消息替代 Studio 按钮；确认/停点仍受 D28 约束。

### foundation.hooks

**源工程证据**：`inkos/packages/core/src/state` 的 hooks 池与六动作；状态由 settler 回写。

**复刻现状**：`core/hooks.ts`、`foundation/hook-ledger`；`hooks.test.mjs` 覆盖 id、状态、结算。

**判定：机制等价** — 文件状态 + 严格校验；无独立存储服务。

### foundation.approval

**源工程证据**：源 Studio 的 `propose_action`／confirmed production 只确认 workflow start（`create_book`、`write_next` 等，15 个）；确认后 host 执行；plan/write 是内部步骤。

**复刻现状**：`gate.ts` 提供 foundation 签核工具与面板认可/退回；`story_foundation_signoff` 读 approval；但 `write_next` 的 workflow start 没有独立确认面，`story:stage` 在 foundation 完成后自动进入 plan/write。

**判定：保真债 D28** — foundation 签核是 DSH 侧附加面；真正缺的是 workflow start 确认与阶段停点。偿还 P1 `panel.confirm` + `runtime.stage-context`；不得把 plan/write 改成逐工具 approval。

### cast.single-authority

**源工程证据**：`inkos/packages/core/src/references/reference-context.ts` 的角色权威；major/minor 都进入 brief/context。

**复刻现状**：`core/cast.ts`／role 文件；`cast.test.mjs` 断言唯一权威与主次角色。

**判定：机制等价** — 角色文件为唯一权威；DSH context 读取同一文件。

### runtime.work-lock

**源工程证据**：`inkos/packages/core/src/state/manager.ts` 的跨进程作品锁、心跳、死锁接管。

**复刻现状**：无实现；`capabilities.yaml` 为 `missing`；P2/P3/P6 已 verified，违反 P1 出口。

**判定：保真债 D27** — 偿还 P1；锁文件/心跳/接管与 `commit` 串行化必须一起验证。

### panel.confirm

**源工程证据**：`inkos/packages/core/src/agent/agent-tools.ts:178-194` 的 workflow start 枚举；`studio/src/shared/confirmed-production.ts` 的 `write_next` confirmed intent；确认卡确认后才执行。

**复刻现状**：无独立确认面；`StoryView` 只有 foundation 认可/退回，`story:stage` 会自动推进。

**判定：保真债 D28** — 新行，P1；Faces: workflow start 确认、拒绝/取消、与 approval/命令同一 decision；只有确认面，不承载只读工作台（P6 `panel.workbench`）。

### skill.references

**源工程证据**：源 `use_skill.query` 的技能参考检索；DSH `skill` 只加载整份技能。

**复刻现状**：无 `use_skill.query`；技能整份注入。

**判定：保真债 D23** — P0 新行；偿还需技能参考检索工具或声明不可观测；不得把整份注入当等价。

### chapter.revise

**源工程证据**：源 revision pipeline 的 spot-fix／polish／rewrite 等；修订后重新审阅。

**复刻现状**：`chapter.revise` 未实现；`chapter.review` 只能审一次。

**判定：保真债（未立债号）** — P3 行仍 missing；P3 出口前必须先立行/实现，不能以 review 代替 revise。

### chapter.summary

**源工程证据**：源 summary agent 写章节摘要并回写 `chapter_summaries`。

**复刻现状**：未实现；`chapter_summary` 文件由 foundation 播种。

**判定：保真债（未立债号）** — P4 行 missing；P3 出口后才做。

### chapter.settle

**源工程证据**：源 settler 的伏笔六动作、状态真值回写与快照。

**复刻现状**：未实现；`chapter.settle` 行 missing。

**判定：保真债（未立债号）** — P4 行 missing；需要 settler prompt 与合并规则。

### chapter.finalize

**源工程证据**：源定稿与快照。

**复刻现状**：未实现；`chapter.finalize` 行 missing。

**判定：保真债（未立债号）** — P4 行 missing。

### chapter.reopen

**源工程证据**：源章节重开/回滚。

**复刻现状**：未实现；`chapter.reopen` 行 missing。

**判定：保真债（未立债号）** — P5 行 missing。

### chapter.move-delete

**源工程证据**：源章节移动/删除与索引回滚。

**复刻现状**：未实现；行 missing。

**判定：保真债（未立债号）** — P5 行 missing。

### state.check

**源工程证据**：源状态核对/修复。

**复刻现状**：未实现；行 missing。

**判定：保真债（未立债号）** — P5 行 missing。

### export.work

**源工程证据**：`inkos/packages/core/src/interaction/export-artifact.ts` 的原子导出。

**复刻现状**：未实现；`export.work` missing。

**判定：保真债（未立债号）** — P6 行 missing。

### backup.restore

**源工程证据**：源 book backup/restore。

**复刻现状**：未实现；行 missing。

**判定：保真债（未立债号）** — P6 行 missing。

### materials.import

**源工程证据**：源素材导入与 reference context。

**复刻现状**：未实现；行 missing；D22/D24 依赖它。

**判定：保真债（未立债号）** — P6 行 missing。

### search.unified

**源工程证据**：源记忆／素材／技能统一检索。

**复刻现状**：未实现；行 missing；D22/D24 依赖它。

**判定：保真债（未立债号）** — P6 行 missing。

### panel.workbench

**源工程证据**：Studio `pages/` 的工作台、阶段按钮、只读产物浏览。

**复刻现状**：未实现；P6 只读工作台；作者确认面拆到 P1 `panel.confirm`。

**判定：保真债（未立债号）** — P6 行 missing；不得承载 P1 确认。

### panel.logs

**源工程证据**：Studio `components/` 的调用日志。

**复刻现状**：未实现；行 missing。

**判定：保真债（未立债号）** — P6 行 missing。

### panel.analysis

**源工程证据**：Studio `pages/` 的分析/节奏。

**复刻现状**：未实现；行 missing。

**判定：保真债（未立债号）** — P6 行 missing。

### v1 之外

`short.*`、`script.*`、`radar.topic`、`forecast.plot` 不在 v1 P0–P6 出口；账本保留 `missing`，对应源模块另行规划。它们不要求 `###` 审计段；不得借“补齐”混进当前阶段。

## 后续批次


- ~~批次 B（P1）~~：已完成。
- ~~批次 C（P2）~~：已完成。
- ~~批次 D（P3）~~：已完成。
- 批次 C（P2）：`plan.*`；
- 批次 D（P3）：`chapter.write`、`chapter.review`。

每批完成后补齐本节并将债写入 `docs/scope.md`。
