# 阶段七：修订 / 清稿（Revision & Polish）深度分析报告

> **源工程**：`inkos/`  
> **核心源文件**：
> - `inkos/packages/core/src/agents/reviser.ts`
> - `inkos/packages/core/src/agents/reviser-tool.ts`
> - `inkos/packages/core/src/pipeline/runner.ts`
> - `inkos/packages/core/src/pipeline/chapter-review.ts`
> - `inkos/packages/core/src/pipeline/chapter-state-recovery.ts`
> - `inkos/packages/core/src/utils/atomic-file-set.ts`
> - `inkos/packages/core/src/utils/text-range-edits.ts`
> - `inkos/packages/core/src/utils/source-text.ts`
> - `inkos/packages/core/skills/inkos-story-deslop/SKILL.md`
> - `inkos/packages/core/skills/inkos-story-deslop/references/semantic-cleanup.md`
> - `inkos/packages/core/src/__tests__/atomic-file-set.test.ts`
> - `inkos/packages/core/src/__tests__/short-revision.flow.test.ts`

---

## 1. 阶段概述

修订与清稿阶段（Revision & Polish）解决的是**正文从有缺陷的初稿演进为可定稿成品的工程闭环问题**。在传统的无状态生成中，修稿往往导致“按下葫芦浮起瓢”或破坏原有优秀段落。InkOS 建立了**两阶段修订机制（Two-phase Revision）**：
1. 先由 **ReviserAgent** 依据审稿意见（Observations）或作者反馈生成修改提案与候选文本；
2. 经过自动化轻量复审（Re-review）；
3. 最终通过底层工业级的**原子文件事务（AtomicFileSet）**一次性提交替换，杜绝文件损坏与状态不一致。

---

## 2. 执行主体与角色编排

- **ReviserAgent（修订子代理）**：根据指定的修订模式（`ReviseMode`），吸收审稿意见和作者反馈，重构正文。
- **PipelineRunner（流水线编排器）**：调度 `reviseDraft`，维护修订前后的字数遥测差分（`LengthTelemetry`），并驱动二次复审。
- **AtomicFileSet Engine（原子提交引擎）**：事务级文件系统安全保障，提供写前日志、影子临时写入、安全原子替换与崩溃自动恢复。
- **Deslop 语义清洗技能（inkos-story-deslop）**：针对 AI 常见毒斑（空洞排比、机械比喻、套话句式）进行语义脱油。

---

## 3. 输入契约与上下文来源

- **待修订章节原文（Chapter Content）**：当前版本的章节完整正文。
- **审稿观察项列表（ReadonlyArray<Observation>）**：上一阶段产出的带行号与引文的冲突项。
- **作者修订指令（User Revision Instruction）**：作者提出的定向修改诉求（若有）。
- **修订模式（ReviseMode）**：确定本次修订的干预深度与边界范围。
- **ContextPackage**：原样保留的核心设定、角色卡与上下文约束。

---

## 4. 输出产物与权威形态

- **修订后章节正文（Revised Content）**：消除了审稿硬伤、符合篇幅与风格要求的终稿文本。
- **修订后字数遥测（LengthTelemetry）**：
  ```typescript
  export interface LengthTelemetry {
    readonly writerCount: number;         // 初稿字数
    readonly postReviseCount: number;     // 修订后字数
    readonly finalCount: number;          // 最终交付字数
    readonly repairApplied: boolean;      // 是否应用了局部修复
  }
  ```
- **修订提案摘要（RevisionDigest）**：记录本次修订改动点与对应的审稿解决项。

---

## 5. 核心流转机制与关键算法

### 5.1 五大专业修订模式（Revise Modes）
```typescript
// packages/core/src/agents/reviser.ts:1
export type ReviseMode = "polish" | "rewrite" | "rework" | "anti-detect" | "spot-fix";
export const DEFAULT_REVISE_MODE: ReviseMode = "rewrite";
```

| 模式名称 | 核心定位与应用场景 | 行为特征与约束 |
| :--- | :--- | :--- |
| **`spot-fix`** | 定向局部微调（Bugfix） | 仅针对审稿指出的行号冲突做精准手术，严格保护周围其他段落不被擅自变动。 |
| **`polish`** | 文笔润色与氛围强化 | 保持剧情骨架完全不变，优化对话机锋、增强动作细节、渲染感官氛围。 |
| **`rewrite`** | 全章重写（默认模式） | 保持章纲目标和核心因果不变，根据审稿反馈对整章文字进行重新构思与铺陈。 |
| **`rework`** | 架构级返工 | 适用于剧情发生严重偏差时，允许调整场景先后顺序甚至重设转折事件。 |
| **`anti-detect`** | 去 AI 感与套话清洗 | 激活 `semantic-cleanup.md` 规则，强制破坏模式化对称句式与空洞抒情。 |

