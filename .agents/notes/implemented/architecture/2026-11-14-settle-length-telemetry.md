# Agent Note: chapter.settle —— 发布索引的长度遥测（D35）

Status: implemented

## Problem

源工程的章节索引条目带 `lengthTelemetry`（目标、计数口径、writer／修订／最终字数、是否修复）与 `tokenUsage`；复刻的 `chapter.settle` 发布、`chapter.revise` 落盘与 `chapter.finalize` 的恢复补齐只写基础字段，`lengthTelemetry` 与 `tokenUsage` 一直缺失。D35 的原文还把「标题变化时删 superseded 章节文件」记在同一行。

同时，复刻的 `countChapterLength` 中文只数 CJK 字符，源 `length-metrics.ts` 去标题/围栏后数全部非空白字符（含标点）；英文源用正则分词，复刻按空白分词。`lengthTelemetry` 的数值必须与源同口径，否则字段写进去也不等价。

D35 拆成三笔：

- **本行（D35）**：统一长度口径为源算法，并在发布/修订/定稿恢复写 `lengthTelemetry`。
- **D60**：`tokenUsage`——DSH 工具边界拿不到每章模型用量；`story_telemetry` 的用量是子会话投影、四个桶与源三字段不同，不能自动归章。
- **D61**：标题变化时删 superseded 章节文件——当前没有会改变标题的写入路径（结算拒绝已发布章、修订沿用原文件名），源 `saveChapter` 的删除分支不可触发。

两笔拆出的债都写入 `docs/scope.md` 与 `docs/fidelity-audit.md`，各有 owner 与关闭判据：D60 的 owner 是 `chapter.settle` + `chapter.revise`（索引写入方），关闭判据是发布/修订在真实索引里写出源形状的 `tokenUsage` 并有测试/回执；D61 的 owner 是 `chapter.write`（标题写入路径），将来由 `materials.import` 的改名/导入触发，关闭判据是出现会改标题的写入能力并让同章号旧文件被删除、有测试。D35 注销不表示 P4/P5 出口完成。

## 源工程证据

- `pipeline/chapter-persistence.ts:8-39`：发布索引条目为 `{number, title, wordCount, createdAt, updatedAt, observations, provenance: "generated", lengthTelemetry, tokenUsage}`；两者可选，原样写进条目；已有条目保留 `createdAt`。
- `pipeline/runner.ts:2032-2046` 的 `buildLengthTelemetry`：`{target, countingMode, writerCount, postReviseCount, finalCount, repairApplied}`。
- `pipeline/runner.ts:1374-1380` 发布：`writerCount` 来自 writer 输出，`postReviseCount: 0`，`finalCount: finalWordCount`，`repairApplied: false`。
- `pipeline/runner.ts:1064-1070` 修订：`writerCount: revisionBaseCount`，`postReviseCount: revisionCount`，`finalCount: revisionCount`，`repairApplied: revisedContent !== content`；`tokenUsage` 不动。
- `pipeline/runner.ts:943-950` 修订的 lengthSpec：`target = chapterMeta.lengthTelemetry?.target ?? book.chapterWordCount`；`countingMode = chapterMeta.lengthTelemetry?.countingMode === "en_words" ? "en_words" : resolveLengthCountingMode(book.language)`。
- `utils/length-metrics.ts:15-27,76-116`：`countChapterLength` 去 frontmatter/围栏/标题/分隔线后，`zh_chars` 数全部非空白字符，`en_words` 用 `[A-Za-z0-9]+(?:'[A-Za-z0-9]+)?` 分词。
- `agents/writer.ts:360-450` 的 `saveChapter` 删除同章号其它 `.md`——本行不实现，归 D61。
- 复刻现状：`chapter-index.ts` 的 `CHAPTER_KEYS` 与校验接受这两个字段，但 `ChapterIndexEntry` 接口没有字段、没有 `LengthTelemetry` 类型；`settle-tool.ts` 发布、`revisedChapterIndex`、`finalize.ts` 只写基础字段；`countChapterLength` 口径与源不同。

## Decision

### 范围与非目标

范围（`chapter.settle`、`chapter.revise`、`chapter.write` 三条能力行；`chapter.write` 只受字数口径切换影响，`core/finalize.ts` 的恢复补齐作为 `chapter.settle` 实现内部的一部分，不新增能力行）：

