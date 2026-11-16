# Agent Note: cast.single-authority —— 人物档案上下文的格式贴源

Status: implemented

## Problem

`renderCastContext` 渲染人物档案的形态与源工程不一致，而且里面的标记、收尾句与内容处理都是复刻自造的：

| 元素 | 复刻现状（`packages/see-dsh-novel/src/pipelines/long/cast.ts`） | 源工程（`inkos/packages/core/src/utils/outline-paths.ts:106-126`） |
|---|---|---|
| 外层标题 | `## 人物档案（唯一来源：source/story/roles/）` | 无 |
| 分组标题 | 无；改为一行 `[roles:index]` + `主要角色：甲、乙` | `## 主要角色 / Major characters`、`## 次要角色 / Minor characters`（中英并列，与作品语言无关） |
| 单卡 | `[role:甲]` 后接卡内容 | `### 甲` 后空行接 `content.trim()` |
| 收尾 | `以上人物档案是唯一来源：已有角色不得改设定，新人物先建档再写。` | 无 |
| 卡内容 | 只去尾部换行，保留行尾空格与前导空行 | `content.trim()`（前后空白都去） |

`docs/scope.md` 的 AU-15 第 1 条记的正是这条（「上下文格式与结尾规则行改贴源 `readCharacterContext`，或登记为方法注入偏差」）。

此外复刻保留了 `[cast-problem]` 块（空卡、读失败时的问题行），源没有对应形态：源在空卡或整本没有角色卡时直接抛错。

## 源工程证据

- `inkos/packages/core/src/utils/outline-paths.ts:106-126` 的 `readCharacterContext`：按 `tier` 分组，`render(cards, "主要角色 / Major characters")` 产出 `## <heading>\n\n` + 每张卡 `### ${name}\n\n${content.trim()}`，卡之间空行；两个分组用 `\n\n` 连接，空分组被过滤。
- 卡来源与顺序：`readRoleCards`（`:60-75`）按四个目录并发收集，**不排序、不去重**，因此渲染顺序即并发完成顺序，本质上不确定。
- 空卡与缺卡：`readRoleCards` 在卡内容为空时抛 `Role card is empty: <path>`（`:93`）；`readCharacterContext` 在没有任何卡时抛 `Canonical role cards are missing from: <bookDir>/story/roles`（`:126`）。
- 权威规则的位置：源不把「不许改已有角色」写进人物档案上下文，而写在 writer 的 `governedContract`（`agents/writer-prompts.ts:39-45`「既成事实、显式禁令、已选上下文和真实 hook id 必须保留」）；复刻的 writer 契约同样有这条（`packages/see-dsh-novel/src/pipelines/long/stages/writer.ts:111-113`）。源里没有「新人物先建档再写」这类表述。

## Decision

- 人物档案上下文改为两段式：每个非空档位一段 `## <标题>`（`主要角色 / Major characters`、`次要角色 / Minor characters`），每卡 `### <名>` + 空行 + `content.trim()`，卡与卡、组与组之间空行，整段末尾不带换行。
- 删除外层标题、`[roles:index]` 索引行、`[role:…]` 标记与收尾句；`[cast-problem]` 保留（AU-15 第 2 条的待办）。
- 卡内容由「只去尾部换行」改为 `trim()`：行尾空格与前导空行不再进入上下文。
- 组内顺序保持按名字升序；这是对「源渲染顺序不可观测」的确定性选择，已登记偏差。
- 删掉收尾句的两个分句分别处理：前半句（既有角色不得改设定）由 writer 契约承担，后半句（新人物先建档再写）在源里没有对应表述，直接删除。
## Design

- `cast.ts`：用分组渲染替换现有拼装；两个组标题取 AC1 规定的文本；卡内容走 `trim()`（替换 `withoutTrailingNewlines`，连同其注释）；问题块逻辑保持，只调整与卡块的连接方式。
- 形态断言改为整段比对；`cast.test.mjs` 的 `contribution.text` 注入断言从 `[role:沈砚]` 改为 `### 沈砚`。要改的行：`:83-85`（外层标题、索引行与其注释）、`:86-88`（`[role:…]`、行尾空格与收尾句断言）、`:118`、`:140`、`:158`、`:189`（按 `[role:` 计数）、`:213-215`（`^## 人物档案` 与问题块）、`:256`（注入断言）；`:76`、`:209` 两条测试标题同步改名。
- `docs/dsh-mapping.md` 的映射表增加「人物档案顺序」行（源并发收集、顺序不可观测 → 复刻按码位升序 → 验证入口）；`artifacts/implementation-audit/dsh-deviations.md` 增加 `### 人物档案顺序` 四段。
- 账本与文档同步：`capabilities.yaml` 的 `cast.single-authority` 标题去掉 `roles:index／role:*` 措辞、`source` 改为 `outline-paths.ts` + `composer.ts`；`artifacts/real-runs/cast.single-authority.json` 重录为 process-level（保留 BLOCKED 说明）；`docs/scope.md` AU-15 剩余项收为第 2 条与第 3 条；`docs/fidelity-audit.md` 该行补「上下文格式已贴源」。

