# Agent Note: runtime.stage-context —— 阶段协议里的工作区读取边界

Status: implemented

## Problem

真实会话 `session-607ecdcb` 里，模型在 `cast_documents` 反复失败后去翻宿主安装目录找工具实现：

| 时间 | 工具 | 目标 | 结果 |
|---|---|---|---|
| 01:16:13 | `grep` | `…\Programs\DeepSeek Harness\resources\app.asar`，模式「角色卡内容不能为空」 | No matches found |
| 01:16:18 | `glob` | 同上 `app.asar\dsh`，`**/*` | `rg: IO error`（asar 是打包文件） |
| 01:16:33 | `glob` | 同上 `resources`，`*` | 列出 `app.asar`、`app-update.yml` 等 |

动机是查工具契约（起因见 `../bug-fix/2026-11-16-cast-documents-contract.md`）。条件有两个：运行时上下文把宿主安装路径写进每个 agent 的上下文；阶段协议没有任何「读写只留在工作区」的约束。

后果：写小说的会话去读打包后的宿主程序，既无助于任务，也把宿主内部实现暴露给作品会话。这次读不到不代表下次读不到别的目录。

## 源工程证据

- 源的 agent 工具围绕作品目录设计（角色上下文、真值白名单、记忆与素材都按作品根解析），没有可指向任意绝对路径的通用检索工具（`inkos/packages/core/src/harness/tools/` 无 `grep`／`glob`）。
- 源运行时与作品同进程同配置，不存在「宿主安装在别处」的概念，也就没有这条路径。
- 因此「可读任意绝对路径」是 DSH 工具面的落点差异，不是源行为。本项不给复刻新增能力，只给这个落点补一条与创作无关的边界——这是作者在 2026-11-16 统一规划中列入的产品决定。

## Decision

- 阶段协议通用段（中英）各加一句：所有读写留在当前工作区内；工具怎么用看它的 schema 与报错，不要读宿主安装目录（`resources`／`app.asar`）或别人的作品目录。
- `common` 被追加到每个阶段，所以约束对所有阶段生效（含 proposal、foundation、plan、write、review、chapter-done）。
- 本项**只做协议约束，不做工具层拦截**：DSH 的 `fs-sandbox` 只对写做 containment，读原样放行；`tools.guard()`／`pre-execute` 虽是可用的缝，但由作品插件改写宿主工具分派属于新的产品限制，需单独裁决与路径判定，不在本项。
- 偏差归属：`docs/dsh-mapping.md` 的「作者裁决偏差」表登记本决定；机制事实与拦截取舍写在 `artifacts/implementation-audit/dsh-deviations.md`。
- 不改 `fs-sandbox`、内置 `read`／`glob`／`grep`、宿主注入的 checkout 路径；不新增工具白名单或数量限制。

## Design

- `stages/index.ts` 的 `renderStageBaseZh`／`renderStageBaseEn` 各自 `common` 常量尾部追加一句；不改阶段分支、不改 `WRITER_STOP_*` 文案。
- 验证切入点：`test/stage-context.test.mjs`——七阶段中文协议断言三句（工作区边界／不读宿主安装目录／工具契约以 schema 与报错为准）；六个阶段的英文协议断言对应三句（`Keep every read and write inside this workspace`／`do not inspect the host installation`／`other workspaces`）。
- 文档：`dsh-mapping.md` 的作者裁决行只写结论与验证入口；`dsh-deviations.md` 用四段写源做法、复刻做法、原因（含 `fs-sandbox` 读放行与 `tools.guard` 缝）与验证。

## Alternatives considered

- **用 `ctx.tools.guard()` 拒绝工作区外路径。** 最强理由：硬约束才可靠，协议只是软约束；缝确实存在（guard 能拿到工具名、参数与 agent）。否掉（本项）：这是新的产品限制，影响所有工具与所有会话；路径判定（符号链接、盘符大小写、UNC）本身要做对，否则会误伤合法读取。要做得住需要单独工作项与作者裁决。
- **把 checkout 路径从上下文移除。** 最强理由：不给模型指路。否掉：那是宿主注入的运行时事实，插件不控制；去掉它也挡不住模型自己猜路径。
- **什么都不做，只修工具契约。** 最强理由：读宿主是被契约卡住引起的，契约修好就不会发生。否掉：契约修好只降低概率；一条协议约束成本极低，且能把「不该读」写成明确规则。

## Consequences

- 模型在任何阶段都能读到「读写留在工作区、工具契约看 schema 与报错」，不再需要靠翻宿主目录理解工具。
- 约束是软的：模型仍可能越界，本项不承诺消除，只承诺写明、可观察、可升级为 guard。
- 已知边界：writer 子会话落盘后，阶段条目整段被 writer-stop 文案替换，该阶段不再携带本约束——这是既有阶段替换行为，不在本项范围。
- 账本与证据：`runtime.stage-context` 的 real-run 重录（process-level + 文本证据）；偏差行与明细已登记；`docs/scope.md` 无新增债（作者裁决不计保真债）；`fidelity-audit.md` 判定维持机制等价。
- 真实 DSH 会话观察（foundation 阶段不再出现工作区外读取）记 BLOCKED，不冒充已验证。
- Implementation Review 的实质发现已修：`dsh-mapping` 行不再夹带机制细节与批次语（归 `dsh-deviations`）；断言补到三句，英文从单阶段扩到六阶段；real-run 已重录。

## Testing

- `test/stage-context.test.mjs`：中文七阶段 × 三句；英文六阶段 × 三句；foundation 第 4 步的字段与字数规格断言保持。
- `pnpm run verify`：见 `artifacts/real-runs/runtime.stage-context.json` 的当前计数。
