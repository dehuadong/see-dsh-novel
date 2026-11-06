# Agent Note: foundation.hook-ledger —— 两个字段与六动作生命周期

Status: proposed

## Problem

源工程的伏笔记录比复刻多两个可选字段，并有一套明确的合并规则：

- `HookRecordSchema` 带 `dependsOn: string[]`（每个元素非空）与 `paysOffInArc?: string`，整条记录 `.strict()`（`models/runtime-state.ts:18-29`）；
- 六类动作：**新建**（`newHookCandidates`，宿主分配规范 id、状态 `open`、起始章与最近推进都记为当章）、**提及**（`mention`，归一化并过滤，reducer 不消费——提及不改变状态、不推进）、**推进**（`upsert` 到任意状态，合并规则见下）、**回收**（`resolve`，置 `resolved` 并推进）、**延后**（`defer`，置 `deferred` 但**不**推进——「延后不是推进」）、**撤回**（`upsert` 到 `superseded`，必须带 notes 作依据；已回收的不能撤回；已撤回的忽略后续修改）（`utils/hook-arbiter.ts:16-135`、`state/state-reducer.ts:74-142`）。

复刻的 `HookRecord` 只有七个基本字段；`core/hooks.ts` 另有一套自造的 `transitionHook`／`TRANSITIONS` 迁移表（禁止 `resolved→deferred`、禁止回退），与源工程的合并规则**不一致**，而且只被它自己的测试使用。P4 结算要写伏笔时，没有与源工程一致的合并规则。

## Proposal

### 字段与校验

`core/hooks.ts` 的 `HookRecord` 增加 `dependsOn?: string[]` 与 `paysOffInArc?: string`：

- `dependsOn` 出现时必须是数组，元素为非空字符串（不 trim、不唯一化）；`paysOffInArc` 出现时必须是任意字符串（允许空串）；
- 两者参与 `validateHooks`；记录上出现未知字段一律拒绝（源 schema `.strict()`）；
- 伏笔投影仍是七列，不含这两个字段（源投影同样不展示）。

### 合并与六动作

新增 `core/hook-ledger.ts`，按源实现逐条对齐：

```ts
export function applyHookOps(state: HooksState, ops: HookOps, chapter: number): { hooks: HooksState, created: ReadonlyArray<string> }
```

- **规范化**：`mention`／`resolve`／`defer` 的 id 先 trim，空串或重复 id 拒绝；`mention` 再过滤掉同时出现在 upsert／resolve／defer 里的 id；
- **新建**：id 依次 `hook`／`hook-2`…（跳过占用），`type`／`expectedPayoff` trim 后必须非空，`notes` trim；`startChapter` 与 `lastAdvancedChapter` 都是当章，状态 `open`；
- **推进（合并）**：`upsert` 的 id 必须已存在（否则报错要求用新建候选）。合并逐字段照源实现：`startChapter` 取 `min`；`type` 用 incoming trim 后的值，空则保留旧值；`status` 在旧状态是 `resolved` 时保持 `resolved`，否则取 incoming；`lastAdvancedChapter` 取 `max`；`expectedPayoff`／`notes` 取 incoming；**`dependsOn`／`paysOffInArc` 不从 incoming 复制**——源实现的 `mergeHookRecord` 只展开 `...existing` 后覆盖上列字段，新值会丢；本行照做并在测试里钉死；
- **回收**：未知 id 报错、已撤回的报错；置 `resolved` 并 `lastAdvancedChapter = max(旧, 当章)`；
- **延后**：未知 id 报错、已撤回的报错；置 `deferred`，`lastAdvancedChapter` 不动；
- **撤回**：只能经 `upsert` 到 `superseded`；已回收的拒绝；`notes` trim 后为空拒绝；撤回后 `notes` 追加依据、状态固定 `superseded`；
- 旧状态已 `superseded` 时任何 `upsert` 原样返回（不报错）；
- 结束按 `startChapter` → `lastAdvancedChapter` → `hookId` 排序。

### 取代旧的迁移表

