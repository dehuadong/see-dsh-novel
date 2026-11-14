# Agent Note: chapter.settle —— 按章用量记账与索引 tokenUsage（D60）

Status: implemented

## Problem

源工程在发布章节时把 writer + review 的 `tokenUsage`（prompt／completion／total 三字段）写进章节索引条目（`chapter-persistence.ts` 的 `persistChapterArtifacts`）。复刻的索引没有这三字段：D35 只能交付 `lengthTelemetry`，把 `tokenUsage` 拆成 D60。

DSH 侧模型用量不在工具边界：`story_telemetry` 从子会话投影读到的是四个桶（uncached input／output／cache read／cache write），且不自动归属章节。要让索引写出源形状的三字段，需要一个按章记账入口：主编把本章的 writer／review 子会话 id 交给工具，工具从投影汇总并落到运行时用量文件；结算发布读取它写索引。

标题变化删除 superseded 文件仍归 D61（当前没有改标题写入路径），不在本行。

## 源工程证据

- `pipeline/chapter-persistence.ts:8-39`：发布条目 `tokenUsage: params.tokenUsage`（`{promptTokens, completionTokens, totalTokens}`），可选；已有条目保留 `createdAt`。
- `pipeline/runner.ts:1338-1372`：`totalUsage` 从 writer 输出用量开始，累加 `reviewChapterDraft` 的 review 用量；`:1430-1436` 把 `tokenUsage: totalUsage` 交给 `persistChapterArtifacts`。
- `state/manager.ts` 的 `loadChapterIndex` 严格读索引；`models/chapter.ts:14-19` 的 `tokenUsage` 为可选 `{promptTokens, completionTokens, totalTokens}`。
- `pipeline/runner.ts:1064-1100` 的修订索引更新只加 `lengthTelemetry`，不写 `tokenUsage`——修订保留已有值。
- 复刻现状：`ChapterIndexEntry.tokenUsage` 已由 D35 补成可选；`story_settle_chapter` 发布不写该字段；`story_telemetry` 只读子会话投影（`runtime.telemetry`），没有按章记账入口；`revisedChapterIndex` 以 spread 保留 `tokenUsage`。

## Decision

### 范围与非目标

范围（`chapter.settle`／`chapter.revise`／`runtime.telemetry`／`runtime.stage-context`；按章用量工具是 `chapter.settle` 的实现细节，不新增能力行）：

1. **新工具 `story_record_chapter_usage`**：参数 `{chapter, childSessionIds: string[]}`。校验章号 ≥1、id 非空且去重；用 `subagents.listDescendants(当前会话)` 确认每个 id 都是本会话的**直接** `child`（`kind === 'child'` 且 `depth === 1`，孙会话与重复计数拒绝）；用 `sessionQuery.observeSession(id, { signal })` 读每个子会话的 `tokenUsage` 投影（四桶，缺任一桶拒绝），并在 `finally` 释放观察；汇总后映射为 `{promptTokens: uncachedInputTokens + cacheReadTokens + cacheWriteTokens, completionTokens: outputTokens, totalTokens: prompt + completion}`；写 `source/story/runtime/chapter-NNNN.usage.json`（version 1、chapter、childSessionIds、tokenUsage、createdAt）。同一章再次调用覆盖旧文件（作者重做后可重记）。
2. **结算读取**：`story_settle_chapter` 发布（含扣下）前读该章 usage 文件；合法则把 `tokenUsage` 写进索引条目；不存在、损坏、章号不符或字段非法时按「无用量」处理（索引不写该字段，不阻断发布，与源「用量可选、缺省不失败」一致）。发布成功的同一 `commitFoundation` 删除 usage 文件（坏文件也删）。
3. **修订保留**：`story_revise_chapter` 的索引更新保留已有 `tokenUsage`（现有 spread 已满足），不读取、不更新、不删除 usage 文件；补测试锁住。
4. **共享用量读取**：把 `runtime.telemetry` 里的 `usageOf` 与会话观察释放逻辑抽到 `plugin/session-usage.ts`（保持插件层，不让 `core` 依赖 `PluginContext`），`telemetry-tool` 与新工具共用；`runtime.telemetry` 的回执行为不变。
5. **工具装配**：在 `plugin/agent.ts` 的 install/dispose 清单注册 `installChapterUsageTool`，并补 `host.test.mjs` 的工具数组断言。
6. **协议**：`review` 阶段改为派审稿子代理产出 observations（主会话拿回后调 `story_review_chapter`）；`chapter-done` 结算步骤加一条——记录本章用量时，用 `story_telemetry` 取 writer／review 两个**直接**子会话 id，再 `story_record_chapter_usage`；结算写索引并删除 usage 文件。拿不到用量时可以不记（`tokenUsage` 可缺省）。
7. **已发布章拒绝记用量**：工具发现该章已有 `source/chapters/NNNN_*.md` 时拒绝，避免孤儿文件；用量只在发布前记录。

