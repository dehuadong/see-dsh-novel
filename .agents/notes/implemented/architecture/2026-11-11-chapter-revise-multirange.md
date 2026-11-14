# Agent Note: chapter.revise 多段局部修订

Status: implemented

> 后续更新（2026-11-14）：D45（重审观察写回索引）已由 [chapter.review —— 重审观察写回章节索引](2026-11-14-review-index-writeback.md) 注销。

## Problem

`chapter.revise` 原先只允许 spot-fix 出现一段连续改动，并且只有 spot-fix 会校验 `targetText`。源工程的行为不是这样：

- `agents/reviser.ts:77-78` 的 `targetText !== undefined` 对任意 mode 都走局部替换契约；
- `agents/reviser.ts:96-105` 的 spot-fix 在没有 `targetText` 时提交 `ranges`（`minItems: 1`），`utils/text-range-edits.ts:40-59` 接受多段不重叠行范围，用 `range_N_content` 逐段替换并保留其余字节；
- `harness/tools/longform-production.ts` 的 `revise_chapter` 只暴露 `targetText`，范围选择发生在 reviser 内部，对作者可观察的结果是「多段局部修订可用，范围外正文不变」。

复刻把「宿主保证范围外不变」缩成「只允许一段」，于是多段局部修订不可用；`targetText` 也只在 spot-fix 生效。追溯评审把这两点记为 D53，作者裁决按源修正。

## Decision

### 范围与非目标

- 范围：只修 `chapter.revise` 的局部修订边界——spot-fix 支持多段不重叠行范围与逐段替换，`targetText` 对所有 mode 生效。
- 非目标：不写 artifact revision 的 `snapshotPath`（D42）；不更新章节索引的 `provenance`／`wordCount`／`upstream-revision`（D45）；不接自动重结算（D59）；不补 `changedRegion` 回执（D56）。
- 不改五种模式的语义、归档、artifact revision、审稿作废与 stage 闸门。
- D53 已在本行注销，`artifacts/real-runs/chapter.revise.json` 已按新行为重录。

### 交付行为

- spot-fix 有两种提交方式：1..N 段不重叠行范围＋每段替换文本＋整段 `content`；或一个唯一 `targetText`＋整段 `content`。两者都没有时拒绝。
- 其他四种 mode 用整段 `content`，可选 `targetText`；提供时只允许替换该片段。
- 多段修订由宿主按声明范围替换正文构造结果；声明的范围外正文逐字节不变。
- 范围与替换数量不一致、越界、重叠、与 `targetText` 同时给、非 spot-fix 给范围时，在写盘前以 `ARTIFACT_EDIT_RANGE_INVALID` 拒绝。
- `content` 与宿主构造的正文不一致时以 `CHAPTER_EDIT_SCOPE_CONFLICT` 拒绝。
- `targetText` 用字符级校验；片段外一个字节改动都拒绝。
- 旧正文归档、新 revision、旧审稿作废、workflow start 行为不变。
- 可观察验收：工具错误码与章节文件字节；`test/chapter-revise.test.mjs` 覆盖。

### 决定与未决问题

- 由主编把 reviser 子代理选出的范围与每段替换文本一起提交给工具：DSH 的修订结果由子代理返回，宿主拿到逐段替换才能像源一样直接构造正文、保证范围外不变。这是宿主侧输入，不是给作者的新入口；偏差登记见 `docs/dsh-mapping.md`。
- `ranges`／`replacements` 只在 spot-fix 允许；`targetText` 与它们互斥；`content` 始终必填。
- 未决问题：无。范围选择规则、错误码与失败行为按源。

### 评审与批准证据

- Plan Review 第 1–5 轮依次修正了：偏差登记、`targetText` 字符级、diff 归属、错误码矩阵、`chapter-done` 章号；第 6 轮（作者追加）通过。
- 批准与执行授权：2026-11-12，作者批准 `implement chapter.revise`。
- Implementation Review（Standards / Spec）：首轮各报 5／6 条，修正后复核通过。

## Design

### 工具接口

`story_revise_chapter` 增加两个可选参数：

```text
ranges?: Array<{ startLine: number, endLine: number }>
replacements?: string[]
```

