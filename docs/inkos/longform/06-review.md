# 阶段六：审稿与连续性审查（Review & Continuity Audit）深度分析报告

> **源工程**：`inkos/`  
> **核心源文件**：
> - `inkos/packages/core/src/agents/continuity.ts`
> - `inkos/packages/core/src/agents/review-tool.ts`
> - `inkos/packages/core/src/pipeline/chapter-review.ts`
> - `inkos/packages/core/src/models/observation.ts`
> - `inkos/packages/core/src/harness/artifact-revisions.ts`
> - `inkos/packages/core/src/harness/artifact-validation.ts`
> - `inkos/packages/core/src/harness/action-observation.ts`
> - `inkos/packages/core/src/utils/source-text.ts`
> - `inkos/packages/core/skills/inkos-story-review/SKILL.md`
> - `inkos/packages/core/skills/inkos-story-review/references/review-matrix.md`
> - `inkos/packages/core/src/__tests__/chapter-review-scope.flow.test.ts`
> - `inkos/packages/core/src/__tests__/harness-observation.flow.test.ts`

---

## 1. 阶段概述

审稿与连续性审查阶段（Review & Continuity Audit）充当整个长篇创作体系的**客观第三方司法检察官**。在大模型文学创作中，最严重的痛点是“幻觉通过自我感知无法发现”。该阶段引入独立的 **ContinuityAuditor**，脱离 Writer 视角，对照权威设定库与前文状态对初稿展开挑刺。该阶段严格推行**“证据化审稿（Evidence-based Review）”**，强制模型提交带行号的具体引文（`quote`），拒绝一切空洞主观的套话评价。

---

## 2. 执行主体与角色编排

- **ContinuityAuditor（连续性审计师）**：无写作倾向的只读审稿智能体，加载 `inkos-story-review` 技能与 `review-matrix.md` 评价准则。
- **PipelineRunner（审稿调度器）**：调用 `reviewChapterDraft`，负责给草稿自动注入行号（`numberReviewSource`），并将初稿送入审查。
- **宿主行号解析引擎（resolveObservationSources）**：比对模型引述的行号与原文片段，剔除伪造引文。
- **Artifact Revisions 验证器**：将审查结果与特定正文版本（Revision ID）强制绑定，建立不可篡改的审查凭据。

---

## 3. 输入契约与上下文来源

- **带行号的章节原文（Numbered Source Text）**：
  宿主调用 `numberReviewSource(chapterContent)`，将正文转换为每行带有形如 `0042 | 主角拔出长剑...` 编号的审计视图。
- **ContextPackage（规划上下文）**：
  原样输入正文写作时参考的规则、前序摘要与角色卡，作为审计判定的法定依据。
- **Review Matrix（审查矩阵）**：
  细分为四大维度的硬性审查标准：
  1. `continuity`（因果连续性与物理站位）；
  2. `rules`（是否违背本书不可动摇的法则）；
  3. `character`（是否发生人设坍塌或弱智化）；
  4. `pacing_and_cliche`（是否有空洞排比、严重的 AI 腔套路）。

---

## 4. 输出产物与权威形态

- **结构化审查报告（AuditResult）**：
  ```typescript
  export interface AuditResult {
    readonly summary: string;                       // 全章审查简要总结
    readonly observations: ReadonlyArray<Observation>; // 观察项与问题列表
    readonly reviewedArtifact?: {                   // 绑定的产物版本
      readonly workId: string;
      readonly artifactId: string;
      readonly revisionId: string;
    };
  }
  ```
- **观察项清单（Observations）**：每条包含分类码（`code`）、判定（`assessment`）、文字证据（`evidence`）以及带行号的真实引文（`sourceRefs.quote`）。

---

## 5. 核心流转机制与关键算法

### 5.1 审计原文编号注入（numberReviewSource）
宿主绝不直接将纯正文丢给审计员，而是通过 `numberSourceLines` 为每一行加注 1-based 行号。此举使得审计员在发现问题时，必须直接提供行号定位，避免含糊其辞。

### 5.2 结构化工具调用（submit_chapter_review）
审计员必须调用受控工具提交结构化结果：
```typescript
// packages/core/src/agents/review-tool.ts
const ReviewSubmissionSchema = Type.Object({
  summary: Type.String({ description: "简短宏观评价" }),
  observations: Type.Array(Type.Object({
    code: Type.String({ description: "如 RULE_VIOLATION, CHARACTER_OOC, PLOT_HOLE" }),
    assessment: Type.Union([
      Type.Literal("issue"),        // 必须修复的硬伤
      Type.Literal("observation"),  // 优化建议
    ]),
    summary: Type.String({ description: "问题描述" }),
    evidence: Type.Array(Type.String()),
    sourceRefs: Type.Array(Type.Object({
      sourceId: Type.String(),
      startLine: Type.Integer({ minimum: 1 }),
      endLine: Type.Integer({ minimum: 1 }),
      quote: Type.String({ minLength: 1 }),
    })),
  })),
});
```

