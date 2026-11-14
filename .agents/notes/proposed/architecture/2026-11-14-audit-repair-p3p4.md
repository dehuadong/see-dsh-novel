# Agent Note: 审计修复第一批 —— chapter.write / review / revise / settle

Status: proposed

## Problem

2026-11-14 审计把 45 条 verified 中的 26 条判为保真债；第一批取 P3/P4 四行：`chapter.write`、`chapter.review`、`chapter.revise`、`chapter.settle`。它们直接决定 v1「正文 → 审稿 → 修订 → 摘要/结算/定稿」能否成立。

四行的差异已在审计证据中逐条记录（`artifacts/implementation-audit/rows/<id>.json`）：

- `chapter.write`：写草稿后阶段不前进（`.drafts/chapter-NNNN.md` vs detectStage 的 `.drafts/NNNN.md`）；writer 契约缺 genre/platform 首段、本章用户指令、min/max 与 delivery；标题章号前缀是自创拒绝；账本 implementation 指向非生产路径。
- `chapter.review`：一章只能审一次（源可重复审并替换索引观察）；governed-context 只有章纲 memo；修订审稿缺 before/current 对照与 scope 证据校验；审稿失败无 unavailable 记录；无 length delivery；证据字段未按源清空。
- `chapter.revise`：缺显式章长硬校验 `CHAPTER_LENGTH_OUT_OF_RANGE` 与 spot-fix 预算冲突 `CHAPTER_EDIT_SCOPE_CONFLICT`；非显式修订的“无观察即 changed:false”短路未复刻；更早章观察差异未登记。
- `chapter.settle`：四份状态 JSON 读取放宽（未知字段、非整数 chapter 不拒）；work.status 激活条件（draft→active vs 源 outlining→active）未登记。

## 源工程证据

- writer：`agents/writer-prompts.ts:17-35`（genre/platform＋Skill 首行、权威顺序）、`agents/writer.ts:453-526`（本章用户指令/方向优先/externalContext）、`:551-567`（target＋min/max 与计数口径）、`:364-451`（saveChapter 同批写章节/状态/快照/索引）、`:695-700`（sanitizeFilename）。
- review：`pipeline/runner.ts:819-871`（可重复审、索引 observations 替换、length delivery）、`agents/continuity.ts:40-96`（governed-context、修订 before/after、scope 双源校验）、`pipeline/chapter-review.ts:48-77`（unavailable 兜底）。
- revise：`agents/reviser.ts:96-114`（多段范围、targetText、`CHAPTER_LENGTH_OUT_OF_RANGE`、`CHAPTER_EDIT_SCOPE_CONFLICT`）、`pipeline/runner.ts:918-941`（非显式且无观察短路）、`:1043-1101`（复审观察并回写）。
- settle: `state/state-validator.ts:14-120`（四份 JSON strict、跨文件不变量）、`pipeline/runner.ts:2106-2115`（outlining→active）。
- 复刻现状：`write-tool.ts`、`chapter-draft.ts`、`chapter-review.ts`、`revise-tool.ts`、`revision-commit-tool.ts`、`settle-tool.ts`；审计 rows 有逐项 file:line。

## Proposal

### 范围与非目标

范围（四行 + `runtime.stage-context` 的路径/协议；不新增能力行）：

1. **chapter.write**
   - 统一草稿路径：`detectStage` 与 `story_write_chapter` 都用 `draftPath(chapter)`（`.drafts/chapter-NNNN.md`），写完阶段进 `review`。
   - writer 契约补：genre/platform 首段；本章用户指令（workflow-start.instruction 或 `chapter-NNNN.user-brief.md`）作为最高优先级块；显式 min/max 与计数口径；回执含 `delivery {target,min,max,actual,status}`。
   - 去掉标题章号前缀拒绝（源只 sanitize 文件名）；标题进入文件名前按源 sanitize。
   - `capabilities.yaml` 的 implementation 改指 `write-tool.ts`／`chapter-draft.ts`（生产路径），不指只被测试调用的 `writeChapterDocument`。
2. **chapter.review**
   - 允许重复审：同一章再提交时替换审稿记录；已发布章的索引 observations 替换（源无守卫）。
   - governed-context：审稿来源改为章节正文＋章纲＋当前状态/伏笔/故事框架/规则＋上一章；不再把章纲 memo 单独当 governed-context；仍缺 composer selectedContext 的部分登记为机制差异。
   - 修订审稿：`revisionDigest` 时自动加载修订前正文为 `chapter-N-before` 来源；`category=scope` 的 issue 必须同时引用 before 与 current，否则 `REVIEW_SCOPE_EVIDENCE_REQUIRED`。
   - 失败兜底：工具接受 `assessment: unavailable` 的审稿记录；阶段协议要求审稿子代理失败时提交 unavailable，不把失败伪装成通过。
   - 回执补 `wordCount`／`delivery`；观察 `evidence` 按源清空（只保留 quote/sourceRefs）。