非目标：

- 不自动发现“哪些子会话属于本章”；由主编显式给 id，工具只校验是本会话**直接** child（`kind==='child' && depth===1`）。
- 不改 `story_telemetry` 的回执形状；不改 D35 的 `lengthTelemetry`；不改 D61 的标题删除。
- 不把用量写进面板/导出；不新增按章成本分析。
- 不把 usage 文件当作品正文；它是运行时诊断，发布后删除。

### 产品行为与验收

- 作者/主编记录本章用量后，结算发布的索引条目带 `tokenUsage`，三字段与子会话投影一致；usage 文件在发布后消失。
- 未记录用量时发布照常，索引无 `tokenUsage`。
- 修订已发布章后索引保留原 `tokenUsage`；usage 文件不影响修订。
- 判定以「## Acceptance criteria」为准。

### 决定与未决问题

- **按章 id 显式输入**：DSH 没有“章节 ↔ 子会话”映射；自动推断会误把 planner／composer 算进本章。显式 id + 子会话校验是唯一可控口径。
- **四桶到三字段的映射**：源是 provider 的 prompt／completion；DSH 投影把输入拆成未缓存／缓存读／缓存写。`promptTokens` 取三个输入桶之和，`completionTokens` 取 output，`totalTokens` 取两者之和；在 `dsh-mapping.md` 登记为机制等价，并注明缓存桶归入 prompt。
- **usage 文件发布后删除**：源没有单独文件；保留会让旧用量泄漏到下一次发布。发布失败不删，便于重试。
- **修订不更新用量**：源 `reviseDraft` 只加 `lengthTelemetry`，`tokenUsage` 保留；复刻照此，不允许修订覆盖作者已记录的用量。
- **无用量时不伪造 0**：源发布恒写三字段，无用量时 `totalUsage` 兜底 0；复刻拿不到 usage 文件时省略字段，不把「没记」写成「没花」。这是 DSH 无法区分两者造成的机制偏差，登记 `dsh-mapping.md`，并说明省略字段是源 schema 允许的可选缺省。
- **settler／state-check 用量不计入**：源 `output.tokenUsage` 与 review 用量的累计发生在 runner 内，settler 的结算调用在 writer 侧；复刻把 settler／state-check 派成独立子代理，不能自动归入本章 `tokenUsage`。本行只记 writer／review 两个直接子会话，该归因差登记 `dsh-mapping.md`（不伪造合并数）。
- 未决问题：无。

### 评审与批准证据

- Plan Review 第 1 轮（Standards／Spec／Architecture）：Standards 报 1 blocker（坏文件拒绝结算属自创失败）＋3 major（新能力行 source 不实、无用量省略未登记、usage 文件生命周期）＋2 minor；Spec 报 1 blocker（审稿在主会话，记账集缺审稿用量）＋4 项（0 兜底、文件删除失去审计、已发布章孤儿、装配/批次）；Architecture 报 1 blocker（新工具未接入 agent 装配）＋3 major（stage-context 同步、孙会话/重复计数、释放与 signal）＋1 minor（core 依赖 PluginContext）。已修：坏文件按无用量不阻断；不新增能力行，工具归 `chapter.settle` 实现；登记四桶→三字段、省略 0、usage 文件生命周期；审稿派子代理；直接 child+signal+finally；helper 落 `plugin/session-usage.ts`；agent/host 装配与 stage-context 同步。
- 第 2 轮：Standards 指出四处表述互斥；Spec 指出设计/验证/非目标不一致；Architecture 指出 settler/state-check 归因、chapter.review 同步、坏文件静默。已修：统一 ENOENT／解析／校验=无用量、其它 I/O 抛出；只记 writer/review，settler/state-check 归因差登记；chapter.review realRun/审计入同步；AC7 加 review 协议断言。
- 第 3 轮：Standards／Spec／Architecture 均通过。
- 作者裁决范围：2026-11-14，D60 执行；D61 仍待。
- 作者批准实施（2026-11-14）：`/implement 批准，执行实现 D60（含跨 chapter.settle / chapter.revise / chapter.review / runtime.telemetry / runtime.stage-context）`；执行授权覆盖实施、Implementation Review、范围内修正与 Verify。

