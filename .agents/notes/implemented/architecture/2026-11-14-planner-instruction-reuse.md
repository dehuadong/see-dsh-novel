# Agent Note: plan.chapter 的 planner 指令与复用语义（AU-22 续）

Status: implemented

## Problem

AU-11 已让 `/story-write` 写入作者附言，但 `plan.chapter` 仍有两处断点：

1. **planner 不读 start.instruction**：`stages/planner.ts` 的「当前用户指令」只取 brief/current_focus/author_intent；作者附言只进 writer，不进 planner。
2. **plan 工具无条件 reused**：`plan-tool.ts` 对任何已存在 plan 返回 `reused:true`，不区分“有新章级指令就重规划”。源 `resolveGovernedPlan` 只在 `reuseExistingIntentWhenContextMissing` 且 externalContext 为空时复用持久 plan，有 externalContext 就重跑 planner 并覆盖。

本行只改这两处；索引进度、detectStage、brief 段差异仍留 AU-22 债。

## 源工程证据

- `runner.ts:2161-2183`：`reuseExistingIntentWhenContextMissing && (!externalContext || trim empty)` 才 `loadPersistedPlan`；否则 `planner.planChapter` 后 `savePersistedPlan`。
- `planner.ts:93`、`planner-prompts.ts:27-42`：externalContext 进入「当前用户指令」，优先于其他上下文。
- 复刻：`stages/planner.ts:51-55`（只 brief/current_focus/author_intent）、`plan-tool.ts:109-118`（无条件 reused）。

## Decision

### 范围与非目标

范围：

1. **planner 读作者指令**：`stages/planner.ts` 用 `authorInstruction(root, chapter)`（仅 source=author）；有作者指令时放当前用户指令段首位，再接 brief/current_focus/author_intent。
2. **复用条件**：`plan-tool` 读本章 start；若已有 plan 且 `authorInstruction(root, chapter)` 为空，返回 `reused:true`；有作者指令则 `saveChapterPlan` 覆盖并返回 `reused:false`。
3. **作者来源标记**：`WorkflowStart` 增 `instructionSource?: 'author' | 'system'`；`writeWorkflowStart` 缺省 author（兼容现有直接调用），`/story-write` 在无作者附言时显式 system，`reviewStartWrites` 写 system。新增访问器 `authorInstruction(root, chapter): string | null`；author 必须 instruction 非空。
4. **测试**：planner 契约含作者附言；无附言复用；有附言覆盖 plan.json/intent.md 且 `reused:false`；system 来源复用；更新 plan-tool 现有 fixture 为 author 覆盖路径。
5. **同步**：scope AU-22 只划掉“planner 不读 start/无条件复用”；索引进度、detectStage、brief 段仍留债。

非目标：

- 不实现索引进度（仍 current_state+1，AU-22 残余）。
- 不实现 `detectStage` 索引进度。
- 不做 chapterCount N>1、不做 review 现场重编排。
- 不改 writer/revise/settle；writer 仍把 instruction 当最高优先级，默认句处理归 AU-11/AU-18 债。

### 产品行为与验收

- `/story-write 写得更冷` 后，planner 契约的「当前用户指令」首段是「写得更冷」。
- 有旧 plan + 无作者附言：plan 工具复用旧 plan，不重写文件。
- 有旧 plan + 作者附言：plan 工具覆盖 plan.json/intent.md，`reused:false`。
- 默认「开始第 N 章」不触发重规划。
- 索引进度仍 current_state；AU-22 不关闭。

### 决定与未决问题

- **来源标记而非字符串匹配**：作者附言与宿主句由写入方标记，planner/plan-tool 共用 `authorInstruction`；不再比较默认句文本。
- **重规划覆盖**：直接 `saveChapterPlan` 覆盖，不保留旧 plan；源同样覆盖。
- **plan 工具入参**：仍要求 goal/body；重规划用调用方给的 memo，复用路径忽略入参。
- 未决问题：索引进度由后续工作项做，本行不碰。