3. **chapter.revise**
   - 增加 `assertChapterLength`：rewrite 与 spot-fix 候选按 work min/max 校验，越界 `CHAPTER_LENGTH_OUT_OF_RANGE`（带实际字数与区间）。
   - spot-fix 在固定文本已超 max 时返回 `CHAPTER_EDIT_SCOPE_CONFLICT`（与“content 与 ranges 构造不一致”分开）。
   - 非显式修订（工具调用带 `explicit:false`）且审稿观察为空时返回 `changed:false`，不写正文。
   - 更早章即时修订的观察差异登记到 `dsh-mapping.md`（不能只靠审稿闸口隐含）。
4. **chapter.settle**
   - 四份状态 JSON 读取改用与源等价的 strict schema：拒未知字段、chapter 为 int≥1、title 非空；`readStateSnapshot`/`inspectState` 共用。
   - work.status 激活：复刻的 `draft` 对应源的 `outlining`；在 `dsh-mapping.md` 登记 status 名称映射，或把源 `outlining→active` 显式映射为复刻 `draft→active`，不改 work schema。

非目标：

- 不修 AU-01–22、AU-27–35；不碰 panel/materials/search/export。
- 不实现 `chapter.import`/D61；不改审稿闸门本身。
- 不改 composer 的 selectedContext 选择算法；只把现有可用来源注入审稿。
- 不改账本状态；修复后由 tests/realRun 重算。

### 产品行为与验收

- 写第 1 章后阶段进入 review，不再需要手工改草稿文件名。
- writer 子代理拿到 genre/platform、本章指令、min/max；回执能看到越界/不足。
- 同一章可以重审，索引观察是最新一次；修订审稿能看到 before/current，scope 问题必须双引。
- 修订越界被拒；spot-fix 受保护文本超预算被拒。
- 状态文件出现未知字段/非整数 chapter 时结算拒绝，不再静默读入。

### 决定与未决问题

- **AU-23 的标题前缀**：去掉自创拒绝，靠文件名 sanitize；D61 仍归未来 `import_chapters`。
- **AU-24 的 governed-context**：完整 composer selectedContext 需要重做 context-select；本批先注入现有章纲/状态/伏笔/框架/规则/上一章，缺口登记为机制差异，不冒充源等价。
- **AU-24 的 unavailable**：DSH 工具无法捕获子代理失败，协议要求失败时提交 unavailable 记录；这是机制差异，登记 mapping。
- **AU-25 的非显式修订**：DSH 工具调用默认 explicit；新增 `explicit:false` 只为承接源的非显式短路，不变成常规入口。
- **AU-26 work.status**：不新增 `outlining` 状态，只登记 `draft` 对应源 `outlining`；避免 work.json schema 迁移。
- 未决问题：无。

### 评审与批准证据

- Plan Review：待填。
- 作者授权：本批四行。
- 批准实施：未给；执行授权：未给。

## Design

### 1. chapter.write

- `chapter-draft.ts` 的 `draftPath` 已产出 `chapter-NNNN.md`；`stages/index.ts` 检测同路径。补 `write-tool.test`：写后 `detectStage=review`。
- `renderWriterContract`：首行 `题材：…｜平台：…`；指令块取 `workflowStart.instruction` 或 `.user-brief`；min/max 来自 `work.metadata`；回执 `charCount/target/min/max/status`。
- `write-tool.ts` 删除标题前缀拒绝；文件名沿用 `safeChapterTitle`（本批不改 sanitize；与源 sanitize 差异保留在 AU-23 债？不，标题规则差异属于 AU-23 关闭项之一，若不改则不能关）。
- 账本 implementation 改 `write-tool.ts`；consumer 仍 `write-tool.test.mjs`。

### 2. chapter.review

