# InkOS 源工程创作流程各模块深度分析专题总览与导航目录

> **源工程路径**：`d:\workspace\see-dsh-novel\inkos`（本地 Junction 联接）  
> **研究存放根目录**：`docs/inkos/`（受 `.gitignore` 保护，不入库）  
> **整理时间**：2026-11-15  

为了避免不同创作媒介、视听参数与底层架构的交叉混杂，本研究专题已按照 **InkOS 源工程底层的真实模块形态（Built-in Profiles & Pipelines）** 进行严格的独立建组与分层隔离：

---

## 模块分层导航索引

```
docs/inkos/
├── README.md                                  # 本主导航总揽（四模块全景图）
│
├── longform/                                  # 【模块形态一：长篇小说状态机流水线】
│   ├── longform-pipeline-analysis.md          # 长篇全景总揽、8 阶段对比矩阵与核心设计
│   ├── 01-proposal.md                         # 阶段 1：提案收敛与 ActionEnvelope 契约
│   ├── 02-init.md                             # 阶段 2：立项初始化、会话绑定与排他锁
│   ├── 03-foundation.md                       # 阶段 3：Architect 四段式生成与规则就绪
│   ├── 04-planning.md                         # 阶段 4：章前规划、SQLite FTS5 与 Composer
│   ├── 05-writing.md                          # 阶段 5：WriterAgent 正文写作与场景推进
│   ├── 06-review.md                           # 阶段 6：ContinuityAuditor 行号证据审校
│   ├── 07-revision.md                         # 阶段 7：Reviser 两阶段修订与原子事务
│   └── 08-settlement.md                       # 阶段 8：Settler 状态结算、伏笔仲裁与快照
│
├── script-linear/                             # 【模块形态二：纯线性影视/短剧剧本流水线】
│   ├── script-pipeline-analysis.md            # 纯剧本全景总揽、四大铁律与对比矩阵
│   ├── script-01-proposal-spec.md             # 阶段 1：立项提议、格式选型与创作规格书
│   ├── script-02-adaptation-boundary.md       # 阶段 2：小说视听外化转译与改编边界保护
│   ├── script-03-dramatic-units-budget.md     # 阶段 3：戏剧单元四要素闭环与分集篇幅预算
│   ├── script-04-screenplay-writing.md        # 阶段 4：视听化分场排版与博弈对白艺术
│   ├── script-05-continuation-recovery.md     # 阶段 5：长文本截断多 pass 续写与低温自愈重构
│   └── script-06-persistence-sync.md          # 阶段 6：剧本工件持久化与 WorkManifest 同步
│
├── storyboard/                                # 【模块形态三：分镜与生图流水线】
│   ├── storyboard-pipeline-analysis.md        # 分镜生图全景总揽、三维对比与实施指引
│   ├── storyboard-01-spec-parameters.md       # 阶段 1：分镜立项、视觉参数与创作规格书
│   ├── storyboard-02-shot-breakdown-continuity.md # 阶段 2：叙事节拍切镜与视听时空连续性保障
│   ├── storyboard-03-prompt-engineering-frozen-moments.md # 阶段 3：生图 Prompt 提纯与单瞬间冻结
│   ├── storyboard-04-asset-manifest-directory.md # 阶段 4：资产清单驱动与目录三态生命周期隔离
│   ├── storyboard-05-multi-provider-batch-generation.md # 阶段 5：多 Provider 生图调度与批处理引擎
│   └── storyboard-06-artifact-persistence-dsh-mapping.md # 阶段 6：工件持久化、断言与 DSH 复刻映射
│
└── interactive-film/                          # 【模块形态四：互动影游图谱与状态推演】
    ├── script-02-dramatic-scenes.md           # 场景张力与镜头预算
    ├── script-03-screenplay-writing.md        # 剧本正文与场景格式化
    ├── script-04-storyboard-assets.md         # 分镜镜头表拆解与生图 Prompt 提取 (assets.json)
    ├── script-05-interactive-graph.md         # 多分支图谱编译 (story-graph.json) 与状态标志位
    ├── script-06-validation-delivery.md       # 终局因果图与可达性对账
    └── script-07-revision-export.md           # 分支补丁与工程导出
```

---

## 四大模块形态技术特征对比

| 模块形态 | 核心媒介 | 核心调度架构 | 状态与版本中枢 | 核心工程挑战 |
| :--- | :--- | :--- | :--- | :--- |
| **1. [长篇小说流水线](./longform/longform-pipeline-analysis.md)** | 连载网文/出版长篇小说 | 8 个专业子代理（Architect $\rightarrow$ Settler）串行循环协作 | SQLite FTS5 长期记忆库 + 章节快照与伏笔账本 | 跨章节宏大叙事一致性与精准历史回滚 |
| **2. [纯线性剧本流水线](./script-linear/script-pipeline-analysis.md)** | 影视长片/竖屏微短剧分场剧本 | `ScriptCreationAgent` 单主笔深度创作 | 磁盘 Markdown + WorkManifest 修订追踪 | 视听外化（禁心理描写）、对白博弈、长文本截断低温自愈 |
| **3. [分镜与生图流水线](./storyboard/storyboard-pipeline-analysis.md)** | 影视分镜总表 + 批量文生图资产 | `StoryboardCreationAgent` + 统一文生图调度层 | `assets.json` 资产清单 + 物理三态目录（Source/Generated/Selected） | **时空动态镜头向静态单瞬间冻结转换**、跨镜头视听连续性保障（180°轴线） |
| **4. [互动影游流水线](./interactive-film/)** | 多结局分支影游 / 互动短剧 | `InteractiveFilmCreationAgent` 图谱编译器 | `story-graph.json` 节点拓扑网 + `flags.md` 状态槽 | 全结局图论可达性验证、死胡同消除、分支变量平衡 |