### 评审与批准证据

- Plan Review 三轴：Standards／Spec／Architecture 均通过（多轮）。
- 作者授权：AU-22 续。
- 作者批准实施：`/implement 批准，执行实现 plan.chapter 审计修复（AU-22 续）`。

## Design

### stages/planner.ts

- 用 `authorInstruction(root, next)`；非 null 时放当前用户指令段首位。
- `readWorkflowStart`：instructionSource 缺省/旧记录为 system；非 author/system 抛「无效来源」。
- `write-tool` 的宿主补写 start 用 `instructionSource: system`。
- 其余 brief/current_focus/author_intent 顺序不变。
- 测试：契约含附言；无附言不含作者文本；system 来源不进入；非法 instructionSource 读取抛错；write-tool 宿主句 system。

### plan-tool.ts

- 读 `readWorkflowStart(root)`；取 `instruction` 与 `chapter`。
- `hasAuthorInstruction = authorInstruction(root, args.chapter) !== null`（返回 string|null）。
- 若 existing !== null && !hasAuthorInstruction：返回 reused true。
- 若 existing !== null && hasAuthorInstruction：继续走到 `saveChapterPlan`，覆盖；返回 reused false。
- 若 existing null：正常创建。
- 测试：复用/覆盖/创建三路径；system 来源复用；write-tool 补写 system start 不被当作者。

### 同步

- `scope.md`：AU-22 划掉 planner 指令/无条件复用；留索引进度/detectStage/brief。
- `docs/dsh-mapping.md`／归档：登记 externalContext 映射到 workflow-start.instruction。
- `fidelity-audit.md`：仍保真债 AU-22，更新证据。
- `audit/panel?` 不涉及；`artifacts/implementation-audit/rows/plan.chapter.json` 更新。
- `capabilities.yaml`：realRun 重录。
- Note 转 implemented；`verify-notes`。

## Alternatives considered

- **给 plan 工具加 `force` 参数**：显式。否掉：自创入参；源由 externalContext 决定。
- **永远重规划**：简单。否掉：源无新上下文时复用持久 plan。
- **只改 planner 不改复用**：半条。否掉：作者附言会被复用路径挡住，plan 不更新。
- **用 start 是否存在判断**：太粗。否掉：start 总有默认句，必须区分作者文本。

## Consequences

- **阶段入口未接重规划**：plan 工具的 author 覆盖只在直接调用时生效；`detectStage` 有 plan 即进 write/review，作者附言不能从阶段回到 plan。AU-22 保留该残余。\n- **来源标记迁移**：旧 start 缺 instructionSource 视为 system，会丢掉在途作者附言；当前冻结树没有此类记录（AU-11 刚引入附言）。
- **覆盖 plan**：作者附言会覆盖旧 memo；源同语义，回执标 `reused:false`。
- **plan 工具入参**：复用路径仍要求 schema 字段；调用方按现有参数传即可。
- **不关 AU-22**：索引进度等仍在，不能宣称等价。

## Verification

1. 作者附言出现在 planner 契约的当前用户指令段首位。
2. `instructionSource` 非 author（含缺省/旧记录/system 宿主句）时，已有 plan 复用，文件字节不变。
3. 有作者附言时，已有 plan 被覆盖，`reused:false`，plan.json/intent.md 更新。
4. `instructionSource` 非 author（含缺省/旧记录）时复用；作者来源才覆盖。
5. 索引进度/detectStage/brief 段仍留 AU-22 债；scope/audit/realRun 同步；`pnpm run verify` 通过；CI 双端。

## 实施记录

- Plan Review 三轴：Standards／Spec／Architecture 均通过（多轮）。
- 实施：instructionSource/authorInstruction、planner 作者指令、plan 复用/覆盖；541 passed／1 skipped；realRun 重录；CI `43587741717` 的 `verify (ubuntu-latest)` 与 `verify (windows-latest)` 均通过（提交 `f08b095`）。
