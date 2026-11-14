# Agent Note: chapter.write 草稿交接与 writer 契约（AU-23）

Status: implemented

## Problem

2026-11-14 审计把 `chapter.write` 判为保真债，AU-23 五条可修差异加 D61：

1. 草稿写入后阶段停在 `write`：`writeChapterDraft` 写 `.drafts/chapter-NNNN.md`，`detectStage` 查 `.drafts/NNNN.md`；写→审阅交接不成立。
2. writer 契约缺源的两块输入：题材／平台首段（`agents/writer-prompts.ts:19/:28`）与本章用户指令（`agents/writer.ts:513` 的 externalContext）。
3. 显式 min/max 既没进 writer prompt（`writer.ts:551`），也没有 delivery 回执（`runner.ts:1469`）。
4. 标题拒绝章号前缀是复刻新增限制（`write-tool.ts:63`）；源只 sanitize 文件名，不因标题内容拒稿。
5. 账本 implementation 指向 `chapter-document.ts`，但生产写入是 `chapter-draft.ts` + `write-tool.ts`。
6. D61：源 `saveChapter` 在标题变化时删除同章号旧 `.md`；复刻无改标题写入路径，触发点是 `import_chapters`；`chapter.import` 不存在，分支不可触发。

本行只修 `chapter.write`；D61 保留为独立债，随未来章节导入关闭。

## 源工程证据

- `agents/writer-prompts.ts:17-35`：genre/platform 与 Skill 首行、权威顺序。
- `agents/writer.ts:453-526`：本章用户指令/方向优先；`externalContext` 进入提示；`:551-567` target 与 min/max；`:364-451` saveChapter 同批写章节/状态/快照/索引；`:695-700` sanitizeFilename。
- `pipeline/runner.ts:1469`：writer 回执带 length delivery。
- `runtime/stage`：源没有 `.drafts` 概念；DSH 的阶段检测以 `.drafts/NNNN.md` 为准。
- 复刻：`write-tool.ts`、`chapter-draft.ts`、`stages/writer.ts`、`stages/index.ts`；审计 rows 有逐项 file:line。

## Decision

### 范围与非目标

范围（`chapter.write` 单行）：

1. **草稿路径统一**：`detectStage` 复用 `draftPath()` 判断草稿；`draftPath` 保持 `.drafts/chapter-NNNN.md`，review/revise/delete/reopen 的现有路径不变。`story_write_chapter` 后 `detectStage=review`。
2. **writer 契约首段**：`renderWriterContract` 恒写 `题材：genre｜平台：platform`；缺省写 `other`（源默认）；首段同时写“按已激活的专业 Skill 写作”。不改现有六段顺序与内容。
3. **本章用户指令**：writer 契约读本章 `workflow-start.instruction`，写入 `## 本章指令`；绑定“最高优先级；指定标题原样使用”。当前 `/story-write` 不接收附言，instruction 恒为默认句；**作者附言生产链缺失，记入本行残余债**（归 panel.confirm，不在本行实现）。`chapter-NNNN.user-brief.md` 不参与写路径。
4. **min/max**：writer 契约的长度段写 `目标 target；区间 min–max`（只写显式字段）；`story_write_chapter` 回执加 `wordCount` 与 `delivery`（源形状，仅显式 min/max）。
5. **标题**：删除“标题不要带章号前缀”的拒绝；标题继续进文件名并由现有 `safeChapterTitle` 处理。
6. **账本**：implementation 用 `write-tool.ts`（生产入口），consumer 用新增 `chapter-write.test.mjs`（同文件覆盖 write-tool、writer 契约与 draftPath）；原 write-tool.test／writer-contract.test 保留。
7. **测试**：写后 `detectStage=review`；契约含 genre/platform、instruction、min/max；回执 delivery；标题前缀不拒；路径与 review/revise 兼容。

非目标：