## Design

### 共享用量读取（plugin/session-usage.ts）

- 从 `plugin/telemetry-tool.ts` 抽出 `usageOf(value)`（四桶校验）与 `release(observation)`（`[Symbol.dispose]`）；`telemetry-tool` 改 import，回执不变。
- 新 `readChildUsage(ctx, exec, childIds)`：
  - `ctx.get('subagents')`、`ctx.get('sessionQuery')` 缺失时报错；根会话 id 取 `exec.agent.session.id`。
  - `listDescendants(root)` 建 `Map<id, row>`；每个 child id 必须在其中、`row.kind === 'child'` 且 `row.depth === 1`，否则抛 `CHAPTER_USAGE_SESSION_UNKNOWN`（孙会话与父子同传都拒绝，避免重复计数）。
  - 逐 id `observeSession(id, { signal: exec.signal })`；`usageOf(...)` 为 undefined 时抛 `CHAPTER_USAGE_UNAVAILABLE`（带 id）；`try/finally` 释放观察。
  - 累加四桶，返回 `{promptTokens, completionTokens, totalTokens}`。

### 用量文件（core/chapter-usage.ts）

- `chapterUsagePath(chapter)`、`readChapterUsage(root, chapter)`（严格校验 version／chapter／三字段非负／total=prompt+completion；ENOENT、JSON 解析失败或校验失败返回 null，其它 I/O 错误抛出）、`renderChapterUsage` 写文件内容；工具与结算共用。

### 工具（plugin/chapter-usage-tool.ts）

- `story_record_chapter_usage` 参数 `{chapter, childSessionIds}`；schema 只约束类型（DSH schema 子集无 `minimum`），`chapter ≥ 1` 在 execute 校验。
- 执行：`withWorkAction`；校验 id 去重非空、该章未发布（`loadChapterDocument` 非空则拒绝，避免孤儿文件）；`readChildUsage`；一次 `commitFoundation` 写 usage 文件；回执 `{chapter, childSessionIds, tokenUsage, path}`。
- 装配：`plugin/agent.ts` 注册/注销 `installChapterUsageTool`；`host.test.mjs` 名单加 `story_record_chapter_usage`。
- 描述写明用途与「结算后删除」。

### 结算（pipelines/long/settle-tool.ts）

- 发布块前 `const usage = await readChapterUsage(root, chapter)`；合法时 `entry.tokenUsage = usage`；null 不写字段。
- `deletes` 加 `chapterUsagePath(chapter)`；发布/扣下都删（坏文件也删）。
- 读取：ENOENT／JSON 解析／校验失败返回 null；其它 I/O 错误照常抛出。不回写 `lengthTelemetry` 或其它字段。

### 修订（core/chapter-index.ts）

- `revisedChapterIndex` 已 spread 当前条目，`tokenUsage` 自动保留；补测试，不改代码。

### 协议（pipelines/long/stages/index.ts）

- `review` 阶段明确：派审稿子代理按注入的方法审稿，拿回 observations 后调 `story_review_chapter`；审稿用量因此是可直接记账的 child 会话。
- `chapter-done` 结算步骤加一条：「记录本章用量：`story_telemetry` 取 writer／review 的**直接**子会话 id → `story_record_chapter_usage`；结算写 `tokenUsage` 并删除 usage 文件；拿不到就跳过，`tokenUsage` 可缺省。id 以本章委派回执为准，错归属由作者核对 childSessionIds。」不改变既有结算两阶段。

### 失败行为

