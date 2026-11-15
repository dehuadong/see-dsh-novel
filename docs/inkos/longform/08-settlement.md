# 阶段八：摘要 / 结算 / 定稿（Summary, Settlement & Finalize）深度分析报告

> **源工程**：`inkos/`  
> **核心源文件**：
> - `inkos/packages/core/src/agents/settler-tool.ts`
> - `inkos/packages/core/src/agents/settler-prompts.ts`
> - `inkos/packages/core/src/state/state-reducer.ts`
> - `inkos/packages/core/src/state/state-validator.ts`
> - `inkos/packages/core/src/state/state-projections.ts`
> - `inkos/packages/core/src/state/runtime-state-store.ts`
> - `inkos/packages/core/src/state/chapter-workspace.ts`
> - `inkos/packages/core/src/state/state-bootstrap.ts`
> - `inkos/packages/core/src/state/chapter-delete.ts`
> - `inkos/packages/core/src/pipeline/chapter-persistence.ts`
> - `inkos/packages/core/src/pipeline/chapter-truth-validation.ts`
> - `inkos/packages/core/src/pipeline/chapter-state-recovery.ts`
> - `inkos/packages/core/src/agents/state-validator.ts`
> - `inkos/packages/core/src/agents/state-validation-tool.ts`
> - `inkos/packages/core/src/models/runtime-state.ts`
> - `inkos/packages/core/src/models/chapter.ts`
> - `inkos/packages/core/src/utils/hook-arbiter.ts`
> - `inkos/packages/core/skills/inkos-long-writing/references/state-projection.md`
> - `inkos/packages/core/src/__tests__/state-reducer.test.ts`
> - `inkos/packages/core/src/__tests__/state-projections.test.ts`
> - `inkos/packages/core/src/__tests__/state-validator.test.ts`
> - `inkos/packages/core/src/__tests__/state-authority-recovery.test.ts`
> - `inkos/packages/core/src/__tests__/hook-arbiter.test.ts`
> - `inkos/packages/core/src/__tests__/superseded-hooks.flow.test.ts`

---

## 1. 阶段概述

摘要、结算与定稿阶段（Summary, Settlement & Finalize）是长篇流水线最重要的**事实锚定点与状态归口枢纽**。正文定稿后，故事世界的真实事实发生了一系列不可逆变化。本阶段的核心使命是：
1. 从最终章节正文中萃取结构化状态差分（`RuntimeStateDelta`：包含新事实、过期事实、伏笔状态流转与新伏笔候选）；
2. 经 **StateValidator** 进行语义对账；
3. 通过 **HookArbiter** 执行伏笔状态机仲裁；
4. 将正文与结构化增量同步落盘，生成单向 Markdown 投影，并落存独立快照（Snapshot）与全文检索索引。

---

## 2. 执行主体与角色编排

- **SettlerAgent（结算师）**：从定稿正文中精准提取情节发生的事实变化、人物认知变化与伏笔跃迁。
- **StateValidatorAgent（状态校验师）**：在真实落盘前对照《本书规则》与大纲进行背离审查（`validateChapterTruthPersistence`）。
- **StateReducer（状态汇算器）**：纯函数式状态机，负责将结算差分（Delta）应用到当前运行时全局状态（`currentState` 与 `hooks`）。
- **HookArbiter（伏笔仲裁器）**：严格校验伏笔状态机跃迁（提及不等于解开、未知伏笔禁止更新）。
- **ChapterPersistence Engine**：底层持久化引擎，协调章节 Markdown、权威 JSON 与 SQLite 索引的写入。

---

## 3. 输入契约与上下文来源

- **最终确立的章节正文（Final Chapter Content）**：经审阅与修订通过的纯净 Markdown。
- **历史状态基线快照（RuntimeStateSnapshot）**：包含 `chapterNumber - 1` 章为止的权威事实库与伏笔库。
- **本书最高宪法**：`story/book_rules.md`、`story/story_frame.md` 与历史章节摘要。

