# Agent Note: plan.context-select —— 章前上下文：四个选择器、分层与 trace

Status: proposed

## Problem

检索之后要把候选变成一份带层级、预算与 trace 的上下文包。源工程由 `ComposerAgent.selectTaskContext` 完成（`agents/composer.ts:591-981`）：固定来源（方向文档、风格指南、上一章）直接 protected；伏笔与摘要走 memory 选择器、角色卡走 role 选择器、当前状态走 state 选择器、大纲走 outline 选择器，四个选择器各是一次 LLM 调用；最后按 token 预算组装 `ContextPackage` 并写 `ChapterTrace`（七字段，`models/input-governance.ts:35-70`）。复刻侧只有检索，没有选择、分层与 trace。

## Proposal

### 数据形状

`core/context-package.ts`：

```ts
interface ContextSource { source: string, reason: string, excerpt?: string, protection: 'protected' | 'compressible' }
interface ContextPackage { chapter: number, selectedContext: ContextSource[] }
interface ChapterTrace {
  chapter: number
  plannerInputs: string[]      // 规划实际读到的 source
  composerInputs: string[]     // 选择器读到的候选 source
  selectedSources: string[]
  contextTiers: { protectedSources: string[], compressibleSources: string[] }
  tokenBudget: { protectedTokens: number, compressibleTokens: number, totalSelectedTokens: number }
  retrieval?: { engine: 'sqlite-fts5-bm25', query: string, selectionMode: 'semantic'|'complete', candidates: {...}[], semanticSelectedIds: string[] }
  notes: string[]
}
```

### 选择管线

`compilePlanningContext(root, chapter, instruction, llm)`：

1. 固定层（protected）：`current_focus`／`author_intent`／`style_guide`（存在时）、大纲两份、上一章正文结尾（存在 `chapters/NNNN.md` 时）；
2. 检索候选：调用 `searchStory` 拿伏笔、摘要、角色、素材、大纲片段；
3. 四个选择器各一次 LLM 调用（prompt 逐字复刻源：memory／role／state／outline），要求返回候选 id 数组；未知 id 丢弃并在 notes 记录；
4. 组装：protected 全收；compressible 按选择顺序装入，超预算时留给 `plan.compression`（本行只报「超预算」标记，不截断、不压缩）；
5. 计算 trace：`tokenBudget` 用 CJK 感知估算（每个 CJK 字符 1 token，拉丁词按 4 字符 1 token），`retrieval` 段填检索引擎与候选数；
6. 返回 `{ package, trace }`。

### 工具与消费者

`story_compile_context(chapter, instruction?)`：只读，返回 `package` 与 `trace`；章节号必须是 `当前章 + 1`。`plan.chapter` 之后消费它；本行先用工具作为运行时消费者。

### LLM 选择器

通过 DSH 的 `llm` 服务发起（不进子代理）：四个提示词与「只返回 id 数组」的约束按源复刻；调用失败时该选择器退化为「全取候选」并在 notes 记录，不中断装配。测试用假 LLM，按提示词内容返回固定 id。

## Alternatives considered

**不做 LLM 选择，全部按检索分数截取。** 简单。否掉：源工程的四个选择器是语义选择，不是 top-k；去掉它等于换算法。

**四个选择器做成四个子代理。** 更接近多代理。否掉：选择器只是一次结构化输出，子代理的装配成本远高于收益；DSH llm 直接调用足够。

**超预算时本行直接压缩。** 一步到位。否掉：压缩是独立能力（`plan.compression`），有自己的失败语义；本行只标记超预算。

## Acceptance criteria

- `compilePlanningContext` 返回的 package：protected 含方向文档与大纲（存在时）、compressible 含被选中的伏笔/摘要/角色/状态；每条有 `source`（作品根相对路径）、`reason`、`protection`。
- trace 七字段齐全；`tokenBudget` 三数之和与 `selectedContext` 的估算一致；`retrieval.engine` 是 `sqlite-fts5-bm25`；`notes` 记录被丢弃的未知 id。
- 四个选择器各被调用一次（假 LLM 计数）；返回未知 id 时丢弃并记录，不报错；选择器抛错时退化为全取并在 notes 记录。
- 超预算时不截断，`notes` 含「超预算」标记与超出量。
- `story_compile_context` 对 `当前章 + 1` 以外的章号拒绝；返回结构符合 schema。
- 测试：`test/context-package.test.mjs`（四选择器、丢弃未知 id、退化、预算、trace 一致性）、`test/host.test.mjs` 工具清单加 `story_compile_context`。
- 实现与证据：implementation `packages/see-dsh-novel/src/core/context-package.ts`；consumer `packages/see-dsh-novel/test/context-package.test.mjs`；工具在 `src/pipelines/long/context-tool.ts`；realRun `artifacts/real-runs/plan.context-select.json`。
- 真实运行：在已有基础设定的工作区会话里调 `story_compile_context` 规划第 1 章，核对返回的 package 分层与 trace 字段；再用错误的章号调一次确认拒绝。

## Risks

- 选择器 prompt 与源的措辞一致，但模型不同、温度不同，选出的条目会不同；测试只锁调用次数与结构，不锁具体 id。
- token 估算是近似值，与源实现的精确计数有差距；trace 字段同名同形，数值误差在 Consequences 记录。
- 本行不压缩；超预算的上下文会原样交给 `plan.chapter`，压缩由下一行补。
- 四个选择器需要真实 LLM 才能验证效果，真实运行只证明管线与结构，不证明选择质量。
