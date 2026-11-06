# Agent Note: foundation.hooks —— 伏笔的状态语义与投影

Status: implemented

## Problem

`foundation.architect` 已经把初始伏笔写进 `state/hooks.json`，但那只是**一次播种**：条目字段由工具调用时顺手拼出，没有 schema、没有取值约束、没有「同一个 hookId 只能出现一次」的检查，也没有任何地方把伏笔渲染成可读的投影。账本这一行要求的是「id/status 语义、投影一致」——播种之外的三件事都还没有属主。

## Decision

### 条目与取值

`HookRecord` 落在 `core/hooks.ts`：

| 字段 | 约束 |
|---|---|
| `hookId` | 非空字符串，状态内唯一 |
| `startChapter` | 非负整数 |
| `type` | 非空字符串 |
| `status` | `open` / `progressing` / `deferred` / `resolved` / `superseded` |
| `lastAdvancedChapter` | 非负整数；不校验与起始章的先后（与源 schema 一致） |
| `expectedPayoff` | 字符串；已存条目的旧值可以为空，新候选必须给 |
| `notes` | 字符串 |

`architect` 播种的初值是 `status: "deferred"`、两个章节号都是 0，与这套约束相容。

### 状态流转

允许的迁移只有三条：

- `deferred → progressing`（本章首次涉及）
- `progressing → resolved`（回收完成）
- 任意状态 `→ superseded`（被新伏笔取代）

`resolved` 与 `superseded` 是终态，不再推进。推进时同时把 `lastAdvancedChapter` 设为当前章，并禁止倒退。非法迁移直接报错，不静默忽略——伏笔状态是后续 `chapter.settle` 的输入，错一次会污染整条链。

### 投影

`renderHooksProjection(state, language)` 输出 Markdown 表格，列固定为 `hook_id / 起始章节 / 类型 / 状态 / 最近推进 / 预期回收 / 备注`，按 `startChapter`、`lastAdvancedChapter`、`hookId` 升序排序。同一份状态必须得到同一份文本，排序不依赖对象插入顺序。

它落在 `pipelines/long/hooks.ts`，与 `core/hooks.ts` 的校验器分开：条目与迁移规则是任何流水线都要遵守的，表格形状是长篇这一侧的呈现。

### 可观察面

新增只读工具 `story_hooks`：返回各状态计数与投影文本。伏笔本身不由作者直接编辑，作者看的是投影；工具只读，写状态仍是 `chapter.settle` 的事。

### 非目标

- 章节结算时的状态推进（`chapter.settle`）
- 伏笔与章节正文的关联检索（`context.retrieval`）
- 作者手改 `hooks.json` 的入口

## Alternatives considered

**投影放进工具里，不建 `core/hooks.ts`。** 少一个模块。否掉：`chapter.settle` 之后要按同一套约束写状态，投影与校验必须共用一份，否则两处各写一遍取值规则。

**status 保持自由字符串。** 兼容性最好。否掉：五态已经是参考资料里的既定词表，放开只会让非法值在检索与 UI 里扩散；迁移非法时应当报错而不是存下来。

**把伏笔放进索引库查询。** 查询更快。否掉：`hooks.json` 是权威文档的一部分，索引可重建；把权威搬进索引会破坏「文档为权威」这条已定决策。

**直接在工具里返回原始 JSON。** 实现最省。否掉：作者与模型看的都是这个投影，表格比 JSON 更容易被后续 brief 直接复用。

## Consequences

收益：伏笔有了约束、迁移与稳定投影。`story_hooks` 在预设会话里可直接看到「# 伏笔池」表格；同一份状态必得同一份文本，排序不依赖插入顺序。

真实运行已跑通（`session-974fa00e…`）：`story_hooks` 返回 `isError=false`，表格里是两条 `deferred` 条目，列与参考资料一致。测试覆盖校验、迁移、排序、转义与计数。

代价与约束：

- `open` 与 `progressing` 的边界参考资料没给，本实现只为 `progressing` 定了「本章首次涉及」，`open` 暂不主动产生。
- 三条迁移规则是按语义补的，不是从 `state-reducer.ts` 抄来的；若后续发现参考实现的迁移不同，需要新开一篇 Note 覆盖本决定。
- 投影文本会成为 brief 输入，表头措辞变化影响下游 prompt；目前靠测试锁住表头。
