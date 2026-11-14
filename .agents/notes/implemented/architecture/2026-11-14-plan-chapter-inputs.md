# Agent Note: plan.chapter 输入、进度与落盘保真（AU-22）

Status: implemented

## Problem

2026-11-14 审计把 `plan.chapter` 判为保真债。本行只处理可在 `plan.chapter` 内闭合的差异：

1. **进度来源**：源用 `chapters/index.json` 与章节文件的连续前缀 +1；index 缺失返回 0；索引/文件 orphaned/missing 不一致即抛错；重复章号去重、缺号只取连续前缀。复刻用 `current_state.chapter+1`。
2. **自创 hook id 段**：源 planner 提示没有全量 hook id 列表；复刻从 hooks.json 注入全部 id，可能含未进入 governed context 的 id。
3. **上一章提示段**：源 planner 的 user message 不渲染 previousChapter（整章只作为 protected context 条目）；复刻在 `stages/planner.ts` 另加独立段并截 2000 字（AU-20 已把 context-package 改成全文）。
4. **校验收紧**：复刻拒绝 trim 后为空的 goal/body；源 schema 只要求 `minLength(1)`，纯空白可通过。
5. **投影字节**：复刻 intent.md 末尾多换行、memo.body 存 trim 值；源 intent.md 无尾换行、plan.json 保存模型原文。
6. **plan 阶段缺创作方法**：`craftSkillsFor('plan')` 返回空；源 planner 由 BaseAgent 注入已激活技能（长文写作为 required）。
7. **复用语义**：源只在 `reuseExistingIntentWhenContextMissing` 且 externalContext 为空时复用持久 plan，有新章级指令时重规划；复刻无条件 reused。**章级指令生产链缺失（归 panel.confirm AU-11）**，本行不伪造；AU-22 保留债。
8. **DSH 闸门**：plan 工具的基础设定六件套／workflow start／current+1 三道闸门是 DSH 阶段与授权落点，均未逐条登记。

## 源工程证据

- `state-bootstrap.ts:4-47`：章节索引连续前缀 +1；不一致抛错。
- `planner.ts:92-97,129-138`：externalContext 进入当前用户指令；user message 不渲染 previousChapter。
- `planner-prompts.ts:27-37`：指令/上下文分段；无 hook id 列表。
- `input-governance.ts:3-8`、`planner-tool.ts:3-7`：memo 的 goal/body `minLength(1)`，不 trim。
- `planner.ts:108,167-184`、`persisted-governed-plan.ts:39-46`：intent.md 无尾换行、plan.json 保存原文。
- `base.ts:52-78`、`builtin-profiles.ts:18`：planner 注入已激活技能。
- 复刻：`plan-tool.ts:56-118`、`stages/planner.ts:44-97`、`chapter-plan.ts:128-146`、`stages/index.ts:356-361`。

## Decision

### 范围与非目标

范围：

1. **进度不修**：索引与 current_state 的分叉仍保留；`plan-tool`/`stages/planner`/`context-package`/`write-command` 继续 current_state+1。索引进度记 AU-22 残余，避免半成品导致重开后互拒。
2. **hook id 段归 AU-18**：`stages/planner.ts` 的全量 hook id 注入属 `runtime.stage-context`（AU-18），本行不改；不重复声称。
3. **删除自创上一章提示段**：`stages/planner.ts` 不再单独注入 previousChapter；整章由 context-package 的 protected 条目提供（AU-20 已全文）。
4. **放宽空白**：`saveChapterPlan` 只拒绝 `length===0` 的 goal/body，不再 trim 后判空；保存原始字符串。
5. **投影字节**：`intent.md` 去掉尾换行；`plan.json` 的 memo.body 保存原文；更新测试。
6. **plan 技能归 AU-18**：`craftSkillsFor('plan')` 属 `runtime.stage-context`（AU-18），本行不改；不重复声称。
7. **DSH 闸门登记**：`docs/dsh-mapping.md` 加 plan 工具的三道闸门（基础设定六件套、workflow start、current+1）为 DSH 阶段/授权落点。
8. **复用语义**：不实现“有新指令重规划”，因为章级指令生产链缺失（AU-11）；在 mapping/scope 登记为残余。AU-22 保留债。

非目标：

- 不做 panel.confirm 的 `/story-write` 附言生产链（AU-11）。
- 不做 plan 现场重编排（AU-20 已登记）。
- 不改 chapter.write/review/settle；不新增技能文档（用现有技能）。
- 不把 current_state 进度伪装成索引进度。

### 产品行为与验收

- 进度仍 current_state+1；index 分叉未修，记 AU-22 残余。
- planner 提示不再出现独立上一章段；上一章只在 governed context。hook id 段归 AU-18，本行不改。
- goal/body 纯空白可保存；intent.md 无尾换行；memo.body 不被 trim。
- plan 阶段上下文含长文写作方法。
- 复用语义仍是无条件 reused（残余）；AU-22 保留债。

