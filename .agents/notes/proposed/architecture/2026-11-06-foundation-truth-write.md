# Agent Note: foundation.truth-write —— 真值文件替换写入

Status: proposed

## Problem

复刻没有任何作者可用的真值文件写入入口：方向文档（`author_intent.md`／`current_focus.md`）只能手改，book rules 只能重跑 details，outline 只能重跑 outline，角色卡只能重跑 cast，状态真值只能等结算。

源工程的 `write_truth_file` 用一个工具覆盖这些文件（`harness/tools/longform-edits.ts:12-133`）：

- 白名单：九份 `story/` 下的平铺文件（`author_intent`、`current_focus`、`book_rules`、`style_guide`、`parent_canon`、`fanfic_canon`、`current_state`、`pending_hooks`、`chapter_summaries`）、两份 `outline/`、以及 `roles/(主要角色|次要角色|major|minor)/*.md`；
- 写入前 `ensureControlDocuments` 补默认模板（`:105`）；
- 内容是**原样**写入（`:121`）；
- `book_rules.md` 走特例：必须带 `bookRulesData`，补 `version: "2"` 后同时写 `book_rules.json`（`:107-119`）；
- 返回 `Updated "<fileName>"` 与 `{ kind: "truth_file_updated", fileName }`（`:124-129`）。

只实现其中两份方向文档会把其余文件的写入入口留空，而它们在源工程里都有明确行为与（多数还有）消费者；这不是 DSH 机制限制，属于保真债，所以本行按源白名单整体落地。`style_guide`／`parent_canon`／`fanfic_canon` 在复刻侧暂时没有读取方，写入行为仍按源实现保留，等对应能力接上。

## Proposal

### 工具：`story_truth_file`

- 参数：`fileName: string`、`content: string`、`bookRulesData?: object`；
- `fileName` 规范化照源实现：去空白；没有 `.md` 后缀就补；拒绝绝对路径、反斜杠、`..`、空名；匹配白名单时大小写不敏感，**落盘路径取白名单的规范小写形式**（`Author_Intent` → `author_intent.md`），角色卡保留档位目录名与文件名的原始大小写；角色卡只接受 `roles/(主要角色|次要角色|major|minor)/<name>.md`；
- 未知名字拒绝，报错列出允许的名字；
- `content` 原样落盘（允许空串）；
- `book_rules.md` 特例：缺 `bookRulesData` 拒绝；用现有 `withVersion` 补版本并校验，同时写 `book_rules.md` 与 `book_rules.json`；
- 写前 `controlDocumentWrites` 补齐默认方向文档；**目标文件自身从补齐列表里剔除**，避免同一路径在一次提交里出现两次；
- 整次写入走一次 `commitFoundation`（原子）；
- 返回 `{ fileName, written: string[] }`，`written` 是本次实际落盘的相对路径（book rules 两条、其余一条）；渲染成 `Updated "<fileName>"`。

### 与其它写入方的关系

- `book_rules.md` 的写入复用 `withVersion`，与 details 走同一份契约，不会绕过版本注入；
- 状态类文件（`current_state.md`／`pending_hooks.md`／`chapter_summaries.md`）按源实现直接替换 Markdown：源工程也允许这样写，它们与 JSON 的同步由结算负责，本工具不假装重算投影；
- 角色卡写入不重命名、不移动档位——那是 cast 工具的职责；这里只按给定路径替换内容。

### 并发

写入走 `commitFoundation` 的单次提交；跨工具串行化是 `runtime.commit-safety` 的范围，本行不解决。

## Alternatives considered

**只做两份方向文档（工具只接受 `author_intent`／`current_focus`）。** 改动最小。否掉：白名单其余六类文件会永远没有作者入口，而源工程一个工具覆盖它们；这是保真债，不是可以登记掉的偏差。

**完全复刻工具名 `write_truth_file`。** 名字更接近。否掉：本项目的工具统一 `story_*` 前缀、参数与回执按 DSH 工具注册；语义对齐即可，名字差异属于既有约定（与 `story_gate`／`story_hooks` 同类）。

**状态文件写入时同步重算 JSON 与投影。** 更一致。否掉：源工具的语义就是「替换这一份真值文件」，同步属于结算；在这里重算会让「作者手改」变成隐性状态迁移。

**写入时 trim 内容。** 更干净。否掉：源工程原样写；控制文档的空白属于作者原文。

## Acceptance criteria

- 白名单内每个名字都能写入，且落盘路径是规范形式：九份平铺文件与两份 outline 一律小写文件名（`Author_Intent` 写 `author_intent.md`），四种角色目录保留原名大小写；未知名字拒绝且不写盘。
- `book_rules.md`：缺 `bookRulesData` 拒绝；带数据时同一次提交写出 `book_rules.md` 与带 `version:"2"` 的 `book_rules.json`；非法数据不落盘。
- 方向文档缺失时同一次提交补齐默认模板；目标文件自身不重复写入（不出现 ENOENT、不丢文件）。
- 内容逐字一致（含首尾空白与空串）；角色卡写入只改指定路径。
- 返回 `{ fileName, written }`，`written` 为实际落盘路径；渲染为 `Updated "<fileName>"`。
- `test/truth-file.test.mjs` 覆盖白名单、名字规范化与拒绝、book rules 特例、方向文档补齐、内容原样；`test/host.test.mjs` 工具清单加入 `story_truth_file`；`docs/scope.md` 的 P1 条目改为「真值文件替换写入」。
- `capabilities.yaml` 的行 id 改为 `foundation.truth-write`，标题覆盖整份白名单，`source: harness/tools/longform-edits.ts`。
- 实现与证据：implementation `packages/see-dsh-novel/src/plugin/truth-tool.ts`；consumer `packages/see-dsh-novel/test/truth-file.test.mjs`；realRun `artifacts/real-runs/foundation.direction-write.json`。
- 真实运行：在已有作品的会话里用 `story_truth_file` 写 `author_intent.md` 与 `current_focus.md`（内容逐字核对），写一次 `book_rules.md`（带 `bookRulesData`，核对两份文件与版本），再用未知名字调一次确认报错。

## Risks

- 状态投影被直接替换后与 JSON 可能不一致；源工程同样允许，结算负责收敛，本工具不检测。
- 角色卡写入不做文件名安全化之外的校验（内容为空也允许）；与源实现一致。
- 没有并发保护，两个写者可能互相覆盖；等 `runtime.commit-safety`。
- 工具名与源不同（`story_truth_file` vs `write_truth_file`），属既有命名约定，不是行为偏差。
