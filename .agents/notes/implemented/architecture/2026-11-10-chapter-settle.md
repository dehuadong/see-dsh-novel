# Agent Note: chapter.settle —— 结算：facts/hooks 增量与状态校验

Status: implemented

## Problem

P4 只剩 `chapter.settle` 与 `chapter.finalize`。章节摘要已经能单独写，但正文里发生的事实、伏笔的推进和当前状态还没有任何写入路径：`current_state.json` 与 `hooks.json` 停在播种值，`manifest.lastAppliedChapter` 永远是 0，`story_next`/上下文/面板看到的“当前状态”与作品实际进度脱节。

源工程把这一整步放在结算里：settler 子代理按正文产出 `postSettlement`、`factOps`、`hookOps`、`newHookCandidates` 与 `chapterSummary`，宿主合并候选伏笔、应用 facts/hooks 增量、校验整份状态，再把章节摘要与状态一起落盘。

## 源工程证据

- `inkos/packages/core/src/agents/settler-tool.ts:45-73`：结算 delta 的形状——`postSettlement`、`factOps{upsert,expire}`、`hookOps{upsert,mention,resolve,defer}`、`newHookCandidates`、`chapterSummary`；`hookOps` 的说明写明“提及不改变状态、缺章不等于撤回、不得虚构 id”。
- `inkos/packages/core/src/state/state-reducer.ts:17-79`：章节必须前进（`chapter <= lastAppliedChapter` 拒绝，`allowReapply` 时允许等章）；摘要章节必须匹配、重复摘要只在重结算时替换；顺序是先 hooks、再 facts、再 summaries，最后 `lastAppliedChapter = chapter`。
- `inkos/packages/core/src/state/state-reducer.ts:75-199`：hooks——`upsert` 合并（`superseded` 需要 notes 作为撤回依据、已 resolved 的历史不能撤回）；`resolve` 置 resolved 并把 `lastAdvancedChapter` 推到 max；`defer` 置 deferred 但**不推进** `lastAdvancedChapter`；unknown id 拒绝，superseded 拒绝。facts——`expire` 把命中且仍活跃的 fact 的 `validUntilChapter` 设为 `chapter-1`；`upsert` 同 subject+predicate 的旧 fact 自动失效，再插入 `validFromChapter=sourceChapter=chapter`、`validUntilChapter=null`；facts 按 predicate/object 排序。
- `inkos/packages/core/src/utils/hook-arbiter.ts:24-90`：`newHookCandidates` 由宿主分配稳定 id（`hook`、`hook-2`…），`startChapter=lastAdvancedChapter=当前章`、status `open`；mention/resolve/defer 去重、空 id 拒绝；与 upsert 冲突时先并入 upsert。
- `inkos/packages/core/src/state/state-validator.ts:15-100`：整份状态校验——重复 hookId、重复摘要章节、`currentState.chapter > manifest.lastAppliedChapter` 都是错误。
- `inkos/packages/core/src/agents/settler-prompts.ts:5-41`：settler 的系统提示（“把正文明确事实投影为增量运行时 truth，保留无关状态和稳定 id，不把计划当成已发生事件”）与用户提示（正文、治理控制块、校验反馈）。

## Decision

### 核心：`applySettlement`

`src/core/settle.ts`：

- 输入：当前 `StateSnapshot`（`state.ts` 的 `inspectState` 读取）、`delta`、`allowReapply`。
- 校验 delta 形状（章节、`postSettlement` 为字符串、ops 数组、摘要七字段）；`postSettlement` 允许空串（源 schema 不设下限）。
- 章号：`chapter === lastAppliedChapter + 1` 走增量；`chapter === lastAppliedChapter` 且 `allowReapply` 走重结算（同章增量）；其余拒绝。源只拒绝倒退（`state-reducer.ts:37-39`），允许任意未结算章；当前强制 `last+1`，记 D47。
- hooks：先合并 `newHookCandidates`（宿主分配 id），再 `upsert` 合并、`resolve`/`defer` 应用；mention 只做去重与 trim，不改变状态与 `lastAdvancedChapter`。
- facts：`expire` 与 `upsert` 按上面源语义；fact 排序。
- summaries：替掉同章行，按章号排序。
- manifest：`lastAppliedChapter = chapter`；`current_state.chapter = chapter`。
- 整份校验：重复 hookId、重复摘要章节、`current_state.chapter > lastAppliedChapter` 都拒绝。
- 返回新快照与 `postSettlement`。

### 重结算的边界（v1）