- 工具：空 id／重复 id、非本会话直接 child（含孙会话）、投影缺四桶、章号非法都拒绝且不写 usage 文件。
- 结算：usage 文件不存在（ENOENT）、版本/章号/字段非法、JSON 解析失败都按无用量处理，照常发布并删除坏文件；其它读取错误（权限、I/O）照常抛出，不掩盖环境问题。
- 修订：不读 usage 文件；`tokenUsage` 保留。
- 清理：`reopen`／`restore`／`delete` 会清掉 `chapter-N.*` 运行时（含 usage 文件）；失败结算保留文件供重试，成功删除。

### 同步清单（六处）

1. `capabilities.yaml`：`chapter.settle` 的 title/source 补「按章用量→索引 tokenUsage」，realRun 重录（`chapter-usage-tool.ts` 是该行的实现细节，不新增能力行）；`chapter.revise` 的说明补「保留 tokenUsage」；`runtime.telemetry` 的实现仍指 telemetry 工具（共享 helper 抽取不改回执）；`check-capabilities -- --write`。
2. `docs/fidelity-audit.md`：`chapter.settle` 段补 usage 文件→索引 `tokenUsage`（只记 writer/review，不含 settler/state-check）、坏文件按无用量处理；`chapter.revise` 段补保留；`chapter.review` 段补「审稿派子代理」；D60 注销，D61 保留；批次 E/F 的 D60 行更新。
3. `docs/scope.md`：删 D60，保留 D61；P4/P5 出口只剩 D61；依赖句同步。
4. `docs/dsh-mapping.md`：新增「chapter.settle：按章用量记账」偏差行（显式子会话 id、四桶→三字段、缓存桶归 prompt、只记 writer/review 不合并 settler/state-check）与「无用量省略 tokenUsage 而非写 0」偏差行；`chapter.settle` 行补 usage 文件生命周期（reopen/restore/delete 清 `chapter-N.*`，成功发布删，失败保留）。
5. `artifacts/real-runs/`：`chapter.settle.json` 重录（含 `tokenUsage` 与 usage 文件删除）；`chapter.revise.json` 补保留断言；`chapter.review.json` 重录（审稿派子代理入口）；`runtime.stage-context.json` 重录（审稿派子代理＋结算记录用量步骤）。
6. 本 Note 转 implemented；`2026-11-14-settle-length-telemetry.md` 的 D60 指针改注销；`2026-11-05-runtime-telemetry.md` 的共享 helper 说明补链（不改回执）；`plugin/agent.ts`／`host.test.mjs` 的工具名单同批。
7. 测试：`chapter-usage`、`telemetry`、`chapter-settle`、`chapter-revise`、`stage-context`、`host` 同批；schema 断言进 `chapter-usage` 测试。
8. CI：推送后确认 `verify (ubuntu-latest)` 与 `verify (windows-latest)` 通过。

### 验证切入点

- `test/chapter-usage.test.mjs`：两个直接 child 的桶求和与三字段映射（含 AC1 数值例）；usage 文件内容/路径；空/重复/未知/非直接 child（含孙会话）/已发布章 id 拒绝；缺桶拒绝；同章覆盖；`withWorkAction` 回执。
- `test/telemetry.test.mjs`：抽取 helper 后回执不变。
- `test/chapter-settle.test.mjs`：有 usage 文件时索引 `tokenUsage` 写入、发布后文件删除；无文件不写；坏文件按无用量照常发布并删除；扣下同样写/删。
- `test/chapter-revise.test.mjs`：修订后 `tokenUsage` 保留。
- 文本断言：review 阶段与 chapter-done 协议含新步骤。

## Verification

