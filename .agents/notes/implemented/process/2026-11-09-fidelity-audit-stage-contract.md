# Agent Note: 全链路保真复审与阶段合同

Status: implemented

## Problem

当前审计把“能力行是否 `verified`”当成阶段完成，但没有验证能力之间的联动，导致：

- `docs/fidelity-audit.md` 只有 20 个 `###` 段，`capabilities.yaml` 有 58 行；P0 的 `runtime.load`／`runtime.agent-tools`／`runtime.client-ui`／`runtime.package-check`／`runtime.boundary-check`、P1 的 `runtime.session-binding`／`runtime.telemetry`／`runtime.recovery`／`foundation.approval`／`cast.single-authority`／`runtime.work-lock` 等没有审计段。`missing` 行也没有审计段。
- `foundation.approval` 行是 `verified`，但它的“foundation 签核”不是源工程的 workflow start 确认；源 `propose_action` 只覆盖 15 个 workflow start，`write_next` 是 confirmed production intent，plan/write/revise 是 workflow 内部步骤。当前真正的缺陷是：**foundation 完成后阶段协议自动进入 plan/write**，没有等作者发起 `write_next` 这个 workflow start；不是“每个 write 工具都要 approval”。
- `runtime.work-lock` 仍是 `missing`，P2／P3／P6 的 `plan.*`、`chapter.write`、`chapter.review`、`artifact.identity` 已 `verified`；`scope.md` 的“前一行未 verified 不跳行”没有执行。
- `runtime.commands` D19–D21 代码未提交，旧 `realRun` 仍描述旧行为。
- `docs/dsh-mapping.md` 已有「作者确认 → approval + commands」行，但缺 `actionPayload`／`targetSessionKind`／confirmed intent 的绑定，缺 workflow start 与 workflow 内部步骤的区别，也缺阶段停点、会话绑定、锁的偏差行。
- `story:stage` 把阶段写成每轮强制协议；源工程没有“阶段 prompt 自动推进”，只有 workflow start 的作者确认。
- 面板 `StoryView` 的「认可/退回」只处理 foundation decision；没有 workflow start（如写下一章）的确认入口。`panel.workbench` 是单行单状态，不能一半归 P1、一半归 P6；必须拆成 `panel.confirm`（P1，workflow start 确认面）与只读 `panel.workbench`（P6），否则 P1 出口要么永远无法满足，要么把半行 P6 报成 `verified`。

## 源工程证据

- `inkos/packages/core/src/agent/agent-tools.ts:178-194`：`propose_action` 的 action 枚举只有 15 个 workflow start（`create_book`、`short_run`、`play_start`、…、`draft_structure`、`connect_choice`、`remove_node`）；没有 plan/write/revise/settle 的逐工具确认。
- `inkos/packages/core/src/interaction/session.ts`：`PendingProposedActionSchema` 持久化待确认动作；确认后才进入执行。
- `inkos/packages/studio/src/api/server.ts`：`confirmedCapabilityBinding`／`executeConfirmedProductionAction` 只在 confirmed action 上执行；`create_book`／`write_next` 等按 confirmed intent 绑定。
- `inkos/packages/studio/src/shared/confirmed-production.ts`：`write_next` 是 confirmed production intent；确认的是 workflow 启动，不是 plan/write 的每一步。
- `inkos/packages/cli/src/commands/book.ts`：CLI 的 `book create` 是作者直接命令，命令本身即确认；Studio 的 `propose_action` 是卡片确认。两者都不是“阶段 prompt 自动推进”。
- `inkos/packages/core/src/state/manager.ts`：`isCompleteBookDirectory`；源 `book create` 对不完整目录 `rm(workDir)` 重建；workspace 锁与事务在 `state`／`atomic-file-set`。
- `inkos/packages/core/src/pipeline/runner.ts`：`initBook` 生成基础设定；审稿、写作、结算各自是显式 pipeline 动作。

## Decision

### 1. 审计覆盖面

`docs/fidelity-audit.md` 必须覆盖 `capabilities.yaml` 的每一行；P7–P9 在“v1 之外”段统一说明，不进入 v1 阶段合同。新增或补齐：

- P0：`runtime.load`、`runtime.agent-tools`、`runtime.client-ui`、`runtime.package-check`、`runtime.boundary-check`；D23 的 `skill.references` 是新行，归 P0 的工具/技能面（先立行再审计）；
- P1：`runtime.session-binding`、`runtime.telemetry`、`runtime.recovery`、`foundation.approval`、`cast.single-authority`、`runtime.work-lock`、`runtime.stage-context`、`panel.confirm`（新行，P1 的 workflow start 确认面）；
- P1 其余已有段但需要补跨能力判断：`proposal.creative`、`panel.gate-resume`、`panel.foundation-start`、`foundation.*`、`runtime.commands`、`runtime.commit-safety`、`runtime.txn-format`；
- P2：`plan.*` 已有段，补“预算/窗口/压缩/素材引用同一证据”；
- P3：`chapter.write`／`chapter.review` 补“workflow start 边界、reviewedArtifact、同 revision”；不要写成每个 write 工具都 approval；
- P6：`artifact.identity` 已有段，补“与 review 的 target 一致”。