---

## 4. 输出产物与权威形态

### 4.1 正式章节产物
- `chapters/0001_第1章_灵矿异动.md`：带有标准元数据的正式成书文件。
- `chapters/index.json`：全书目录索引（章节号、标题、字数、路径、创建时间、哈希）。

### 4.2 机器权威文件（Truth Files）
- `state/current_state.json`：更新后的世界运行状态（包含当前有效的所有事实实体）。
- `state/hooks.json`：更新后的伏笔台账。
- `state/chapter_summaries.json`：全书累积结构化摘要（剧情核心、人物弧光、环境氛围）。

### 4.3 只读单向投影（Read-Only Projections）
- `story/current_state.md`
- `story/pending_hooks.md`
- `story/chapter_summaries.md`
由系统基于权威 JSON **单向自动渲染**生成，严禁人类或 Agent 反向解析这些 Markdown 作为事实。

### 4.4 历史快照与索引
- `state/snapshots/chapter_0001.json`：第 1 章结算完毕时刻的完整全局状态深拷贝。
- SQLite FTS5：将本章摘要与关键事件写入检索库。

---

## 5. 核心流转机制与关键算法

### 5.1 结算差分抽取（SettlerToolSchema）
SettlerAgent 必须调用受控工具提交极其详尽的差分载荷：
```typescript
// packages/core/src/agents/settler-tool.ts
export const SettlementToolSchema = Type.Object({
  postSettlement: Type.String({ description: "本章事实变化的简短说明" }),
  factOps: Type.Object({
    upsert: Type.Array(StateFactToolSchema, { description: "本章建立的当前最新事实" }),
    expire: Type.Array(StateFactSelectorToolSchema, { description: "本章明确终结或被取代的旧事实" }),
  }),
  hookOps: Type.Object({
    upsert: Type.Array(HookRecordToolSchema, { description: "既有伏笔的属性更新" }),
    mention: Type.Array(Type.String(), { description: "本章仅提及、未改变状态的伏笔 ID" }),
    resolve: Type.Array(Type.String(), { description: "本章彻底闭环兑现的伏笔 ID" }),
    defer: Type.Array(Type.String(), { description: "本章明确推迟的伏笔 ID" }),
  }),
  newHookCandidates: Type.Array(Type.Object({
    type: Type.String({ minLength: 1 }),
    expectedPayoff: Type.String({ minLength: 1 }),
    notes: Type.String(),
  })),
  chapterSummary: ChapterSummaryToolSchema, // 结构化摘要
});
```

### 5.2 伏笔仲裁（HookArbiter）
伏笔状态机遵循极度严苛的守恒定律：
```typescript
// packages/core/src/utils/hook-arbiter.ts
// 1. 既有伏笔更新必须是已存在的 ID，禁止凭空造 ID
if (!knownHookIds.has(hook.hookId)) {
  throw new Error(`Hook upsert references unknown hook id: ${hook.hookId}. Submit a newHookCandidate instead.`);
}
// 2. 只有当前作者批准的设定明确撤销前提时，才允许将状态标记为 "superseded"
// 3. 某伏笔在章节正文中未出现，绝不等于已撤销或已解决！
```

### 5.3 事实对账与语义校验（validateChapterTruthPersistence）
在真正写入磁盘前，启动 StateValidator：
- 审查 `factOps` 是否推翻了前文不可推翻的公理；
- 检查新挖的伏笔是否与主线大纲冲突；
- 若出现严重分歧，设置 `reconciliationRequired: true`，将对账问题记入审计报告甚至挂起结算。

### 5.4 原子持久化编排（persistChapterArtifacts）
结算落盘执行统一编排：
1. 校验章节文件命名规则（`0001_*.md`）；
2. 写入章节文件；
3. 更新 `chapters/index.json`；
4. 汇算并写入 `state/current_state.json` 与 `state/hooks.json`；
5. 自动单向渲染并覆写 `story/current_state.md` 等投影文件；
6. 创建该章状态快照 `state/snapshots/chapter_<N>.json`；
7. 同步 WorkManifest 中的 Artifact Revisions。

