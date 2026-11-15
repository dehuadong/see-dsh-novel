# 线性剧本阶段六：剧本工件持久化与工程产物同步（Persistence & Source Sync）深度分析报告

> **源工程**：`inkos/`（Harness: `work-store.ts`, `source-sync.ts`, `artifact-revisions.ts`）  
> **核心源文件**：
> - `inkos/packages/core/src/pipeline/script-storyboard-runner.ts` (`syncWorkSourceArtifacts`, `assertNonEmptyArtifacts`)
> - `inkos/packages/core/src/harness/work-store.ts` (`saveWorkManifest`, `loadWorkManifest`)
> - `inkos/packages/core/src/harness/source-sync.ts` (`syncWorkSourceArtifacts`)
> - `inkos/packages/core/src/harness/artifact-reader.ts` (`readArtifactRevision`)
> - `inkos/packages/core/src/utils/atomic-file-set.ts`

---

## 1. 阶段概述

剧本创作的最终收官阶段是**将重构提纯后的纯净剧本成文与规格书安全落盘，并纳入全局作品版本控制与产物索引体系**。InkOS 坚决摒弃了随意将文本文件写入磁盘的无序做法，而是建立了**基于 WorkManifest 与 Artifact Revisions 的工件跟踪体系**。该阶段通过非空完整性断言（`assertNonEmptyArtifacts`）与原子文件同步（`syncWorkSourceArtifacts`），确保剧本工件具备确定性哈希校验、版本可回溯性，并为后续的剧本导出与排演提供纯净的数据源。

---

## 2. 执行主体与角色编排

- **PipelineRunner（流水线编排器）**：装配 `textArtifact` 数组，触发非空校验与源工件同步。
- **SourceSync Engine（源产物同步引擎）**：比对磁盘与内存工件差异，计算 SHA-256 校验和（Checksum）。
- **WorkStore（作品仓库元数据管理器）**：持久化 `.inkos/works/<projectId>.json` 清单，更新工件修订历史。
- **AtomicFileSet Engine**：底层文件事务保障，防止写入中断导致剧本残缺。

---

## 3. 输入契约与上下文来源

- **剧本创作规格书工件**：`textArtifact(join(baseDir, "script-spec.md"), spec)`；
- **提纯后的剧本正文工件**：`textArtifact(join(baseDir, "script.md"), script)`；
- **工程项目上下文（Project Root & Project ID）**。

---

## 4. 输出产物与权威形态

### 4.1 物理存储目录树
```text
works/<projectId>/
└── source/
    ├── script-spec.md         # 规格工件权威
    └── script.md              # 剧本正文权威
```

### 4.2 全局清单注册记录（WorkManifest Artifacts）
在 `.inkos/works/<projectId>.json` 中注册两个一类公民工件：
1. `script-spec`：记录规格书的路径、当前 Revision ID 与哈希；
2. `script`：记录剧本成文的路径、当前 Revision ID 与哈希。

---

## 5. 核心流转机制与关键算法

### 5.1 非空与最小有效篇幅硬校验（assertNonEmptyArtifacts）
在持久化前，必须对所有待落盘工件执行严格检验：
```typescript
// packages/core/src/pipeline/script-storyboard-runner.ts
export function assertNonEmptyArtifacts(artifacts: ReadonlyArray<TextArtifact>): void {
  for (const artifact of artifacts) {
    const trimmed = artifact.content.trim();
    if (!trimmed) {
      throw new Error(`Production completed with empty artifact: ${artifact.path}`);
    }
    // 剧本正文最小篇幅断言（防止输出只有几个字的残篇）
    if (artifact.path.endsWith("script.md") && trimmed.length < 500) {
      throw new Error(`Script production delivered insufficient content: ${artifact.path} (${trimmed.length} chars)`);
    }
  }
}
```

### 5.2 统一产物同步（syncWorkSourceArtifacts）
```typescript
// packages/core/src/pipeline/script-storyboard-runner.ts:183
const artifacts = [
  textArtifact(join(baseDir, "script-spec.md"), spec),
  textArtifact(join(baseDir, "script.md"), script),
];
assertNonEmptyArtifacts(artifacts);

// 一次性原子写入并更新清单版本
await syncWorkSourceArtifacts({
  projectRoot: options.projectRoot,
  workId: projectId,
  accept: true,
  writes: artifacts,
});
```

### 5.3 成果回报结构（ScriptCreationRunResult）
流水线最终返回给调用者或界面的标准结构：
```typescript
return {
  projectId,
  baseDir,
  specPath: relPath(baseDir, "script-spec.md"),
  scriptPath: relPath(baseDir, "script.md"),
};
```

---

## 6. 数据结构与 Schema 详述

### 6.1 `WorkArtifact` 结构
```typescript
// packages/core/src/harness/contracts.ts
export interface WorkArtifact {
  readonly id: string;                        // 工件唯一 ID（如 "artifact_script_main"）
  readonly kind: "script-spec" | "script";    // 工件类型
  readonly currentRevisionId: string;         // 最新版本 ID
  readonly revisions: readonly {
    readonly id: string;                      // 版本 UUID
    readonly path: string;                    // 相对路径 "source/script.md"
    readonly checksum: string;                // SHA-256 校验和
    readonly createdAt: string;               // 生成时间戳
  }[];
}
```

---

## 7. 质量门禁与强校验规则

1. **残卷拦截（Insufficient Content Guard）**：
   - 生成的 `script.md` 若因模型故障只输出了几句对白即宣告结束（小于 500 字符），流水线直接拒绝同步并报错阻断。
2. **原子文件提交锁（AtomicFileSet Locks）**：
   - 所有的工件写入通过影子临时文件 `.tmp-*` 进行，并在同一文件事务中执行原子 Rename，绝不产生“只有规格书没有剧本正文”的半同步脏状态。

---

## 8. 一致性与因果链保障

- **哈希防篡改（Checksum Validation）**：
  每一个落盘的剧本工件均由系统自动计算并记录 SHA-256 校验和；后续无论是导出、审校还是再次修订，系统均会比对哈希值，防止文件被外部进程意外篡改。

---

## 9. 创作技能与专业方法论

- **开箱即用交付原则（Delivery-Ready Deliverable）**：
  最终产物 `script.md` 必须是一个干净纯粹、毫无“系统提示词残留”、“AI 思考痕迹”或“模型自述前言”的高质量剧本文档，排演人员复制即可直接用于围读剧本。

---

## 10. 测试覆盖与验证场景

主要测试位于 `inkos/packages/core/src/__tests__/script-storyboard.test.ts`：
- **端到端生产同步测试**：验证执行 `runScriptCreation` 后，磁盘目标路径下准确生成 `script-spec.md` 与 `script.md`，且返回的运行结果对象路径完全吻合。
