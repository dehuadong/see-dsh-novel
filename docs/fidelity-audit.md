# 保真审计

逐行对照源工程行为与复刻行为。判定只有三种：`等价`、`机制等价`（必须带 `docs/dsh-mapping.md` 偏差行）、`保真债`（必须带 `docs/scope.md` 偿还行）。

审计范围：账本中全部 `verified` 行与待验行；按 P0 → P1 → P2 → P3 → P4 → P5 → P6 分批。`###` 段必须覆盖 v1 P0–P6 的每一行；`missing` 行也写源证据与阻塞。

## 跨能力不变量

行级判定之外，以下不变量必须由阶段出口同时验证；每条绑定源工程证据、DSH 落点与验证位置。

1. **workflow start 确认**：源 `propose_action` 只枚举 15 个 workflow start（`agent/agent-tools.ts:178-194`）；`write_next` 是 confirmed production intent（`studio/src/shared/confirmed-production.ts`）；plan/write/revise 是内部步骤。DSH 的 approval／面板／命令只确认 workflow start，不逐工具确认；未确认不启动 workflow。
2. **阶段停点**：源没有“阶段 prompt 自动推进”；DSH `systemPrompt.context` 只描述当前阶段。普通问候/讨论不改作品；workflow start 由作者动作触发；阶段完成必须停下；工具入口拒绝没有 workflow start 的跨阶段写入。
3. **作品边界**：源 `works/<id>`、`WorkManifest`、`state` 锁与原子文件集 → DSH 一个工作区一部作品、`work.json`、`runtime.work-lock`／`commit`；跨作品隔离；失败不留半写。
4. **证据同一**：会话日志、telemetry、realRun、面板展示来自同一证据；`capabilities.yaml` 状态只由 `check-capabilities` 依据证据生成。
5. **上下文同一**：模型窗口、预算、检索候选、压缩、`ChapterTrace` 七字段、review 来源同一基准；不静默截断。
6. **产物同一**：章节文档、artifact revision、`reviewedArtifact`、review 证据指向同一被审版本；写/审/改不跨 revision。
7. **面板/命令一致**：面板按钮、`/story-*` 命令、原生 approval 不出现三套 decision；`panel.confirm` 拥有确认语义，`panel.workbench` 是读取 + 动作面；确认状态由宿主的 `detectStage` 与 approval 回执产生，面板动作与命令走同一宿主入口。

验证位置：1/2 见 `runtime.stage-context`／`foundation.approval`／`panel.confirm`；3 见 `runtime.session-binding`／`runtime.work-lock`／`runtime.commit-safety`；4 见 `runtime.telemetry`／`check-capabilities`；5 见 `plan.*`；6 见 `chapter.write`／`chapter.review`／`artifact.identity`；7 见 `workbench.test.mjs`／`client.test.mjs` 的动作派发断言与 `panel.confirm` 测试。

---

## 批次 A：P0 运行时骨架

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

**复刻现状**：`client/index.ts` 注册 slot 与哨兵，条件注册「作品」页；`StoryView` 索引驱动、`Workbench` 承载阶段栏/产物/动作条；样式随插件安装。面板内容与桌面回执归 `panel.workbench`。

**判定：机制等价** — DSH client 插件 + slots 替代 Studio 前端；面板的完成度见 `panel.workbench`，不在本行重复计债。

### runtime.package-check

**源工程证据**：`dsh-webnovel-writer:packages/bundle/scripts/pack-check.mjs` 校验 tarball files／exports／patch。

**复刻现状**：`src/tools/packaging.ts` 与 `packaging.test.mjs`；`check-package` 在 verify 中执行。

**判定：机制等价** — DSH 打包检查；无产品行为差异。

### runtime.boundary-check

**源工程证据**：项目护栏：源码不得 import 源工程，`@deepseek-ai` 只允许预设与前端 type-only 引用。

**复刻现状**：`src/tools/boundary.ts`、`source-boundary.test.mjs`、`check-boundary`。

**判定：机制等价** — 项目护栏，不是源产品功能。

### skill.references

**源工程证据**：`inkos/packages/core/src/agent/skill-tool.ts:55-120` 的 `use_skill`——`resourcePath` 精确读一个参考文件、`query` 对参考文件检索；`:40-52` 的激活结果携带 `resources`。

