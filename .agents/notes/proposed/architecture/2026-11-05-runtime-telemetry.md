# Agent Note: runtime.telemetry —— 按作品读回每笔委派

Status: proposed

## Problem

委派已经能发生（`subagent` 工具在预设里挂着），但事后没有一份按作品可读的账：主编把一段活派给写手，只知道结果文本，不知道这一趟花了多少 token、跑了多久、正常结束还是中途失败。作者问「这一章花了多少」，只能猜。

`docs/scope.md` 已经把这条的落点写死：「会话与调用证据留在 DSH session」；账本那一行也写着 `dsh: session log + events`。所以本行不该再写一份作品内的账本文件——那会和「证据留在会话」的既有决定打架，也会让 `source/story/` 之外多出一份会过期的副本。

会话里其实已经有全部事实：父会话的目录里记着派出去的子会话，子会话自己的日志里有每一步的用量与轮次边界，宿主把它们折成了投影。缺的是一个**读回来的入口**：从「当前会话」出发，把子会话列出来，给出用量、耗时与是否正常结束。

## Proposal

### 没有任何写入：只读会话已有的数据

本行不新增文件、不监听生命周期事件、不碰 `source/`。`story_telemetry` 是一个只读工具：在调用它的 agent 会话里，列子树、读每个子会话的投影，汇总成一份可读的回执。证据位置仍然是会话本身，符合 scope 与 `dsh-mapping.md` 的「证据留在 session」。

不监听还有一个结构上的好处：预设插件挂在预设这一层，能看见进程里所有会话的事件；按事件流记账就必须自己再按作品/会话过滤，容易串账。工具只读调用者自己的子树，作用域由调用点决定，不需要额外的过滤规则。

### 数据来源：三个已注册的投影 + 子代理目录

对每个子会话（`subagents.listDescendants(rootSessionId)` 得到，带 `parentId` 与 `depth`）：

- **身份**：`subagentCatalog`（父会话投影）给 `id`、`mode`（one-shot／continuable／external／unknown）、`label`；`subagentIdentity`（子会话投影）给子会话自己的 label 副本。
- **用量**：`tokenUsage` 投影，四个互不重叠的桶——`uncachedInputTokens`、`outputTokens`、`cacheReadTokens`、`cacheWriteTokens`。不自己扫 `assistant/message` 求和使用量：那条读日志的路子已经被宿主的投影取代，而投影连缓存分桶都算好了。
- **耗时**：`subagentTiming` 投影的 `settledMs`（已结束轮次的累计毫秒），加上 `active` 的开区间（`through - since`）作为当前轮已用时间。
- **是否正常结束**：`subagentTiming.lastTurnCompleted`。`false` 说明最近一轮没正常收尾；`undefined` 说明还没有结束的轮次。

读取子会话用宿主的 `sessionQuery.observeSession(id)`：它是「按 id 读一个会话投影」的正式入口，不用已经被取代的 `snapshotEvents`。

### `story_telemetry` 的输出

参数：`limit`（正整数，默认 20，上限 200）。

```json
{
  "summary": { "delegations": 1, "incomplete": 0, "durationMs": 42000,
    "usage": { "uncachedInputTokens": 0, "outputTokens": 0, "cacheReadTokens": 0, "cacheWriteTokens": 0 } },
  "delegations": [
    { "childSessionId": "session-…", "label": "writer", "mode": "one-shot", "depth": 1,
      "state": "completed", "durationMs": 42000,
      "usage": { "uncachedInputTokens": 1200, "outputTokens": 800, "cacheReadTokens": 0, "cacheWriteTokens": 0 } }
  ]
}
```