### 决定与未决问题

- **进度不修**：源以索引+文件为准；复刻仍 current_state+1，记 AU-22 残余，不把 current_state 伪装成索引。
- **hook id 段归 AU-18**：本行不删/不改，避免跨行；AU-18 负责收窄。
- **上一章段删除**：源 user message 不渲染；整章作为 protected 条目，避免重复注入。
- **空白不 trim**：源 `minLength(1)` 允许纯空白；保留原文。
- **复用语义 blocked**：没有指令生产链，无法区分“新指令”；不伪造 `force` 参数。
- 未决问题：AU-11 完成后是否补复用/重规划，由该行决定。

### 评审与批准证据

- Plan Review 三轴：Standards／Spec／Architecture 均通过（多轮）。
- 作者授权：AU-22 单行。
- 作者批准实施：`/implement 批准，执行实现 plan.chapter 审计修复（AU-22）`。

## Design

### 进度

- 本行不新增索引进度 helper；`plan-tool`、`stages/planner`、`context-package`、`write-command` 保持 current_state+1。

### planner 输入

- 只删除 `previousChapter` 段；保留 goal/brief/author_intent（当前用户指令段）与 governed context。`readHooks`/hookIds 不在本行改动。
- 测试：契约不含独立 `上一章`；上一章只在 governed context。

### 空白/字节

- `saveChapterPlan`：`goal.length===0`/`body.length===0` 才拒绝；不 trim。
- `renderIntentMarkdown` 末尾不加换行；plan.json 的 memo.body 保存原文，intent.md 投影仍按源 trim；`threadRefs` 每项 `length>0`，空串拒绝。
- 测试：`'   '` 可保存；intent.md 不以 `\n` 结尾；memo.body 保留空格。

### plan 技能（归 AU-18，不在本行）

- 本行不改 `craftSkillsFor('plan')`；AU-18 负责注入长文写作方法。测试归属 AU-18。

### mapping

- `dsh-mapping.md` 加 plan 工具的基础设定/workflow start/current+1 三道闸门偏差行。
- 复用语义残余写 scope/AU-22，不写 mapping 合法偏差。

### 同步

- `fidelity-audit.md`：`plan.chapter` 仍保真债 AU-22（复用语义+指令生产链）；更新证据。
- `scope.md`：AU-22 只留复用语义/指令生产链/brief 指令段；hook id 与 plan 技能写回 AU-18 的残余，audit row 同步。
- `artifacts/implementation-audit/rows/plan.chapter.json`：更新证据/limitations。
- `capabilities.yaml`：implementation/consumer 指向 plan-tool/chapter-plan；realRun 重录。
- Note 转 implemented；`verify-notes`。

## Alternatives considered

- **继续用 current_state+1**：简单。否掉：源以章节索引为准，扣下/重开时分叉。
- **在本行删 hook id 段**：顺手。否掉：属 AU-18，跨行。
- **保留独立上一章段**：显式。否掉：源 user message 不渲染；context 已有全文。
- **trim 空白**：整洁。否掉：源 schema 不 trim，属自创收紧。
- **加 `force` 参数实现重规划**：绕过指令生产链。否掉：自创入参；AU-11 未完成。

## Consequences

- **索引缺失**：index.json 缺失时源返回 0（下一章 1），即使目录有章节文件；复刻同，不要求先建索引。
- **删除段**：模型可能少看到上一章摘要；context package 已提供全文，测试锁。
- **空白保存**：纯空白 memo 后续渲染难看；源允许，保留。
- **技能名**：`longform-writing` 是现有技能；若目录不同按实际名，不新增技能。
- **复用语义未修**：不能把 AU-22 说成等价；brief/current_focus/author_intent 作为“当前用户指令”与源 externalContext 的差异保留为 AU-22 残余。

## Verification

1. 进度仍 current_state+1；索引进度未实现，记 AU-22 残余。
2. planner 提示不含独立上一章节；上一章只在 governed context；hook id 段归 AU-18。
3. goal/body 纯空白可保存；intent.md 无尾换行；plan.json 的 memo.body 原文；threadRefs 每项非空。
4. 本行不改 plan 技能/全量 hook id；两项归 AU-18，已在该行 scope/审计同步。
5. plan 工具的基础设定/workflow start/current+1 三道 DSH 闸门登记；复用语义记 AU-22 残余。
6. AU-22 维持保真债；scope/fidelity/audit row/realRun 同步；`pnpm run verify` 通过；CI 双端。

## 实施记录

- Plan Review 三轴：Standards／Spec／Architecture 均通过（多轮）。
- 实施：删上一章段、空白/字节/threadRefs、三道闸门登记；索引进度未实现（AU-22 残余）。`pnpm run verify` 535 passed／1 skipped；realRun 重录；CI 待回填。