1. **统一长度口径**：把 `countChapterLength` 改为源算法——去 frontmatter、围栏、标题行与 `---`/`...` 分隔线；`en` 用源正则分词，`zh` 数去空白后的全部字符。新增按计数方式取的内部函数（`countChapterLengthByMode`），`wordCount`、`charCount`、`finalCount`、`writerCount` 与 telemetry 用同一口径；更新受影响测试的期望值。
2. **索引类型落点**：在 `chapter-index.ts` 定义 `LengthTelemetry`，并在 `ChapterIndexEntry` 加可选 `lengthTelemetry`／`tokenUsage`（校验已允许，接口补齐）。
3. **发布写 `lengthTelemetry`**：`story_settle_chapter` 发布（含扣下发布）的索引条目加 `{target: work.metadata.chapterWordCount ?? defaultChapterLength, countingMode: language mode, writerCount: 草稿字数, postReviseCount: 0, finalCount: 草稿字数, repairApplied: false}`。
4. **修订写 `lengthTelemetry`**：`story_revise_chapter` 的索引更新加 `{target, countingMode, writerCount: 修订前字数, postReviseCount: 修订后字数, finalCount: 修订后字数, repairApplied: changed}`；`target`／`countingMode` 按源规则从该章已有 `lengthTelemetry` 取（`en_words` 才沿用条目口径，否则按作品语言），缺条目时取作品目标/语言；修订回执的 `target` 也取同一值，不另用作品目标。
5. **定稿恢复写 `lengthTelemetry`**：`finalizeChapter` 补索引条目时写与发布同形状的 telemetry（target/口径取作品，writerCount=finalCount=正文口径字数，postRevise=0，repairApplied=false）。
6. **不写 `tokenUsage`**：本行不动该字段；归 D60。
7. **不做标题删除**：归 D61。

非目标：

- 不实现每章 `tokenUsage`（D60）；不实现标题变化删除（D61）。
- 不改结算/重算的状态、提案与对账（D33/D34）；不改修订的模式、范围、复审闸门（D45/D58）；不改删除、重开、恢复的判定与补齐条件（只在定稿恢复补条目时加 telemetry）。
- 不补索引缺失行、不重建索引、不改 `chapterTitleOf`。

### 产品行为与验收

- 发布（含扣下）后，索引该章的 `lengthTelemetry` 与草稿正文、作品目标、作品语言一致；`postReviseCount=0`、`repairApplied=false`。
- 修订已发布章后，索引该章 `lengthTelemetry` 按源规则更新；修订回执的 `target` 与索引 target 相同；`tokenUsage` 保留。
- 定稿恢复补出的索引条目同样带 `lengthTelemetry`。
- 字数口径与源一致：`第一段。` 的中文计数为 4，`one two three` 的英文计数为 3。
- 判定以「## Acceptance criteria」为准。

### 决定与未决问题

- **口径必须与源一致**：长度字段若用复刻的 CJK 口径，数值与源不可比；本行直接替换计数器，而不是在 telemetry 里另算一套。`wordCount` 随之改为源口径，受影响测试同批更新。
- **D35 拆 D60/D61**：`tokenUsage` 是缺“按章用量记账”；标题删除是缺“会改标题的写入路径”。两者都是保真债，不混进本行：
  - **D60（owner `chapter.settle` + `chapter.revise`）**：源把 writer+review 的 prompt/completion/total 三字段写进条目；DSH 的 `story_telemetry` 只有子会话的四个桶、且不归属章节。选定偿还路径：writer/review 子代理返回后由主编把本章用量记到 `source/story/runtime/chapter-NNNN.usage.json`，结算/修订读取后写 `tokenUsage`；关闭判据是发布/修订在索引写出源形状三字段并有测试与回执。
  - **D61（owner `chapter.write`）**：源 `saveChapter` 删除同章号其它 `.md`；复刻没有改标题的写入路径（结算拒绝已发布章、修订沿用文件名）。关闭判据是出现改标题的写入能力（如导入/重命名）时同批实现删除并测试；在那之前不加不可达分支。
