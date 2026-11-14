# Agent Note: chapter.review 重复审、上下文与修订对照（AU-24）

Status: implemented

## Problem

2026-11-14 审计把 `chapter.review` 判为保真债，AU-24 七条：

1. 修订审稿缺 before/current 对照来源与 scope 证据校验：源 `continuity.ts:50-95` 把 before revision 作为编号来源、要求 `category=scope` 同时引用两版，否则 `REVIEW_SCOPE_EVIDENCE_REQUIRED`。
2. 审稿失败没有 unavailable 观察：源 auditor 抛错仍写一条 unavailable；复刻失败就没有记录。
3. governed-context 来源不同：源是 composer selectedContext；复刻把章纲 memo 当 governed-context。
4. 一章一条审稿记录，第二次拒绝；源可重复审并替换索引 observations。
5. 源审稿返回 length delivery；复刻只返回 counts。
6. 已发布章无章纲仍可审是复刻新增放宽。
7. 观察 evidence 源在 `submitSourcedReview` 清空；复刻保留并写记录/索引。

## 源工程证据

- `agents/continuity.ts:40-96`：governed-context、修订 before/after、scope 双源校验。
- `pipeline/runner.ts:819-871`：可重复审、索引 observations 替换、length delivery。
- `pipeline/chapter-review.ts:48-77`：auditor 失败写 unavailable。
- `agents/base.ts:91`：`submitSourcedReview` 清空 evidence。
- 复刻：`chapter-review.ts:80-95`（已有记录拒绝、plan memo 当 governed-context）；`review-tool.ts`（一次记录、无 delivery）。

## Decision

### 范围与非目标

范围（`chapter.review` 单行）：

1. **重复审**：删除“已有记录不覆盖”；同一章再提交时覆盖记录，已发布章的索引 observations 用新观察替换（源语义）。
2. **governed-context**：读 `chapter-XXXX.context.json` 的 `selectedContext`（AU-20 的包），渲染成 `governed-context`；缺包时回退章纲 memo，**这是保真债**（源总有 composer selectedContext）。**源在重审时以 review brief 现场重编排并追加 `story/book_rules.md`，复刻没有该入口**；机制差异只登记“重审现场重编排缺失”，AU-24 保留债，不把读旧包说成等价。
3. **修订 before/current**：revision 模式下加入 `chapter-N@before`（修订前正文，取已发布 document 并校验 `revisionDigest(document)===baseDigest`）与 `chapter-N`（修订后正文）。`assessment=issue` 且 `category=scope` 的观察必须同时引用 before 与 current；缺一版或两者同版都抛 `REVIEW_SCOPE_EVIDENCE_REQUIRED`。
4. **unavailable**：工具接受 `assessment:'unavailable'` 的观察并落盘；协议要求审稿子代理失败时提交一条 unavailable，不伪装通过。
5. **delivery**：审稿回执/记录加 length delivery（源形状，仅显式 min/max）。
6. **移除放宽（记债）**：已发布章也要求章纲；源重审现场重编排不依赖 plan 文件，因此“无章纲拒绝”是复刻限制，记 AU-24 残余债。
7. **evidence 清空**：写入记录前把 observation.evidence 置空数组（保留字段，`evidence: []`），保留 `sourceRefs`。
8. **审稿契约**：`stages/review.ts` 与 `stages/index.ts` review 分支同步：编号来源注入 context 包渲染、revision before（`chapter-N@before`）/current；协议文本删“一章只审一次”。
9. 测试：重复审替换索引、context 来源、before/current、scope 拒绝、unavailable、delivery、无章纲拒绝、evidence 为空数组、reviewedArtifact 消费回归；realRun 重录。

非目标：

- 不改 context-package 的选择算法；只消费其包。
- 不改 writer/revise/settle；不改审稿闸门。
- 不新增“审稿子代理失败自动捕获”；DSH 宿主拿不到子代理异常，协议写 unavailable。

### 产品行为与验收

- 同一章可重审，索引 observations 是最新一次。
- 审稿来源是 context 包（缺包回退章纲）；修订审稿有 before/current。
- scope 问题必须双引，否则拒绝。
- 审稿失败可落 unavailable。
- 回执有 wordCount/delivery；evidence 落空数组。
- 无章纲的已发布章不再可审。

### 决定与未决问题

- **context 缺包回退**：旧工作区或 reopen 后可能没有 context.json；回退章纲 memo 并记为保真债，不伪造 selectedContext。
- **before 源名**：用源 `chapter-N@before`；取已发布 artifact 的 before 固定标签，取不到时用 `before` 占位并在 mapping 登记。before 正文只取已发布 document，且必须匹配 `baseDigest`。
- **unavailable 由协议承接**：宿主无法捕获子代理异常；工具只负责落盘。父代理兜底未实现，AU-24 因此保留债。
- **evidence 清空**：quote/sourceRefs 保留；evidence 落空数组，源同语义。
- 未决问题：context 包缺失的回退是否长期保留，由后续 composer 覆盖率决定。

### 评审与批准证据

