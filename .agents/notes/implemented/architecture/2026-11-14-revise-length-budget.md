# Agent Note: chapter.revise 长度硬校验与修订预算（AU-25）

Status: implemented

## Problem

2026-11-14 审计把 `chapter.revise` 判为保真债，AU-25 五条：

1. 缺显式章长硬校验：源 reviser 在 rewrite 与 spot-fix 候选上 `assertChapterLength`，越界抛 `CHAPTER_LENGTH_OUT_OF_RANGE`（带 delivery／replacementBudget，可重试）；复刻 `minChapterLength`/`maxChapterLength` 从 work 读出后无人使用。
2. 缺 spot-fix 预算冲突：源在“受保护文本本身已超最大章长”时抛 `CHAPTER_EDIT_SCOPE_CONFLICT`；复刻把同名错误码只用于 content 与 ranges 构造不一致。
3. 非显式修订短路未复刻：源在 `externalContext` 为空、非 targetText、非 rewrite/rework 时先复审，观察为空返回 `changed:false`。
4. 更早章即时修订清空索引观察并另写复审 start；源在同一事务内复审并写 `postRevisionObservations`，差异未登记。
5. 源回执有 `wordCount` 与 length delivery；复刻只有 charCount/target。

本行只修 `chapter.revise`；`chapter.write`/`review`/`settle` 另立。

## 源工程证据

- `agents/reviser.ts:96-139`：spot-fix 先按 ranges 置空得到 `fixedContent`，算 `fixedLength` 与 `replacementBudget`；`maximum<0` 抛 `CHAPTER_EDIT_SCOPE_CONFLICT`；候选 `contract.apply` 后 `assertChapterLength`，越界把 delivery／replacementBudget 回传。
- `agents/reviser.ts:141-190`：rewrite 的 `validate` 对整段 `revisedContent` 调 `assertChapterLength`。
- `utils/length-metrics.ts:42-74`：`buildLengthSpec(target, language, bounds)`、`chapterLengthDelivery(count, spec)`、`assertChapterLength(content, spec)`；错误码 `CHAPTER_LENGTH_OUT_OF_RANGE`。
- `pipeline/runner.ts:909-941`：`explicitRevisionRequested` 由 externalContext/targetText/rewrite/rework 决定；非显式先 `collectReviewObservations`，观察为空返回 `changed:false`。
- `pipeline/runner.ts:1043-1101`：源复审写 `postRevisionObservations`；更早章只写章节/索引，不倒退状态。
- `pipeline/runner.ts:1150-1160`：回执 `wordCount` 与 delivery。
- 复刻：`revise-tool.ts` 无 assert；`core/length.ts` 只有 target/count；`chapter-index.revisedChapterIndex` 清空观察。

## Decision

### 范围与非目标

范围（`chapter.revise` 单行）：

1. **长度 spec**：`core/length.ts` 增 `LengthSpec`、`chapterLengthSpecOf(work, entry)`、`buildLengthSpec`、`chapterLengthDelivery`、`assertChapterLength`（错误码与源一致，含 `delivery`）。`chapterLengthSpecOf` 统一 target／countingMode／min/max 解析；`chapter-document`、`revision-commit-tool`、`revise-tool` 共用，不再各自解析。
2. **rewrite 校验**：`revise-tool` 构造 body 后、写盘前调 `assertChapterLength`；越界拒绝并带 actual/min/max。
3. **spot-fix／targetText 预算**：ranges 置空或 `targetText` 从正文移除得到 `fixedContent`，算 `fixedLength`；`max` 已小于 fixedLength → `CHAPTER_EDIT_SCOPE_CONFLICT`（带 replacementBudget）；候选 body 再 `assertChapterLength`，越界带 scope=selected_ranges、replacementBudget、actual/min/max。两者都适用：targetText 对任意模式。
4. **回执**：`ReviseResult` 增 `wordCount`、`delivery`（无 min/max 时 delivery 缺省）；`changed:false` 带当前正文 delivery。
5. **非显式短路**：`story_revise_chapter` 只承接显式修订（工具调用是显式）；源的非显式自动复审路径在 DSH 没有对应入口，登记为“入口即显式”的机制差异，不新增 `explicit` 参数。
6. **更早章观察差异**：并入 `dsh-deviations.md` 已有 chapter.revise 事务行：源同事务复审写 postRevisionObservations；复刻即时修订清空观察并写复审 start，由审稿闸门承接。
7. **测试与 realRun**：rewrite/spot-fix 越界、预算冲突、无 min/max 放行、回执 delivery、更早章/最新章路径；重录 `chapter.revise.json`。