- **修订 target 单一来源**：由 `reviseChapterDocument` 一次解析（条目 telemetry → 作品），同时用于索引与回执；避免改 `chapterWordCount` 后回执与索引分叉。
- **`changed=false` 也写 telemetry**：源修订执行后总是写索引；此时 `writerCount=postReviseCount=finalCount`、`repairApplied=false`。
- 未决问题：无。

### 评审与批准证据

- Plan Review 第 1 轮（Standards／Spec／Architecture）：Standards 报 1 blocker（AC 与 Design 的 `changed=false` 互斥）＋3 major（计数口径、修订 target 双源、D60 同步）；Spec 报 3 major（计数口径、target、拆债与 finalize）；Architecture 报 1 blocker（索引类型缺字段）＋4 major（`changed=false` 冲突、口径/构造漂移、修订无 target 落点、拆债）。已修：索引补 `LengthTelemetry`/可选字段；计数改源算法；target/mode 单一来源并回传回执；`changed=false` 同值写；D35 拆 D60/D61 并写 owner/关闭判据。
- 第 2 轮：Standards 指出 `chapter.write` 未同步、D60/D61 仍只有断言、finalize 引用不存在；Spec 指出 D60/D61 owner 未落、finalize 无 realRun/test；Architecture 指出 `chapter.write` 受口径影响、`reviseChapterDocument` 调用点、mapping 缺索引行偏差。已修：范围/同步纳入 `chapter.write`；D60/D61 写具体路径；删 `chapter.finalize` 引用；`target`/`mode` 改可选默认；mapping 行补「追加行也写 telemetry」。
- 第 3 轮：Spec／Architecture／Standards 均通过；仅剩归档 Note 不改、验证文件名等非阻塞措辞，已同批整理。
- 作者裁决范围：2026-11-14，D35 执行；D60/D61 为拆出的后续债。
- 作者批准实施（2026-11-14）：`/implement 批准，执行实现 D35（含跨 chapter.settle / chapter.revise / chapter.write）`；执行授权覆盖实施、Implementation Review、范围内修正与 Verify。

## Design

### 长度口径（core/length.ts / chapter-document.ts）

- 在 `core/length.ts` 加 `stripMarkdownMetadata`（源算法的逐行端口：frontmatter、代码围栏、标题、`---`/`...`）。
- `countChapterLength(content, language)` 改为：`stripMarkdownMetadata` 后，`en` 用 `/[A-Za-z0-9]+(?:'[A-Za-z0-9]+)?/gu` 匹配，`zh` 去 `\s` 后 `.length`。
- 加 `countChapterLengthByMode(content, mode: 'zh_chars' | 'en_words')`；`countChapterLength` 按语言映射到 mode 后调用。
- 所有现有调用方（write-draft、revise、settle、finalize、工具回执）沿用 `countChapterLength`，数值自动切到源口径。

### 索引类型（core/chapter-index.ts）

- 定义 `export interface LengthTelemetry { target: number; countingMode: 'zh_chars' | 'en_words'; writerCount: number; postReviseCount: number; finalCount: number; repairApplied: boolean }`。
- `ChapterIndexEntry` 加 `lengthTelemetry?: LengthTelemetry` 与 `tokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number }`。
- 加 `buildLengthTelemetry(input): LengthTelemetry`（直接返回对象），发布/修订/定稿共用。

### 发布（pipelines/long/settle-tool.ts）

- 发布块构造 `lengthTelemetry`：target 取 `work.metadata.chapterWordCount ?? defaultChapterLength(work.language)`；mode 按 `work.language`；counts 用 `countChapterLengthByMode(draft.content, mode)`；`postReviseCount: 0`、`repairApplied: false`。
- 扣下发布同一字段；`entry` 的其它字段与现有规则不变。

### 修订（chapter-document.ts / revise-tool.ts）

- `reviseChapterDocument` 的输入加可选 `target?: number` 与 `countingMode?: 'zh_chars' | 'en_words'`（作品回退值；缺省用 `defaultChapterLength(language)` 与语言 mode，保证直接调用仍能写出合法条目）；内部读 entries 后：
  ```
  const current = entries.find(e => e.number === chapter)
  const target = current?.lengthTelemetry?.target ?? input.target ?? defaultChapterLength(input.language)
  const mode = current?.lengthTelemetry?.countingMode === 'en_words'
    ? 'en_words'
    : input.countingMode ?? (input.language === 'en' ? 'en_words' : 'zh_chars')
  const writerCount = countChapterLengthByMode(existing.content, mode)
  const finalCount = countChapterLengthByMode(body, mode)
  const lengthTelemetry = buildLengthTelemetry({ target, countingMode: mode, writerCount, postReviseCount: finalCount, finalCount, repairApplied: changed })
  ```
  把 `lengthTelemetry` 传给 `revisedChapterIndex`（该函数只在 `chapter-document.ts` 被调用）；返回值加 `lengthTelemetry`。