**复刻现状**：随包技能注册带 `provider` 与 `resourceBase: { kind: 'directory', path: <packageRoot>/skills/<name> }`；DSH 的 `renderSkillContent` 把绝对基址渲染进 `skill` 工具输出，主/子代理按路径读 `references/*.md`；阶段注入 `renderCraft` 会把 `SKILL.md` 与 `references/*.md` 整份拼进上下文。`resourcePath` 行为等价；`query` 未实现；源对越界、符号链接、非文件、512KB、UTF-8 的校验与失败回执也未复刻。

**判定：保真债 D23／D54** — DSH 技能服务只声明资源位置，但项目可以注册工具提供参考检索，`query` 不是机制强制：D23 仍欠参考检索入口，D54 欠边界校验与失败回执；`docs/dsh-mapping.md` 不再把「基址读取」登记为替代 `query` 的偏差。

## 批次 B：P1 创意、立项与基础设定

### runtime.session-binding

**源工程证据**：`inkos/packages/core/src/harness/session-binding.ts` 用 `works/<id>` 与 session 绑定；一个工作区一部作品。

**复刻现状**：`work.json` 在工作区根，`workingDirectory` 绑定会话；面板从会话读取作品身份；跨作品隔离由工作区边界。

**判定：机制等价** — 源多作品目录改为一个工作区；无跨作品路径。

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

### runtime.telemetry

**源工程证据**：源 pipeline／agent 记录 usage、耗时、失败回执。

**复刻现状**：DSH session 日志记录 usage／耗时／失败；`story_*` 工具回执可追溯；没有独立遥测存储。

**判定：机制等价** — DSH session 日志替代源 telemetry；面板/审计读取同一日志。

### runtime.recovery

**源工程证据**：源 `state` 重建索引与故障恢复。

**复刻现状**：`core/recovery.ts` 自检与重建，`recovery` 测试覆盖；作品内容文档可重建索引。

**判定：机制等价** — DSH 文件状态 + 恢复函数；无独立数据库。

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

### panel.gate-resume

**源工程证据**：Studio 确认卡确认后继续；退回是停止信号。

**复刻现状**：`StoryView` 的认可/退回调用 `/story-approve`／`/story-reject`，`panel.gate-resume` 把「继续」投回会话；workflow start 另由 `/story-write` + `panel.confirm` 处理。

**判定：机制等价** — 确认-继续通道在；workflow start 不再是确认-继续，而是独立 start 记录。

### panel.foundation-start

**源工程证据**：Studio 的创作入口在立项后启动基础设定。

**复刻现状**：工作台 `foundation` 节点的「开始基础设定」（无索引时是兜底卡片）投一条开工指令；`panel.foundation-start` 有回执与失败提示。

**判定：机制等价** — DSH 会话消息替代 Studio 按钮；workflow start 由 `panel.confirm` 接；工作台入口在 `panel.workbench`。

### foundation.architect

**源工程证据**：`agents/architect-tool.ts` 的四段 schema；`agents/architect.ts` 用 `buildFoundationProtocol` 组装 system prompt（book、外部指令 contextBlock、review feedback、语言前缀），并以 temperature 0.8 分阶段生成。

**可验证不变量**：四段字段（storyFrame／volumeMap；bookRules＋bookRulesData＋pendingHooks；cast index 至少一人；每卡一段文本）；architect 的 system prompt 含作品身份、外部指令、反馈与「不写正文」约束；基础设定缺任一段不算完成。

**复刻现状**：四段 tool schema 与源一致（`contract.ts`）；阶段协议只列四段顺序，**没有移植 architect 的 system prompt**（作品身份、外部指令、反馈块）。`story_foundation_details` 在初始快照同批写 `source/chapters/index.json = []`，仅在无章节文件且索引不存在时写；有章节文件、索引已存在或状态损坏时跳过。

**判定：机制等价（D6 已偿还）** — 架构契约（元信息、外部指令、提交要求）与四步依赖已由 `stages/architect.ts` 注入 `foundation` 阶段；「已激活的专业 Skill」在 DSH 落点是阶段主动注入的 `longform-writing`，已在 `docs/dsh-mapping.md`「方法注入」行覆盖。review feedback 与 import／fanfic 变体仍属后续能力。

### foundation.hooks

**源工程证据**：`inkos/packages/core/src/state` 的 hooks 池与六动作；状态由 settler 回写。

**复刻现状**：`core/hooks.ts`、`foundation/hook-ledger`；`hooks.test.mjs` 覆盖 id、状态、结算。

**判定：机制等价** — 文件状态 + 严格校验；无独立存储服务。

### foundation.approval

**源工程证据**：源 Studio 的 `propose_action`／confirmed production 只确认 workflow start（`create_book`、`write_next` 等，15 个）；确认后 host 执行；plan/write 是内部步骤。

