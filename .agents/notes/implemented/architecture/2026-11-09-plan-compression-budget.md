# Agent Note: plan.compression —— 模型预算、task spool 与固定压缩任务

Status: implemented

## Problem

审计 D13 写「窗口与压缩文本由调用方手填，宿主没有从模型信息推导窗口，也没有把 compressible 交给子代理压缩的固定路径」。上一版实现已经能派生模型窗口、按 D25 切 memory 候选、生成 compressionTask 与六字段 trace，但真机被 DSH 的主上下文卡住：

- `story_context_candidates` 把所有 task 的**候选正文**一次性返回给主模型；要让选中的 compressible 超过可用输入（792k），任务列表本身就超过 1M，主模型在派 subagent 前溢出；
- 换小窗口模型不能解决，主模型仍要先接住整份任务列表；
- DSH subagent 的输出预算是模型 `maxTokens`（256k），源 selector 的调用级上限是 2048；按源 2048 分组会让每个选择请求接近模型窗口，按 256k 分组才能放进 DSH。

因此本行需要 **task spool**：候选与压缩分块落到文件，主模型只拿句柄，一次读一个任务。

## 源工程证据

- `contextBudgetFromClient`：`contextWindowTokens = client._piModel.contextWindow`；`reservedOutputTokens = max(0, client.defaults.maxTokens)`；缺失或 ≤0 返回 undefined。
- `semanticInputBudget`：`max(1, contextWindow - 2048 - 2048)`；memory 的 `groupMemoryCandidates` 用它切分候选 excerpt、按 token 分组，`selectMemoryCandidates` 逐组调模型。
- `applyContextBudgetIfNeeded`：`availableInputTokens = contextWindow - reserved`；protected 超预算报错；compressible 为空记 notes；`compileBudget = max(1, available - protected)`；`SemanticContextCompilerAgent` 按 semantic input budget 分块、每块 `max(512, ceil(maxInputTokens / chunks.length))`、合并后重压一次、仍超报错；trace 六字段（`compiledSource` 为 `runtime/compiled-compressible-context`，`compressibleTokens` 为压缩前，`budgetTokens = compileBudget`）。

## Decision

### 预算从模型派生

- `core/types.ts` 的 `LlmLike`／`LlmModelInfoLike`：从 `request/header` 的 provider／model／maxTokens + `llm.resolveModelInfo` 取窗口；`reservedOutputTokens = maxTokens`。
- 模型信息或 header 缺失 → 无预算（不 complete、不压缩），与源一致。
- tools 的 model-facing 参数不再接受 `contextWindowTokens`／`reservedOutputTokens`；core 仍接受显式 `ContextBudget` 供测试。

### D25 memory 分组：按 DSH 子代理预算

- 分组预算用 `max(1, contextWindow - reservedOutputTokens - 3072)`，不是源的 2048；原因：DSH 选择 subagent 的输出预算是模型 `maxTokens`（256k），源的 selector 是调用级 2048。分组更保守，避免选择请求本身超窗。
- 候选 excerpt 按行/字符切块；`selectionId` 为 `candidate.id` 或 `<id>:part-N`；按 token 分组。
- 这是 DSH 机制强制的预算口径，登记为机制等价：源 2048 selector 上限 → DSH 模型 maxTokens；验证是选择任务逐组可放进模型窗口、selectionId 映射回 candidate。
- D25 在本行偿还。

### 候选 task spool

- `story_context_candidates`：
  - 生成任务后写 `source/story/runtime/chapter-XXXX.<purpose>.tasks.json`（manifest）与 `...task-<n>.json`（每任务 instruction + candidates）；
  - 只返回句柄：`{taskId, kind, file?, candidateCount, estimatedTokens}`，不返回候选正文；
  - 新 pass 覆盖旧 manifest/task 文件，不迁移旧文件。
- 新增 `story_context_task`：入参 `{purpose, taskId}`；读对应任务文件，返回 `{taskId, kind, file?, instruction, candidates}`；主模型一次只读一个任务，派一个 subagent，拿回 id 集合。
- `story_context_package` 读 manifest/task 文件校验 selection，不再从主模型接收候选；未知 selectionId 抛错；package 与 trace 落盘。
- 任务文件与 manifest 用 `commitFoundation` 原子写；读取时校验 chapter／purpose／taskId。

### 压缩 task spool

- `story_context_package` 超预算时：
  - protected 超预算报错；compressible 为空 package 原样 + notes；
  - 否则写 `chapter-XXXX.<purpose>.compress-<n>.json`，返回 `compressionTask` 句柄：`{chapter, language, maxInputTokens, chunks:[{chunkId, maxTokens, tokenCount, file}]}`；
  - 不返回 chunk 正文；主模型调新增 `story_context_compression_task`（`{purpose, chunkId}`）一次读一个 chunk 的 `{instruction, maxTokens}`。