非目标：

- 不改 `chapter.write`/`review`/`settle`；不实现 `chapter.import`/D61。
- 不改 spot-fix 的行构造语义（另属 AU-25 之外的审计差异，若后续发现单独记）。
- 不新增 `explicit:false` 入参；不把非显式短路硬塞进工具。
- 不改审稿闸门；不改 artifact/归档逻辑。

### 产品行为与验收

- rewrite 或 spot-fix 候选低于 min／高于 max 时拒绝，错误带实际字数与区间；源同码。
- spot-fix 受保护文本已超 max 时拒绝为 `CHAPTER_EDIT_SCOPE_CONFLICT`，不写正文。
- 没有 min/max 时行为不变；有 min/max 时成功回执带 wordCount 与 delivery。
- 更早章即时修订仍不倒退状态；观察差异有 mapping 行。

### 决定与未决问题

- **非显式短路不实现**：源的非显式路径由 pipeline 内部 `externalContext` 组合决定；DSH 工具入口本身就是显式修订，没有“非显式”调用面。登记为机制差异（入口即显式），不新增布尔参数，也不把 `changed:false` 伪装成非显式。
- **预算错误码复用**：现有“content 与 ranges 不一致”也用 `CHAPTER_EDIT_SCOPE_CONFLICT`；本行新增“固定文本超 max”用同一码，但消息/delivery 不同。保留现有码，避免改已发布行为。
- **delivery 形状**：复用源的 `{status, measurements:{count,countingMode}, target:{target,countingMode,minChapterLength?,maxChapterLength?}, issues:[{code,actual,minimum?,maximum?}]}`；只有显式 min/max 才返回，避免无界时伪造。
- 未决问题：无。

### 评审与批准证据

- Plan Review 三轴：Standards／Spec／Architecture 均通过（多轮）。
- 作者授权：AU-25 单行。
- 作者批准实施：`/implement 批准，执行实现 chapter.revise 审计修复（AU-25）`。

## Design

### core/length.ts

- `LengthSpec { target, countingMode, minChapterLength?, maxChapterLength? }`；`buildLengthSpec(target, language, bounds)`；`chapterLengthDelivery(count, spec): {status:'checks_passed'|'needs_revision', measurements:{count,countingMode}, target, issues}`；`assertChapterLength(content, spec)` 抛 `Error`，message 为含 `{code, delivery, instruction}` 的 JSON，并附 `code`/`delivery`；便于子代理按预算重试。
- countingMode 由 `countChapterLengthByMode` 使用；min/max 只在显式给出时校验。

### revise-tool

- 先读章节索引，取当前条目；`spec = chapterLengthSpecOf(work, entry)`（target／countingMode／min/max 同一解析）。
- `readChapterIndex` 前置到构造前，避免 target 读晚。
- `body` 构造后：`assertChapterLength(body, spec)`；错误直接抛。
- spot-fix 且 `hasRanges`：`fixedEdits = edits.map(edit => ({...edit, replacement:''}))`；`fixedContent=chapterBodyForChapter(applyRangeEdits(base,fixedEdits),chapter)`；`fixedLength=countChapterLengthByMode(fixedContent,spec.countingMode)`；若 `max!==undefined && fixedLength>max` 抛 `CHAPTER_EDIT_SCOPE_CONFLICT`，附 `{fixedContentLength,maximum,replacementBudget}`。
- `targetText` 路径：`fixedContent = base 移除唯一 targetText`，同样算 fixedLength 与预算；`max<fixedLength` 同样抛冲突。
- `replacementBudget = {countingMode, fixedContentLength, minimum: Math.max(0, (minChapterLength??0) - fixedLength), ...(maxChapterLength===undefined?{}:{maximum:maxChapterLength-fixedLength})}`；`maximum<0` 即固定文本超 max，抛 `CHAPTER_EDIT_SCOPE_CONFLICT` 并附该 budget。
- 回执 `wordCount = countChapterLengthByMode(body, spec.countingMode)`；`charCount` 同样用 spec 口径，不再用 `work.language`。`delivery = chapterLengthDelivery(...)`（无 min/max 为 undefined）。
- 最新章两阶段在写提案前做上述校验；C2 复用提案内容与摘要，不再按当前 work 重新解析 spec（提案内容不可变）；补“落盘字数＝断言口径”不变量测试。