新增机械检查 `verify-audit-coverage`：从 `capabilities.yaml` 读取 **v1 P0–P6** 的每个 `id`，要求 `docs/fidelity-audit.md` 存在 `### <id>` 段（id 后允许括注，如 `### runtime.commands（建书命令）`）；P7–P9 不要求。`missing` 行也必须有段，内容写源证据与阻塞/债，不写“等价”。CI 失败即文档未覆盖。该检查只证明“有审计段”，不证明判断正确；判断仍由 Plan Review 审查。

每行审计固定六项：**源工程证据**（文件/流程/错误行为）、**复刻现状**、**命中的横向不变量**、**判定**（等价／机制等价／保真债）、**债号/阻塞**、**测试与真实回执**。没有源证据或没有命中的不变量，不写“等价”。

### 2. 阶段合同

`docs/scope.md` 的每个 P0–P6 阶段改为一份可验收合同，固定七项：

1. **源模块**：本阶段对应的 `inkos` 文件/流程。
2. **能力行**：本阶段包含的 `capabilities.yaml` id。
3. **横向不变量**：见第 3 节。
4. **用户可见面**：会话、命令、面板、确认通道、失败回执。
5. **入口条件**：上一阶段全部行 `verified`，且上一阶段横向不变量通过。
6. **出口条件**：本阶段行 `verified` + 横向不变量 + 真实回执 + 债务处理。
7. **非目标/债务**：本阶段不做的能力与 `scope.md` 债号。

阶段行清单以 `capabilities.yaml` 行序为准；`scope.md` 不复制状态。`P7–P9` 保持 v1 之外，不进入合同。P6 的 `panel.*` 只指导出/备份/素材/检索相关面板；`panel.gate-resume`、`panel.foundation-start` 属于 P1，不重复列入 P6。`panel.workbench` 拆成两行：`panel.confirm`（P1，workflow start 确认面）与只读 `panel.workbench`（P6）；两行各自有独立状态、实现、消费者与 realRun，不能把一行拆成两个阶段。`runtime.stage-context` 归 P1，不依赖账本里它与 `control-docs`／`truth-write` 的相邻顺序；实现顺序按账本行序，`scope.md` 债表顺序不是实现顺序。

### 3. 横向不变量

以下不变量写入 `fidelity-audit.md` 的独立段，并绑定到阶段出口；每条不变量在 `dsh-mapping.md` 有源 → DSH 落点：

1. **workflow start 确认**：源 `propose_action`／confirmed production 只覆盖 workflow start（如 `create_book`、`write_next`），不覆盖 plan/write/revise 的每一步；DSH 的审批/面板/命令必须确认 workflow start，workflow 内部步骤不重复加 approval。拒绝/取消/超时/未确认不启动 workflow；不能把“逐工具确认”自创成产品限制。
2. **阶段停点**：阶段上下文只描述当前能做什么；普通问候/讨论不改作品；只有作者发起 workflow start（命令/面板/确认）才进入下一阶段；阶段完成必须停下，不自动 plan/write/revise；工具入口可以拒绝“没有 workflow start 的跨阶段写入”，但不要求每个内部步骤 approval。
3. **作品边界**：一个工作区一部作品；`work.json` 身份、session 绑定、跨作品隔离；跨进程 `work-lock` 与事务；失败不留半写。
4. **证据同一**：会话日志、telemetry、realRun、面板展示来自同一证据；`capabilities.yaml` 状态只由证据生成，不手工写 `verified`。
5. **上下文同一**：模型窗口、预算、检索候选、压缩、`ChapterTrace` 七字段、review 来源同一基准；不静默截断。
6. **产物同一**：章节文档、artifact revision、`reviewedArtifact`、review 证据指向同一被审版本；写/审/改不跨 revision。
7. **面板/命令一致**：面板按钮、`/story-*` 命令、原生确认条不出现三套 decision；面板只读同一证据。

### 4. 映射覆盖

`docs/dsh-mapping.md` 已有「作者确认 → approval + commands」行，补齐而不是重写：

- **动作信封**：源 `propose_action` 的 `actionPayload`／`targetSessionKind`／`instruction`／`title`／`summary`，以及 host 的 `confirmedCapabilityBinding`／`confirmed intent` → DSH approval 的 reason／参数／命令回执；原因/验证；
- **workflow start 与内部步骤**：源 workflow start 只确认一次，plan/write/revise 是内部步骤 → DSH 只在 workflow start 使用 approval／面板，阶段内部不重复请求；
- **阶段停点**：源无阶段 prompt 自动推进 → DSH `systemPrompt.context` 只描述，workflow start 由作者动作触发；
- **会话/作品绑定**：源 `works/<id>` → DSH 一个工作区一个作品、`work.json`；
- **作品锁/事务**：源 `state` 锁／原子文件集 → DSH `commit`／work-lock；
- **面板**：源 Studio 确认卡 → DSH client slot + commands，`panel.workbench` 的确认面与只读面分开。

机制等价与真实偏差分开登记；不得用“阶段协议”替代 workflow start 确认，也不得把逐工具 approval 写成源行为。

