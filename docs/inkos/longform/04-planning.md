# 阶段四：全书 / 章前规划（Planning: Planner + Composer + Retrieval）深度分析报告

> **源工程**：`inkos/`  
> **核心源文件**：
> - `inkos/packages/core/src/agents/planner.ts`
> - `inkos/packages/core/src/agents/planner-tool.ts`
> - `inkos/packages/core/src/agents/planner-prompts.ts`
> - `inkos/packages/core/src/agents/composer.ts`
> - `inkos/packages/core/src/agents/semantic-context-compiler.ts`
> - `inkos/packages/core/src/retrieval/local-search.ts`
> - `inkos/packages/core/src/utils/memory-retrieval.ts`
> - `inkos/packages/core/src/utils/governed-context.ts`
> - `inkos/packages/core/src/utils/governed-working-set.ts`
> - `inkos/packages/core/src/utils/context-assembly.ts`
> - `inkos/packages/core/src/models/input-governance.ts`
> - `inkos/packages/core/src/models/context-compression.ts`
> - `inkos/packages/core/src/pipeline/persisted-governed-plan.ts`
> - `inkos/packages/core/src/__tests__/persisted-governed-plan.test.ts`
> - `inkos/packages/core/src/__tests__/governed-working-set.test.ts`
> - `inkos/packages/core/src/__tests__/context-compaction.flow.test.ts`
> - `inkos/packages/core/src/__tests__/local-search.test.ts`

---

## 1. 阶段概述

在数十万至数百万字的长篇小说创作中，模型上下文窗口有限且容易在海量历史细节中产生幻觉或设定漂移。**章前规划阶段**是解决这一问题的核心技术枢纽。它包含两大约束代理与一个检索引擎：
1. **PlannerAgent**：负责微观剧情推演，生成本章因果目标（`ChapterMemo`）；
2. **LocalSearch Engine**：基于 SQLite FTS5/BM25 从历史章节、实体与伏笔中检索关联记忆；
3. **ComposerAgent**：将全量素材按权限与重要度划分为“受保护层”与“可压缩层”，执行超预算语义压缩，组装生成具备确定性证据链的 `ContextPackage` 与 `ChapterTrace`。

---

## 2. 执行主体与角色编排

- **PlannerAgent（规划师）**：阅读分卷地图、上一章状态与活动伏笔，设计本章的具体剧情节拍点（Beats）与因果目标。
- **SQLite FTS5 / BM25 检索模块**：本地轻量级全文检索库，负责关键词索引与相关性打分（BM25）。
- **ComposerAgent（装配师）**：负责上下文的准入控制、分层保护、Token 预算计算与来源注入。
- **SemanticContextCompiler（语义压缩器）**：在 Token 超出预设硬预算时介入，通过专用子代理对可压缩层文本进行无损因果摘要。

---

## 3. 输入契约与上下文来源

- **故事大纲与分卷地图**：`story/outline/story_frame.md`、`story/outline/volume_map.md`。
- **世界当前权威状态**：`state/current_state.json` 与前序章节摘要集合。
- **活动伏笔集合**：`state/hooks.json` 中处于 `deferred` 或 `progressing` 状态的伏笔。
- **作者即时意图**：`story/current_focus.md` 或本轮调用传入的 `externalContext`。
- **角色卡与规则库**：`story/roles/` 与 `story/book_rules.json`。

---

## 4. 输出产物与权威形态

1. **ChapterMemo & Governed Plan（受治理章纲）**：
   - 包含本章章节号、核心剧情目标、正文提示、引用的伏笔（`threadRefs`）。落盘于 `story/runtime/plan_ch<N>.json`。
2. **ContextPackage（正文注入上下文包）**：
   - 经过严格准入筛选的来源数组（`selectedContext`），每个来源标记有保护等级（`protected` 或 `compressible`）。
3. **ChapterTrace（七字段溯源痕迹）**：
   - 全流程不可篡改的技术审计日志，记录规划入参、装配入参、来源清单、分层名单、Token 消耗、检索候选集及压缩详情。

---

## 5. 核心流转机制与关键算法

### 5.1 规划生成（PlannerAgent.planChapter）
Planner 结合卷纲为当前章节确立明确目标：
- 确定本章核心事件（例如：主角发现灵矿被污染的物理证据）。
- 挑选本章需要推进或提及的伏笔 ID（放入 `threadRefs`）。
- 生成 Markdown 格式的场景规划草案。
- **规划复用机制**：若磁盘已存在通过验证的 `plan_ch<N>.json` 且未提供外部覆盖指令，系统优先复用既有规划，确保断点续跑确定性。

### 5.2 本地检索召回（Local Search: SQLite FTS5 + BM25）
```typescript
// packages/core/src/retrieval/local-search.ts
// 使用 SQLite FTS5 虚拟表对历史摘要、设定条目构建全文索引
SELECT id, kind, source, bm25(story_fts) as score 
FROM story_fts 
WHERE story_fts MATCH @query 
ORDER BY score ASC 
LIMIT @limit;
```
检索结果标记候选 ID、类型、来源片段与 BM25 得分，为 Composer 提供事实候选。

### 5.3 上下文分层治理（Two-Tier Context Governance）
ComposerAgent 执行严格的双层预算机制：
- **受保护层（Protected Sources）—— 绝对禁止压缩与截断**：
  1. `author_intent.md`（作者最高指导意图）；
  2. 上一章结尾文本（保证物理空间、角色站位、动作时空的绝对连续）；
  3. `book_rules.json` 核心禁忌；
  4. 本章登场主要人物的核心能力卡。