### 回执 schema

- `wordCount` integer；`delivery` 可选，源形状：`{status:"checks_passed"|"needs_revision", measurements:{count,countingMode}, target:{target,countingMode,minChapterLength?,maxChapterLength?}, issues:[{code,actual,minimum?,maximum?}]}`；只在 work 有显式 min/max 时出现。
- `changed:false`（显式空改）也带同 spec 的 delivery；不引用未实现的源非显式短路。

### 更早章观察差异

- 并入 `dsh-deviations.md` 已有 chapter.revise 事务行：源同事务复审写 observations；复刻即时修订清空并写 start，由 review 闸门承接；验证 `chapter-revise`/`chapter-settle` 的复审→重算路径。

### 测试

- `chapter-revise.test.mjs`：rewrite 低于 min/高于 max 拒绝；spot-fix fixed 超 max 预算冲突；候选越界；无 min/max 放行；receipt wordCount/delivery；最新章提案路径同样校验；更早章路径不倒退。
- `length.test.mjs`（或新 `length-spec.test.mjs`）：build/delivery/assert 边界。
- `chapter-revision-commit.test.mjs`：提案内容已过校验；C2 不重复。
- real-run 重录。

### 同步

- `fidelity-audit.md`：`chapter.revise` 审计判定由保真债改机制等价/等价（长度校验已对齐；非显式/更早章观察已登记）；清 AU-25。
- `scope.md`：AU-25 标关闭。
- `dsh-deviations.md`：非显式路径并入已有事务行；mapping 只链接。
- `capabilities.yaml`：不改状态；realRun 重录。
- Note 转 implemented；`verify-notes`。

## Alternatives considered

- **加 `explicit:false`**：最贴源。否掉：源由 externalContext/模式组合判定，布尔参数自创；DSH 无该调用面。
- **不改长度校验只登记债**：最小。否掉：AU-25 的核心行为差异，源有硬校验。
- **把 budget 错误并入 length 错误**：少一个码。否掉：源两个码语义不同（固定文本不可满足 vs 候选越界）。
- **重写 spot-fix 行构造**：更贴源。否掉：属另一差异，先锁本行长度/预算。

## Consequences

- **范围边界**：spot-fix 的 raw 插入/归档字节差异不在 AU-25 行；若测试暴露，另记，不混入。
- **错误码复用**：`CHAPTER_EDIT_SCOPE_CONFLICT` 现有构造不一致路径仍在；新路径消息不同，需测试区分。
- **最新章两阶段**：校验必须在写提案前，否则提案会被 C2 拒绝；C2 只复用已验证内容。
- **delivery 形状**：按源完整形状返回；无 min/max 时不返回，避免无界时伪造。
- **更早章观察**：登记为机制差异，不是“等价”。

## Verification

1. `LengthSpec`/`buildLengthSpec`/`chapterLengthDelivery`/`assertChapterLength` 与源边界一致；无 min/max 时不拒绝。
2. rewrite 候选低于 min 或高于 max 抛 `CHAPTER_LENGTH_OUT_OF_RANGE`，错误带 actual/min/max；不写正文。
3. spot-fix ranges 或 targetText 的固定文本超 max 抛 `CHAPTER_EDIT_SCOPE_CONFLICT`，replacementBudget 含 countingMode/fixedContentLength/minimum/maximum；候选越界抛长度错误。
4. 有显式 min/max 时，成功回执含 `wordCount` 与源形状 delivery；`changed:false` 同条件；最新章两阶段提案前校验。
5. 更早章即时修订不倒退状态；非显式短路按“入口即显式”登记，更早章观察差异并入已有 chapter.revise 事务行。
6. `chapter.revise` 的 AU-25 关闭；fidelity/scope 同步；realRun 重录；`pnpm run verify` 通过；CI 由交付后 Verify 回填。

## 实施记录

- Plan Review 三轴：Standards／Spec／Architecture 均通过（多轮）。
- 实施：`length.ts` 增 spec/delivery/replacementBudget；`revise-tool` 统一 `chapterLengthSpecOf`，预算先于长度断言；`revision-commit-tool` 共用 spec；新增 chapter-revise 长度/预算/delivery 用例。
- 验证：`pnpm run verify` 520 passed／1 skipped；CI 待回填。
