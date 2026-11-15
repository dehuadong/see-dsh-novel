# 剧本阶段二：戏剧单元、分集规划与故事树（Dramatic Scenes & Story Tree）深度分析报告

> **源工程**：`inkos/`  
> **核心源文件**：
> - `inkos/packages/core/skills/inkos-script-writing/references/episode-scene-craft.md`
> - `inkos/packages/core/src/interactive-film/graph-schema.ts`
> - `inkos/packages/core/src/interactive-film/generate.ts`
> - `inkos/packages/core/src/interactive-film/paths.ts`
> - `inkos/packages/core/skills/inkos-interactive-film/SKILL.md`
> - `inkos/packages/core/skills/inkos-interactive-film/references/branch-state-craft.md`

---

## 1. 阶段概述

剧本与小说最大的结构差异在于：**剧本由离散的视听场景（Scenes）或交互节点（Nodes）作为最基本的物理因果单元构成**。本阶段解决的是**将宏观故事在空间、时间与选择维度进行工程化解构**的问题：
1. **线性剧本**：将故事拆解为由“目标-阻碍-转折-后果”支撑的戏剧单元（Dramatic Units），并进行集篇幅预算（Episode Budget）分配；
2. **互动影游**：将故事展开为具备严格可达性、分支逻辑与收敛终局的多叉**故事树（Story Tree）**与有向图谱。

---

## 2. 执行主体与角色编排

- **ScriptCreationAgent**：负责线性剧本的分集架构与分场大纲设计。
- **InteractiveFilmCreationAgent**：负责分支故事树（`story-tree.md`）的拓扑规划与分支选择设计。
- **StoryGraph Compiler（generate.ts）**：将模型产出的结构化故事树文本解析编译为规范的 `StoryGraph` 节点数据结构。

---

## 3. 输入契约与上下文来源

- **创作规格说明书（Spec）**：集数（`episodeCount`）、单集时长（`episodeDuration`）、总节点预算。
- **原著小说或大纲素材**：核心情节骨干、人物设定与经典台词。
- **剧本创作技能指引**：
  - 线性技能：`episode-scene-craft.md`（戏剧单元与集预算）；
  - 互动技能：`branch-state-craft.md`（真假分支鉴别与状态门控）。

---

## 4. 输出产物与权威形态

- **线性剧本分集剧纲**：包含每集核心情节点与场景清单。
- **分支故事树文档（story-tree.md）**：面向编剧与导演的树状分支可读图谱，展示父子节点关系与选择文案。
- **有向图谱对象（StoryGraph）**：机器权威的结构化图数据，包含节点集合（`nodes`）与边集合（`choices`）。

---

## 5. 核心流转机制与关键算法

### 5.1 戏剧单元四要素模型（Dramatic Units）
`episode-scene-craft.md` 规定每一个场景必须具备四个不可或缺的物理支点：
1. **可演出的即时目标（Playable Objective）**：角色进场时想要达成的具体目的（如：逼问出钥匙的藏匿位置）；
2. **明确阻碍（Resistance）**：对方的拒绝、物理障碍、突发意外或时间压力；
3. **节拍转折（Turn）**：信息差揭露、心理破防、权力地位逆转或武力失衡；
4. **离场后果（Exit Condition）**：场景结束时，角色关系、信息量或情势必须发生不可逆变化。

### 5.2 真分支鉴别原则（Material Branches）
`inkos-interactive-film` 提出长篇分支规划的核心铁律：
- **拒绝表面措辞分支**：“Cosmetic wording changes are not branches.”（同一个意图换两种不同的礼貌用语不构成两个分支）；
- **有效分支必须包含五项实质差异之一**：
  1. 不同的意图（Intentions）；
  2. 付出不同的代价（Costs）；
  3. 获得互斥的信息（Information）；
  4. 影响不同的人物关系（Relationships）；
  5. 导致不同的因果结局（Consequences）。

### 5.3 汇聚与终局收敛机制（Merge & Reconvergence）
分支不能无限发散。系统支持两类汇聚节点：
- **共同瓶颈节点（Chokepoints / Merge Nodes）**：无论之前走哪条路，剧情由于不可抗力在关键事件汇聚；
- **条件特异性台词**：在汇聚节点中，公共场景只描写共同事实，特定路线的记忆通过带 `condition` 的专属对白呈现。

---

## 6. 数据结构与 Schema 详述

### 6.1 `StoryGraphNode` 结构
```typescript
// packages/core/src/interactive-film/graph-schema.ts
export interface StoryGraphNode {
  readonly id: string;                    // 节点唯一标识（如 "node_cellar_interrogation"）
  readonly title: string;                 // 场次/节点名称
  readonly type: "scene" | "ending";      // 节点类型（普通场景或终局）
  readonly act?: string;                  // 所属幕/集
  readonly entryCondition?: Condition;    // 进入该节点的全局状态前置条件
  readonly choices: readonly StoryChoice[]; // 出度分支选项
}
```

### 6.2 `StoryChoice`（分支选项定义）
```typescript
export interface StoryChoice {
  readonly id: string;
  readonly label: string;                 // 玩家或观众可见的选择文案
  readonly targetNodeId: string;          // 目标节点 ID
  readonly condition?: Condition;         // 可见或可点击的条件门禁
  readonly effects?: readonly StateEffect[]; // 选择后引发的状态/变量变化
}
```

---

## 7. 质量门禁与强校验规则

1. **不可达节点拦截（FILM_UNREACHABLE_NODES）**：
   - 故事树中不能存在任何从起点无法遍历到达的“孤岛节点”。
2. **死胡同拦截**：
   - 非 `ending` 类型的节点，其出度（`choices`）必须大于等于 1，严禁剧情中断。
3. **可见选项数门禁（FILM_VISIBLE_CHOICES）**：
   - 每个选择节点在特定前置状态下，玩家能实际看见的选项数必须满足最低配额，防止选项因条件失效全部消失。

---

## 8. 一致性与因果链保障

- **状态时序守恒（State Causality）**：
  如果某个道具或线索是通过分支选项 A 获得的，故事树必须保证：**该机会在选项发生前提出，且对该物品的持有感知只能出现在后续子节点中**。严禁在状态更新生效前就提前宣告结果。

---

## 9. 创作技能与专业方法论

- **集篇幅预算（Episode Budgeting）**：竖屏短剧每集时长有限，必须预留时间给“动作与反应（Action and Reaction）”，绝不能把有限的秒数全部塞满报菜名式的背景台词。
- **悬念扣子（The Hook）**：每一集的结尾必须落在具体的压力、选择或新发现上，而不是依靠空洞的黑屏音效假造悬念。

---

## 10. 测试覆盖与验证场景

核心测试位于 `inkos/packages/core/src/__tests__/if-paths.test.ts` 与 `if-graph-store.test.ts`：
1. **故事树遍历与最短路径测试**：验证算法能够准确找到从根节点到主结局的最短无循环选择链（`findSimpleRuntimeRoute`）。
2. **孤岛节点检测测试**：故意注入未连接的节点，断言校验器抛出 `FILM_UNREACHABLE_NODES` 错误。