1. 工具把两个直接子会话的四桶汇总为 `promptTokens = uncachedInput + cacheRead + cacheWrite`、`completionTokens = outputTokens`、`totalTokens = prompt + completion`；例：child A `{1200,800,40,10}` + child B `{300,100,5,5}` → `prompt=1560`、`completion=900`、`total=2460`。写 `source/story/runtime/chapter-NNNN.usage.json`，内容含 version／chapter／childSessionIds／tokenUsage／createdAt。
2. 空 id、重复 id、非本会话直接 child（含孙会话）、投影缺桶、章号非法、该章已发布都拒绝，不写 usage 文件。
3. 结算发布（含扣下）读到合法 usage 文件时，索引条目 `tokenUsage` 等于文件三字段；发布成功后 usage 文件被删除。
4. 结算无 usage 文件、文件损坏/章号不符/字段非法时，索引无 `tokenUsage` 且照常发布（坏文件在发布成功时删除），不阻断任何作品写盘。
5. 修订已发布章后索引保留原 `tokenUsage`；usage 文件不影响修订。
6. `runtime.telemetry` 的回执形状与行为不变（共享 helper 抽取后测试通过）。
7. `review` 阶段协议写明派审稿子代理并拿回 observations（测试断言）；`chapter-done` 协议写明记录用量的入口、直接子会话 id、“发布后删除”，且从本章委派回执取 id。
8. 六处同步完成（`chapter-usage-tool` 在 `plugin/agent.ts` 的 install/dispose 与 `host.test.mjs` 工具名单、`runtime.stage-context` realRun、schema 断言、D60 注销、D61 保留）；`pnpm run verify` 全绿；CI 双端通过。

## 实施记录

- Plan Review 三轴：Standards／Spec／Architecture 均通过（第 3 轮确认）。
- Implementation Review 第 1 轮：Standards 报 2 major（audit finalize/D35 note 的 D60 指针未注销、已发布章拒绝未登记/Note schema 不实）＋2 个 smell；Spec 报 5 项（坏文件变体无测试、修订不受 usage 影响无测试、同步未完成、schema 断言、协议断言不足）。已修：audit/D35 Note/runtime-telemetry Note 指针更新；mapping 登记已发布章拒绝；schema 措辞改为 execute 校验；usage 文件用严格 `isTokenUsage`（恰好三字段、非负、求和），索引保持源形状 `isIndexTokenUsage`（三整数，不额外约束负值/求和），坏 usage 的未知字段不再毒化索引；补章号不符/字段非法、修订保留、协议“直接子会话/删除 usage”断言；`validUsage` 去重、`ChapterTokenUsage` 别名删除。
- Implementation Review 第 2 轮：Standards／Spec 均通过（余 Message Chains 等判断项不阻塞）。
- 验证：`pnpm run verify` 通过（503 passed／1 skipped symlink）；`verify-notes`、`check-capabilities`、`verify-audit-coverage` 通过；CI `43557040441` 的 `verify (ubuntu-latest)` 与 `verify (windows-latest)` 均通过（提交 `7bef372`）。
## Alternatives considered

- **主编在结算参数里直接传 tokenUsage**：少一个工具。否掉：主编要自己汇总数字，无法校验来源；工具内显式 id + 投影是唯一可审计路径。
- **结算自动扫描所有子会话**：无需主编传参。否掉：无法知道哪些子会话属于本章；会把 planner／composer／state-check 算进去。
- **把 usage 写进章节正文/主题文件**：少一个运行时文件。否掉：用量是诊断，不属于作品正文；源也没有该文件。
- **修订也重算 tokenUsage**：索引更新更彻底。否掉：源修订只更新 `lengthTelemetry`，`tokenUsage` 保留；重算会覆盖章发布时的历史用量。
- **保留 usage 文件**：便于复查。否掉：旧用量会泄漏到下一次发布；发布成功即删，失败保留。

## Consequences
收益：索引写出源形状 tokenUsage，且来源（childSessionIds）可核对；代价见下。

- **显式 id 依赖主编**：主编选错子会话会把别的用量算进本章；工具只能校验“是本会话直接 child”，不能校验“属于本章”。协议与回执暴露 childSessionIds，作者可核对。
- **settler／state-check 不计入**：索引的 `tokenUsage` 只含 writer／review，低于源工程的累计值（源把结算调用算在 writer 侧）；已在 `dsh-mapping.md` 登记，不伪造合并数。
- **缓存桶归入 prompt**：源 provider 的 prompt 是否含缓存命中无法从 DSH 四桶还原；按输入总量计入 prompt，登记为机制等价。
- **usage 文件生命周期**：发布失败保留，便于重试；发布成功删除。若作者在结算前重记，覆盖旧文件。
- **修订保留历史用量**：修订后的新模型调用不会更新 `tokenUsage`（源行为）；需要新用量时只能等下一次发布（当前发布只对新章）。
- **runtime.telemetry 重构**：抽 helper 不改变回执，但需回归 telemetry 测试。