**复刻现状**：`gate.ts` 提供 foundation 签核工具与面板认可/退回；`story_foundation_signoff` 读 approval；workflow start 由 `/story-write`/`panel.confirm` 独立确认，不再自动进入 plan。

**判定：机制等价** — foundation 签核是 DSH 侧附加面；workflow start 确认已接；不把 plan/write 改成逐工具 approval。

### cast.single-authority

**源工程证据**：`inkos/packages/core/src/references/reference-context.ts` 的角色权威；major/minor 都进入 brief/context。

**复刻现状**：`core/cast.ts`／role 文件；`cast.test.mjs` 断言唯一权威与主次角色。

**判定：机制等价** — 角色文件为唯一权威；DSH context 读取同一文件。

### foundation.rule-contract

**源工程证据**：`models/book-rules.ts`：`version: "2"`、严格对象、可选 protagonist／genreLock／narrativePerson／fanficMode、必填 prohibitions／enableFullCastTracking／allowedDeviations。

**可验证不变量**：写入时注入 version；读取严格校验未知字段。

**复刻现状**：`pipelines/long/book-rules.ts` 的版本与字段一致；测试覆盖严格解析。

**判定：等价**。

### foundation.ready-check

**源工程证据**：`utils/outline-paths.ts` 的 `isBookFoundationComplete`：`book.json`、`story/outline/story_frame.md`、`volume_map.md`、`book_rules.md`、`book_rules.json`、`pending_hooks.md`，且任一角色目录至少一张卡。

**可验证不变量**：就绪 = 六类文件 + 至少一张角色卡；缺 `book_rules.json` 不算就绪。

**复刻现状**：`workProbes` 要求 story_frame、volume_map、book_rules.md、current_state.md、pending_hooks.md、chapter_summaries.md + 角色卡；**没有 `book_rules.json`**，多了 current_state 与 chapter_summaries。

**判定：等价（D7 不成立）** — `workProbes` 的七项与源一致：work.json（对应 book.json）、story_frame、volume_map、book_rules.md、book_rules.json、pending_hooks、至少一张角色卡；current_state／chapter_summaries 不参与判据。审计最初把它误记为六项，复核后撤回。

**附带发现**：`stages` 的同步探针曾用 current_state／chapter_summaries 代替 book_rules.json，与 `workProbes` 不一致；本行已把两处统一为同一组文件。

### foundation.truth-projections

**源工程证据**：`state` 投影（current_state／pending_hooks／chapter_summaries）的列、排序与转义。

**可验证不变量**：排序稳定、文本转义、末尾换行；缺数据时输出表头。

**复刻现状**：`core/state-projections.ts` 有对应渲染与测试。

**判定：等价**（列集以测试为准）。

### foundation.control-docs

**源工程证据**：`manager.ts` 的 author_intent／current_focus 兜底；brief 原文进入外部上下文。

**可验证不变量**：文件缺失时写默认模板；author_intent 按 instruction 播种；current_focus 是默认聚焦文本。

**复刻现状**：`controlDocumentWrites` 的 author_intent 兜底与源逐字一致；current_focus 默认模板与测试覆盖。

**判定：等价**。

### foundation.truth-write

**源工程证据**：`harness/tools/longform-edits.ts` 的 `write_truth_file` 白名单：9 个平铺文件（author_intent、current_focus、book_rules、style_guide、parent_canon、fanfic_canon、current_state、pending_hooks、chapter_summaries）、2 个 outline、4 种角色目录。`interaction/truth-authority.ts` 的 8 项集合是 `edit-controller` 的 `truth-file-edit` 分类表，不是写入白名单。

**可验证不变量**：只允许写这份 9＋2＋角色目录的 allowlist；平铺与 outline 名字大小写不敏感并落规范小写，角色卡保留原名；未知文件拒绝。

**复刻现状**：`core/truth-files.ts` 的 `FLAT_NAMES`／`OUTLINE_NAMES`／`ROLE_TIERS` 与源逐项一致；`test/truth-file.test.mjs` 覆盖三份平铺文件、两份 outline 与两种角色目录。

**判定：等价**。`truth-authority.ts` 的 8 项集合属于 `truth-file-edit` 事务，不是本行的写入白名单。

### foundation.hook-ledger

**源工程证据**：`models/runtime-state.ts` 的 Hook 字段（hookId、type、startChapter、status、lastAdvancedChapter、expectedPayoff、notes、dependsOn?、paysOffInArc?）。