- `startLine`／`endLine` 为 1 基、含端点，相对章节正文（不含标题行）。
- `content` 保持必填。
- `ranges` 只允许 spot-fix；`replacements` 必须与 `ranges` 等长、一一对应。
- spot-fix 必须提供 `ranges`＋`replacements`，或 `targetText` 之一。
- `targetText` 对五种 mode 都可用；与 `ranges`／`replacements` 同时出现时拒绝。

### 坐标与替换

- 行坐标取 `loadChapterDocument(root, chapter).content`：已去章标题、CRLF 归一为 LF、首尾 trim。范围外不变指这一层正文逐字节不变；文件层按现有渲染加标题与尾换行。
- 该层正文按 `\n` 切分为行（不含行尾换行）；空串零行。
- `replacements[i]` 是该段替换后的行内容：空串表示删除该段所有行；非空串按 `\n` 切分为若干行，替换原段所有行。宿主按行拼接后 `join('\n')`；纯删除不会留下空行。
- `ranges` 可以乱序提交：宿主把 `ranges` 与 `replacements` 按索引配对后按 `startLine` 排序，再校验。
- 范围校验：至少一段；每段整数、`startLine >= 1`、`endLine >= startLine`、`endLine <= 行数`；排序后要求 `startLine > 前一段 endLine`（相邻行可相接，重叠拒绝）。
- 数量不一致、缺 `replacements`、越界、重叠统一 `ARTIFACT_EDIT_RANGE_INVALID`，不写盘。源同名错误只覆盖范围本身；把参数形状错误复用到同一码是复刻契约，在 mapping 行的验证里注明。

### 构造与校验

- 有 `ranges` 时，宿主从原文按行切分、依次用 `replacements` 替换各段，拼出正文；不依赖 diff，不存在插入归属问题。
- 构造结果先按 `chapterBodyForChapter` 归一（吸收替换引入的首尾空白）；`content` 也按同一函数归一，再逐字节比较；归一后不一致才拒绝 `CHAPTER_EDIT_SCOPE_CONFLICT`。带本章标题、CRLF、首尾空白会被归一吸收，不算不一致。
- 有 `targetText` 时取 `original = document.content`（归一后的原文），`start = original.indexOf(targetText)`；要求归一后的 `content` 前缀逐字节等于 `original.slice(0, start)`、后缀逐字节等于 `original.slice(start + targetText.length)`；中间就是替换文本。前缀或后缀不符即 `CHAPTER_EDIT_SCOPE_CONFLICT`。
- 判定顺序：未知 mode → 参数形状（spot-fix 两条路径、互斥、非 spot-fix 不得给范围）→ 范围排序与校验 → 构造正文／归一 `content` → 空正文 → `content` 比较 → `targetText` 绑定 → 是否与原文一致（`changed=false` 则不写盘、不作废审稿、不重开）。
- spot-fix 无改动（构造结果与原文一致）返回 `changed=false`，不再抛「没有可落盘的改动」。

### 错误码矩阵

| 情形 | 结果 |
| --- | --- |
| 未知 mode | 现有未知模式错误 |
| spot-fix 且无 `ranges`／`targetText` | `ARTIFACT_EDIT_RANGE_INVALID` |
| 非 spot-fix 给 `ranges`／`replacements` | `ARTIFACT_EDIT_RANGE_INVALID` |
| `ranges` 与 `targetText` 同给 | `ARTIFACT_EDIT_RANGE_INVALID` |
| `replacements` 缺失或与 `ranges` 不等长 | `ARTIFACT_EDIT_RANGE_INVALID` |
| 范围非整数、越界、重叠 | `ARTIFACT_EDIT_RANGE_INVALID` |
| `content` 与构造结果不一致 | `CHAPTER_EDIT_SCOPE_CONFLICT` |
| `targetText` 不存在或为空 | `ARTIFACT_EDIT_TARGET_NOT_FOUND` |
| `targetText` 出现多次 | `ARTIFACT_EDIT_TARGET_AMBIGUOUS` |
| 改动超出 `targetText` | `CHAPTER_EDIT_SCOPE_CONFLICT` |
| 归一后正文为空 | `content 不能为空` |
| 结果与原文一致 | `changed=false`，不写盘 |

