# Agent Note: plan.context-select 上下文选择保真（AU-20）

Status: implemented

## Problem

2026-11-14 审计把 `plan.context-select` 判为保真债。本行只处理 **context-package 自身**的选择语义：

1. D24 book reference 上下文缺失：源 `composeChapter` 把 compressible 引用段计入 complete 预算与 selectedContext；复刻没有 reference provider。
2. 上一章 excerpt 只取末尾 2000 字，且把下一章章号传给 `chapterBodyForChapter`，导致「第 N-1 章」标题残留。
3. semantic 模式下第 N-1 章摘要没有强制进入选择；源无条件包含。
4. selectedContext 顺序与 reason 不同：源 `memo→focus→intent→style→state→outline→canon→role→referenced hook→summary→volume→hooks`，reason 为来源完整说明；复刻是 fixed→memory→role→state→outline，reason 统一 `composer <kind>`。
5. referenced hook 文本只有中文；源按 language 输出两套。
6. `parseContextPackage` 只检查 chapter 与 selectedContext 是数组；源 `ContextPackageSchema` 是 strict。
7. planner pass 多写 `chapter-XXXX.planner-context.json`；源 planner 只返回 plannerInputs，不落 planner 包。

**不在本行**（各自行处理）：

- 角色目录扩展（AU-15，`plan.chapter` 侧 `readCast` 同集问题）。
- trace 的 memory 候选 id（AU-19，`plan.retrieval`）。
- planner 契约的上一章全文（AU-22，`plan.chapter`）。
- D24 reference context（依赖 P6 的 `materials.import`/`search.unified`）。

## 源工程证据

- `composer.ts:93-104,569-578`：reference 进入预算/selectedContext；`reference-context.ts:40-84`。
- `planning-materials.ts:20-51`：上一章去标题全文；`context-package.ts:212-225` 是尾部 slice。
- `memory-retrieval.ts:256-266`：semantic 无条件包含 N-1 摘要。
- `composer.ts:722-734`：选定顺序；`:861-891`：referenced hook 按 language。
- `input-governance.ts:19-30`：`ContextPackageSchema` strict；条目只有 `source/reason/excerpt?/protection`。
- `planner.ts:84,103-108`：planner 只写 intent，不落 planner 包。
- 复刻：`context-package.ts:212-225,281-289,323-345,458-468,609-628`；`chapter-plan.ts:44-49`；`context-tool.ts:291-293`。

## Decision

### 范围与非目标

范围（`plan.context-select` 单行）：

1. **上一章全文（context-package 侧）**：从当前状态章号 N-1 读 `source/chapters/` 正文，用 `chapterBodyForChapter(content, N-1)` 去标题，不 `slice(-2000)`。
2. **强制 N-1 摘要**：semantic 选择时 `summary:N-1` 无条件 selected；预算不足时按源把全部 compressible 压成一条，不按序截断、不丢 N-1。
3. **顺序与 reason**：selectedContext 按 source id 映射源顺序；`runtime/previous_chapter#N-1` 固定在末尾；summary 同类按章号升序，volume 按索引升序，hook 按源顺序；reason 用来源完整说明，不再 `composer <kind>`。
4. **referenced hook 双语**：按 work.language 输出中文或英文 reason/excerpt。
5. **strict context**：`parseContextPackage` 按源 schema 校验：chapter int≥1、selectedContext 数组、每项恰好 `source/reason/excerpt?/protection`；未知字段/缺失/类型错误拒绝。`stages/writer.ts` 读取 `chapter-XXXX.context.json` 也走同一校验，不再直接 `readJson` 放行。
6. **planner-context**：保留文件作为 DSH 子代理拆分产物，`dsh-deviations.md` 登记原因与验证；读回校验。

非目标：

- 不实现 D24 reference context；不伪造 materials。
- 不改 AU-15 的角色目录、AU-19 的 trace id、AU-22 的 planner 契约上一章全文。
- 不改 composer 子代理协议/spool；不改 writer/review。
- 不移除 planner-context；只登记。

### 产品行为与验收

- 上一章 excerpt 是完整正文去标题，不截断、不带「第 N-1 章」。
- semantic 必含 N-1 摘要；预算不足时压缩 compressible，不丢 required。
- selectedContext 顺序与 reason 可对读源；referenced hook 按语言。
- 坏 context 包拒绝，不传给 writer/planner。
- D24 仍缺；AU-20 保留为保真债。

### 决定与未决问题

- **D24 不在本行**：reference 依赖 materials 资产；没有导入/检索时不做空 provider。
- **planner-context 保留**：DSH 把 planner 拆成子代理，回传 plannerInputs 需要落点；登记机制差异。
- **顺序按 source id**：memory 三类共用 kind，不能只按 kind 排。
- **strict 校验点**：源在构造处 parse；复刻在 `parseContextPackage` 读入时校验，不做 trace 读取方假设。
- 未决问题：D24 随 P6 materials 偿还，由 P6 计划决定。

### 评审与批准证据