**可验证不变量**：字段与可选性一致；未知字段拒绝；hookId/type 非空。

**复刻现状**：`core/hooks.ts` 字段一致，严格校验与测试覆盖。

**判定：等价**。

### runtime.commit-safety

**源工程证据**：`utils/atomic-file-set.ts` 的路径包含校验、按根 `serialize`、`prepared` 日志先行、`existed` 回滚判据、回滚失败保留事务目录并把 pid 改成 0。

**可验证不变量**：越界路径拒绝；重复写、写删冲突、目录/子路径重叠拒绝；同根提交串行；journal 先于备份；`existed` 决定回滚删除/恢复；回滚失败保留现场；`committed` 写失败进入回滚。

**复刻现状**：`core/commit.ts` 的 `safeRelativePath`、冲突检查、`withCommitQueue`、`entries[].existed` 与失败留痕与源一致；事务目录/日志/备份/阶段由 `runtime.txn-format` 承接。

**判定：等价**。事务格式由 `runtime.txn-format` 拥有，本行不含该债。

### runtime.work-lock

**源工程证据**：`inkos/packages/core/src/state/manager.ts` 的跨进程作品锁、心跳、死锁接管。

**复刻现状**：`core/work-lock.ts` 落 `source/.write.lock`，metadata/常量/stale/心跳/释放与源一致；`core/work-mutation.ts` 提供 `withWorkMutationScope`（AsyncLocalStorage reentrancy）与 `runInWorkMutationQueue`（root+action 串行），`withWorkAction` 在 init/foundation/truth/plan/write/review/recover 等 action 入口包锁；`commitFoundation`／`commitFile` 保持 lock-agnostic；跨进程 child 测试覆盖一个持锁一个 BOOK_BUSY。

**判定：等价** — D27 已偿还；锁在 action 边界而不是 commit；`docs/dsh-mapping.md` 登记路径与 queue 语义；真实回执 `artifacts/real-runs/runtime.work-lock.json`。

### runtime.stage-context

**源工程证据**：各角色在调用点组装 system prompt（architect／writer／planner／reviewer），方法来自已激活 Skill。

**可验证不变量**：方法随阶段注入；协议随阶段切换；同一阶段不出现别阶段协议。

**复刻现状**：`stages/index.ts` 注册 `story:stage`／`story:craft`，按工作区阶段注入。

**判定：等价** — 阶段注入机制等价；workflow start 记录、foundation-ready/chapter-done 停点、plan/write/review 工具准入已接通。`panel.confirm` 仍是 D29（写 start 的入口），不在本行。

### runtime.txn-format

**源工程证据**：`utils/atomic-file-set.ts`：`PREFIX = ".inkos-file-txn-"`；事务目录在 `rootDir` 用 `mkdtemp` 创建；`staged/`＋`backup/`；`JournalSchema` 为 `{version:1,pid,phase:"prepared"|"committed",entries:[{path,existed}]}`；目标 `rename` 到 backup；staged 写入 rename 到位；死 `prepared` 回滚、`committed` 清理；`recoverRoot` 扫作品根。

**可验证不变量**：事务目录在作品根且以前缀识别；布局是 `staged/`＋`backup/`；日志只含 `entries` 与两阶段；备份用 rename（删除项由移动生效）；`committed` 写失败回滚；死 `prepared` 一律回滚，死 `committed` 只清理；活属主与无日志不动。

**复刻现状**：`core/commit.ts` 的 `TXN_PREFIX`、`CommitJournal`、`recoverDeadTransactions` 与 `core/recovery.ts` 的根目录扫描/报告/修复；`test/txn-format.test.mjs` 覆盖根事务、entries、旧 `.staging-*` 不扫描，`test/recovery.test.mjs` 覆盖两种阶段。

**判定：等价**。旧 `.staging-*` 与旧日志不迁移；预发布格式不做兼容层。

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

### panel.confirm

**源工程证据**：`inkos/packages/core/src/interaction/action-envelope.ts:14-32` 的 `write_next`；`:46-48` 的 `chapterCount`（默认 1）；`studio/src/shared/confirmed-production.ts:3-20,28-30` 的 confirmed production intent；button／slash／quick-action 才有执行权。

**复刻现状**：`/story-write` 在 foundation-ready、无 review、无 start 时写 `workflow-start.json`；工作台 `foundation-ready` 节点的「开始下一章」/「稍后」与索引里的开始/已开始/本章完成状态已接；命令 followup 带 `story-command` source。P1 面板固定第 1 章。