- `revise-tool` 传作品 target/语言 mode；发布章的回执 `target` 用 `revised.lengthTelemetry.target`；草稿分支仍用作品 target。
- `revisedChapterIndex` 更新当前条目时写 `lengthTelemetry`，保留 `tokenUsage` 与其它字段。

### 定稿（core/finalize.ts）

- 补缺失条目时加 `lengthTelemetry`：target/口径取作品，counts 用文档正文的 mode 字数，`postReviseCount: 0`、`repairApplied: false`；已有条目不覆盖。

### 失败行为

- 计数不新增拒绝；target 缺失用 `defaultChapterLength`；未知语言按 zh。
- 索引严格读取/写回失败路径不变；`changed=false` 也写 telemetry。

### 同步清单（六处）

1. `capabilities.yaml`：`chapter.settle`／`chapter.revise`／`chapter.write` 的 title/source/implementation 补长度遥测与源口径（`chapter.write` 只受口径切换影响，不改工具行为），realRun 重录；`check-capabilities -- --write`。
2. `docs/fidelity-audit.md`：`chapter.settle`／`chapter.revise` 段补长度遥测与源口径；`chapter.finalize` 段补恢复补条目的 telemetry；`chapter.write` 段补字数口径切换；判定 D35 注销，新增 D60／D61 残余；批次 E/F 出口改为待 D60／D61。
3. `docs/scope.md`：删 D35，新增 D60（owner `chapter.settle`，关闭判据=发布/修订写出源形状 `tokenUsage` 且有测试/回执）与 D61（owner `chapter.write`，关闭判据=出现改标题写入路径并删除同章号旧文件、有测试）；P4/P5 出口与依赖句同步。
4. `docs/dsh-mapping.md`：不新增偏差（长度遥测是源行为直接复刻）；把「缺索引行时追加修订条目」行补「追加行也写 `lengthTelemetry`」。
5. `artifacts/real-runs/`：`chapter.settle.json`、`chapter.revise.json`、`chapter.write.json` 重录（无 `chapter.finalize` 行）。
6. 本 Note 转 implemented；只改活文档：`docs/scope.md:67,77,101,103,134`、`docs/fidelity-audit.md:391,426,430,532-533`，以及仍活跃的 `2026-11-14-chapter-reopen-closure.md`、`2026-11-14-review-index-writeback.md` 的 D35 指针；已交付 Note（`2026-11-13-chapter-settle-baseline.md`、`2026-11-13-chapter-atomic-save.md`、`2026-11-14-chapter-settle-validation.md`、`2026-11-06-chapter-write.md`）保留当时 D35/口径描述，按 `fidelity-audit.md:400` 的归档先例不改。

### 验证切入点

- `test/chapter-document.test.mjs`：源口径样例（`第一段。` zh 4、`one two three` en 3、去标题/围栏/frontmatter）；`writeChapterDocument` charCount 期望更新。
- `test/chapter-settle.test.mjs`：发布与扣下的 `lengthTelemetry`（target/mode/writer/final/postRevise 0/repair false）；已有条目保留 createdAt；严格读回。
- `test/chapter-revise.test.mjs`：修订前后字数、`repairApplied`、`changed=false` 同值写回、条目 target 优先于作品 target、回执 target 与索引一致、`tokenUsage` 保留。
- `test/chapter-settle.test.mjs` 的恢复补齐用例：先清掉该章索引行、再 `story_recover` apply（现有 `chapter-publish-incomplete` 用例只删快照，索引行仍在，finalize 走「已有条目不覆盖」测不到新增分支），断言补出的条目带 telemetry。
- 文本断言：回执 target 变化只影响数值字段，不改文案。

## Verification