- 不实现 `chapter.import`/D61；D61 仍挂本行，AU-23 因此不关闭。
- 不改 `safeChapterTitle` 与源 sanitize 的差异；作为本行残余债记入 scope，不随可达差异关闭。
- 不改 writer 子代理的六段顺序/方法正文；不引入 prompt 拼装层。
- 不改 `chapter.revise`/`review`/`settle` 行为；它们只是草稿路径的消费者。

### 产品行为与验收

- 写完第 1 章，阶段进入 `review`，无需手工改草稿文件名。
- writer 契约第一段能看到题材/平台；有 start 时看到本章指令；有显式 min/max 时看到区间。
- 写入回执有 wordCount；有界时带 delivery。
- 标题以“第 1 章 …”开头时仍能写入；文件名由 sanitize 处理。
- D61 仍开放，标为阻塞于 `chapter.import`。

### 决定与未决问题

- **草稿路径选择**：改 `detectStage` 复用 `draftPath()`，不改 helper；scope AU-23 明确允许。`runtime.stage-context` 只改检测调用，写/审/修订的草稿路径与旧工作区兼容。
- **指令来源**：只取 workflow-start；user-brief 不参与写路径（源在审稿/修订才读），避免自创优先级。
- **AU-23 不关闭**：没有 `chapter.import`，D61 分支不可触发但仍是本行债；本次只关可达差异，fidelity 维持保真债。
- **min/max delivery 只读不拒**：源 writer 不因越界拒稿，delivery 供后续审稿/修订；本行不新增硬校验。
- 未决问题：无。

### 评审与批准证据

- Plan Review 三轴：Standards／Spec／Architecture 均通过（多轮）。
- 作者授权：AU-23 单行。
- 作者批准实施：`/implement 批准，执行实现 chapter.write 审计修复（AU-23）`。

## Design

### chapter-draft.ts

- `draftPath(chapter)` 保持 `.drafts/chapter-NNNN.md`；`detectStage` 改为调用 helper 判断草稿。
- 现有 `loadChapterDraft`/`writeChapterDraft` 继续用 helper；review/revise 路径自动跟随。
- 旧 `.drafts/chapter-NNNN.md` 继续可读；测试不迁移路径。

### stages/writer.ts

- `WorkLike.metadata` 增 `minChapterLength`/`maxChapterLength`。
- 首段：`题材：${genre ?? 'other'}｜平台：${platform ?? 'other'}；按已激活的专业 Skill 写作`（en 对应 `Genre/Platform`）。
- 指令段标题：`## 本章指令` 正文前写“最高优先级；指定标题原样使用”；标题仍由 `story_write_chapter` 的 title 参数承接。
- 指令：`readWorkflowStart` 同步读（新增 `workflowStartInstructionSync` 或用现有 JSON 读取），chapter 匹配才取；输出 `## 本章指令` / `## Chapter instruction`。指令中指定的标题由 `story_write_chapter` 的 `title` 参数承接，写工具不二次解析标题。
- 长度段：`目标 ${target} 字；区间 ${min}–${max}`（只写已定义端）；en 对应。
- 不改变六段顺序；新段插在 Authority 之前/之后按源首段语义：题材/平台在 Authority 前，指令在 Authority 后、Length 前。

### write-tool.ts

- 删除标题前缀正则与拒绝。
- 读 work；写草稿；`finalCount=countChapterLengthByMode(body, spec.countingMode)`；`delivery=chapterLengthDelivery(finalCount, chapterLengthSpecOf(work))`。
- 回执增 `wordCount`/`delivery`；output schema 同 revise。
- `charCount` 用 spec 口径（与回执 wordCount 一致）。

### 测试

- `chapter-write.test.mjs`（新增）：同文件覆盖 writer 契约（题材/平台/Skill/指令/minmax）、write-tool 路径/回执、写后 `detectStage=review`。
- `write-tool.test.mjs`：写后路径、回执、标题前缀可写。
- `writer-contract.test.mjs`：契约含题材/平台与原有六段；无 start 时不写指令段。
- `chapter-write.test.mjs`：start 指令与 min/max 区间、write 回执、写后 review。

