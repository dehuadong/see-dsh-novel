# Agent Note: panel.gate-resume —— 认可之后让会话继续

Status: implemented

## Problem

作者在「作品」面板点「认可」，命令执行成功、回执写进会话（`story-approval stage=foundation digest=… via=receipt`），但**没有新一轮**：模型停在上一次提问上，不知道作者已经放行。

真实运行（`session-974fa00e`）的日志就是证据：seq 371–376 三条命令全部成功，之后没有任何 `turn/start`。作者点完按钮还得自己说一句「继续」，模型才会调用 `story_gate` 读到回执。

要区分两个工具：`story_gate` 只读回执并报告（`confirmed`、最新决定 `decision`、通道 `channel` 与一句提示 `hint`），真正**拒绝签核**的是 `story_foundation_signoff`——它成功时返回 `signed`，被拒时以工具错误报出原因（`SignoffResult` 的 `denied` 分支），要求存在与当前 `source/story/` 摘要一致的确认。门禁已经足够强，缺的是确认之后把会话叫醒。

参考工程的确认语义不是这样：宿主确认之后会起一轮，并把 `confirmedAction` 交给 agent——「本轮动作已由宿主确认：… 立即调用匹配的 capability action，不要再次确认。」

门禁本身已经足够强（`story_foundation_signoff` 在摘要不匹配或最新决定是退回时拒绝），缺的是**确认之后把会话叫醒**这一环。

## Decision

### 一次点击，先写回执，再投「继续」

`StoryView` 的 `submit(label, line)` 在命令成功之后串联一步：

```
点「认可」
  → runCommand('/story-approve')        // 宿主执行，写回执
  → outcome === 'ok'
  → resume(sessionId)                   // 投一条用户消息，起一轮
```

两条都是客户端已有的调用（`binding.session.command` 与 `binding.session.prompt`），同一个 `submit()` 里先后执行，作者只点一次。

### 投回去的那条消息

```
作者刚在面板确认了 foundation（若那之后基础设定有改动，以回执与摘要为准）。
请调用 story_gate 复核这一版是否已确认：确认成立就调用 story_foundation_signoff
定稿并继续下一步；不成立就把原因告诉作者。不要再次请作者确认。
```

- 不带摘要：面板拿不到摘要（`session.command` 只返回 `{ matched }`），而门禁本来就会自己核对摘要——消息只是触发器，不是授权凭证。
- 措辞里带「若那之后有改动，以回执与摘要为准」：`queue` 模式会在当前轮结束后才跑，回执的摘要冻结在点击那一刻；这期间若有写入，消息说的「已确认」可能已经过时，agent 必须按门禁结论走。
- 用 `prompt(content, 'queue')`（`PromptContentPart[]`，即 `[{ type: 'text', text }]`），追加一轮，不打断正在进行的轮次。
- 消息以作者口吻出现：这次点击本来就是作者的动作，不需要伪装成系统消息。

### `resume` 的注入面与失败判据

`index.ts` 给视图注入一个 `resume(sessionId)`，返回 `'ok' | 'failed'`：

- 拿不到会话绑定（`ctx.sessions.binding` 为 `undefined`）→ `'failed'`；
- `await binding.session.prompt([{ type: 'text', text: RESUME_TEXT }], 'queue')` 返回的 `RemoteResult` 里 `ok !== true` → `'failed'`（`prompt` 用返回值报错，不抛异常）；
- `ok === true` → `'ok'`。

`requestId` 不传：面板不需要本地回声，消息会从会话流里回来。

### 每条命令的结果文案

| 命令 | 后续 | 面板文案 |
| --- | --- | --- |
| `story-approve` 成功且 `resume` 返回 `'ok'` | 投消息起一轮 | 「已确认，正在继续…」 |
| `story-approve` 成功但 `resume` 返回 `'failed'` | 不投 | 「已确认；会话没能自动继续，在「对话」里说一句「继续」即可。」 |
| `story-reject` 成功 | 不投 | 「已退回；这一版不会签核，等意见后重写再确认。」 |
| `story-review` 成功 | 不投 | 「已提交，结果在「对话」里。」 |
| 命令失败／无该命令 | 不投 | 沿用现有文案 |

退回与查看不唤醒：退回是停止信号，查看是只读检查。