**判定：等价** — 确认/取消、锁竞争、followup 回执有测试；P1 面板固定第 1 章、动态章节与工作台布局由 `panel.workbench` 承接。

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

## 批次 D：P3 正文生产

### chapter.write

**源工程证据**：`agents/writer.ts` 的 `buildWriterSystemPrompt`：作品身份、governed contract、length contract（目标、计数口径）、narrative person、protagonist 规则、book rules 与 style guide 权威块；WriterAgent 返回标题与正文。

**复刻现状**：`story_write_chapter` 只校验章纲、标题、正文并落盘；标题由模型传入；writer 子代理的提示由主编临场拼，缺少上述契约块。

**判定：机制等价（D16 已偿还）** — 六段 writer 契约（权威／字数／人称／主角／规则／风格）与本章章纲由 `stages/writer.ts` 注入 write 阶段；writer pass 的 `context.json` selectedContext 也已注入；标题拒绝章号前缀。

### chapter.review

**源工程证据**：审稿 system prompt 要求按审稿 Skill 与权威上下文审查、提交编号原文证据；宿主把 `governed-context` 与 `chapter-N` 一起编号；审计失败生成 `unavailable` 观察；`reviewedArtifact` 记录被审版本。

**复刻现状**：`story_review_chapter` 校验观察并落盘；来源为章节正文与章纲 memo；`sourceRefs` 工具 schema 已收紧为对象数组；`reviewedArtifact` 由 artifact store 的 current revision 填充，number-aware 标题归一化后字节不匹配则省略；没有 artifact 的旧工作区仍可审稿，但记录无 identity。

**判定：等价（D17、D18 已偿还）** — 编号原文与章纲由 `stages/review.ts` 注入；`sourceRefs` 字符串在入参被拒绝；`reviewedArtifact` 来自 `source/artifacts/manifest.json` 的 `chapter-<NNNN>` current revision，且只在 revision bytes 与被审正文一致时写入。

### chapter.revise

**源工程证据**：`pipeline/runner.ts:874-1120` 的 `reviseDraft`；`agents/reviser.ts:13-15` 的五种模式与 `:167-190` 的模式协议；`harness/tools/longform-production.ts` 的 `revise_chapter`（`targetText` 绑定局部修订）；`state/chapter-workspace.ts:61-80` 的 `archiveChapterVersion`；Studio `server.ts:5571-5599,5832-5870` 的修订/重写入口。

**复刻现状**：`story_revise_chapter` 支持五种模式（默认 rewrite），覆盖同一章节文件、旧正文归档到 `source/chapters/.versions/NNNN/`、追加 artifact revision（r2，parent r1，旧 revision superseded）、作废旧审稿把阶段送回 review。spot-fix 用 `ranges`＋`replacements` 逐段构造正文，空串删段、多行按换行分行；`targetText` 对任意模式生效，字符级校验片段外不变。面板 `chapter-done` 由索引根动作给出「修订本章」。

**判定：机制等价（重审闸门）+ 保真债 D42／D45／D56** — 修订后的自动复审由审稿闸门承接，`dsh-mapping.md` 有偏差行；自动重结算未复刻，随 D34。多段范围与 `targetText` 任意模式已交付（D53 注销）；revision 缺 `snapshotPath`（D42）、索引与后代标记未写（D45）、回执缺 `changedRegion`（D56）是债。

## 批次 E：P4 结算与定稿

### chapter.summary

**源工程证据**：`agents/settler-tool.ts:21-62` 的 `chapterSummary` 七字段；`models/runtime-state.ts:39-56` 的行 schema（chapter ≥1、title 非空、strict）；`state/state-reducer.ts:195-213` 的排序与重结算替换；`agents/writer.ts:214-260` 的 `settleChapterState` 返回摘要与状态；`pipeline/runner.ts:999-1123` 结算后随章节保存。

**复刻现状**：`story_summarize_chapter` 写 `chapter_summaries.json` 与 `chapter_summaries.md` 投影；七字段校验、同章替换、按章号排序；前置为本章有正文与审稿记录；坏状态拒绝覆盖。摘要由 settler 子代理在 `chapter-done` 协议里产出。

**判定：保真债 D48** — 七字段、排序与同章过滤一致；但源没有独立摘要入口，摘要只在结算 schema 内产生、随 `saveChapter` 同批写，且仅 `allowReapply` 时替换/拒绝重复；复刻新增可先于结算的 `story_summarize_chapter` 且无条件替换。账本 `source:` 同时改指 `agents/settler-tool.ts`。