---

## 6. 数据结构与 Schema 详述

### 6.1 `RuntimeStateDelta`
```typescript
// packages/core/src/models/runtime-state.ts
export interface RuntimeStateDelta {
  readonly postSettlement: string;
  readonly factOps: {
    readonly upsert: ReadonlyArray<StateFact>;
    readonly expire: ReadonlyArray<StateFactSelector>;
  };
  readonly hookOps: {
    readonly upsert: ReadonlyArray<HookRecord>;
    readonly mention: ReadonlyArray<string>;
    readonly resolve: ReadonlyArray<string>;
    readonly defer: ReadonlyArray<string>;
  };
  readonly newHookCandidates: ReadonlyArray<NewHookCandidate>;
}
```

### 6.2 `ChapterSummary`
```typescript
// packages/core/src/models/chapter.ts
export interface ChapterSummary {
  readonly chapterNumber: number;
  readonly title: string;
  readonly summary: string;               // 核心剧情梗概
  readonly keyEvents: string[];           // 关键大事件清单
  readonly characterDevelopments: string[]; // 角色心智与关系变化
  readonly foreshadowingNotes: string[];  // 伏笔铺设线索
  readonly atmosphere: string;            // 氛围与情绪基调
}
```

---

## 7. 质量门禁与强校验规则

1. **未知伏笔禁止更新**：
   - 在 `hookOps.upsert` 中提交未在数据库中立项的 `hookId`，立即抛出强类型错误阻断流程。
2. **重复操作冲突拦截**：
   - 同一个 `hookId` 不能在同一章同时出现在 `resolve` 和 `defer` 中。
3. **真相文件落地前对账拦截**：
   - 若 `truthValidation.validation.reconciliationRequired === true`，结算流程标记异常，阻止不自洽状态合入主库。

---

## 8. 一致性与因果链保障

- **双轨单向投影不变量**：
  状态数据在机器端由强类型 JSON 管理，在人类作者端表现为易读的 Markdown。任何时候如果产生分歧，一律以 JSON 为准。
- **快照回滚能力（Snapshot Rollback）**：
  由于每一章结算都会沉淀完整的 `chapter_<N>.json` 全量快照，当后续发生删章或章节重开时，系统能够瞬间无损还原至任意历史章节的世界线，彻底终结长篇写作中的因果崩塌。

---

## 9. 创作技能与专业方法论

技能 `inkos-long-writing` 与 `state-projection.md` 规范指出：
- **事实的颗粒度控制**：只记录对未来因果链有长期约束力的事实（如：获得灵宝、身中剧毒、得知宗门机密），切勿把琐碎流水账（如“主角喝了一杯茶”）提升为全局事实；
- **伏笔生命周期自觉**：明确区分“提到（Mention）”与“推进（Advance）”，避免作者或模型产生“伏笔已经解决”的错觉。

---

## 10. 测试覆盖与验证场景

核心测试位于 `inkos/packages/core/src/__tests__/state-reducer.test.ts`、`hook-arbiter.test.ts`、`state-validator.test.ts` 与 `superseded-hooks.flow.test.ts`：
1. **伏笔状态机跃迁测试**：断言通过 `resolve` 提交的伏笔状态正确流转为 `resolved`。
2. **非法废弃伏笔拦截测试**：验证在缺少作者授权依据时，试图将伏笔标记为 `superseded` 会被 `hook-arbiter` 拦截。
3. **单向投影一致性测试**：断言应用 StateDelta 后，重新渲染的 `current_state.md` 包含所有新 `upsert` 的事实文本。
4. **历史快照恢复测试**：模拟回滚至第 3 章快照，断言第 4、5 章的事实被完全剔除。
