# Agent Note: proposal.creative —— 从对话到一个可确认的立项提案

Status: proposed

## Problem

立项现在有两条确定性的路：`/story-init` 命令与 `story_work_create` 工具，参数由调用方直接给。但它们都不是「创意提案」：作者说「我想写个都市悬疑，主角是个夜班出租车司机」，没有一个入口把这句话收敛成「标题／题材／平台／语言／章数／单章字数」的提案，也没有一张确认卡让作者先看清再落盘。模型若直接调 `story_work_create`，等于替作者拍板。

参考工程把这件事做成 `propose_action`：一次调用带上 `action`、`instruction`、`title`、`summary` 与结构化的 `createBook`（标题、题材、平台、语言、总章数、单章字数、最小/最大章长），宿主弹确认卡，确认后按结构化参数执行；提案的文案与执行参数是分开的两层。

DSH 侧已经有确认条（`approval` 服务，foundation 签核在用）与作品创建原语（`writeWork`）。本行把它们接起来：模型在对话里收敛创意，调 `story_propose` 交出结构化提案，确认条就是确认卡；作者点「允许」才写 `work.json`，点「拒绝」则什么都不落盘。

## Proposal

### `story_propose` 工具

参数（`title` 与 `summary` 必填，其余可选，缺的按作品默认值走）：

| 参数 | 含义 |
| --- | --- |
| `title` | 书名，必填 |
| `summary` | 一到两句：确认之后会发生什么 |
| `genre` | 题材，例如「都市悬疑」 |
| `platform` | 目标平台，原样存进作品元数据 |
| `language` | `zh` 或 `en`，默认 `zh` |
| `chapters` | 目标章数，正整数 |
| `chapterWords` | 单章字数，正整数 |

参考工程的 `createBook` 还带 `minChapterLength`／`maxChapterLength`；它们是章长约束，`docs/scope.md` 不在本行要求里，所以不收——等章长约束成为独立能力时再进提案。

执行顺序是固定的：

1. 已经立项（`work.json` 存在）→ 直接报错「已立项」，不覆盖身份；
2. 组装确认文案：`立项《标题》｜题材 · 平台 · 中文／English · 目标 N 章 × 单章 M 字` 加一句 `summary`；语言按实际值渲染，没给的字段不出现；
3. 取 `approval` 服务与策略；缺席或 `never` → **不写任何文件**，返回 `outcome: "unavailable"` 与一句「确认条不可用，可以用 `/story-init`，或在作者明确说要立项后调 `story_work_create`」；
4. 弹确认条（`toolName: story_propose`，`reason` 就是那张卡，带 `callId` 与 `signal`）；
5. `allowed-once` → `writeWork` 写入身份（标题、语言、`metadata.targetChapters`／`chapterWordCount`／`genre`／`platform`），返回 `created: true` 与 `describeWork` 的一句话摘要；
6. `rejected`／`cancelled` → `created: false`，同样不写盘，`outcome` 原样返回。

工具不创建 `source/story/`，也不顺便写基础设定：立项与写设定是两步，写设定的入口仍是 foundation 段。

### 作品身份补两个可选字段，三条路一起扩

`WorkMetadata` 加可选的 `genre` 与 `platform`；`writeWork` 只接受非空字符串，`parseWork` 原样保留，`describeWork` 在它们存在时追加到摘要里。`work.json` 的 `version` 不变：两个字段是可选的，旧文件照样通过解析。

字段进了身份，就不能只有提案一条路能写：`story_work_create` 的参数与 `story_work_show` 的输出 schema（都按 `additionalProperties: false` 声明 metadata）同批加上这两个字段，`/story-init` 也加 `--genre`、`--platform` 两个选项。三条路写出的 `work.json` 是同一个形状，`story_work_show` 才能读回自己刚写的东西。

### 确认条：复用 foundation 已经验证过的判定

不新写一套「能不能弹确认条」：用 `gate.ts` 已经导出的 `approvalServiceOf(ctx)` 与 `confirmationPolicy(approval, agent)`（foundation 签核在用），并把 `exec.callId`、`exec.signal` 原样传给 `approval.request`，作者取消时卡片随之收回。

四种结果分别处理：

- `allowed-once` → 写身份，`created: true`；
- `rejected` / `cancelled` → 不写盘，`created: false`，`outcome` 原样返回，提示模型问作者想改哪一处；
- `unavailable`（服务缺席、策略 `never`、或 `request` 自己返回 `unavailable`）→ 不写盘，`created: false`，提示确定性入口：`/story-init`，或作者明确说要立项后调 `story_work_create`。

### 对话收敛交给技能

新技能 `story-proposal`（`skills/story-proposal/SKILL.md`，随包注册）只讲「怎么问」：

