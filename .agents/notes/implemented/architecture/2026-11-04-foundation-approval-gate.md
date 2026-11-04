# Agent Note: foundation.approval —— 作者确认闸门与回执

Status: implemented

## Problem

前三段能力已经把大纲、规则与角色卡写进作品，但写进去就等于定了：没有任何一步停下来问作者「这版你认不认」。参考做法是提议与执行分离：工具只提议，只有作者确认过的动作才带来执行权。这套分离在本项目里缺两头——确认没有入口，判断「这一版被批准过」也没有可查询的留痕。

DSH 自带的 approval 服务看起来是现成入口，但它回答的是「这个工具调用准不准执行」，并且与会话的权限策略绑死：策略为 `never` 时它在派发前就确定拒绝，作者什么也看不到。创作认可与会话安全策略是两件事，不能只靠前者。

## Decision

### 闸门位置

闸门放在签核。`story_foundation_signoff` 是把这一版基础设定标记为定稿的唯一入口；每次调用都必须拿到一条有效确认，否则拒绝且不写任何文件。写入工具（outline、details、cast_documents）照常可反复重写，不要求确认。

### 两条确认通道

B 是原生确认：会话的确认策略为 `ask` 时，签核工具调用 `ctx.approval.request`，作者在输入框上方的确认条上决定。回执是 `approval/asked` 与 `approval/decided`；只有 `allowed-once` 放行，且这条确认只服务发起它的那一次调用。

A 是面板确认：作者在「作品」面板点「认可」，面板执行 `/story-approve`。回执是这条命令的 `command/run` 与 `command/done`，`command/done` 的文本末尾带一行自有标记 `story-approval stage=foundation digest=<hex> files=<n> via=receipt`。命令自己校验并重算摘要，工具读回执时再算一次比对。

通道在调用前按确定规则选定，不是问完再猜。策略按 approval 服务自己的生效顺序读：会话覆盖优先，其次组合层默认，最后是 `ask`。

| 签核时的状态 | 通道 |
| --- | --- |
| 已有有效 A 回执 | 直接放行，不再询问 |
| 无 A 回执，策略为 `ask` | B |
| 无 A 回执，策略为 `never` 或 `approval` 服务不存在 | 不发起询问，拒绝并给出 `/story-approve` 指引 |

B 的非授权结果不转 A：`rejected` 与 `cancelled` 终止，作者已经表态或撤回；`unavailable` 说明没有可用的确认端，拒绝并提示改走 A。只有确认通道整体不可用才改道。

### 回执与有效性

工件集合是 `source/story/` 下的全部文件；摘要是把相对路径升序排列后，逐文件把相对路径、字节长度与内容喂入 sha256 得到的十六进制串。字节长度参与摘要，避免「路径 + 内容」直接拼接时两组不同文件碰出同一串。集合为空时签核直接拒绝——还没有基础设定可以定稿。

最近一次作者决定决定一切，且退回与确认同样重要：最近决定是确认、且摘要与当前工件一致，回执有效；最近决定是退回，更早的确认不再放行。A 回执来自 `/story-approve` 的命令结果，B 回执来自签核工具在原生确认条里获批后的结果；两者都写成同一行标记，所以「这一版已签核」事后可读。标记行是结果文本里唯一的机器可读部分；面向作者的人读文本放在它前面。B 的确认还在发起它的调用内复核一次摘要：询问前算一次，放行前再算一次，不一致即拒绝。

回执只进会话日志，不进作品目录：作品是作者的文档，确认是操作痕迹。

### 面板

三个按钮，数据全部来自客户端已有通道：

- 会话工作目录：`useSessions(state => state.byId[sessionId]?.cwd)`。
- 会话预设：`useSessions(state => state.projectionsBySession[sessionId]?.values.agentPreset ?? state.byId[sessionId]?.projectionValues?.agentPreset)`。
- 目录里有没有作品：`file` 协议的 stat 只接受普通文件、探不到目录，所以改探两个锚点文件——`source/story/outline/story_frame.md` 与 `source/story/state/manifest.json`；任一 `live` 即视为作品，两个都 `failed` 表示没有，`none` 表示该地址没有 provider（此时不提供动作）。

三态：不是作品目录时显示「当前工作区还不是作品」并说明如何立项；是作品但不是该预设会话时只读展示、不提供按钮；是作品且预设相符时提供「查看待确认」「认可」「退回」三个按钮，分别执行 `/story-review`、`/story-approve`、`/story-reject`。读取中与文件资源通道不可用时给出对应说明，同样不提供动作。

`conversation.view` 的注册是全局的：DSH 的 list slot 只接受 `id`／`order`／`label`／`priority`，没有按会话过滤的扩展点（消费方 `viewTabs()` 只按开发者工具开关滤掉 trajectory 一项），所以「作品」tab 在每个会话都出现。适用性由上面的内容三态表达，不靠隐藏 tab；要真正按会话隐藏，需要平台先提供可见性过滤点。

按钮经 `ctx.sessions.binding(sessionId)?.session.command(line)` 提交；拿不到 binding 时按钮不出现并说明原因。命令结果——清单、摘要与确认结果——落在「对话」页，所以按钮提交后必须在面板里回报结果（执行中／已提交／失败原因），否则作者停在「作品」页会以为没反应。面板不读命令结果，也不新增宿主到客户端的数据通道；面板的完整形态留给 panel.workbench。