### 5. 整改顺序

1. **冻结 P2/P3/P4/P5/P6**：不再提交 `plan.*`、`chapter.write/review/revise`、`artifact.identity`、`export.*` 的新增量；已 `verified` 的行保留证据，但不作为后续阶段入口。P2 也冻结到 P1 复审完成。
2. **P0 复审**：补齐 P0 五个行审计；确认 agent 工具面、client、package/boundary。
3. **P1 复审与补齐**：
   - `runtime.work-lock`（missing）；
   - `runtime.commands` D19–D21（未提交代码先完成真机/提交）；
   - `foundation.approval`：审计它与源 create_book 确认的关系；补 workflow start 边界，不把 plan/write 做成逐工具 approval；
   - `runtime.stage-context` 阶段停点：完成一段就停，不自动 plan/write；
   - `panel.workbench` 拆行：新增 `panel.confirm`（P1，workflow start 确认面）；`panel.workbench` 保留只读工作台（P6）。两行独立走 implementation／consumer／realRun；
   - `runtime.session-binding`／`runtime.telemetry`／`runtime.recovery` 审计；
   - `foundation.*`、`cast.*`、panel 跨不变量。
4. **P2 复审**：`plan.*` 上下文同一；偿还 D22／D24／D26 或明确阻塞。
5. **P3 复审**：`chapter.write/review/revise` 与 workflow start、artifact 同一；不在每个 write 工具上加 approval。
6. **P6 复审**：artifact/export/backup/materials/search/panel。
7. 每阶段退出后，才允许下一阶段的新增量。

### 6. 文档职责

- `docs/scope.md`：阶段合同（七项）与阶段顺序；不写状态、不写实现步骤。
- `docs/fidelity-audit.md`：行审计 + 横向不变量；判定与债号。
- `docs/dsh-mapping.md`：所有机制/动作/面板/阶段偏差；源 → DSH → 原因 → 验证。
- `capabilities.yaml`：唯一状态表；行证据、implementation／consumer／realRun。
- `docs/agents/GATES.md`：阶段授权；阶段出口检查引用 `scope.md` 合同与 `fidelity-audit.md` 不变量。
- Agent Notes：设计决定与备选；不复制阶段合同。
- `README`／包文档／面板文案：用户可见面（命令、面板、确认、失败回执）。

## Alternatives considered

- **只修 `foundation.approval` 门禁**：最快解决截图问题。否掉：`runtime.work-lock`、P0 审计、阶段合同、workflow start 映射仍缺；下一个能力还会在行级 `verified` 上漏联动。
- **继续按 P3/P6 行补**：保住已交付。否掉：P1 work-lock 与 workflow start 未闭合，P3/P6 的 `verified` 不能作为阶段完成。
- **新建一份阶段状态表**：直观。否掉：违反“状态只来自 `capabilities.yaml`”；阶段合同只写入口/出口与不变量，不写状态。
- **一次性重写全部 58 行审计**：彻底。否掉：范围过大且难评审；按 P0→P1→P2→P3→P6 分批，每批有机械覆盖检查。

## Testing

- `verify-audit-coverage`：v1 P0–P6 的每个 id 都有 `### id` 段（允许括注），`missing` 行也覆盖；缺一行 CI 失败。P7–P9 在 v1 之外段说明。
- `docs/scope.md` 的 P0–P6 合同包含七项与阶段行清单；P7–P9 明确非 v1；`runtime.stage-context` 归 P1，`panel.confirm` 新行归 P1、只读 `panel.workbench` 归 P6。
- `fidelity-audit.md` 有 7 条横向不变量，每条绑定源证据、DSH 落点、验证；
- `dsh-mapping.md` 已有作者确认行补齐 action envelope／workflow start／阶段停点／会话绑定／锁／面板；
- `runtime.work-lock`、`runtime.commands`、`runtime.stage-context`、`panel.workbench` 的行审计与真实回执；
- `pnpm run verify` 与 CI 双端通过。
- 实施后：`docs/scope.md` P0–P6 已按七项重写；`docs/fidelity-audit.md` 有 7 条不变量 + v1 全部行审计；`docs/dsh-mapping.md` 有 action envelope／workflow start／阶段停点／面板偏差；`capabilities.yaml` 增 `skill.references`、`panel.confirm`；`node scripts/verify-audit-coverage.mjs` 输出「50 个 v1 能力行均有审计段」；`check-capabilities --write` 为 60 条能力、verified 33、missing 27。

## Consequences

- 复审期会冻结 P2/P3/P4/P5/P6 的新增量；已在工作树的 D19–D21 先不提交，等 P1 复审口径确定。
- `verified` 行仍保留状态，但“阶段出口”不再只看行状态；审计可以给已验证行登记保真债。
- 文档工作量大于单点修复；收益是后续能力不再靠行级测试掩盖联动缺口。
- `propose_action` 的 DSH 等价是 workflow start 的 approval/面板/命令，不是逐工具 approval，也不是新增阶段 prompt；若某个 workflow start 无法确认，登记保真债，不能默认放行。
