# Agent Note: runtime.stage-context —— 阶段协议里的工作区读取边界

Status: proposed

## Problem

真实会话 `session-607ecdcb` 里，模型在 `cast_documents` 反复失败后去翻宿主安装目录找工具实现：

| 时间 | 工具 | 目标 | 结果 |
|---|---|---|---|
| 01:16:13 | `grep` | `C:\Users\MyPC\AppData\Local\Programs\DeepSeek Harness\resources\app.asar`，模式「角色卡内容不能为空」 | No matches found |
| 01:16:18 | `glob` | 同上 `app.asar\dsh`，`**/*` | `rg: IO error`（asar 是打包文件） |
| 01:16:33 | `glob` | 同上 `resources`，`*` | 列出 `app.asar`、`app-update.yml` 等 |

动机是查工具契约（起因见 [`2026-11-16-cast-documents-contract.md`](../../implemented/bug-fix/2026-11-16-cast-documents-contract.md)）。条件有两个：

1. 运行时上下文把宿主安装路径写进每个 agent 的上下文（「Current DeepSeek Harness implementation checkout: …app.asar\dsh」）。
2. 阶段协议没有任何「读写只留在工作区」的约束；模型在工作区里找不到答案时，很自然向外找。

后果：写小说的会话去读打包后的宿主程序，既无助于任务，也把宿主内部实现暴露给作品会话。这次读不到不代表下次读不到别的目录。

## 源工程证据

- 源的 agent 工具围绕作品目录设计，没有可指向任意绝对路径的通用检索工具（`ikinos` 的工具集在 `inkos/packages/core/src/harness/tools/`，检索面是作品/记忆/素材；无 `grep`／`glob`）。
- 源运行时与作品同进程同配置，不存在「宿主安装在别处」的概念，也就没有这条路径。
- 因此「可读任意绝对路径」是 DSH 工具面的落点差异，不是源行为。本项不给复刻新增能力，只给这个落点补一条与创作无关的边界——**这是作者在 2026-11-16 统一规划中列入的产品决定**（「③工作区外读取边界」），不是源行为复刻。

## Proposal

### 范围与非目标

- 范围：`stages/index.ts` 的阶段协议通用段（中英各一句）加「读写留在工作区内」的约束；`docs/dsh-mapping.md` **作者裁决偏差**表增「读边界」行（这是作者本批列入的产品决定，不是机制偏差）；`artifacts/implementation-audit/dsh-deviations.md` 增四段明细（含 `fs-sandbox` 的机制事实）；文本断言测试；重录 `artifacts/real-runs/runtime.stage-context.json`。
- 非目标：不改 DSH 的 `fs-sandbox`、内置 `read`／`glob`／`grep`（插件无权改宿主文件策略）；不新增工具白名单或数量限制；不改运行时上下文里宿主注入的 checkout 路径（插件改不了）；不实现工具层拦截（见决定）。
- 跨项边界：与角色卡契约项共享 `stages/index.ts`，本项只改 `renderStageBaseZh`／`renderStageBaseEn` 的 `common` 段那一行；角色卡项只改 foundation 分支第 4 步。

### 产品行为与验收

- 阶段协议（中英）写明：所有读写留在当前工作区内；工具怎么用看它的 schema 与报错，不要读宿主安装目录（`resources`／`app.asar`）或别的作品目录。
- 因为 `common` 会被追加到每个阶段，这条约束对所有阶段生效（含 foundation／plan／write／review）；这是有意为之：越界读取不限于某个阶段。
- 验收：`test/stage-context.test.mjs` 断言中英两份协议都含该约束；`docs/dsh-mapping.md` 的作者裁决表有「读边界」行且写明「DSH 读不受限、复刻用协议约束、未做拦截」；「foundation 阶段不再出现工作区外读取」这一观察项在无真实 DSH 会话时明确记 BLOCKED，不冒充已验证。

### 决定与未决问题