- Plan Review 三轴：Standards／Spec／Architecture 均通过（多轮）。
- 作者授权：AU-20 单行。
- 作者批准实施：`/implement 批准，执行实现 plan.context-select 审计修复（AU-20）`。

## Design

### 上一章

- `previousChapterText(root, chapter)`：`chapter-1` 存在时读章节正文，`chapterBodyForChapter(content, chapter-1)`；context-package 使用；不 slice。
- stages/planner 的同样问题不在本行（AU-22）。
- 测试：N=2 时 excerpt 等于第 1 章去标题全文；标题行不出现；>2000 字完整。

### 强制 N-1 摘要

- `memoryCandidates` 生成后，在 `selectSemantic` 前把 `summary:${chapter-1}`（story-index 的 document id，不是 AU-19 的 trace candidate id）标记 required；选择器回传后校验在 selected；缺失补入。
- 预算：先计 required；超预算按源压全部 compressible 为一条，不逐项截断。

### 顺序 / reason

- `selectOrderKey(source)` 映射 12 类；`runtime/previous_chapter#N-1` 排最后；memory 用 `summary:`/`volume-summary:`/`hook:` 前缀；同类 summary 按章号、volume 按索引、hook 按源顺序稳定排序。
- reason 从各来源完整说明生成，禁止 `composer <kind>`。
- 测试：固定夹具断言顺序、reason 非空且不含 `composer `、memory 三类顺序。

### referenced hook 双语

- 按 `work.language` 选择中/英文模板；en 不出现中文 reason/excerpt。

### strict context

- `validateContextPackage`：对象、chapter int≥1、selectedContext 数组；每项恰好 `source/reason/excerpt/protection`，source/reason 非空，excerpt 可选字符串，protection 枚举；未知字段拒绝。
- `parseContextPackage` 调用它；坏包 throw，plan-tool/writer 读入即拒。
- 测试：未知字段、缺 reason、protection 非法、chapter 0 都拒绝。

### planner-context

- 保留 `chapter-XXXX.planner-context.json`；`dsh-deviations.md` 加一行：源 planner 只写 intent，复刻为子代理回传/断点写 planner 包；验证 plan-tool 读回与坏包拒绝。
- 读回校验与 context 同 strict。

### 同步

- `fidelity-audit.md`：`plan.context-select` 维持保真债（D24）；更新证据。
- `scope.md`：AU-20 只留 D24；已修项划掉。
- `dsh-deviations.md`：planner-context、subagent 拆分。
- `artifacts/implementation-audit/rows/plan.context-select.json`：同步证据与 limitations。
- `capabilities.yaml`：implementation/consumer 指向 context-package/context-tool；realRun 重录。
- Note 转 implemented；`verify-notes`。

## Alternatives considered

- **空 reference provider**：让 complete 预算有 reference。否掉：没有 materials 资产，空 provider 是自创。
- **删 planner-context**：更贴源产物。否掉：DSH 子代理回传/断点需要落点；登记机制差异。
- **保留 2000 字截断**：省 token。否掉：源是全文，截断是未登记偏差。
- **本行顺带改角色目录/trace id/planner**：一次做完。否掉：分别属 AU-15/AU-19/AU-22，跨行。
- **只修 strict 不修顺序**：小。否掉：顺序/reason 是审计明确差异。

## Consequences

- **顺序调整**：selectedContext 顺序影响 writer 上下文与 token 统计；测试锁顺序，realRun 重录。
- **强制 N-1 摘要**：预算紧张时压缩 compressible；不静默丢。
- **strict**：旧 context 带未知字段被拒；错误给字段路径，不静默迁移。
- **D24 未修**：不能把 AU-20 说成等价；fidelity 保持债。
- **跨行边界**：角色目录/trace id/planner 契约不在本行，若测试暴露另立。

## Verification

1. 上一章 excerpt 是 N-1 全文去标题；>2000 字不截断；标题行不出现。
2. semantic 选择必含 `summary:N-1`；超预算压缩 compressible，不丢 required。
3. selectedContext 按源 12 类顺序；reason 是来源完整说明，不含 `composer ` 前缀。
4. referenced hook 按语言输出；en 不含中文模板。
5. context 包 strict：未知字段、缺 reason、protection 非法、chapter 0 在 `parseContextPackage` 与 writer 契约读取处即拒，不进入 plan-tool/writer。
6. planner-context 保留并在 `dsh-deviations.md` 有原因/验证；读回 strict。
7. AU-20 仍为保真债（D24）；scope/fidelity/audit row 同步；realRun 为 process-level，semantic/en 的真实 DSH 会话不可得并记 limitation（不声称已验证）；`pnpm run verify` 通过；CI 由交付后 Verify 回填。

## 实施记录

- Plan Review 三轴：Standards／Spec／Architecture 均通过（多轮）。
- 实施：context-package 上一章全文、强制 N-1 摘要、source-id 顺序/reason、双语 hook、strict context、planner-context 登记。`pnpm run verify` 529 passed／1 skipped；realRun 重录；CI `43579836554` 的 `verify (ubuntu-latest)` 与 `verify (windows-latest)` 均通过（提交 `14fa0b7`）。