### chapter.settle

**源工程证据**：`agents/settler-tool.ts:45-82` 的 delta 形状；`state/state-reducer.ts:17-199` 的章节前进、hooks 合并与终态保护、facts 失效与同 key 替换；`utils/hook-arbiter.ts:24-90` 的候选伏笔 id 分配；`state/state-validator.ts:15-100` 的整份校验；`agents/settler-prompts.ts:5-45` 的 settler 提示；`agents/state-validator.ts:23-95` 的状态校验与 `pipeline/chapter-truth-validation.ts:39-104` 的对账重试。

**复刻现状**：`story_settle_chapter` 一次提交写四份状态 JSON 与三份投影，推进 `manifest.lastAppliedChapter`；hooks 六动作（候选创建、upsert 合并、mention 不推进、resolve 推进、defer 不推进、superseded 撤回需 notes）；facts 的 expire 与同 key 失效；摘要同批替换；整份状态校验。结算前要求四份状态文件都存在，缺失时在写盘前拒绝；章号只拒倒退，允许大于 `lastAppliedChapter` 的跳章。

**判定：保真债 D33／D34** — 结算规则按源 reducer 复刻；逐章快照已由 `chapter.finalize` 写出，缺口是不按快照做基线重算（D33）；缺状态校验 agent 与 reconciliation 重试（D34），写入前没有模型对账。状态缺失前置与跳章已按源对齐（D46／D47 注销）。

### chapter.finalize

**源工程证据**：`writer.ts:364-450` 的 `saveChapter`（章节 + 三份投影 + 四份状态 JSON + `story/snapshots/<chapter>/` 七份文件 + `chapters/index.json`，一次原子提交；标题变化删除被取代文件）；`manager.ts:495-520` 的 `snapshotStateAt`；`runner.ts:1424-1434` 的 `markBookActiveIfNeeded`；`models/chapter.ts:5-16` 的 `ChapterMeta`。

**复刻现状**：`story_finalize_chapter` 写 `source/story/snapshots/<chapter>/` 七个文件；严格读取 `source/chapters/index.json`，只替换本章条目、保留其余条目（已有条目保留 `createdAt`，`updatedAt` 取当前时间，新条目追加），标题经文档头（含 `：` 形式）并经文件名兜底、字数取自正文；把 `work.status` 从 `draft` 推进到 `active`。索引缺失/非法/条目不合 schema 时在写盘前拒绝。

**判定：保真债 D35／D37** — 源在结算后一次 `saveChapter` 原子写章节、状态、快照与索引；复刻拆成写作/修订 → 审稿 → 结算 → 定稿，中间态没有快照与索引（D37，重新定稿可补齐）；章节索引缺 `lengthTelemetry`／`tokenUsage`（D35，superseded 清理当前不可观测）。索引的单行更新与严格校验已交付（D49 注销）。

## 批次 F：P5 章节运维与对账

### chapter.reopen

**源工程证据**：`state/chapter-workspace.ts:61-130` 的版本归档（id `<时间戳>_<来源>_<uuid>`、来源 `manual|agent|revision|regeneration|restore`、`chapters/.versions/<NNNN>/`、列表倒序）；`studio/src/api/server.ts:3132-3175` 的版本列表/读取与 restore；`interaction/edit-controller.ts:337-380` 的 `chapter-replace`（归档当前、替换正文、清 `chapter-NNNN.*` 运行时文件但保留 user-brief、索引记人工编辑观察）。

**复刻现状**：`story_chapter_versions` 列归档版本；`story_reopen_chapter` 按 `versionId` 分流。恢复对任意章可用：替换正文、归档当前为 `restore`、清该章全部运行时文件（保留 user-brief），不动状态指针/摘要/facts/hooks；重开只对最后已结算章：保留正文、清运行时、写或沿用 workflow start、指针退回上一章并删除本章摘要行。工具返回提交后的真实阶段。

**判定：机制等价（重开指针回退）+ 保真债 D33／D36** — 源恢复分支已按源对齐：任意章、只换正文与运行时、不动状态；重开分支的指针回退与摘要删除是 DSH 阶段判定的机制等价，已登记 `dsh-mapping.md`。源在索引里记 `manual-edit-review` 与 `provenance: edited`，复刻未更新索引（D36）；恢复更早章后的状态重建（源 `requiresTruthRebuild`）没有等价流程（并入 D33）。D43／D44／D55 已注销。

### chapter.move-delete