- 同一章重结算（修订 → 重审 → 再结算）**按增量应用**：facts 由同 key 失效与新值替换，hooks 由合并规则收敛，摘要替换该行。不按逐章快照做基线重算，旧 delta 不再适用的 facts 可能残留，记 D33。
- 更早章节的重结算被直接拒绝。逐章快照已由 `chapter.finalize` 写出（`story/snapshots/0..N`），缺口是没有按快照重算（源的 `loadRuntimeStateSnapshotAtChapter` 语义），记 D33（偿还：`chapter.settle`／`state.check`）。

### 工具：`story_settle_chapter`

`src/pipelines/long/settle-tool.ts`：

- 参数：`chapter`、`postSettlement`、`factOps{upsert,expire}`、`hookOps{upsert,mention,resolve,defer}`、`newHookCandidates`、`chapterSummary`（七字段）。
- 前置：本章有正文与审稿记录；坏状态（JSON 不可解析）拒绝，不覆盖。状态文件缺失时 `inspectState` 按默认继续（第 1 章可写），与源只校验已有文件一致，但与「必须存在」的描述不符，记 D46。
- 执行：`withWorkAction` 内读快照 → `applySettlement` → 一次 `commitFoundation` 写四份状态 JSON（manifest／current_state／hooks／chapter_summaries）与三份 Markdown 投影（`state.ts` 的 `stateJsonWrites`／`stateProjectionWrites`）；投影语言取 manifest，manifest 缺失时用 `work.language`。
- 输出：`{ chapter, facts, hooks, summaryTitle, postSettlement }`（facts／hooks 是结算后的条数），渲染成回执。

### 阶段与面板

- `chapter-done` 协议：作者要求结算时，派 settler 子代理按正文与审稿记录产出 delta，再调 `story_settle_chapter`；只要摘要不要结算时调 `story_summarize_chapter`。作者裁决收敛为结算内唯一路径；收敛前独立摘要入口仍在，记 D48。
- 面板不新增动作：结算走对话/阶段协议；`chapter-done` 根动作仍是修订。

### 行与债务

- `capabilities.yaml` 的 `chapter.settle`：implementation 指向 `src/pipelines/long/settle-tool.ts`，consumer 指向 `test/chapter-settle.test.mjs`，realRun 指向 `artifacts/real-runs/chapter.settle.json`。
- D32：结算把摘要与 facts/hooks 放进同一次提交；修订后的重结算走同一工具的重结算路径，自动重结算仍随 D34。
- D33（不按快照基线重算）、D46（缺文件按默认继续）、D47（强制 `last+1`）登记 `docs/scope.md` 与 `docs/fidelity-audit.md`。
- `docs/dsh-mapping.md` 不需要新偏差：结算工具是 DSH `tools.register` + commit 的既有机制。

## Alternatives considered

- **把结算并入摘要工具** — 少一个工具。否掉：账本两行，摘要先交付；并入会让“只要摘要”也要求 full delta。
- **只做 facts，不做 hooks** — 更小。否掉：伏笔六动作是源结算的一半，缺了 `pending_hooks.md` 永远不更新。
- **允许任意章节重结算（不建快照）** — 使用方便。否掉：会静默重算全部历史状态；源有基线快照，本项目没有，先拒绝并登记 D33。
- **mention 也推进 lastAdvancedChapter** — 看起来更“记录”。否掉：源明确“提及不推进”，推进只由 resolve 与 upsert 的 field 变化表达。
- **在工具里跑 settler 模型** — 一次调用完成。否掉：模型由子代理跑，宿主只校验与落盘。

## Testing

- `test/chapter-settle.test.mjs`：结算写四份 JSON 与三份投影、facts 同 key 失效与新值替换、mention／defer 不推进与 resolve 推进、候选伏笔 id 分配、superseded 撤回与 resolved 历史保护、未知 id 拒绝、章号规则、缺正文/缺审稿/坏状态拒绝。
- `test/host.test.mjs`：工具清单包含 `story_settle_chapter`。
- `test/stage-context.test.mjs`：`chapter-done` 协议包含 `story_settle_chapter`。
- `pnpm run verify` 全绿；回执记录一次结算与投影内容。

## Consequences

- 同章重结算按增量应用，旧 delta 不再适用的 facts 可能残留；更早章节不能重结算——按快照重算（D33）会同时解决这两点；快照已由 `chapter.finalize` 写出。
- 结算一次写七个文件；任何一步失败整体回滚（`commitFoundation` 原子），坏状态与冲突在写入前拒绝。
- 摘要工具与结算都会写摘要行；协议在结算场景优先结算，避免两次写同一行（同章替换是幂等的）。
- settler 的质量决定 facts/hooks 的准确度；宿主只保证结构、合并规则与状态校验。
- 结算没有状态校验 agent 与 reconciliation 重试（D34）；投影冲突只能由后续 `state.check` 或人工发现。