- `reviewChapter` 删除“已有记录拒绝”，改为读取旧记录后覆盖；`reviewedChapterIndex` 用新观察替换；旧记录保留 `reviewedArtifact` 规则。
- `reviewSources` 组装顺序：chapter、governed-context（章纲＋current_state＋pending_hooks＋story_frame＋book_rules）、上一章正文（若有）；`sourceId` 与源同名。
- 修订：`revisionDigest` 时加 `chapter-N-before`（旧正文），`category=scope` 的 issue 的 `sourceRefs` 必须同时含 before 与 current。
- 证据：`resolveObservationSources` 后把 `evidence` 置空（源 `submitSourcedReview` 行为）；`quote`/`sourceRefs` 保留。
- 回执加 `wordCount`、`delivery`；unavailable 记录不阻断索引替换？源失败仍写 unavailable；工具接受。
- 阶段协议：审稿子代理失败 → 提交 unavailable，不跳过。

### 3. chapter.revise

- `core/revise.ts` 增 `assertChapterLength(content, min, max, countingMode)`；`revise-tool` 对构造结果与整段 content 均校验；错误码 `CHAPTER_LENGTH_OUT_OF_RANGE`。
- spot-fix：先算固定文本长度；若 >max，`CHAPTER_EDIT_SCOPE_CONFLICT`（与构造不一致分开）。
- `explicit?: boolean` 默认 true；false 且审稿观察为空 → `changed:false`，不写。
- 回执加 `wordCount/delivery`。
- mapping 补更早章观察差异。

### 4. chapter.settle

- `core/state.ts` 的 `readStateSnapshot`/`inspectState` 用 strict 校验：四份 JSON 未知字段拒绝、chapter int≥1、title 非空；错误码/消息指向文件与字段。
- work.status：settle-tool 的 `draft→active` 保留；`dsh-mapping.md` 加行“源 outlining→active ↔ 复刻 draft→active”，并说明复刻没有 outlining 状态。
- 测试：坏状态 JSON（未知字段/非整数 chapter/空 title）拒绝；正确状态仍发布。

### 同步与验证

- `fidelity-audit.md` 四行判定从保真债改为等价/机制等价（按证据），AU-23～26 关闭；scope 删对应 AU 行。
- `dsh-mapping.md` 只补偏差（审稿来源不足、unavailable、status 映射、更早章观察）。
- `capabilities.yaml` 改 chapter.write 的 implementation；real-runs 重录四行。
- tests：`write-tool`、`chapter-review`、`chapter-revise`、`chapter-settle`、`stage-context`；`pnpm run verify`。

## Alternatives considered

- **只修代码不改账本 implementation**：少改。否掉：真实生产路径与账本不一致，审计无法复核。
- **保留一章一審**：简单。否掉：源可重复审，D45 索引写回要能替换。
- **完整 composer selectedContext**：最贴源。否掉：属 `plan.context-select` 的 AU-20，本批只补现有来源并登记缺口。
- **新增 outlining 状态**：最贴源。否掉：要迁移 work.json 与全部判定；先登记名称映射。
- **把 D61/import 一起做**：顺手。否掉：无章节导入能力，D61 仍 latent。

## Acceptance criteria

1. `story_write_chapter` 后 `detectStage` 为 `review`；writer 契约含 genre/platform、本章指令、min/max；回执含 delivery；标题前缀不再拒绝。
2. 同一章可重审，索引 observations 为最新；修订审稿有 before/current，scope issue 缺双引时 `REVIEW_SCOPE_EVIDENCE_REQUIRED`；失败可落 unavailable。
3. 修订 rewrite/spot-fix 越界 `CHAPTER_LENGTH_OUT_OF_RANGE`；spot-fix 固定文本超 max `CHAPTER_EDIT_SCOPE_CONFLICT`；`explicit:false` 且无观察返回 changed:false。
4. 四份状态 JSON 的未知字段、非整数 chapter、空 title 被拒；work.status 映射在 mapping 有行。
5. 四行 fidelity 判定更新、AU-23～26 关闭、scope 删行、mapping 更新；real-runs 重录。
6. `pnpm run verify` 通过；CI 双端。

## Risks

- **范围大**：四行同时改 writer 提示、审稿、修订、状态 schema；分四张内部工单，按 write→revise→review→settle 顺序，避免交叉回归。
- **审稿来源仍不等于 composer**：本批补现有来源，selectedContext 缺口登记，不能宣称完全等价。
- **重复审**：索引观察替换可能覆盖历史；源也替换，保持同语义。
- **标题前缀**：去掉拒绝后，以章号开头的标题会进入文件名；源 sanitize 不拒绝，测试需锁文件名。
- **状态 strict**：旧工作区可能有未知字段，升级后会被拒；需在 mapping/迁移说明里写“旧工作区先修复”。

## Verification

- Plan Review 三轴：待填。
- 实施后：四行 tests、stage/review/revise/settle 回归、real-runs、`pnpm run verify`、CI。