作品绑定与「从会话进入作品」的完整流程属于 runtime.session-binding；本能力只判断确认区能否操作，不实现作品索引或切换。

### 工具与命令

- `story_gate`（只读）：只报告与确认有关的状态——待确认工件清单、当前摘要、最近一次作者决定（确认还是退回、时间、通道是面板命令还是原生确认条、是否仍有效）、当前确认策略、此刻能否弹原生确认条；没有 `approval` 服务时策略报 `unknown`。作品与下一阶段仍由 `story_next` 报告。
- `story_foundation_signoff`：按通道规则取确认，成功则报告定稿的工件与摘要，并在结果里留下同一条标记行。
- `/story-review`：打印工件清单、摘要、最近决定与可用通道。
- `/story-approve`：校验工件存在、重算摘要，返回带标记的成功结果。
- `/story-reject`：记录一次退回，作废更早的确认，不产生可放行的回执。
- `/story-approve` 与 `/story-reject` 接受一段作者备注，写进结果文本；备注在标记行之外，不参与回执判定。

工具与命令都注册在 `see-dsh-novel/agent`，因此只有该预设的会话拥有它们。`ctx.approval` 用 `ctx.get('approval')` 可选读取，缺失时只让签核失败，不影响其余工具。

### 非目标

- 逐章节的评审与修订确认（属于 chapter.review）。
- 多作者或多人审批；回执的跨设备同步。
- 阶段状态机本身：本能力只产生「这一版被签核」的事实，谁消费它由后续能力决定。
- 作品目录里的阶段标记；跨会话继续同一作品时的重复确认由 runtime.session-binding 处理。

## Alternatives considered

### 只保留原生确认（B）

最少代码，零新事件类型。否掉：它与权限策略绑死。DSH 的 approval 行按 `DSH_PERMISSION_MODE` 决定策略，`danger-full-access` 时为 `never`（`deepseek-harness/packages/bundle/base/cordis.patch.yml`）；在这个模式下每个新会话都是 `never`，作者永远看不到确认条，签核恒拒。要让作者确认就得先把沙箱策略改严，等于把创作认可绑到安全等级上。

### 客户端自建 RPC 加 `story/approval` 会话事件

最初的设计。否掉两条硬约束：出树插件的客户端半边拿不到 typert 生成产物，`ctx.remote` 只挂载构建期选定的 namespace，没有自定义 RPC 出口；自造的事件类型不在宿主的事件词表里，持久化读回时整份日志被拒读，而 `session.append` 无法写 `ignorable` 标记——只有 `appendPluginRecord` 能，那要求给本项目加第一个 `@deepseek-ai/dsh-session` 运行时依赖。完整推理保留在[被取代的提案](../../rejected/architecture/2026-11-04-foundation-approval.md)。

### 每次工具调用都要求确认

最严格。否掉：四段要确认四次以上，作者会习惯性连点，确认退化成橡皮图章。

### 在对话里用 `ask_user_question` 确认

零新 UI。否掉：对话里的回答不是可查询的回执，签核无法机械判断「这一版被批准过」。原生确认之所以可用，正是因为它留 `approval/decided`。

### 把确认写进作品目录（如 `source/story/approvals.json`）

便于导出携带。否掉：作品目录是作者的文档，确认是操作痕迹；写进去会让「文档即作品」这条已定决策变脏。

### 只在 UI 里置灰按钮，不做宿主校验

省一层。否掉：绕过面板直接调工具就能签核，闸门形同虚设。

### 用会话投影承载面板数据

面板可以直接显示清单与最近确认，不必绕到命令结果里。本能力内否掉：投影注册要求 zod 形状的 schema，要么给插件加 zod 依赖，要么依赖「注册后只调 `.parse()`」这个内部细节；面板的完整形态属于 panel.workbench，届时按那里的数据需求一并引入。

## Consequences

收益：签核成为定稿的唯一出口，作者不确认就定不了稿，被拒绝时一个字也不写；两条通道共用同一行回执，`danger-full-access` 下也有可用的确认路径；回执带摘要，写入一变旧确认自动失效，退回也一样作废；`story_gate` 与 `/story-review` 读得出最近一次决定，后续阶段有据可依。

`packages/see-dsh-novel/test/approval.test.mjs` 覆盖这些行为：无回执与各类拒绝、`allowed-once` 放行、面板回执放行、内容变更后回执失效、退回作废旧确认、原生确认留在日志里的签核、三个命令，以及两条工具在无归属会话里失败。真实运行（`ask` 走一次 B、`never` 走一次 A）的留档在 `artifacts/real-runs/foundation.approval.json`。

代价与已知限制：

- 摘要把 `source/story/` 全部文件卷进来：等章节正文写进这个目录，摘要会随章节变化，必须按阶段收窄工件范围，否则签核被无关写入作废。
- A 回执的摘要是结果文本里的自有标记；格式一改旧回执就失效——失败方向是拒绝，不是放行。
- 面板是本项目第一处写操作 UI，等待态与失败重试没有参考实现；面板判「是不是作品」靠两个锚点文件，因为 `file` 协议的 stat 探不到目录。
- 回执只在会话里；换会话继续同一作品需要重新签核（`runtime.session-binding` 处理）。
- B 的确认条要等作者：作者不响应时这次工具调用一直挂着（与其它 approval 一致），取消本轮得到 `cancelled`。
- `never` 策略下 B 完全不可用；作者既不切策略也不用面板时，流程停在等待确认。