1. `countChapterLength` 与源口径一致：`第一段。`（zh）为 4、`one two three`（en）为 3；标题、围栏、frontmatter、`---` 不计入；`wordCount`/`charCount` 同批更新。
2. 发布（含扣下）后，索引 `lengthTelemetry` 为 `{target, countingMode, writerCount, postReviseCount: 0, finalCount, repairApplied: false}`，数值与草稿正文、作品目标、语言一致；已有条目保留 `createdAt`。
3. 修订已发布章后，索引 `lengthTelemetry` 为 `{target, countingMode, writerCount: 修订前, postReviseCount: 修订后, finalCount: 修订后, repairApplied: changed}`；`target`/`countingMode` 优先取该章条目（`en_words` 才沿用条目模式，否则按作品语言）；修订回执 `target` 与索引一致；`tokenUsage` 保留。
4. `changed=false` 的修订同样写 `lengthTelemetry`（writer=postRevise=final，`repairApplied=false`）。
5. 定稿恢复补出的索引条目带同形状 `lengthTelemetry`；已有条目不被覆盖。
6. `ChapterIndexEntry` 接口含可选 `lengthTelemetry`／`tokenUsage`，类型通过 typecheck；严格读回不丢字段。
7. `tokenUsage` 仍不写；D60（tokenUsage）与 D61（标题删除）写入 scope/audit，含 owner、阻塞与关闭判据；D35 注销不表示 P4/P5 出口完成。
8. 六处同步完成；`pnpm run verify` 全绿；CI 双端通过。

## 实施记录

- Plan Review 三轴：Standards／Spec／Architecture 均通过（第 3 轮确认）。
- Implementation Review 第 1 轮：Standards 报 2 blocker（mapping/活 Note 未同步、批准证据未更新）＋4 major（计数函数落点、D61 归属、同值双算/口径分叉、注释写源证据）；Spec 报 4 项（chapter.write realRun 旧回执、audit D60/D61、同步半成品、en_words 无测试）。已修：mapping/scope/audit/活 Note 同步；批准证据写 `/implement`；计数与目标函数下沉 `core/length.ts`（`countingModeOf`/`lengthTargetOf`）；`wordCount`/`charCount` 统一取 finalCount；`chapter.write` realRun 改 process-level 并删除旧 CJK 回执；补 en_words 条目测试。
- Implementation Review 第 2 轮：Standards 通过（余 3 条非阻塞已清：死导入、内联 target/mode、活 Note 历史措辞）；Spec 通过（仅文档行号清单，已补）。
- 验证：`pnpm run verify` 通过（495 passed／1 skipped symlink）；`verify-notes`、`check-capabilities`、`verify-audit-coverage` 通过；CI 结果见提交后回填。
## Alternatives considered

- **本行连 `tokenUsage` 一起做**：一步还清 D35。否掉：工具边界没有按章用量；写 0 是伪造，写会话总量不是每章值；要新增按章记账或主编传参，属新合同，归 D60。
- **本行连标题删除一起做**：让 D35 完全注销。否掉：当前没有会改标题的写入路径；在不可达分支上加删除与测试属 speculative，等 `materials.import` 等改标题能力出现时归 D61。
- **保留复刻 CJK 计数，只在 telemetry 写源数值**：不改 `wordCount`。否掉：同一索引里 `wordCount` 与 `finalCount` 会不可比；源用同一计数器，必须一起切。
- **把长度字段塞进 `wordCount` 或投影**：不动索引结构。否掉：源把 telemetry 放在索引条目；`wordCount` 表达不了 target/口径/修复标记。

## Consequences
收益：发布/修订/恢复补齐的索引带源口径长度遥测，字数口径与源一致；代价见下。

- **计数口径切换**：`wordCount`/`charCount`/目标偏差显示都会变，旧测试与历史索引数值不再可比；这是源口径的代价，验收里用固定样例锁住。
- **修订 target 切换**：作者改 `chapterWordCount` 后，已有章的修订仍用条目 target（源行为）；新章用新目标。回执与索引同源可避免分叉。
- **D60/D61 长期未还**：P4/P5 出口继续等待；索引缺省 `tokenUsage`，读取方不得假设存在；标题删除在不可达路径上不实现。
- **定稿恢复**：只补缺失条目；已有旧条目不回填 telemetry，避免覆盖作者/历史数据。