- `state`：`completed`（`lastTurnCompleted === true`）、`incomplete`（`false`）、`running`（有 `active` 开区间）、`unknown`（没有可判定的信号）。枚举固定四值，不猜。
- `usage` 与 `durationMs` 读不到时是 `null`，不写 0：0 会被当成「真的没花」。
- `summary` 只统计返回的这 `limit` 条，字段名与含义在工具描述里写明，避免作者把分页当成全量。
- 排序：按子会话创建时间升序，取最近 `limit` 条（即最后 N 条），与「最近一次委派」的直觉一致。

### 服务缺失时明确报错

`subagents` 与 `sessionQuery` 用 `ctx.get(...)` 取；任一缺失时工具返回错误文本，点名缺哪个服务（与现有 `story_hooks` 读不到文件时的风格一致），不退化成空结果。

## Alternatives considered

**在作品里写一份 `source/telemetry/delegations.jsonl`。** 一次读到底、不依赖投影。否掉：`docs/scope.md` 与 `dsh-mapping.md` 都把调用证据的属主定在 session；再落一份文件就是第二个会过期的副本，还会绕开「证据留在会话」这条既有决定。

**监听 `subagent/start` 与 `subagent/end` 记账。** 能记到事件里的 `stopReason`。否掉：预设插件在预设作用域，事件是全进程的，得自己按作品过滤，串账风险比收益大；而且 start 时抓住的子会话未必能撑到 end 之后读日志。

**自己扫 `assistant/message.usage` 求和。** 不依赖投影。否掉：宿主的用法注记已经把这个读取路径标成不推荐，`tokenUsage` 投影是维护中的入口，还带缓存分桶。

**把主智能体的用量也读进来。** 账更全。否掉：主会话自己的用量在会话与状态栏里已经可见，本行回答的是「派出去的那一段」，两件事分开。

**在 `story_next` 里顺带返回委派账。** 少一个工具。否掉：`story_next` 是路牌，输出 schema 小且稳定；账本条目数会随委派增长，塞进去会让它膨胀。

## Acceptance criteria

- 当前会话没有子代理时：`story_telemetry` 返回 `summary.delegations: 0` 与空 `delegations`，不报错。
- 有一次子代理委派后：`delegations` 里出现该子会话，`childSessionId`、`label`、`mode`、`depth`、`state`、`durationMs`、`usage` 齐备；`usage` 是四个非负整数桶或 `null`；`state` 是四个固定值之一。
- `incomplete` 的子会话（最近一轮没有正常收尾）在 `summary.incomplete` 里被计数，对应条目的 `state` 是 `incomplete`。
- `limit` 生效：只返回最近 `limit` 条，`summary` 与返回集合一致。
- `subagents`／`sessionQuery` 缺失时返回错误文本并点名缺失的服务。
- `test/host.test.mjs` 的工具清单同批加 `story_telemetry`；`test/telemetry.test.mjs` 用假的服务面覆盖上述分支。
- 实现与证据：implementation `packages/see-dsh-novel/src/plugin/telemetry-tool.ts`（工具与聚合）与 `src/plugin/agent.ts`（注册）；consumer `packages/see-dsh-novel/test/telemetry.test.mjs`；realRun `artifacts/real-runs/runtime.telemetry.json`。
- 真实运行：在一个有 `work.json` 的会话里让主编把一件小事派给子代理，随后调用 `story_telemetry`，能看到该子会话的 label、state=completed、耗时与用量四桶。

## Risks

- 子会话的投影缺项（外部 provider、旧会话）时只能给 `null` 与 `unknown`；报告要如实，不补零。
- `listDescendants` 会遍历父目录链；会话很多时是一次按需读，不作为每轮都调的工具。
- `sessionQuery` 是宿主服务，未装载时本行不可用；错误文本要能直接指向装载问题。
- `state` 只反映「最近一轮是否正常收尾」，不区分失败原因（错误／中止／超限）；更细的终止原因要从子会话日志取，超出本行的投影读取口径。
- 工具读的是调用者自己的子树：作者在别的会话里问同一部作品时，看不到另一棵树的历史；这是「证据留在会话」的必然结果，不是缺陷。