`core/hooks.ts` 的 `transitionHook`／`TRANSITIONS` 与源行为不一致、且只被自己的测试使用：本行删除它们，`test/hooks.test.mjs` 的迁移用例改为 reducer 用例；旧笔记 `implemented/architecture/2026-11-04-foundation-hooks.md` 里「状态迁移表」的决定同批标注被本笔记取代。

### 落点与证据边界

本行不注册新工具，也没有写盘入口：源工程的六动作只作为结算输入被消费，foundation 阶段没有作者会推进伏笔；字段也只可能出现在结算写出的 `hooks.json` 里（源实现里六动作同样不会给 `dependsOn`／`paysOffInArc` 赋值）。因此：

- 账本行的 `dsh` 记 `library`（不是 `tools.register`），`source` 记 `models/runtime-state.ts`（六动作的源位置在 Note 里另列）；
- 真实运行在一份真实工作区上：用脚本对 `hooks.json` 应用六个动作并打印状态变化，再确认 `validateHooks` 接受带两个字段的记录、拒绝未知字段，`pending_hooks.md` 仍是七列；
- P4 的 `chapter.settle` 是本模块的第一个工具调用方；那一行落地时补真正的会话证据。

## Alternatives considered

**只在 P4 做，本行只加字段。** 少一个模块。否掉：字段与合并规则是同一条契约；只加字段会让 P4 重新发明「延后不推进」「撤回要依据」这些最容易丢的边界。

**保留 `transitionHook`，另写 reducer 共存。** 少改旧代码。否掉：同一份状态出现两套互相矛盾的迁移规则，调用方会选错；旧测试测的是源工程没有的行为。

**给六动作注册 `story_hook_update` 工具。** 更早可交互。否掉：源工程没有这个工具，六动作是结算输入；提前开入口会把结算职责漏到 P1，也让「谁在推进伏笔」变得含糊。

**`mention` 也推进。** 直觉上「提到即推进」。否掉：源工程明确区分「被提到」与「叙事推进」；混在一起会让排序失真。

**合并时保留 incoming 的 `dependsOn`。** 更符合直觉。否掉：源实现不复制这两个字段；按直觉实现等于悄悄改行为，还会让「字段从未被写入」这一源事实变得不可观察。

## Acceptance criteria

- `validateHooks` 接受带 `dependsOn`／`paysOffInArc` 的记录，拒绝空串元素、非数组、记录上的未知字段。
- `applyHookOps`：新建 id 序列、`startChapter`／`lastAdvancedChapter` 为当章且状态 `open`；提及与延后不推进；回收推进到当章；推进取 `max`；`startChapter` 取 `min`；`type` 空值回退旧值；`resolved` 粘滞；`dependsOn`／`paysOffInArc` 不从 incoming 复制；旧 `superseded` 忽略 upsert。
- 错误分支：未知 upsert／resolve／defer、已回收再撤回、撤回缺 notes、id 空串或重复。
- `transitionHook`／`TRANSITIONS` 删除，旧测试改为 reducer 用例；旧笔记同批标注被取代。
- `pending_hooks.md` 仍是七列。
- 实现与证据：implementation `packages/see-dsh-novel/src/core/hook-ledger.ts`；consumer `packages/see-dsh-novel/test/hook-ledger.test.mjs`；字段改动在 `src/core/hooks.ts`，旧迁移表删除并更新 `test/hooks.test.mjs`；realRun `artifacts/real-runs/foundation.hook-ledger.json`。
- 真实运行：在真实工作区上应用六个动作并打印每步的 `status` 与 `lastAdvancedChapter`；`validateHooks` 对带两字段的记录通过、对未知字段拒绝；投影仍七列。

## Risks

- 六动作没有工具入口，作者在 P4 之前无法推进伏笔；这是阶段顺序，不是缺失。
- `dependsOn` 不做引用完整性：指向不存在的 id 合法；引用校验留给结算调用方。
- 新建 id 规则（`hook`、`hook-2`…）是源实现细节；源工程改动时本行要跟。
- 证据边界：本行的真实运行证明的是纯函数与校验，不是会话内的工具调用；P4 必须补会话证据。