**源工程证据**：`state/chapter-delete.ts:33-115` 的 `deleteLatestChapter`：只允许删最新章；章节文件先移到 `chapters/.trash/`（不硬删）；删前校验上一章快照 `story/snapshots/<latest-1>/current_state.md` 与 `pending_hooks.md` 存在；回滚失败把 trash 文件搬回；返回 `rolledBackTo`／`discarded`。

**复刻现状**：`story_delete_chapter` 只删最新章——前置只 stat 上一章 `current_state.md` 与 `pending_hooks.md`；`state/*` 按快照实际文件恢复，缺 `chapter_summaries.md` 时删投影，活状态里多出的 `state/*` 一并删除；最新章与保留项来自严格读取的 `chapters/index.json`，保留项原样写回；章节文件移到 `chapters/.trash/`（重名加 `-2` 后缀），删更晚章的快照/运行时/草稿与 `memory.db*`；提交失败把 trash 搬回。删除不读 `work.json`。foundation details 写 `snapshots/0/` 初始快照，删除第 1 章可用。

**判定：等价** — 源没有移章/重排，只删最新章；前置、最新章判据、索引回写、trash 与失败搬回、检索库删除均与源一致。

### state.check

**源工程证据**：`agents/state-validator.ts:23-95` 的 `StateValidatorAgent.validate`：模型提交布尔 `reconciliationRequired` 与证据报告，报告缺失时返回 `STATE_RECONCILIATION_REASON_REQUIRED`；`pipeline/chapter-truth-validation.ts:39-104` 的校验与 reconcile 流程。

**复刻现状**：`story_state_check` 接收子代理产出的 `reconciliationRequired` 与 `reportMarkdown`，校验必填报告（`STATE_RECONCILIATION_REASON_REQUIRED`）并返回只读观察；不写作品。工具 description、参数说明与 `chapter-done` 协议写明源判据：仅当换一份 truth projection 能消解时为 true，正文/权威矛盾只作观察、不授权重结算。自动“结算后校验 + 重结算”仍未接（D34）。

**判定：保真债 D34** — 只读对账入口已交付，布尔判据已进入模型可见的工具说明与阶段协议（D51 注销）；源在结算后自动校验并可能重结算，复刻仍要作者显式发起，自动路径未接（D34）。账本 `source:` 已改指 `agents/state-validator.ts`。

## 批次 G：P6 产物与工作台

### artifact.identity

**源工程证据**：`harness/artifact-revisions.ts` 的 `createCurrentArtifact`／`stageArtifactRevision`／`promoteArtifactRevision`、`contracts.ts` 的 manifest/revision 不变量与 `WorkResourceIdSchema`／`RelativeArtifactPathSchema`；章节 revision 的 path 直接指向 `source/chapters/...`，`agents/continuity.ts` 用 current revision 生成 `reviewedArtifact`。

**复刻现状**：`core/artifact-store.ts` 用 `source/artifacts/manifest.json` 记录 chapter artifact 的 `r1` current revision，path 指向章节文件；`writeChapterDocument` 同一次提交写章节与 manifest；`reviewChapter` 读取 current revision 并写 `reviewedArtifact`；checksum/byteLength/current/parent/superseded/ID/路径校验与源一致。

**判定：等价** — 章节产物 identity 与 review 消费已接通；manifest 是独立索引而非 WorkManifest 内嵌，登记在 `dsh-mapping.md`。

### export.work

**源工程证据**：`interaction/export-artifact.ts:12-36` 的 `ChapterExportSourceError`（`CHAPTER_EXPORT_SOURCE_MISMATCH`，details 含缺失/重复/未入索引）；`:100-160` 的 `buildExportArtifact`（txt／md／epub、章节索引顺序、书名开头、`renderChapterDocument` 重渲染）；`:162-182` 的 `writeExportArtifact`；`studio/src/api/server.ts:5606-5675` 的下载与 `export-save`（落 `bookDir/<id>.<fmt>`）。

**复刻现状**：`/story-export [txt|md|epub]` 命令（宿主执行）＋面板页头格式选择与「导出」按钮（`runCommand`，不经过 agent）；索引与章节文件四种不一致都拒绝且不写目标文件；导出到工作区根 `<workId>.<format>`，临时文件 + rename 原子替换；EPUB 用最小 ZIP store 实现（`mimetype` 第一项不压缩、container／content.opf／nav／章节 XHTML）。

**判定：保真债 D50** — 三种格式、索引一致性校验、章节渲染与落点与源一致；EPUB 章标题取裸索引 title、`xml:lang` 固定 `zh-CN`、导航标题固定「目录」，与源取渲染标题、按 `work.language` 不一致；temp+rename 是源没有的写入方式。