判定顺序见上：空正文在构造／归一之后、`content` 比较之前；源同名错误只覆盖范围本身，参数形状错误复用同一码属复刻契约。

### 偏差登记

`docs/dsh-mapping.md` 的「chapter.revise：局部修订范围由主编随正文提交」记录：源在 reviser 内部提交 `ranges`＋`range_N_content`，复刻由主编把 `ranges`＋`replacements` 一起提交；验证见该行。

### 阶段协议

`chapter-done` 与 `review` 的修订步骤写明：spot-fix 时 reviser 子代理按编号正文（`numberSourceLines(body)`）选范围并给出每段替换文本（空串删段，非空按 `\n` 分行）；`chapter-done` 注入与 `review` 相同的编号来源（章号 `currentChapter + 1`，即被审章；只给 `## 来源 chapter-N` 与 memo，不复用「审稿要求」），协议标题用 `第 ${next} 章`；提供 `targetText` 时改交整段 `content`。

### 兼容与失败行为

- `ranges`／`replacements` 是新增可选参数；非 spot-fix 的旧调用不受影响。
- spot-fix 的旧调用（只给 `content`）不再可用，必须补范围或 `targetText`；这是 D53 修正的一部分。
- spot-fix 无改动从抛错改为 `changed=false`；旧测试已同步。
- 实现文件：`src/core/revise.ts`、`src/pipelines/long/revise-tool.ts`、`src/pipelines/long/stages/index.ts`、`src/pipelines/long/stages/review.ts`。

## Alternatives considered

- **允许 content 出现多个 diff 段，不声明范围** — 去掉「第二段拒绝」即可。否掉：没有声明就无法区分多段局部修订与范围外改动，范围外保护会丢。
- **content＋行级 diff 判定改动是否落在 ranges 内** — 只加一个 `ranges` 参数。否掉：diff 对齐在重复行、文首/文末插入时不是字节契约，会把合法替换判成越界或反之；改成逐段替换后宿主直接构造正文，判定确定。
- **保持单段限制，把 D53 留作债** — 不改行为。否掉：限制是复刻自创的，源支持多段；作者已裁决按源修正。
- **新增 `story_revise_ranges` 工具分两步走** — 更接近源内部「先选范围、再填替换」。否掉：多一次工具往返与一份中间状态，主编仍要保管范围；一次调用提交范围与替换能达到同样保证。
- **只支持 `targetText`，用多个 `targetText` 表达多段** — 参数更简单。否掉：源的多段是行范围；多个 `targetText` 会引入重复片段歧义与新的匹配规则，偏离源契约。

## Testing

- `test/chapter-revise.test.mjs`（14 例）：范围配对、排序、重叠、越界、非整数；空串删段与多行替换；多段成功；`content` 不一致；缺 `replacements`；空 ranges；`targetText` 任意模式与字符级边界；构造结果归一后比较；spot-fix 无改动 `changed=false`；归档、revision 与归档隐藏。
- `test/stage-context.test.mjs`（4 例）：`chapter-done` 章号为 `next`、编号来源为被审章、且不含「审稿要求」；`review` 协议含 spot-fix 的 `ranges`／`replacements` 修订步骤。
- `pnpm run verify` 全绿：402 tests；`artifacts/real-runs/chapter.revise.json` 已按新行为重录。
- D53 已从 `docs/scope.md` 注销；`changedRegion` 仍缺，记 D56。

## Consequences

- 宿主不再用行级 diff 推断改动，范围外保护由「构造」而不是「比较」保证；`content` 与 `ranges`／`replacements` 必须自洽，否则拒绝。
- 子代理要多交一份整段 `content`，模型输出略增；不一致时拒绝，不会写坏文件。
- spot-fix 无改动从错误变成 `changed=false`，依赖旧错误的调用方会看到行为变化；旧测试已改写。
- 旧回执与审计描述按新行为重录；D42 仍是本行的债；D45／D56 已由 [修订更新索引与回执](2026-11-13-revise-index-changed-region.md) 交付（D45 收窄为定稿覆盖 `edited` 的残余）。
