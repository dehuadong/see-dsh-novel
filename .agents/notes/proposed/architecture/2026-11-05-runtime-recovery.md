# Agent Note: runtime.recovery —— 工作区自检与可重建的索引

Status: proposed

## Problem

作品的真相在文件里，但文件会被人手动改动：`work.json` 被挪走、`source/story/state/` 下的索引被删、`hooks.json` 丢了。现在没有任何入口能回答「这个工作区现在还完整吗、少了什么、能不能补」，也没有补的办法——`story_next` 只会说阶段，`story_gate` 只算摘要，作者只能翻目录猜。

参考工程的对应模块做的是另一件事：`chapter-state-recovery.ts` 在审阅之后发现「状态投影与正文矛盾」时，只重算这一章的结算层，用观察列表把不一致讲清楚，重试仍不一致就带着观察报 `unresolved`。那是**章节级**的对账；本章节流水线还没落地（P2／P3），本行先把同一套「自检 → 报告 → 可修则修」的骨架放在**工作区级**：扫出缺失或坏掉的文件，能安全重建的重建，不能重建的如实报告。

## Proposal

### 一个只读扫描 + 一个显式修复

工具 `story_recover`，参数 `apply`（布尔，默认 `false`）：

- 默认只扫描并返回发现清单，不写任何文件；
- `apply: true` 时，只修**可以安全重建**的项，然后重新扫描一遍，把修过的路径列在 `applied` 里。

扫描是纯函数组合（`src/core/recovery.ts`），工具只是执行壳：这样「什么算问题」与「怎么修」不依赖宿主，可以单独测。

### 发现项

| code | 判据 | 可修 |
| --- | --- | --- |
| `unbound` | 工作区既没有 `work.json`，也没有 `source/story/` | 否（还没立项） |
| `work-missing` | 有 `source/story/` 内容，但没有 `work.json` | 否（标题要作者给，不猜） |
| `work-invalid` | `work.json` 存在但解析失败 | 否（身份不自动改写） |
| `foundation-empty` | 已立项，但 `source/story/` 下没有任何文件 | 否（还没开始写设定） |
| `state-missing` | `manifest.json`／`current_state.json`／`chapter_summaries.json` 缺失，且 `source/story/` 里已有其它文件 | **是**（写回默认内容） |
| `hooks-missing` | `hooks.json` 缺失，且已有其它文件 | 否（伏笔池是创作事实，重建等于造假） |

每条发现带 `code`、`severity`（`info`／`warning`／`error`）、`path`（相对作品根，没有就是 `null`）、`detail`（一句人话）、`fixable`。

### 修复只做「无歧义的重建」

`state-missing` 写回的内容与 foundation 段播种的默认值一致（`schemaVersion: 2`、`lastAppliedChapter: 0`、`chapter: 0`、空 rows）；这些文件是**索引**，缺失时补一个空的是安全的。

不修的三类都有明确理由：`work.json` 承载身份（标题只能作者给）；`hooks.json` 是创作事实（补空等于声称没有伏笔）；`source/story/` 里的工件是作品内容（不能猜）。`work-invalid` 也不改写：坏掉的 JSON 可能还带着作者的手改，覆盖它比报错更糟。

修复写入用 `commitFile`（单文件原子写），只写 `source/story/state/` 下的三个文件，不碰 `work.json` 与任何工件。

### 与门禁的关系

自检不改变门禁：`state-missing` 补回的是空索引，补之前与补之后的工件摘要都不含这些文件（摘要只覆盖 `source/story/`），所以作者已下的确认不会因此失效。`story_recover` 只回答「工作区能不能继续用」，签核仍然走 `story_gate`。

### 章节级对账为什么不在这行

参考工程的模块解决的是「这一章的正文与状态投影矛盾」；这需要章节文件、结算层与状态校验器，都属于 P2／P3。现在做它只能对空数据跑。本行交付的是它的前置：能把工作区修到「可以让章节流水线接手」的状态。

## Alternatives considered

**只报告，不修。** 最安全。否掉：`manifest.json` 这类索引被删是常见的手滑，补一个空索引既无歧义又省一次手改；把可修项也交给作者，等于让作者背工具该做的事。

**什么都修：`work.json` 用目录名当标题、`hooks.json` 写空。** 一键恢复。否掉：标题是作者的决定，目录名不是作品名；空伏笔池会让后续章节「没有伏笔可回收」，比缺失更糟。

**把自检做成定时任务（jobs）。** 不需要作者触发。否掉：工作区变化没有事件可订阅，定时扫描只是空转；作者在接手前跑一次就够。行里的 `dsh` 从 `jobs + storage` 改成 `tools.register + atomic write`，与实现对齐。

**把自检塞进 `story_next`。** 少一个工具。否掉：`story_next` 每轮都可能被调用，扫描要列目录、读 JSON，不该成为路牌的成本；而且它的输出 schema 会膨胀。

**恢复时也重建 `work.json`（从 `book_rules.json` 推标题）。** 看似智能。否掉：`book_rules` 是设定产物，标题可能只出现在文件第一行；从内容推身份是猜测，和「身份只由作者给」冲突。

## Acceptance criteria

- 空工作区（没有 `work.json`、没有 `source/story/`）：扫描返回一条 `unbound`、`fixable: false`；`apply: true` 不写任何文件。
- 只有 `work.json`：一条 `foundation-empty`（`info`）；不写文件。
- 有工件、缺 `manifest.json`：一条 `state-missing`、`fixable: true`；`apply: true` 后写回默认 `manifest.json`，重新扫描不再报，`applied` 里列出该路径。
- 缺 `hooks.json`：一条 `hooks-missing`、`fixable: false`；`apply: true` 不创建它。
- `work.json` 内容非法：一条 `work-invalid`（`error`）、`fixable: false`；`apply: true` 不改写任何文件。
- 修复前后 `readArtifacts` 的摘要一致（自检不碰工件）。
- 工具输出 schema 在运行时子集内；`test/host.test.mjs` 的工具清单同批加 `story_recover`。
- 实现与证据：implementation `packages/see-dsh-novel/src/core/recovery.ts`（扫描与重建规则）与 `src/plugin/recovery-tool.ts`（工具）；consumer `packages/see-dsh-novel/test/recovery.test.mjs`；realRun `artifacts/real-runs/runtime.recovery.json`。
- 真实运行：在一个有基础设定的工作区删掉 `state/manifest.json`，调 `story_recover`（先看报告、再 `apply: true`），文件被重建、摘要不变、`story_next` 仍报 `ready`。

## Risks

- 只覆盖工作区级：章节正文与状态投影的矛盾对账要等 P2／P3 的章节流水线。
- `state-missing` 补的是空索引：`manifest.json` 的 `lastAppliedChapter` 会回到 0，如果作者之前推进过章节（当前还没有章节能力），这个值会丢；等章节能力落地后要改成从章节文件推算。
- `hooks-missing` 不修：伏笔池丢了只能靠重跑 details 段或人工补，工具只负责报警。
- 扫描是只读的，但 `apply` 是写操作：它只写 `source/story/state/` 下三个索引文件，路径写死在代码里，不接受参数指定。