- Plan Review 三轴：Standards／Spec／Architecture 均通过（多轮）。
- 作者授权：AU-24 单行。
- 作者批准实施：`/implement 批准，执行实现 chapter.review 审计修复（AU-24）`。

## Design

### 重复审

- `reviewChapter` 删除 existing 检查；读旧记录仅用于在正文未变时保留 `reviewedArtifact`/`reviewedRevisionDigest`，否则覆盖。
- `reviewedChapterIndex` 已替换 observations；已发布章写索引；草稿不写。
- 测试：同章两次审，第二次观察替换索引。

### governed-context

- `loadWriterContext` 读 `chapterContextPath`；存在时 `selectedContext` 渲染为 `## <source>\n<reason>\n<excerpt>`，source id `governed-context`。
- 缺包：`plan.memo.body` 作 fallback；这是保真债（源总有 composer selectedContext），记 scope/AU-24，不登记为合法机制偏差。
- 无章纲：无论 published/draft 都 throw。
- 测试：有 context 包时 sources 用包；无包时用 memo；无 plan 拒绝。

### 修订 before/current

- `reviewSources(root, chapter, revisionContent, beforeContent?, beforeLabel?)`：revision 模式 sources 加 `chapter-N@before` = beforeContent（旧正文）；`chapter-N` = revisionContent。
- `revisionSource` 返回 `{digest, content, beforeContent, beforeLabel}`；beforeLabel 用已发布 artifact 的 before 固定标签，取不到时 `before` 并在 mapping 登记。
- `resolveObservationSources` 增加 scope 校验：仅 `assessment==='issue'` 且 `category==='scope'` 时，sourceRefs 的 sourceId 必须同时包含 before 与 current；缺一版或 before/current 内容相同都抛 `REVIEW_SCOPE_EVIDENCE_REQUIRED`。
- 测试：缺一版拒绝；双引通过；source id 形状。

### unavailable / delivery / evidence

- `reviewChapter` 记录 `wordCount`、`delivery`（复用 length.ts，spec 来自 work/entry）。
- 观察输入 assessment=unavailable 允许；记录照写。
- 写记录前把每条 `observation.evidence` 置空数组（保留字段与 `sourceRefs`），不要解构删字段。
- 测试：unavailable 落盘；delivery 有界；evidence 不出现在记录。

### 同步

- `fidelity-audit.md`：`chapter.review` 维持保真债 AU-24（重审现场重编排缺失）。
- `scope.md`：AU-24 保留，只把已修项划掉，留重审现场重编排与 context 回退。
- `docs/dsh-mapping.md`：只登记“重审现场重编排缺失”机制差异；context 缺包回退与 unavailable 兜底记 scope/AU-24 债。
- `capabilities.yaml`：implementation/consumer 指向 chapter-review/review-tool；realRun 重录。
- Note 转 implemented；`verify-notes`。

## Alternatives considered

- **保留一章一審**：简单。否掉：源可重审，索引观察要能替换。
- **继续用章纲 memo 当 governed-context**：省事。否掉：源是 composer selectedContext；AU-20 已产出包，应消费。
- **宿主自动写 unavailable**：更自动。否掉：DSH 拿不到子代理异常；协议承接。
- **保留 evidence**：信息多。否掉：源清空，且 evidence 是模型自述。
- **允许已发布章无章纲**：宽松。否掉：源始终有 governed context。

## Consequences

- **重审覆盖**：旧审稿记录被覆盖；源同语义，索引替换。
- **context 包缺失**：旧工作区/reopen 后回退章纲；记保真债，不假等价。
- **before source**：artifact 缺失时用 `before` 标签；测试锁形状。
- **scope 校验**：只对 category=scope 强制，避免误伤其他类别。
- **delivery**：spec 用 entry/work，写工具与审稿口径一致。

## Verification

1. 同章可重审；已发布章索引 observations 被第二次替换。
2. 审稿来源优先 context 包；缺包回退章纲并记债；无章纲一律拒绝（reopen 删除 context 时同样回退，scope 同步）。
3. 修订审稿有 `chapter-N@before` 与 `chapter-N`；审稿契约同时展示两版；assessment=issue 的 scope 缺一版或同版抛 `REVIEW_SCOPE_EVIDENCE_REQUIRED`。
4. unavailable 观察可落盘；回执有 delivery（有界时）。
5. 记录/索引保留 observation.evidence 字段并置为空数组；sourceRefs 保留。
6. AU-24 保留为保真债（重审现场重编排未复刻）；scope/fidelity/audit row/realRun 同步；`pnpm run verify` 通过；CI 双端。

## 实施记录

- Plan Review 三轴：Standards／Spec／Architecture 均通过（多轮）。
- 实施：重复审替换、context 来源/缺包回退、before/current+scope、unavailable、delivery、evidence 空数组、无章纲拒绝；`pnpm run verify` 535 passed／1 skipped；realRun 重录；CI `43581686598` 的 `verify (ubuntu-latest)` 与 `verify (windows-latest)` 均通过（提交 `26cc585`）。