- 决定（本规划，2026-11-16）：**本项只做协议约束，不做工具层拦截**。依据与代价：DSH 确实提供了拦截缝（`tools/pre-execute` waterfall 与 `ctx.tools.guard()`，见 `deepseek-harness/packages/core/tools/src/index.ts` 与 `contracts.ts`），理论上可以拦住内置 `read`／`glob`／`grep` 的工作区外路径；但由一个作品插件去改写宿主工具分派、并按路径拒绝，属于新的产品限制（源没有），影响面覆盖所有会话与所有工具，必须单独裁决与验证。本项先把「不越界」写成协议并留下证据，拦截作为已识别的备选记录在案。
- 决定：`docs/dsh-mapping.md` 的对应行必须写明「读没有机制拦截」；若日后加了 guard，再改判并更新验证。
- 未决：是否需要工具层拦截（见上），本项不做。

### 评审与批准证据

- 规划授权：用户 2026-11-16 输入 `/planning 批准，执行规划 统一规划：①角色卡工具契约 ②角色卡目录权威 ③工作区外读取边界 ④控制文档语义`。
- Plan Review：第 1 轮指出本 Note 原挂 `runtime.agent-tools` 行不对（实现是 `stages/index.ts`）、「源真值写入走白名单」引用错文件、以及「无机制拦截」的判断错误（`tools.guard`／`pre-execute` 是可用的缝）。已改挂 `runtime.stage-context`、改正引用、并把「有缝但不用」写成显式决定；第 5 轮终评通过：Standards／Architecture 第 4 轮 clean，Spec 第 5 轮 clean。
- 实施授权：未授予。

## Design

- `stages/index.ts` 的 `common`（zh）追加：`所有读写都留在当前工作区内；工具怎么用看它的 schema 与报错，不要读宿主安装目录（resources／app.asar）或别人的作品目录。`
  `common`（en）追加：`Keep every read and write inside this workspace; the tool schema and its errors are the contract — do not inspect the host installation (resources/app.asar) or other workspaces.`
- `docs/dsh-mapping.md` 的「作者裁决偏差」表加「读边界」行，四段：源做法（工具围绕作品目录，无任意路径检索）／复刻做法（阶段协议要求工作区内读写）／作者裁决（2026-11-16 统一规划列入）／验证（文本断言 + 会话观察，拦截未做）。机制事实写在 `artifacts/implementation-audit/dsh-deviations.md`：`fs-sandbox` 只对写做 containment——`deepseek-harness/packages/fs/fs-sandbox/src/index.ts:5-8` 明确 "Reads pass through untouched"，写检查在 `:160-176`。
- 验证切入点：`test/stage-context.test.mjs` 的 zh／en 文本断言（注意 `proposal` 阶段恒渲染中文，英文断言要在 foundation 及之后阶段取）。

## Alternatives considered

- **用 `ctx.tools.guard()` 拒绝工作区外路径。** 最强理由：硬约束才可靠，协议只是软约束；而且缝确实存在（`contracts.ts` 的 guard 能拿到 `name`／`arguments`／`agent`）。否掉（本项）：这是新的产品限制，影响所有工具与所有会话；路径判定（符号链接、盘符大小写、UNC）本身要做对，否则会误伤合法读取。要做得住需要单独工作项与作者裁决，不能在「修一条角色卡报错」的批次里顺手加上。
- **把 checkout 路径从上下文移除。** 最强理由：不给模型指路。否掉：那是宿主注入的运行时事实，插件不控制；去掉它也挡不住模型自己猜路径。
- **什么都不做，只修工具契约。** 最强理由：读宿主是被契约卡住引起的，契约修好就不会发生。否掉：契约修好只降低概率；一条协议约束成本极低，且能把「不该读」写成明确规则。

## Acceptance criteria

1. 阶段协议中英各含「读写留在工作区」的约束，`test/stage-context.test.mjs` 断言两处文本。
2. `docs/dsh-mapping.md` 有「读边界」行，写明源无该场景、DSH 读不受限、复刻用协议约束、拦截未做。
3. 真实会话观察：foundation 阶段不再出现工作区外 `read`／`glob`／`grep`——环境无真实会话时记 BLOCKED，不作为本项通过条件。
4. 重录 `artifacts/real-runs/runtime.stage-context.json`（process-level + 协议文本证据；真实会话部分记 BLOCKED）。

## Risks

- 协议是软约束，模型仍可能越界；本项不承诺消除，只承诺写明、可观察、可升级为 guard。
- `common` 影响所有阶段文本，既有文本断言若整段匹配会失败；实现时只加不删，并把断言写成「包含」。
- 若日后加 `tools.guard()` 拦截，`dsh-mapping` 的「读边界」行与 AC3 的观察口径都要改判。