### 5.3 宿主引文校验与来源解析（resolveObservationSources）
模型提交审查后，宿主引擎介入验证：
1. 检查 `quote` 文本是否确实在 `startLine` 至 `endLine` 之间出现；
2. 若模型虚构引文或行号错位，宿主会自动比对并纠偏，若无法匹配则予以丢弃或降低置信度。

### 5.4 严格版本绑定（ReviewedArtifact）
```typescript
// packages/core/src/agents/continuity.ts
// 仅当当前内容哈希与磁盘持久化的 revision 完全一致时，才赋予 reviewedArtifact 标识
if (body(current.bytes.toString('utf8')) === chapterContent) {
  reviewedArtifact = { workId: work.id, artifactId: artifact.id, revisionId: current.revision.id };
}
```
**防御机制**：草稿审查绝不能冒充已定稿版本的审查证明，版本不一致时拒绝赋予持久化认证。

---

## 6. 数据结构与 Schema 详述

### 6.1 `ObservationSchema`
```typescript
// packages/core/src/models/observation.ts:1
export const ObservationSchema = z.object({
  code: z.string().min(1),                         // 分类代号（如 CONTINUITY_BREAK）
  summary: z.string().min(1),                      // 问题总结
  evidence: z.array(z.string()).default([]),       // 证据阐述
  category: z.enum(["execution", "quality", "scope"]).optional(),
  assessment: z.enum(["issue", "resolved", "unavailable", "observation"]).optional(),
  scope: z.string().optional(),
  targetHash: z.string().optional(),
  target: z.object({ workId: z.string(), artifactId: z.string(), revisionId: z.string() }).strict().optional(),
  sourceRefs: z.array(z.object({
    sourceId: z.string().min(1),
    quote: z.string().min(1),
  }).strict()).optional(),
}).strict();
```

---

## 7. 质量门禁与强校验规则

1. **禁止模型字数估算**：
   - 提示词与代码明确约束：`Do not estimate length; the host computes it.`。审稿员禁止自报正文字数，一切以宿主底层严格算法为准。
2. **硬伤阻断（Critical Issues Gate）**：
   - 若 `observations` 中存在 `assessment: "issue"` 的硬伤（如核心设定违反），流水线打上阻断标签，强制流转至修订阶段（Revision），禁止直接跳至结算定稿。
3. **空观察项合法性（Empty Observations is Valid）**：
   - 系统明确允许并认可 `observations: []`，坚决反对大模型为了“显得有在工作”而无中生有地挑刺。

---

## 8. 一致性与因果链保障

- **对比审稿机制（Differential Audit）**：
  支持 `episode_start` 或 `parent_revision` 差异比对（`changedSourceRegion`）。当章节经历过修订后，复审阶段优先聚焦于**改动行（Diff Region）**，既保证了改动处已修复，又防止修订引入了次生灾害。
- **事实对账双重校验**：
  不仅看文学修辞，还审查是否提前使用了后续章节才解锁的法宝、是否颠倒了事件发生的先后顺序。

---

## 9. 创作技能与专业方法论

技能 `inkos-story-review` 与 `review-matrix.md` 提出了长篇小说特有的审查指标：
- **设定反向击穿（Rule Breached）**：主角是否在没有付出代价的情况下打破了战力天花板；
- **动机虚假（Motive Hollow）**：反派或配角的行动是否纯粹为了给主角送经验，缺乏自身利益立场；
- **无效推进（Fake Progression）**：全章是否只是反复对话“商讨去调查”，而实际剧情没有发生任何物理或认知位移。

---

## 10. 测试覆盖与验证场景

核心测试位于 `inkos/packages/core/src/__tests__/chapter-review-scope.flow.test.ts` 与 `harness-observation.flow.test.ts`：
1. **行号精确匹配测试**：构造含特定矛盾的段落，验证 Auditor 提取出的 `quote` 与原文行号完全一致。
2. **修订前后差异审稿测试**：对修订前后的两版草稿进行对比审查，断言原有的 `issue` 状态被正确标记为 `resolved`。
3. **版本隔离测试**：验证篡改正文哈希后，`reviewedArtifact` 字段不会错误挂载旧版本号。