- **可压缩层（Compressible Sources）—— 超限时可优雅降级**：
  1. 远期章节摘要（如前 10 章的背景梗概）；
  2. 宽泛的世界观补充说明；
  3. 次要人物背景资料。

### 5.4 语义压缩与 Fail-Fast 阻断
当总 Token 超过模型窗口或预设上限（例如 8192 或 16384 Tokens）：
1. 锁定 Protected Sources，计算其所占的基础 Token；
2. 将 Compressible Sources 提交给 `SemanticContextCompiler` 提取高密度因果事实；
3. **若压缩后依然超出预算，系统直接抛出异常阻断流程**，绝不采取主流大模型方案中“默默从后往前截断”的做法，杜绝因关键规则被截断而发生人设穿帮。

---

## 6. 数据结构与 Schema 详述

### 6.1 `ChapterMemoSchema`
```typescript
// packages/core/src/models/input-governance.ts:3
export const ChapterMemoSchema = z.object({
  chapter: z.number().int().min(1),
  goal: z.string().min(1),             // 本章核心文学目标
  body: z.string().min(1),             // 场景节拍分解 Markdown
  threadRefs: z.array(z.string()),     // 引用的 hookId 数组
}).strict();
```

### 6.2 `ContextPackageSchema`
```typescript
// packages/core/src/models/input-governance.ts:28
export const ContextPackageSchema = z.object({
  chapter: z.number().int().min(1),
  selectedContext: z.array(z.object({
    source: z.string().min(1),          // 来源文件路径或标识
    reason: z.string().min(1),          // 引入原因
    excerpt: z.string().optional(),     // 节选内容
    protection: z.enum(["protected", "compressible"]), // 保护等级
  }).strict()),
}).strict();
```

### 6.3 `ChapterTraceSchema`（七大核心技术字段）
```typescript
// packages/core/src/models/input-governance.ts:35
export const ChapterTraceSchema = z.object({
  chapter: z.number().int().min(1),
  plannerInputs: z.array(z.string()),     // 1. Planner 读取的输入清单
  composerInputs: z.array(z.string()),    // 2. Composer 读取的输入清单
  selectedSources: z.array(z.string()),   // 3. 最终被选入正文上下文的来源
  contextTiers: z.object({               // 4. 上下文分层归属
    protectedSources: z.array(z.string()),
    compressibleSources: z.array(z.string()),
  }).strict(),
  tokenBudget: z.object({                 // 5. 预算消耗明细
    protectedTokens: z.number().int().nonnegative(),
    compressibleTokens: z.number().int().nonnegative(),
    totalSelectedTokens: z.number().int().nonnegative(),
  }).strict(),
  compression: z.object({                 // 6. 语义压缩痕迹（如触发）
    compiledSource: z.string().min(1),
    protectedSources: z.array(z.string()),
    compressedSources: z.array(z.string()),
    protectedTokens: z.number().int().nonnegative(),
    compressibleTokens: z.number().int().nonnegative(),
    budgetTokens: z.number().int().nonnegative(),
  }).strict().optional(),
  retrieval: z.object({                   // 7. FTS5 检索审计
    engine: z.literal("sqlite-fts5-bm25"),
    query: z.string(),
    selectionMode: z.enum(["semantic", "complete"]),
    candidates: z.array(z.object({
      id: z.string(), kind: z.string(), source: z.string(), score: z.number(),
    }).strict()),
    semanticSelectedIds: z.array(z.string()),
  }).strict().optional(),
  notes: z.array(z.string()),
}).strict();
```

---

## 7. 质量门禁与强校验规则

1. **伏笔引用存在性校验**：
   - `threadRefs` 中的所有 `hookId` 必须能在 `state/hooks.json` 中找到对应记录，禁止虚构伏笔标识。
2. **Token 预算硬门禁**：
   - 设定严格的 `tokenBudget`，若压缩失败或保护层自身已超出预算上限，立即阻断。
3. **Plan 持久化完整性校验**：
   - 在启动 Writer 前，`savePersistedPlan` 必须成功完成，确保每一次正文生成的背后都有存盘的章纲对应。

---

## 8. 一致性与因果链保障

- **时空锁定（Spatiotemporal Continuity）**：
  受保护层强制将前一章的末尾段落原汁原味注入，锁定了主角的物理状态（受伤、疲惫、持有物品），防止模型开篇时空跳跃。
- **记忆溯源不可抵赖**：
  通过 `ChapterTrace`，当后续审稿或作者发现正文出现莫名其妙的情节时，能够精确倒查是检索命中了哪份历史记忆，还是 Planner 在哪一步加入了未经授权的设定。

---

## 9. 创作技能与专业方法论

技能 `inkos-long-writing` 在规划阶段要求遵循 **“场景因果链（Scene Causal Chain）”**：
- 场景禁止平铺直叙：每个场景必须包含 `Goal`（目标）、`Conflict/Obstacle`（冲突阻碍）、`Disaster/Outcome`（后果/转折）；
- 章节末尾必须留下未解悬念或即时危机，以满足网络连载文学的读者“追读率（Progression）”。

---

## 10. 测试覆盖与验证场景

核心测试位于 `inkos/packages/core/src/__tests__/context-compaction.flow.test.ts`、`governed-working-set.test.ts` 与 `local-search.test.ts`：
1. **分层保护测试**：断言标记为 `protected` 的来源在经历上下文压缩处理后内容完全不被修改或丢失。
2. **BM25 检索测试**：验证向 SQLite 写入测试章节摘要后，针对指定角色名或地名的查询能高分排在首位。
3. **压缩超限测试**：注入超大尺寸的可压缩素材，断言触发 `SemanticContextCompiler` 并最终输出合规的 `ChapterTrace.compression` 记录。
