# 剧本阶段五：互动影游图谱与变量因果系统（Interactive Graph & Variable System）深度分析报告

> **源工程**：`inkos/`  
> **核心源文件**：
> - `inkos/packages/core/src/interactive-film/graph-schema.ts`
> - `inkos/packages/core/src/interactive-film/tool-schemas.ts`
> - `inkos/packages/core/src/interactive-film/evaluator.ts`
> - `inkos/packages/core/src/interactive-film/delta.ts`
> - `inkos/packages/core/src/interactive-film/paths.ts`
> - `inkos/packages/core/skills/inkos-interactive-film/SKILL.md`
> - `inkos/packages/core/skills/inkos-interactive-film/references/branch-state-craft.md`
> - `inkos/packages/core/src/__tests__/if-evaluator.test.ts`
> - `inkos/packages/core/src/__tests__/if-delta.test.ts`

---

## 1. 阶段概述

互动影游与多结局短剧不同于传统线性剧本，其核心是一张**具备动态图拓扑结构、变量累积与条件分支的因果计算网络（Causal State Machine）**。本阶段解决的是**将玩家交互选择与剧情走向用严格的计算机语言进行图谱化建模**的问题。InkOS 将状态变量解构为纯粹的叙事因果（而非通用的复杂 RPG 数值），并设计了确定性的条件求值器与增量应用机，确保多结局分支具备可计算性与自洽性。

---

## 2. 执行主体与角色编排

- **InteractiveFilmCreationAgent**：负责设计剧本分支结构、变量体系（`flags.md`）与结局路径。
- **StoryGraph Engine（graph-schema.ts）**：维护节点、连边、选项、门禁条件的强类型图数据结构。
- **Condition Evaluator（evaluator.ts）**：运行时条件判定器，根据玩家当前累积的变量状态（State），动态计算分支选项是否可见、是否可点。
- **State Delta Applier（delta.ts）**：纯函数式状态机，负责在玩家做出选择后，准确更新好感度、关键证据、持有道具与布尔标记。

---

## 3. 输入契约与上下文来源

- **互动创作规格说明（interactive-spec.md）**：节点数量、目标结局数、变量复杂度。
- **叙事核心线索**：主线真相、嫌疑人关系网、不可逆牺牲事件。
- **互动影视创作技能（inkos-interactive-film）**：注入分支设计哲学、汇聚点检查规范与结局对账原则。

---

## 4. 输出产物与权威形态

1. **结构化图谱文件（story-graph.json）**：
   - 包含完整的节点（`nodes`）、选项（`choices`）、变量声明（`variables`）与初始状态（`initialState`）。这是互动剧本的**唯一机器权威**。
2. **变量与标志说明书（flags.md）**：
   - 供人类编剧与程序员阅读的变量全景字典，注明每个变量的文学含义、影响分支与合法取值范围。
3. **分支故事树（story-tree.md）**：
   - Markdown 树状展示，直观呈现每条剧情分支的父子关系。

---

## 5. 核心流转机制与关键算法

### 5.1 变量与标志服务于剧情因果（Variables Serve Story Causality）
技能规范明确禁止生搬硬套复杂的 RPG 属性系统（如力量、敏捷、体力等），强制变量只映射真实的叙事事实：
- **知识与秘密（Knowledge）**：`knows_affair: boolean`（是否已知婚外情）；
- **物理证据与道具（Evidence/Items）**：`has_cold_storage_key: boolean`；
- **关系压力与好感度（Relationship Pressure）**：`inspector_trust: number`（探长信任值：-10 至 +10）；
- **重大身份抉择（Identity Commitments）**：`betrayed_mentor: boolean`。

### 5.2 条件表达式求值算法（evaluator.ts）
系统实现了一套轻量级、沙盒安全的条件求值器，杜绝使用危险的 `eval()`：
```typescript
// packages/core/src/interactive-film/evaluator.ts
export function evaluateCondition(condition: Condition, state: Record<string, unknown>): boolean {
  const value = state[condition.var];
  switch (condition.op) {
    case "==": return value === condition.value;
    case "!=": return value !== condition.value;
    case ">":  return (value as number) > (condition.value as number);
    case "<":  return (value as number) < (condition.value as number);
    case ">=": return (value as number) >= (condition.value as number);
    case "<=": return (value as number) <= (condition.value as number);
    case "in": return Array.isArray(condition.value) && condition.value.includes(value);
    case "has": return Array.isArray(value) && value.includes(condition.value);
    default: return false;
  }
}
```

