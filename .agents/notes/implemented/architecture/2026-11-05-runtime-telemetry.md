# Agent Note: runtime.telemetry —— 按作品读回每笔委派

Status: implemented

## Problem

委派已经能发生（`subagent` 工具在预设里挂着），但事后没有一份按作品可读的账：主编把一段活派给写手，只知道结果文本，不知道这一趟花了多少 token、跑了多久、正常结束还是中途失败。作者问「这一章花了多少」，只能猜。

`docs/scope.md` 已经把这条的落点写死：「会话与调用证据留在 DSH session」；账本那一行也写着 `dsh: session log + events`。所以本行不该再写一份作品内的账本文件——那会和「证据留在会话」的既有决定打架，也会让 `source/story/` 之外多出一份会过期的副本。

会话里其实已经有全部事实：父会话的目录里记着派出去的子会话，子会话自己的日志里有每一步的用量与轮次边界，宿主把它们折成了投影。缺的是一个**读回来的入口**：从「当前会话」出发，把子会话列出来，给出用量、耗时与是否正常结束。

## Decision

### 没有任何写入：只读会话已有的数据

这条能力不新增文件、不监听生命周期事件、不碰 `source/`。`story_telemetry` 是一个只读工具：在调用它的 agent 会话里，列子树、读每个子会话的投影，汇总成一份可读的回执。证据位置仍然是会话本身，符合 scope 与 `dsh-mapping.md` 的「证据留在 session」。

不监听还有一个结构上的好处：预设插件挂在预设这一层，能看见进程里所有会话的事件；按事件流记账就必须自己再按作品/会话过滤，容易串账。工具只读调用者自己的子树，作用域由调用点决定，不需要额外的过滤规则。

### 数据来源：已注册的投影 + 子代理目录

`subagents.listDescendants(rootSessionId)` 返回两类行：`kind: 'child'`（真正的子会话，带 `depth`、`mode`、`label?`、`activity`）与 `kind: 'diagnostic'`（目录读不通或模式未知，只有 `id` 与 `reason`）。可用的 `child` 行进 `delegations`；目录自带的 `diagnostic` 行进 `diagnostics`，连同 `reason`（`corrupt`／`unsupported`／`unavailable`）一起报出来，不假装它是委派。

`diagnostics` 里还有两类**由本工具判定**的条目，措辞与目录自带的原因一致：

- 缺 `mode`／`depth` 的 `child` 行 → `unsupported`。这类行不用读会话就能判定，所以对全部子会话都判，不进 `delegations`，也不占 `limit` 的名额。
- 返回窗口里读不出本地会话的 `child` 行 → `unavailable`（external 没有本地会话、旧会话读不到）。窗口之外的子会话不读，也就不产生这类条目——`summary.diagnostics` 因此不是整棵树的全量异常数，而是「目录异常 + 返回窗口内的读失败」。取消（`signal` 已 abort）照常抛出，不算读失败。

对每个可用的 `child`：

- **身份**：行里的 `mode`（one-shot／continuable／external）与 `label`。`label` 对 one-shot 允许缺省，所以按可空处理。
- **用量**：子会话的 `tokenUsage` 投影，四个互不重叠的桶——`uncachedInputTokens`、`outputTokens`、`cacheReadTokens`、`cacheWriteTokens`。不自己扫 `assistant/message` 求和使用量：那条读日志的路子已经被宿主的投影取代，而投影连缓存分桶都算好了。
- **耗时**：子会话的 `subagentTiming` 投影：`settledMs`（已结束轮次的累计毫秒）加 `active` 开区间（`through - since`）；`settledMs` 缺失时耗时是 `null`，**不影响**状态判断。
- **状态**：目录行的 `activity` 与子会话 `subagentTiming` 的 `active` 一起用——两个都成立才是「住着且在跑」；单独的 `activity` 只是驻留，单独的 `active` 可能来自崩溃留下的未闭合轮次。终态由 `lastTurnCompleted` 给（`true` → `completed`、`false` → `incomplete`），两者都没有就是 `unknown`。

读取子会话用宿主的 `sessionQuery.observeSession(id)`：它是「按 id 读一个会话投影」的正式入口，不用已经被取代的 `snapshotEvents`。观察用完通过 `[Symbol.dispose]` 释放（宿主 `SessionObservation extends Disposable`，没有 `dispose()` 方法）。

### `story_telemetry` 的输出

参数：`limit`（正整数，默认 20，上限 200）。

```json
{
  "summary": { "delegations": 1, "incomplete": 0, "diagnostics": 0, "partial": 0, "durationMs": 42000,
    "usage": { "uncachedInputTokens": 1200, "outputTokens": 800, "cacheReadTokens": 0, "cacheWriteTokens": 0 } },
  "delegations": [
    { "childSessionId": "session-…", "label": "writer", "mode": "one-shot", "depth": 1,
      "state": "completed", "durationMs": 42000,
      "usage": { "uncachedInputTokens": 1200, "outputTokens": 800, "cacheReadTokens": 0, "cacheWriteTokens": 0 } }
  ],
  "diagnostics": []
}
```

- `state` 的判定顺序：目录行 `activity === 'running'` **且** `subagentTiming` 有 `active` 开区间 → `running`（住着且在跑）；否则 `lastTurnCompleted === true` → `completed`、`false` → `incomplete`；都没有（或子会话读不到、没有本地会话）→ `unknown`。枚举固定四值，不猜。
  `activity` 只是「这个会话现在还住着没有」的驻留事实，单用会把轮次之间空闲的 continuable 子会话说成在跑；`active` 只说明「有一个还没关的轮次」，单用会被进程崩溃留下的未闭合轮次骗到。两个一起成立才算 `running`。