- 只问缺的关键信息：标题／方向、题材、平台、语言、章数、单章字数；已经说过的不要再问；
- 一次只问一个问题，能合并的合并；目标读者与平台没提就先问平台，因为它决定章长与节奏；
- 信息够了两三句就提案，不要把所有字段做成表格让作者填；
- 被拒后只问「想改哪一处」，改完再提案，不重问已经确认过的项；
- 提案里不虚构作品事实（人物、设定、伏笔留给 foundation 段）。

技能是方法，不是门禁：真正挡住「没确认就落盘」的是工具里的那一步确认。

### 与已有入口的关系

`/story-init` 与 `story_work_create` 保留：它们是确定性的、不需要确认卡的路（命令本身就是作者的动作）。`story_propose` 是「模型发起、作者确认」的那条路。三条路都只写 `work.json`，不会各写各的身份格式。

## Alternatives considered

**让模型直接调 `story_work_create`，把「提案」放进对话文本。** 少一个工具。否掉：那等于模型替作者拍板，作者没有一张能看清参数再决定的卡；参考工程把提案与执行分开，正是为了这一步。

**用面板卡片而不是原生确认条。** 视觉更可控。否掉：面板要新增一块 UI 与状态通道，而确认条已经存在、已被 foundation 签核验证；先用确认条，等面板需要展示提案详情时再扩展。

**把提案存成文件再等作者确认。** 跨会话可恢复。否掉：提案是对话的一次性产物，存文件就多一份会过期的副本，还要处理「提案与作品不一致」；确认就在同一轮里完成。

**`story_propose` 在确认后顺便调 foundation 段。** 一步到位。否掉：作者确认的是「立项」，不是「开始写设定」；自动往下走会把确认的范围悄悄扩大。

## Acceptance criteria

- 作者在对话里给出方向、缺的项由模型追问；信息够后模型调 `story_propose`，确认条上出现标题、题材／平台、语言、目标章数与单章字数。
- 确认条允许 → `work.json` 出现且只有它：`title`、`language`、`metadata.targetChapters`／`chapterWordCount`／`genre`／`platform` 与提案一致；`source/story/` 不存在；`story_next` 报 `foundation`；工具返回 `created: true`。
- 拒绝或取消 → 工作区没有任何新文件，工具返回 `created: false` 与对应 `outcome`；模型据此问作者要改什么。
- 没有 `approval` 服务、策略 `never`、或 `approval.request` 自己返回 `unavailable`：三者都不写盘，工具返回 `created: false`、`outcome: "unavailable"` 与替代路径的提示。
- 已存在 `work.json` → 工具报错且不改写原文件。
- 校验：空标题、空 `summary`、非法 `language`、`chapters`／`chapterWords` 非正整数时报错，不落盘；未给的字段按默认（`zh`，无目标规模）。
- `work.json` 里多出的 `genre`／`platform` 能被 `parseWork` 读回、被 `describeWork` 展示；旧格式 `work.json`（没有这两个字段）照常解析。
- 技能 `story-proposal` 随包注册（`test/host.test.mjs` 的技能清单断言同批更新），`story_propose` 进 `src/plugin/agent.ts` 的注册与注销顺序，工具清单断言同批更新。
- 身份字段：`story_work_create` 与 `/story-init` 都能写 `genre`／`platform`，`story_work_show` 的输出 schema 能原样读回；旧格式 `work.json` 照常解析。
- 实现与证据：implementation `packages/see-dsh-novel/src/plugin/proposal-tool.ts`；consumer `packages/see-dsh-novel/test/proposal.test.mjs`；核心校验与卡片渲染在 `src/core/proposal.ts`，身份字段与三条路的改动在 `src/core/work.ts`、`src/plugin/work-tools.ts`、`src/plugin/work-command.ts`，技能在 `skills/story-proposal/SKILL.md`；realRun `artifacts/real-runs/proposal.creative.json`。
- 真实运行：在一个空工作区里由主编收敛一句创意并提案，作者在确认条上点允许，`work.json` 按提案落盘、`story_next` 报 `foundation`；再跑一次被拒绝的提案，确认没有写盘。

## Risks

- 会话策略是 `never`（或宿主没装 approval）时提案只能走确定性入口，作者少一条路；工具会把替代路径说清楚，不静默创建。
- 标题、题材的质量取决于模型与作者来回，工具只做校验；写得太随便的提案会得到一张信息很少的卡，技能负责把该问的问到。
- `genre`／`platform` 是自由字符串，没有枚举；拼写不一致不会报错，后续若要筛选题材需要另立词表。
- 提案一次只落一个作品：确认后写盘与确认之间没有并发保护，同一会话里重复调用会被「已立项」挡住，跨会话同时立项仍可能各自创建。
- 拒绝后没有任何提案留档：作者改主意要重新收敛，这是「提案不落盘」的代价。