### 5.3 汇聚节点的全路径验证律（Merge Node Verification）
当两条不同分支汇聚到同一节点（如法庭审判场）时：
- **公共描述一致性**：该节点的场景环境描述、静态分镜图片必须且只能描写两条路线共有的事实；
- **分支差异表现**：路线特定的记忆（如“指认先前获得的凶器”）必须包裹在带 `condition` 表达式的专有对白中；严禁在无条件台词中直接写成“张三拿出了先前找到的凶器（或者赤手空拳）”这类敷衍的或然句。

---

## 6. 数据结构与 Schema 详述

### 6.1 `ConditionToolSchema`（条件判定 Schema）
```typescript
// packages/core/src/interactive-film/tool-schemas.ts
export const ConditionToolSchema = Type.Object({
  var: Type.String({ minLength: 1, description: "状态变量名" }),
  op: Type.Union([
    Type.Literal("=="), Type.Literal("!="),
    Type.Literal(">"), Type.Literal("<"),
    Type.Literal(">="), Type.Literal("<="),
    Type.Literal("in"), Type.Literal("has"),
  ]),
  value: Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Array(Type.String())]),
});
```

### 6.2 `StateEffect`（状态效果结构）
```typescript
// packages/core/src/interactive-film/graph-schema.ts
export interface StateEffect {
  readonly var: string;                         // 变更的目标变量
  readonly op: "set" | "add" | "toggle";        // 赋值、累加或取反
  readonly value: string | number | boolean;
}
```

### 6.3 `StoryGraph` 完整模型
```typescript
export interface StoryGraph {
  readonly projectId: string;
  readonly title: string;
  readonly rootNodeId: string;                  // 起始根节点
  readonly initialState: Record<string, unknown>; // 全局初始变量池
  readonly nodes: readonly StoryGraphNode[];    // 全量节点清单
  readonly endings: readonly {
    readonly nodeId: string;
    readonly title: string;
    readonly type: "true_ending" | "bad_ending" | "normal_ending";
    readonly description: string;
  }[];
}
```

---

## 7. 质量门禁与强校验规则

1. **未声明变量引用拦截**：
   - 任何选项或条件中使用的 `condition.var`，必须在全局 `initialState` 中有显式定义，禁止引用野指针变量。
2. **死锁循环检测**：
   - 图谱中必须存在至少一条有限步长通向 `ending` 节点的有效路径，严禁无退出条件的选择死循环。
3. **变量类型一致性守恒**：
   - 布尔型变量严禁执行 `add` 数值运算，数值型变量严禁赋值为字符串。

---

## 8. 一致性与因果链保障

- **结局路径沉淀性（Accumulated Path Endings）**：
  每个结局必须是对整条路径所有选择与代价的集中体现；严禁在终局前一秒临时挂一个与前面所有选择无关的标签作为“伪结局”。
- **记忆不回退保障**：
  如果主角在节点 B 中受重伤（`is_injured: true`），其后续所有可达子节点均继承该状态，直到遇到明确的“就医”事件解除。

---

## 9. 创作技能与专业方法论

技能 `inkos-interactive-film` 指导要点：
- **有意义的抉择（Meaningful Choices）**：给玩家的选择必须产生真实的心理挣扎（利益 vs 良知、保全自己 vs 保护同伴），而不是纯粹的走迷宫；
- **展示代价与兑现**：每一个分支所承诺的收益，必须在后续剧情中让玩家真实感知并承担后果。

---

## 10. 测试覆盖与验证场景

主要测试位于 `inkos/packages/core/src/__tests__/if-evaluator.test.ts` 与 `if-delta.test.ts`：
1. **条件求值逻辑测试**：测试数值比较、字符串相等、数组包含（`has` / `in`）在各种边界状态下的正确布尔值返回。
2. **状态增量应用测试**：断言通过 `delta.applyEffects` 执行多次选择后，全局状态变量精确累加且无副作用污染。
