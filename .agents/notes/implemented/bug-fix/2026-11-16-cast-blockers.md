# Agent Note: cast.single-authority —— 空卡与读失败的处置登记（AU-15 收尾）

Status: implemented

## Problem

AU-15 最后一条是「空卡/读失败处置按源复刻或裁决」。逐一核对后，**可复刻的部分已经一致，剩下的必须登记**：

| 情形 | 候选选择侧（`composer.ts` / `context-package.ts`） | 物化侧（人物档案上下文） |
|---|---|---|
| 卡文件读不出 | 两边都对非 ENOENT 抛出：源 `composer.ts:801` 无 try/catch，复刻 `readText` 只吞 ENOENT —— **已一致** | 源 `outline-paths.ts:92` 抛；复刻 `cast.ts` 的 `readTier` catch 后记问题并继续 —— **偏差** |
| 卡内容为空 | 两边都宽容：源把空 `excerpt` 当候选；复刻同样 —— **已一致** | 源 `:93` 抛；复刻不注入 + 记问题 —— **偏差** |
| 角色目录读不出 | 两边都对非 ENOENT 抛出 —— **已一致** | 源 `:81-88` 抛；复刻记问题 —— **偏差** |
| 四个目录零个 `.md` | 两边都没有候选 —— **已一致** | 源 `:126` 抛；复刻不输出人物档案段 —— **偏差** |
偏差全部集中在**物化人物档案**这一步（候选选择侧四档都已对齐）：源的调用点是 foundation 重生成（`pipeline/runner.ts:590`）与叙事预测（`forecast/context-builder.ts:62`），复刻没有 forecast，foundation 重走是 `cast_documents` 的 `revise`（不整体读旧档案）；而把抛错挪到 `systemPrompt.context()` 的文本函数不行——它每步装配，抛错会把无关对话步骤一起打断，范围远大于源的一次动作。

因此本项不改代码，只把物化侧的四档登记为机制偏差，并把 AU-15 收口。

## 源工程证据

- 目录读失败：`inkos/packages/core/src/utils/outline-paths.ts:81-88`，`readdir` 非 ENOENT 直接抛出。
- 卡文件读不出：`:92` 的 `readFile` 在 `Promise.all`（`:100`）里没有 try/catch。
- 空卡：`:93` `if (!content.trim()) throw new Error(\`Role card is empty: …\`)`。
- 整本无卡：`:126` 抛 `Canonical role cards are missing from: …`。
- 候选选择：`inkos/packages/core/src/agents/composer.ts:792` 只 guard ENOENT，`:801` 的 `readFile` 直接抛出；空卡不检查，空 `excerpt` 也是有效候选。
- 物化点：`readCharacterContext`（`:106-126`）的调用点只有 `pipeline/runner.ts:590` 与 `forecast/context-builder.ts:62`。

## Decision

- 本项不改代码：候选选择侧四档（读失败、空卡、目录读失败、零卡）已与源一致，物化侧四档的失败在复刻没有对应落点。
- 物化侧（空卡、读失败、目录读失败、零卡）登记为机制偏差：源在物化人物档案时抛错（foundation 重生成、叙事预测），复刻的人物档案由 `systemPrompt.context()` 每步装配，改为不注入 + `[cast-problem]`。
- 不加 plan／write 闸门：源对空卡在 plan／write 是宽容的（空 `excerpt` 也算候选），加闸门是新的产品限制。
- 保留 `[cast-problem]` 作为坏卡的唯一可见出口。
## Design

- 无代码改动。文档三处：`docs/dsh-mapping.md` 映射表加一行（机制：人物档案坏卡处置；源：物化时对空卡、读失败、目录读失败、零卡都抛；候选选择时对空卡宽容、对读失败抛出；复刻：候选侧四档已对齐，物化侧四档改为不注入 + `[cast-problem]`；原因：源的物化是单次触发（foundation 重生成／forecast），复刻的提供者每步装配、没有对应落点；验证：`cast`／`context-package` 现有用例 + real-run（真实会话部分仍 BLOCKED））；`artifacts/implementation-audit/dsh-deviations.md` 四段；`docs/scope.md` 与 `docs/fidelity-audit.md` 收窄措辞。
- 回执：`artifacts/real-runs/cast.single-authority.json` 重录，写清三档现状与偏差理由，真实会话部分继续 BLOCKED。

## Alternatives considered

- **在 plan／write 加闸门（最初方案）。** 最强理由：作者最关心「坏卡别让我写出一章缺人的稿」。否掉：源对空卡在 plan／write 是宽容的（空 `excerpt` 也算候选），加闸门是新的产品限制。
- **在上下文提供者里抛错。** 最强理由：与源同一处失败。否掉：提供者每步装配，抛错会打断无关对话，范围远大于源的一次动作。
- **把读失败也登记为偏差（认为候选枚举会吞错）。** 最强理由：看起来复刻更宽容。否掉：核实后 `readText` 对非 ENOENT 已经抛出，与源 `composer.ts:801` 一致，没有可登记的差异。

## Consequences

- AU-15 的代码项到此关闭；只剩真实回执，等作者有真实会话时补。
- 坏卡（空卡、读失败、目录坏、零卡）在物化侧始终是「告警 + 缺席」，不会挡住写作；与源在 foundation 重生成时拒绝不同，已在 `dsh-mapping` 与 `dsh-deviations` 登记。
- 若作者要求「坏卡必须挡住写作」，需另立工作项并按新的产品限制裁决；若作者认可「提供者不抛错」是产品决定而非机制限制，本行应改挂「作者裁决偏差」。

## Testing

- 无代码改动；行为由现有用例锁定：`test/cast.test.mjs` 覆盖空卡、目录读失败、零卡的问题行与两段式形态；`test/context-package.test.mjs` 覆盖读失败抛出与空卡仍成候选。
- `pnpm run verify`：601 tests／600 pass／1 skipped（与改动前一致，符合「不改行为」的合同）。
- 真实 DSH 会话回执未取得（作者 2026-11-16 决定暂不重跑）：BLOCKED，AU-15 的剩余回执三类待补。
## Risks

- 登记不等于修复：作者若期望「坏卡挡写作」，这条登记不会带来那个效果，需要另一次裁决。
- 三档并列容易写混：读失败是「已对齐」，其余是「登记」，文档必须分开写，否则以后会被当成同一类偏差。
- forecast 在复刻中不存在，源的第二个物化点没有对应物；偏差行写明，避免以后被当成遗漏。