### 防重复

- 提交期间按钮置灰（`busy`）。
- `story-approve` 成功后把三个按钮换成一行状态：`resume` 返回 `'ok'` 时写「已确认，正在继续…」，返回 `'failed'` 时写「已确认；会话没能自动继续，在「对话」里说一句「继续」即可。」——两种情况本次挂载内都不能再点，否则连点会写两条回执并起两轮。
- 会话切换或面板重挂载后恢复初始状态；届时摘要若已变化，门禁自然会发现旧确认对不上。

### 失败不撤销决定

`resume` 失败只影响「有没有自动继续」，回执已经写下、仍然有效。面板文案要如实区分这两件事，不能让作者以为确认没成功。

## Alternatives considered

**由宿主在命令处理器里追加这条消息。** 一步到位，连面板都不用改。否掉：宿主侧完全做得到——`CommandInvocation.agent` 就是活的 `Agent`，`followup()` 的职责正是「排队一轮并唤醒驱动」；真正的代价在我们自己：宿主半边刻意只做 `import type`（`test/boundaries.test.mjs` 的客户端规则、以及全仓库零 `@deepseek-ai/*` 值导入的约定），要在命令里造 `UserMessage`、碰 `agent.followup`，就得把宿主代码绑到 DSH 的内部消息结构与品牌类型上。账本也已把这一行落在 `client session.prompt`。所以选客户端；这条宿主路径留作将来「连面板都不用开」时的备选。

**把确认做成「审批服务」的原生确认框（`approval.request`）。** 与 `foundation.approval` 已经做过的那条路径统一。否掉：本组合的会话权限是 `danger-full-access`，确认策略为 `never`，原生确认框不会出现；面板命令正是那条路径的替代品。

**让模型自己轮询回执（定时调用 `story_gate`）。** 不需要改面板。否掉：没有触发器就不会有轮次，定时查询也得先有轮次；而且浪费一轮上下文。

**在消息里带上摘要。** 更明确。否掉：面板拿不到摘要；带错或带旧摘要反而会误导 agent，让门禁与消息打架。门禁自己核对。

**退回后也唤醒一轮。** 让 agent 立刻开始改。否掉：退回时作者通常还没给修改意见，唤醒只会得到一句「请告诉我改哪里」；等作者自己说。

## Consequences

落到实现的：`src/client/index.ts` 导出 `RESUME_TEXT` 并给视图注入 `resume(sessionId)`（`prompt([{ type:'text', text }], 'queue')`，`RemoteResult.ok !== true` 或没有会话绑定时返回 `'failed'`）；`StoryView.tsx` 的 `submit` 是一次点击两步——命令成功且是 `/story-approve` 时接着调 `resume`，成功后把三个按钮换成状态行（`'已确认，正在继续…'` 或 `'已确认；会话没能自动继续，在「对话」里说一句「继续」即可。'`），两种都在本次挂载内不可再点。防重靠 `useRef` 的 `inFlight`／`done`：同一帧连点两次只会走一遍，state 的异步更新挡不住这一下。

验证：`test/client.test.mjs` 14 例，新增或改写的覆盖「认可→投消息」「resume 失败文案」「退回／查看不唤醒」「命令失败不投且保留按钮」「连点只走一次」「`resume` 注入面的 payload 与 `queue` 模式」「prompt 拒绝与无绑定都返回 `failed`」「消息文本含两个工具名且不含摘要」；`pnpm run verify` 全绿。

代价与已知限制：

- 面板投的消息是用户口吻：会话记录上看起来像作者打的字。这是刻意的（点击就是作者的动作），导出会话时要知道这条是面板代发的。
- 连点防重只在本次挂载内有效；跨挂载重复认可仍会起两轮，门禁只保证「摘要不匹配的确认不生效」。
- `prompt` 的成败取决于会话是否可写（被归档、agent 正阻塞等）；失败路径已定义，作者仍要手动说一句才能继续。
- 消息文本会随产品演进，测试断言的是「提到两个工具名」「不要再次请作者确认」这类稳定语义，不锁整句。
- 宿主侧 `Agent.followup()` 这条路没有走：它能把「确认即继续」做到连面板都不需要，但要宿主代码碰 DSH 的内部消息结构与品牌类型，等真有“无面板确认”需求时再评估。