## Alternatives considered

- **保留 `[role:名]` 标记，只补分组标题。** 最强理由：标记对模型是显式边界，长卡之间不易粘连。否掉：源没有、也没有代码消费者；保留就等于把 AU-15 的债留下。
- **保留收尾句，登记为作者裁决偏差。** 最强理由：这句话把「不得改设定」直接放在档案旁边，比藏在 writer 契约里更显眼。否掉：源把这条写在 writer 契约里，复刻也已有；在 cast 里重复等于自造一条额外限制。
- **按目录收集顺序（不排序）输出。** 最强理由：与源 `readRoleCards` 的 push 顺序字面一致。否掉：源用 `Promise.all` 并发收集，顺序本身不确定，无法作为可比对的规格；排序至少可复现，并按「源行为不可观测」登记偏差。
- **保留 `withoutTrailingNewlines`（只去尾部换行）。** 最强理由：卡内容是作者的原文，逐字保留更接近「肉眼看文件」。否掉：源明确 `content.trim()`，格式贴源要求前后空白一起去掉；差异会体现在渲染结果上，不能算等价。

## Consequences

- 人物档案上下文变成源的两段式；模型看到的结构与源会话一致，`[role:…]` 这类自造标记消失。
- 卡内容的行尾空格与前导空行不再保留（`trim()` 的直接后果）；若有作者依赖行尾空格（例如 Markdown 硬换行），渲染会变化——这是源行为。
- 删掉收尾句后，foundation／plan 阶段的人物档案不再携带任何「不得改设定」提示：源同样如此（源的人物档案在两处注入，均不带规则），复刻的 writer 契约只在写作阶段承担权威顺序。这是贴源的直接后果，不假装由 writer 契约全阶段覆盖。
- 组内顺序按码位升序（登记为「源行为不可观测」偏差）；同名双卡仍各渲染一段（② 已定，不去重）。
- `[cast-problem]` 仍存在：复刻「不抛错、报问题」的策略与源抛错不同，归 AU-15 第 2 条；本项的形态断言会在第 2 条落地时再改一次。
- 账本与证据：`cast.single-authority` 的 real-run 重录（process-level）；`fidelity-audit` 与 `scope.md` 同批收窄；真实 DSH 会话回执仍缺（作者 2026-11-16 决定暂不重跑），记 BLOCKED。
- `artifacts/implementation-audit/rows/cast.single-authority.json` 的 `replicaEvidence` 描述的是**当前**行为（现在还写着 `[role:*]` 与收尾句），必须重录；能冻结的只有带日期的审计索引 `artifacts/implementation-audit/2026-11-14.md` 里当时的叙述文字，它指向的行文件本身是当前证据。旧回执同理：重录新的，旧条目删掉或明确标为历史。

## Testing

- `test/cast.test.mjs`：整段比对覆盖「两组都有」「只有主要角色」「无卡有问题」「有卡有问题」四种形态；`trim()` 的边界（尾空格、前导空行）由第一种形态的夹具覆盖；`### 名` 计数用例改用新标记。
- 改动前这些用例失败（旧形态带外层标题与 `[role:…]`）；改动后 26 例全绿。
- `pnpm run verify`：601 tests／600 pass／1 skipped。
- 真实 DSH 会话回执未取得（作者 2026-11-16 决定暂不重跑）：记 BLOCKED。
## Risks

- 少了 `[role:…]` 边界标记，超长卡相邻时可能更难区分；源本来如此，若观测到混淆再单独评估。
- `trim()` 会去掉行尾空格，可能改变 Markdown 硬换行渲染；属源行为，需在回执里写明。
- 排序是登记的不可观测偏差；若日后发现源有确定顺序，应改判并更新 `dsh-mapping`。
- `[cast-problem]` 与新形态并存，形态上仍有一处非源元素；AU-15 第 2 条落地时要再改这些断言。