- `label`、`usage`、`durationMs` 读不到时是 `null`，不写 0：0 会被当成「真的没花」；`label` 缺省是 one-shot 的正常形态，不是错误。
- **求和只加读得到的行**：`summary.durationMs` 是返回集合里非 `null` 耗时之和，`summary.usage` 四个桶分别对非 `null` 的 usage 求和；没有任何一条委派时两个合计都是 `0`（空集之和），不是 `null`。`summary.partial` 数「至少一个字段缺失、因而某个合计只覆盖了部分行」的委派数，让作者知道合计是部分的，而不是把缺失当 0 摊进总数。
- `summary.delegations`、`summary.incomplete` 只数返回的 `delegations`；`summary.diagnostics` 数返回的 `diagnostics`：目录自带的全部诊断行，加上全部 `unsupported` 行，加上返回窗口内的 `unavailable` 行。
- `diagnostics` 的 `reason` 沿用目录原值或上面的两类判定；诊断不进 `delegations`、不计入 `incomplete`。
- `limit` 只截 `delegations`：先剔除缺字段的行（它们不占名额），再按目录顺序取最后 `limit` 条；`diagnostics` 按上面口径返回，不按 `limit` 截断。
- 排序：沿用 `listDescendants` 返回的目录顺序（父目录事件序，即创建顺序；该 API 不返回 `createdAt`，不另造排序键）。

### 服务缺失时明确报错

`subagents` 与 `sessionQuery` 用 `ctx.get(...)` 取；任一缺失时工具返回错误文本，点名缺哪个服务（与现有 `story_hooks` 读不到文件时的风格一致），不退化成空结果。

## Alternatives considered

**在作品里写一份 `source/telemetry/delegations.jsonl`。** 一次读到底、不依赖投影。否掉：`docs/scope.md` 与 `dsh-mapping.md` 都把调用证据的属主定在 session；再落一份文件就是第二个会过期的副本，还会绕开「证据留在会话」这条既有决定。

**监听 `subagent/start` 与 `subagent/end` 记账。** 能记到事件里的 `stopReason`。否掉：预设插件在预设作用域，事件是全进程的，得自己按作品过滤，串账风险比收益大；而且 start 时抓住的子会话未必能撑到 end 之后读日志。

**自己扫 `assistant/message.usage` 求和。** 不依赖投影。否掉：宿主的用法注记已经把这个读取路径标成不推荐，`tokenUsage` 投影是维护中的入口，还带缓存分桶。

**把主智能体的用量也读进来。** 账更全。否掉：主会话自己的用量在会话与状态栏里已经可见；这条能力回答的是「派出去的那一段」，两件事分开。

**在 `story_next` 里顺带返回委派账。** 少一个工具。否掉：`story_next` 是路牌，输出 schema 小且稳定；账本条目数会随委派增长，塞进去会让它膨胀。

## Consequences

收益：作者与主编都能在不离开会话的情况下回答「这一趟派出去花了多少、跑了多久、收尾没有」；数据就是会话里已有的投影，不需要任何新的写入，也不会让基础设定的摘要变化。

`src/plugin/telemetry-tool.ts` 注册只读工具 `story_telemetry`（参数 `limit`，默认 20、上限 200）：通过 `ctx.get('subagents')` 取目录、`ctx.get('sessionQuery')` 读子会话投影，`listDescendants(rootSessionId)` 的 `child` 行进入 `delegations`、`diagnostic` 行进入 `diagnostics`（带 `reason`）。每行读 `tokenUsage` 的四个桶与 `subagentTiming` 的 `settledMs`／`active`／`lastTurnCompleted`，`state` 按「驻留 + 未闭合轮次 → running；否则最近一轮收尾 → completed／incomplete；否则 unknown」判定；`settledMs` 缺失只让 `durationMs` 为 `null`，不改变状态。读不到本地会话（external）或缺 `mode`／`depth` 的行仍回一条记录（值为 `null`），并在 `diagnostics` 里记 `unavailable`／`unsupported`，不猜默认值。`summary` 只覆盖返回的 `limit` 行：合计只加非 `null` 的值、零行为 0、`partial` 数缺值的行，`diagnostics` 全量返回。观察用完通过 `[Symbol.dispose]` 释放。`src/plugin/agent.ts` 注册并保持相反顺序注销；`src/core/types.ts` 增补 `SessionLike.id`、`SessionObservationLike`、`SessionQueryLike`、`SubagentRowLike`、`SubagentsLike` 五个手写面。

验证见 `test/telemetry.test.mjs` 与 `test/host.test.mjs`（工具清单含 `story_telemetry`）。真实运行由 Verify 阶段验证，回执产出到 `artifacts/real-runs/runtime.telemetry.json`。

代价与已知限制：

- 子会话的投影缺项（外部 provider、旧会话）时只能给 `null` 与 `unknown`；报告要如实，不补零。
- `listDescendants` 会遍历父目录链；会话很多时是一次按需读，不作为每轮都调的工具。
- `sessionQuery` 是宿主服务，未装载时这条能力不可用；错误文本要能直接指向装载问题。
- `state` 只反映「最近一轮是否正常收尾」，不区分失败原因（错误／中止／超限）；更细的终止原因要从子会话日志取，超出当前的投影读取口径。
- 工具读的是调用者自己的子树：作者在别的会话里问同一部作品时，看不到另一棵树的历史；这是「证据留在会话」的必然结果，不是缺陷。