- 每个 chunk 派 subagent 压缩，输出 Markdown；合并后超 `maxInputTokens` 时重压一次；仍超报错；最终文本作为 `compressedText` 重调 package。
- 压缩成功：package 用 `runtime/compiled-compressible-context`；trace 六字段按源（source id、压缩前 token、`budgetTokens = max(1, available - protected)`）；`contextTiers` 按最终 package。
- 压缩 chunk 的预算：`contextWindow - min(reserved, max(1024, maxInputTokens)) - 3072`；每块 `max(512, ceil(maxInputTokens / chunks.length))`。

### 阶段与工具

- `plan` 阶段：`story_context_candidates(purpose=planner)` → 每个句柄 `story_context_task` + subagent → `story_context_package`；如 compressionTask，逐个 `story_context_compression_task` + subagent，合并后重调 package；再写 memo、`story_plan_chapter`。
- `write` 阶段：同样 writer pass，package/trace 落盘后派 writer。
- 输出 schema：candidates 只含句柄；package 允许 `{package?, trace?, compressionTask?}`；compressionTask 只含句柄；新工具只读一个任务。
- 真机：大 compressible 夹具使任务句柄 >1、compressionTask 非空；主模型逐个读任务/分块，记录派生窗口、D25 分组、压缩合并、trace 六字段。

## Alternatives considered

- **让主模型一次接住所有候选** — 最强理由：工具少。否掉：超过 1M 直接溢出，真压缩无法触发。
- **换小窗口模型** — 最强理由：不改工具。否掉：主模型仍要接住整份任务列表；小窗口只会更早溢出。
- **宿主直接调 LLM 选择/压缩** — 最强理由：可控。否掉：选择与压缩是 agent 行为；宿主裸 LLM 绕开 agent 循环与 prompt 责任。
- **把候选放 DSH storage 而非文件** — 最强理由：平台化。否掉：任务文件是同一次 chapter runtime 的可重建投影，放作品 runtime 与 plan/context 同域，读写与清理简单。
- **本行继续不做 D25** — 最强理由：范围小。否掉：大 compressible 下 memory 选择本身超窗，无法真机压缩。

## Testing

- 预算：`request/header` + `llm.resolveModelInfo` 得到正数窗口；tools 不再接受 caller 窗口；缺失模型信息不猜测。
- 候选 spool：candidates 只返回句柄；`story_context_task` 一次读一个任务；任务/manifest 原子写；新 pass 覆盖旧任务；selectionId 映射回 candidate。
- D25：按 `contextWindow - reserved - 3072` 分组，超长 excerpt 切块；机制等价行登记；真机/测试验证分组选择。
- 压缩 spool：超预算返回 chunk 句柄；`story_context_compression_task` 一次读一个 chunk；压缩合并、重压一次、仍超报错；trace 六字段与源一致。
- 阶段：plan/write 卡片使用 spool 工具；package 只在拿到 package 时落盘；真机大夹具触发候选句柄 >1 与 compressionTask。
- 审计/范围/账本/笔记/realRun 同步；`pnpm run verify` 与 CI 双端通过。
- `pnpm run verify` 299 例通过；`test/context-package.test.mjs` 覆盖 compressionTask、六字段 trace、D25 分组；`test/context-spool.test.mjs` 覆盖任务/manifest 与压缩分块 spool。
- 真机 `session-e96508fc-aff4-48b4-a934-5b70e4519e06` 的 writer pass：`story_context_candidates(purpose=writer)` 返回 complete 0 任务（模型派生窗口 1,048,576、maxTokens 256,000；无 caller 窗口）；`story_context_task(writer, task-1)` 返回 ENOENT，确认 complete 不写任务文件、任务由 spool 文件承载。
- 大 compressible 夹具 `.artifacts/work-compression` 写出 6 个 writer 任务文件（task-1 2.3MB 等），但主模型读取 task-1 时卡死；真压缩回执未取得，登记 D26（真机压缩证据缺口），不冒充等价。

## Consequences

- 任务文件是新的 runtime 投影，必须原子写、按 pass 覆盖、读取校验 chapter/purpose/taskId；旧任务不能串到新 pass。
- **D26**：大 compressible 夹具的 task spool 已写出任务文件，但主模型读取 2.3MB task 时卡死，真压缩未取得真机回执；压缩行为由 core 测试与 spool 测试覆盖，证据缺口保留。
- 主模型逐个读任务仍会累积上下文；任务大小按 DSH subagent 预算控制，必要时再降组大小。
- 压缩分块的合并顺序与重压次数要与源对齐；回执必须写实际触发路径。
- 任务文件/压缩文件是模型可见中间产物，不能把候选写进工具结果；否则 spool 失效。
- D24 references 与本行无关；D25 之外的其他债不自动偿还。