### backup.restore

**源工程证据**：`cli/src/book-backup.ts:34-37` 的备份目录（works 之外、不含备份）；`:39-84` 的 `createBookBackup`（只要求作品目录、id 时间戳+后缀+冲突号、整本 cp）；`:86-107` 的 `listBookBackups`（mtime ISO、id 倒序）；`:109-150` 的 `restoreBookBackup`（id 安全校验、pre-restore、`rm`+`cp`）；`cli/src/commands/book.ts:301-374` 的 CLI 接线与“坏 book.json 也要能备份”的注释；`cli/src/__tests__/book-backup.test.ts`。

**复刻现状**：`/story-backup [create|list|restore <id>]` 命令，create/restore 在 `withWorkAction` 锁内；备份集合为作品拥有项 `work.json` + `source/`（排除活动锁与 `panel.index.json`），恢复只替换这两项、保留根上 `.git`/作者文件/导出/`.backups` 与锁；不读 `work.json`；回收死事务失败时隔离为 `.dead-txn-*`；pre-restore 与 id 规则同源。

**判定：机制等价（备份位置、恢复范围、死事务隔离三条偏差）+ 保真债 D38** — 位置与范围由 DSH“工作区是唯一稳定根、根可能是仓库根”决定，死事务隔离由复刻的事务目录在作品根决定，三条都登记在 `dsh-mapping.md`；导出文件不回滚记 D38。

### materials.import

**源工程证据**：源素材导入与 reference context。

**复刻现状**：未实现；行 missing；D22/D24 依赖它。

**判定：保真债（未立债号）** — P6 行 missing。

### search.unified

**源工程证据**：源记忆／素材／技能统一检索。

**复刻现状**：未实现；行 missing；D22/D24 依赖它。

**判定：保真债（未立债号）** — P6 行 missing。

### panel.workbench

**源工程证据**：Studio `pages/` 的工作台、阶段按钮、只读产物浏览；`BookDetail` 的写下一章；立项提案在对话里完成。

**复刻现状**：作品页是工作台：阶段栏、本阶段产物列表、详情/`<pre>` 正文，当前阶段的动作集中在右栏顶部动作条；索引 `panel.index.json` 由宿主投影（写 action 成功后重建、会话发布时补建缺失/旧索引），面板只读不触发；产物按白名单显示（状态 JSON、`memory.db`、流程记账不出现；章节正文归正文/审阅；运行时诊断默认折叠），作者产物的 JSON 用键值树并可切原始；动作经宿主命令/提示（确认、下一章、退回、查看待确认、稍后、规划/写作/审阅）；无作品只给对话引导，没有新建表单；没有「刷新索引」。

**判定：机制等价 + 保真债 D39／D40／D41** — DSH client 插件 + slots + remote workspace-files 替代 Studio 前端；工作台、对话立项、宿主投影与阶段动作由进程级测试覆盖。作者裁定不做桌面回执（D31 关闭），`artifacts/real-runs/panel.workbench.json` 为交付证据。源真值文件可编辑、Studio 有删除按钮、白名单不含额外 4 项，复刻分别为只读、无动作、多列，记债。

### panel.logs

**源工程证据**：Studio `components/` 的调用日志。

**复刻现状**：未实现；行 missing。

**判定：保真债（未立债号）** — P6 行 missing。

### panel.analysis

**源工程证据**：Studio `pages/` 的分析/节奏。

**复刻现状**：未实现；行 missing。

**判定：保真债（未立债号）** — P6 行 missing。

## 批次进度

| 批次 | 阶段 | 能力行 | 状态 |
| --- | --- | --- | --- |
| A | P0 运行时骨架 | 6 | 完成 |
| B | P1 创意、立项与基础设定 | 23 | 完成 |
| C | P2 章前规划 | 4 | 完成 |
| D | P3 正文生产 | 3 | 完成 |
| E | P4 结算与定稿 | 3 | 完成 |
| F | P5 章节运维与对账 | 3 | 完成 |
| G | P6 产物与工作台 | 8 | 进行中（4/8） |

阶段合同与出口见 [`scope.md`](scope.md)；能力状态只由 `check-capabilities` 生成。

## v1 之外

`short.*`、`script.*`、`radar.topic`、`forecast.plot` 不在 v1 P0–P6 出口；账本保留 `missing`，对应源模块另行规划。它们不要求 `###` 审计段；不得借“补齐”混进当前阶段。