### 5.2 两阶段修订流程（Two-Phase Revision）
1. **阶段 1：候选生成（Candidate Generation）**：
   Reviser 生成完整修订稿，调用 `onCandidate` 回调暂存，但不立即写入正式章节库；
2. **阶段 2：复审对账与原子提交（Re-audit & Atomic Commit）**：
   宿主对修订稿重新发起轻量审查，确认原先的 `Observation` 已被消除且未引入新的硬伤后，一次性提交事务。

### 5.3 工业级原子文件事务（AtomicFileSet）
```typescript
// packages/core/src/utils/atomic-file-set.ts
export async function commitAtomicFileSet(input: AtomicFileSet): Promise<void> {
  return serialize(input.rootDir, async () => {
    // 1. 检查并恢复之前可能遗留的未完事务（Crash Recovery）
    await recoverRoot(input.rootDir);
    // 2. 校验路径安全（杜绝相对路径穿越，杜绝写删同一路径）
    // 3. 写入影子临时文件（.tmp-*）
    // 4. 记录事务日志（Journal Log）
    // 5. 执行原子 Rename 替换正式文件
    // 6. 清理临时备份
  });
}
```
**安全防御**：即使在写入过程中断电或进程强杀，下次启动时 `recoverAtomicFileSets` 会自动根据日志回滚或推进到一致状态。

---

## 6. 数据结构与 Schema 详述

### 6.1 `ReviseOutput`
```typescript
// packages/core/src/agents/reviser.ts
export interface ReviseOutput {
  readonly revisedContent: string;
  readonly wordCount: number;
  readonly tokenUsage?: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
  };
}
```

### 6.2 `AtomicFileSet` 结构
```typescript
// packages/core/src/utils/atomic-file-set.ts
export interface AtomicFileWrite {
  readonly relativePath: string;
  readonly content: string | Uint8Array;
}

export interface AtomicFileSet {
  readonly rootDir: string;
  readonly writes: ReadonlyArray<AtomicFileWrite>;
  readonly deletes?: ReadonlyArray<string>;
  readonly renameFile?: (from: string, to: string) => Promise<void>;
}
```

---

## 7. 质量门禁与强校验规则

1. **路径穿越防御（safeRelativePath）**：
   - 相对路径必须保持在 `rootDir` 内部；任何包含绝对路径、空路径或 `..` 试图访问父目录的行为，立即抛出 `Atomic file path must stay inside rootDir`。
2. **路径重叠拦截（ATOMIC_PATH_OVERLAP）**：
   - 事务禁止同时修改某个目录及其子文件，防止文件系统层面的递归锁死与写冲突。
3. **字数反弹拦截（assertChapterLength）**：
   - 修订后的正文字数必须重新经过 `chapterLengthDelivery` 检验，防止修稿后字数缩水或极度膨胀。

---

## 8. 一致性与因果链保障

- **状态自动回溯（Chapter State Recovery）**：
  若最新章发生过重写，系统调用 `reconcileChapterStateAfterReview`，废弃前次初稿可能已经临时提炼出的虚假事实，保证结算基线重新锚定在最新的修订稿上。
- **修订说明持久化合并**：
  若存在多次修改，调用 `mergeChapterRevisionInstructions` 将多轮修改诉求结构化合并，确保 Reviser 始终知晓历次修订的累积背景。

---

## 9. 创作技能与专业方法论

技能 `inkos-story-deslop` 与 `semantic-cleanup.md` 针对大模型写作顽疾提出了系统化治理规范：
- **消灭“叹气-耸肩-苦笑”三件套**：禁止在对话中机械化插入角色微动作填充句；
- **破除虚假哲理**：删除诸如“他明白，在这个残酷的世界里，唯有力量才是永恒的真理”这类陈词滥调；
- **具体化动词替代抽象修饰**：用具体的物理受力、声响与轨迹替换空泛的“强大的气势铺天盖地而来”。

---

## 10. 测试覆盖与验证场景

核心测试位于 `inkos/packages/core/src/__tests__/atomic-file-set.test.ts` 与 `short-revision.flow.test.ts`：
1. **原子事务崩溃恢复测试**：模拟在 Rename 阶段强行注入崩溃，断言下次调用 `recoverAtomicFileSets` 能准确复原受损文件。
2. **路径越界攻击测试**：传入 `../../secret.txt`，断言被 `safeRelativePath` 成功拦截。
3. **Spot-fix 模式局部性断言**：测试在仅提供特定行错误的情况下，修订输出与原稿除该处外保持高度一致。
