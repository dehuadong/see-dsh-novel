# Agent Note: 结算的章号间隙与缺失状态前置

Status: implemented

## Problem

`chapter.settle` 曾有两处与源工程的结算规则不一致：

- 章号：`applySettlement` 要求 `chapter === lastAppliedChapter + 1`，跳章直接拒绝；源只在 `delta.chapter <= lastAppliedChapter` 时拒绝（`allowReapply` 时只拒 `<`），任何更大的章号都允许（`state/state-reducer.ts:34-38`）。
- 状态前置：`inspectState` 把缺失的状态文件按默认快照继续，于是第 1 章可以在四份状态 JSON 不存在时结算；源 `loadRuntimeStateSnapshot` 用 `readJson` 读四份文件，缺失直接抛 `ENOENT`（`state/runtime-state-store.ts:45-64`）。

追溯评审把这两条记为 D47（跳章）与 D46（缺失状态前置）。结算的 hooks／facts／摘要规则、同章重结算的增量语义不变。

## Decision

### 范围与非目标

- 范围：`chapter.settle` 允许章号大于 `lastAppliedChapter` 的跳章结算；四份状态 JSON 缺失时在写盘前拒绝。
- 非目标：不接状态校验与 reconciliation（D34）；不做基线重算（D33）；不收敛独立摘要入口（D48）。
- 不改同章重结算、hooks／facts／摘要合并规则、投影内容与一次提交。

### 交付行为

- 结算要求 `source/story/state/` 下 `manifest.json`、`current_state.json`、`hooks.json`、`chapter_summaries.json` 四份文件都存在；缺任一份时拒绝，列出缺失文件，作品不变。
- 状态 JSON 存在但不可解析、或形状不合法时仍以「状态文件损坏」拒绝。
- 结算章号大于 `lastAppliedChapter` 时允许（可以跳过中间章）；`manifest.lastAppliedChapter` 与 `current_state.chapter` 推进到该章，摘要只写该章。
- 章号小于 `lastAppliedChapter` 时仍拒绝，指向 D33；同章重结算保持增量语义。
- 可观察验收：工具错误与写盘后的状态文件。

### 决定与未决问题

- 缺失状态用 `inspectState` 的 `missing` 字段，不把默认回退改成全局报错：其它只读消费者仍需要「缺失按默认」。
- 跳章只放宽章号比较，不补中间章摘要或 facts；这是源 reducer 的语义。源现有调用点都结算相邻章，跳章能力由 reducer 守卫与 validator 推导，本行按 reducer 契约复刻，不把它当成源的产品常用路径。
- 未决问题：无。

### 评审与批准证据

- Plan Review 第 1 轮：需修订（旧 Note 仍写「源只校验已有文件」的错误事实；测试 fixture 未补四份状态；源无跳章产品路径）；已修正。
- Plan Review 第 2 轮：通过，无未解决 blocker/major。
- Implementation Review（Standards / Spec）：首轮各报 3／2 条；改为 `inspectState.missing`、补齐逐份缺失/损坏用例后复核通过。
- 批准与执行授权：2026-11-13，作者批准 `implement chapter.settle`。

## Design

### 缺失状态前置

`src/core/state.ts` 的 `inspectState` 在读取四份状态文件时同时给出 `missing` 与 `invalid`（同一次读取，不再另做 `stat`）；`src/pipelines/long/settle-tool.ts` 在写盘前检查 `read.missing`：

- 有缺失时一次性列出全部缺失路径，抛 `状态文件缺失，先修复或重建再结算：…`，在写入前结束。
- 缺失与损坏同时存在时先报缺失；只有存在但不可解析时才报「状态文件损坏」。
- `missing` 只用于结算前置；其它消费者（对账、恢复）继续使用默认回退，不受影响。

### 章号规则

`src/core/settle.ts` 的 `applySettlement`：

- `delta.chapter < lastAppliedChapter` → 拒绝（更早章节，D33）。
- `delta.chapter === lastAppliedChapter` 且未显式 `allowReapply` → 拒绝（已结算）。
- `delta.chapter > lastAppliedChapter` → 允许，包含跳章。
- 其余 hooks／facts／摘要与整份校验不变。

### 兼容与失败行为

- 状态文件齐全的旧作品行为不变；缺文件的第 1 章不再能静默结算。
- 跳章结算后中间章没有摘要行；`detectStage` 仍按 `current_state.chapter` 找下一章。
- `test/chapter-settle.test.mjs` 的 workspace 与 reopen/finalize fixture 都补种四份状态 JSON。
- 实现文件：`src/core/state.ts`、`src/core/settle.ts`、`src/pipelines/long/settle-tool.ts`。

## Alternatives considered

- **保留 `last+1` 限制，把 D47 留作债** — 改动最小。否掉：源只拒倒退，限制是复刻自创的。
- **把缺失状态改成全局报错** — 一处改完。否掉：`inspectState` 还被只读对账与恢复使用，缺失按默认是它们需要的行为；前置只属于结算。
- **跳章时补空摘要或空 facts** — 看起来完整。否掉：源不补，补了会造出中间章的伪摘要。
- **要求前章已结算** — 更安全。否掉：源没有这个前置，属于自创限制。
- **在工具层用 `stat` 预检四份文件（Plan Review 版设计）** — 不改 `state.ts`。否掉：重复 `inspectState` 已经读到的状态、留 TOCTOU，且路径字面量出现第三份；改为 `inspectState.missing`。

## Testing

- `test/chapter-settle.test.mjs`（8 例）：四份状态 JSON 与三份投影；facts 失效与替换；mention/defer 不推进与 resolve 推进；候选 id、superseded 撤回与 resolved 历史；逐份删除四份状态文件、四份全缺、逐份写坏都以对应错误拒绝且状态目录不变；跳章工具用例与 `applySettlement` 跳章/倒退用例；同章重结算语义。
- `test/chapter-reopen.test.mjs`、`test/chapter-finalize.test.mjs`：fixture 补种四份状态后既有断言全绿。
- `pnpm run verify` 全绿：415 tests；`artifacts/real-runs/chapter.settle.json` 已按新行为重录。
- D46／D47 已从 `docs/scope.md` 注销，审计判定同步。

## Consequences

- 跳章后中间章没有摘要与 facts，后续若补结算会被 `<= lastAppliedChapter` 拒绝；这是源的行为，要重做需基线（D33）。
- 缺失前置会让旧工作区里没播种状态的作品第一次结算失败；需要先跑基础设定或重建状态。
- 错误信息列全部缺失文件，比源的首个 `ENOENT` 更完整；行为仍是拒绝，消息文案不构成产品差异。
- `inspectState` 多一个 `missing` 字段；其它消费者不读它，保持默认回退。