- `stage-context.test.mjs`：现有 write 夹具不变（本就不读草稿）；write-tool 用例覆盖 `detectStage=review`。
- `runtime.stage-context` 作为消费面同步：重录 `artifacts/real-runs/runtime.stage-context.json`；`stage-context` 测试断言路径由 `draftPath()` 决定。
- `chapter-review`/`chapter-revise`：草稿路径断言跟随 helper。
- realRun `chapter.write.json` 重录。

### 同步

- `fidelity-audit.md`：`chapter.write` 维持保真债（D61 未关）；只更新证据与剩余项。
- `scope.md`：AU-23 保留；关闭判据只留 D61（`chapter.import`）与 `safeChapterTitle` 空标题/清洗差异；作者附言生产链写入 `panel.confirm` 的 AU-11，并同步 `panel.confirm.json` 的 limitations（不占 AU-23）。
- `docs/dsh-mapping.md`：草稿路径是 DSH 机制差异（源无 `.drafts`）；细节归档 `dsh-deviations.md`；标题前缀限制删除不登记；D61 仍债。
- `capabilities.yaml`：implementation 改 `write-tool.ts`、consumer 改新增 `chapter-write.test.mjs`；realRun 重录。
- Note 转 implemented；`verify-notes`。

## Alternatives considered

- **改 `draftPath` 为 `.drafts/NNNN.md`**：少改检测。否掉：要迁移 `delete-chapter`/`reopen`/stage 协议里的旧路径字面量与旧草稿；改 `detectStage` 复用 helper 更窄，旧路径保持可读。
- **保留标题前缀拒绝**：避免歧义。否掉：源无此限制，属自创。
- **把 D61 一起做**：顺手。否掉：无 `chapter.import`，分支不可触发。
- **在 write 工具硬拒越界**：更安全。否掉：源 writer 只回 delivery，不拒稿；硬拒会自创行为。

## Consequences

- **草稿路径兼容**：helper 不变，旧 `.drafts/chapter-NNNN.md` 继续可读；`detectStage` 改为复用 helper，不再有 `0001.md` 死路径。
- **指令生产者缺失**：`/story-write` 不接收附言，start instruction 恒为默认句；作者附言链记入 panel.confirm 的 AU-11，不占本行关闭判据。
- **AU-23 仍未关闭**：D61 与 `safeChapterTitle` 清洗差异仍挂本行；不能把 AU-23 说成“全行等价”，fidelity 保持保真债。
- **delivery 口径**：条目 countingMode 优先于 work language；写工具尚无条目，使用 work 语言。
- **契约位置**：题材/平台段不替代六段；测试锁顺序。

## Verification

1. `story_write_chapter` 后 `detectStage=review`；草稿路径为 `.drafts/chapter-NNNN.md`，review/revise 读取同一路径。
2. writer 契约恒含题材/平台；有 start 时含指令段；有显式 min/max 时含区间；缺省不省略题材/平台（写 `other`）。
3. 写入回执含 `wordCount`；有显式 min/max 时含源形状 delivery；无界时不返回。
4. 标题带章号前缀仍可写入；文件名由现有 sanitize 处理。
5. 账本 implementation 用 write-tool、consumer 用 chapter-write.test；realRun 重录。
6. 路径/首段/minmax/标题/账本的可达差异完成；D61 与 `safeChapterTitle` 仍使 **AU-23 不关闭、fidelity 维持保真债**；作者附言生产链记入 `panel.confirm` 的 AU-11；scope 同步；`pnpm run verify` 通过；CI 双端。

## 实施记录

- Plan Review 三轴：Standards／Spec／Architecture 均通过（多轮）。
- 实施：`detectStage` 复用 `draftPath`；writer 契约加题材/平台/Skill、start 指令、min/max；write 回执 wordCount/delivery；删除标题前缀拒绝；账本改 write-tool/chapter-write.test。
- 验证：`pnpm run verify` 523 passed／1 skipped；realRun chapter.write/stage-context 重录；CI 待回填。
