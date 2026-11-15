# 阶段二：立项 / 初始化（Init & Session Binding）深度分析报告

> **源工程**：`inkos/`  
> **核心源文件**：
> - `inkos/packages/core/src/pipeline/runner.ts` (`initBook`, `prepareDraftBook`)
> - `inkos/packages/core/src/harness/session-binding.ts`
> - `inkos/packages/core/src/harness/work-store.ts`
> - `inkos/packages/core/src/harness/contracts.ts`
> - `inkos/packages/core/src/state/manager.ts`
> - `inkos/packages/core/src/interaction/session.ts`
> - `inkos/packages/core/src/utils/outline-paths.ts`
> - `inkos/packages/core/src/harness/runtime.ts`
> - `inkos/packages/core/src/__tests__/work-initial-production.flow.test.ts`
> - `inkos/packages/core/src/__tests__/book-session.test.ts`

---

## 1. 阶段概述

立项/初始化阶段（Init & Session Binding）承担着**从批准的提案参数到物理工程落地的转换**职责。它为作品分配唯一的 `workId`，在文件系统中开辟独立的目录骨架，建立全局作品清单（`WorkManifest`），播种顶层意图控制文档（`author_intent.md` 等），并在跨进程级别加锁（`acquireBookLock`）。同时，它通过 `session-binding` 机制将作品目录绑定到对应的交互会话，使得前端面板能直观呈现立项状态，为进入“基础设定阶段”做好完备的运行时准备。

---

## 2. 执行主体与角色编排

- **PipelineRunner**：长篇流水线编排入口，提供 `initBook(book, options)` 和 `prepareDraftBook(book)`。
- **StateManager**：工作区状态管理器，负责目录创建、控制文档播种（`ensureControlDocuments`）及文件写锁（`acquireBookLock`）。
- **WorkStore（Harness）**：管理跨作品全局元数据，负责 `WorkManifest` 的创建、校验、保存与 `Artifact` 注册。
- **Session Binding 层**：映射 `sessionKind` 与 `workId`，确立当前会话的 Profile（`longform`）与上下文边界。
- **前端面板（Studio Workbench）**：监听会话状态，渲染立项后的基础信息，并提供「开始基础设定」动作按钮。

---

## 3. 输入契约与上下文来源

- **BookConfig（书籍配置）**：
  ```typescript
  export interface BookConfig {
    readonly id: string;                    // 作品唯一 ID（如 "ling-mai-ju-zhen"）
    readonly title: string;                 // 书名
    readonly genre: string;                 // 题材类型
    readonly language: "zh" | "en";         // 正文语言
    readonly chapterWordCount: number;      // 目标单章字数
    readonly targetWordCount?: number;      // 全书预期总字数
    readonly direction?: string;            // 核心设定与故事方向
    readonly platform?: string;             // 目标平台
    readonly fanficMode?: FanficMode;       // 同人模式选项（可选）
  }
  ```
- **InitBookOptions**：
  - `externalContext`：提案阶段确立的自包含外部指令（用于写入 `story/brief.md`）。
  - `onProgress`：阶段进度流式回调。

---

## 4. 输出产物与权威形态

### 4.1 目录结构与权威文件
```text
books/<bookId>/
├── book.json                     # 作品核心配置（唯一配置权威）
├── .write.lock                   # 跨进程互斥文件锁
├── story/
│   ├── author_intent.md          # 作者顶层意图（控制文档权威）
│   ├── current_focus.md          # 近期阶段聚焦点（控制文档权威）
│   ├── brief.md                  # 外部指令简报（如存在）
│   ├── runtime/                  # 运行时临时数据目录
│   ├── outline/                  # 待填充的大纲目录
│   └── roles/                    # 待填充的角色目录（主要角色/、次要角色/）
├── state/                        # 状态目录（后续阶段初始化）
├── chapters/
│   └── index.json                # 章节索引（初始为空）
└── artifacts/                    # 虚拟产物存储
```

### 4.2 全局清单（WorkManifest）
位于工作区根目录的 `.inkos/works/<workId>.json`：
- 状态初始打标为 `status: "draft"`。
- 绑定 `profileId: "longform"`，校验其声明的 `capabilityIds` 必须包含 `"longform"`。

---

## 5. 核心流转机制与关键算法

### 5.1 预立项检查（prepareDraftBook）
1. 尝试调用 `loadWorkManifest(projectRoot, book.id)`。
2. 校验现有工程的 `profileId` 是否具有长篇能力，若不具备则抛出错误：`Work does not declare long-form production capability`。
3. 状态检查：如果作品状态不是 `draft` 且目录已完整（`isCompleteBookDirectory`），则拒绝覆盖已完成作品：`Book already exists as a completed Work.`。
4. 若不存在则通过 `createWorkManifest` 派生新清单。

### 5.2 跨进程作品锁（acquireBookLock）
为防止并发写入冲突或双 Agent 竞争：
- 在目标作品目录下尝试创建 `.write.lock` 文件。
- 内部维护 `processBookLocks` Map；如果已有进程或线程持有该作品锁，立即抛出 `BookWriteLockError`。
- 操作完成后执行返回的 `releaseLock()` 回调。

### 5.3 播种控制文档（ensureControlDocumentsAt）
```typescript
// packages/core/src/state/manager.ts:76
await mkdir(storyDir, { recursive: true });
await mkdir(runtimeDir, { recursive: true });
await mkdir(outlineDir, { recursive: true });
await mkdir(rolesMajorDir, { recursive: true });
await mkdir(rolesMinorDir, { recursive: true });

// 写入或补齐 author_intent.md 与 current_focus.md
await this.writeIfMissing(
  join(storyDir, "author_intent.md"),
  authorIntent?.trim() ? authorIntent.trimEnd() + "\n" : StateManager.defaultAuthorIntent(language)
);
await this.writeIfMissing(
  join(storyDir, "current_focus.md"),
  StateManager.defaultCurrentFocus(language)
);
```

### 5.4 暂存目录写入与原子替换（Staging Directory）
在 `initBook` 执行基础设定时：
- 先在同父级下创建带时间戳与随机后缀的暂存目录：`.tmp-book-create-<bookId>-<timestamp>-<rand>`。
- 所有初始文件先写入暂存目录，生成完成后通过原子文件操作同步至正式目录，保证失败时不留脏文件（`preserveFailedWork`）。

---

## 6. 数据结构与 Schema 详述

### 6.1 `WorkManifest` Schema
```typescript
// packages/core/src/harness/contracts.ts
export const WorkManifestSchema = z.object({
  id: z.string().min(1),
  profileId: z.string().min(1),
  title: z.string().min(1),
  language: z.enum(["zh", "en"]),
  status: z.enum(["draft", "active", "completed", "archived"]),
  metadata: z.record(z.unknown()),
  artifacts: z.array(WorkArtifactSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
```

### 6.2 `SessionBinding`
```typescript
// packages/core/src/harness/session-binding.ts
export function resolveSessionHarnessBinding(input: {
  readonly sessionKind: SessionKind;
  readonly bookId: string | null;
  readonly sessionId: string;
}): { readonly profileId: string; readonly workId: string | null } {
  return {
    profileId: PROFILE_ID_BY_SESSION_KIND[input.sessionKind],
    workId: input.bookId ?? (input.sessionKind === "play" ? input.sessionId : null),
  };
}
```

---

## 7. 质量门禁与强校验

1. **唯一标识冲突校验**：
   - 无法对已定稿或已发布的完整书籍重复执行 `initBook`，抛出明确错误。
2. **能力兼容性门禁**：
   - `require(manifest.profileId).capabilityIds.includes("longform")` 强制拦截非长篇预设误入长篇流水线。
3. **写锁冲突拦截**：
   - 抛出 `BookWriteLockError`，附带持有锁的进程信息与路径，防止多端竞态。
4. **控制文档完整性断言**：
   - 必须确保 `author_intent.md` 和 `current_focus.md` 真实落盘，否则后续 Agent 启动前检查会直接报错。

---

## 8. 一致性与因果链保障

- **幂等与安全重入（Safe Reentrancy）**：
  若目录已经完整且处于有效状态，`initBook` 识别后仅同步源产物清单（`syncWorkSourceArtifacts`），不重复抹除现有基础设定。
- **意图穿透链（Intent Propagation Chain）**：
  初始落盘的 `author_intent.md` 是长篇流水线的最高宪法。无论后续写到第 1 章还是第 100 章，该文档都会被 `Composer` 视作不可压缩的顶层上下文，防止随字数增长产生设定漂移。

---

## 9. 创作技能与方法论

在初始化阶段，系统激活 `inkos-long-writing`：
- 确立全书基础规范，设定读者承诺的基准点。
- 将作者意图清晰划分为两部分：
  1. **长期不变量（Author Intent）**：全书的核心调性、主线大结局愿景、绝对不能触碰的毒点或禁忌。
  2. **近期聚焦点（Current Focus）**：当前卷或前三章的核心目标，用于引导开篇节奏。

---

## 10. 测试覆盖与验证场景

主要测试位于 `inkos/packages/core/src/__tests__/work-initial-production.flow.test.ts` 与 `book-session.test.ts`：
1. **作品初始化流测试**：验证 `initBook` 之后，目录骨架完备，`book.json` 格式合规。
2. **会话绑定测试**：断言传入 `sessionKind: "book"` 和 `bookId` 能正确绑定到 `longform` Profile。
3. **互斥锁测试**：在未释放锁的情况下启动第二个实例，断言抛出 `BookWriteLockError`。
4. **控制文档播种测试**：断言缺省情况下能够生成对应语言（中/英）的默认作者意图模版。
