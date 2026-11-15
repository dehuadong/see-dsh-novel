# 分镜与生图阶段六：工件持久化、完整性断言与 DSH 复刻映射（Persistence, Assertion & DSH Mapping）深度分析报告

> **源工程**：`inkos/`（Harness: `source-sync.ts`, `work-store.ts`, `atomic-file-set.ts`）  
> **核心源文件**：
> - `inkos/packages/core/src/pipeline/script-storyboard-runner.ts` (`assertNonEmptyArtifacts`, `syncWorkSourceArtifacts`)
> - `inkos/packages/core/src/harness/work-store.ts` (`saveWorkManifest`)
> - `inkos/packages/core/src/harness/source-sync.ts` (`syncWorkSourceArtifacts`)
> - `capabilities.yaml`（`storyboard` / `script.scenes`）

---

## 1. 阶段概述

分镜工件持久化与完整性断言（Persistence & Integrity Assertion）是**分镜与生图流水线的最终收官与交付阶段**。该阶段负责对前面各步骤产生的所有多模态资产（规格、分镜正文、提示词数组、资产清单 JSON、已生成图像）执行严格的完整性物理断言，通过带有原子事务保障的工件同步引擎（`syncWorkSourceArtifacts`）写入磁盘，并在全局作品元数据（`WorkManifest`）中登记版本与修订历史。

同时，本报告将给出源工程的分镜与生图机制如何**零保真债复刻到 DeepSeek-Harness (DSH) 架构**的完整落地设计。

---

## 2. 交付物集合与物理布局

在 `runStoryboardCreation` 尾部，系统装配四大文本工件：

```typescript
const artifacts = [
  textArtifact(join(baseDir, "storyboard-spec.md"), spec),
  textArtifact(join(baseDir, "storyboard.md"), storyboard),
  textArtifact(join(baseDir, "image-prompts.md"), imagePrompts),
  textArtifact(join(baseDir, "assets.json"), JSON.stringify(assetsManifest, null, 2)),
];
```

加上已生成的图像文件，构成分镜工程的**法定标准五产物（Standard 5 Artifacts）**：

| 工件文件 | 文件类型 | 职责与消费方 |
| :--- | :--- | :--- |
| **`storyboard-spec.md`** | Markdown 规格 | 记录导演设定的风格、画幅、预算参数 |
| **`storyboard.md`** | Markdown 正文 | 人类导演、摄影师、演员、剪辑师阅读的分镜总表 |
| **`image-prompts.md`** | 纯文本数组 | 供生图模型、外部 SD/ComfyUI 批量执行的提示词集 |
| **`assets.json`** | 结构化 JSON | 机器中枢清单，记录镜头状态、变体路径与终选绑定 |
| **`assets/` 目录树** | 多模态二进制 | 存放 source 垫图、generated 候选图、selected 终选图 |

---

## 3. 非空断言守卫与确定性哈希校验

### 3.1 非空完整性断言（assertNonEmptyArtifacts）
源工程在执行落盘前设置了不可绕过的守卫：
```typescript
function assertNonEmptyArtifacts(artifacts: ReadonlyArray<TextArtifactWrite>) {
  for (const artifact of artifacts) {
    if (!artifact.content || artifact.content.trim().length === 0) {
      throw new Error(`Storyboard generation artifact "${artifact.path}" is empty.`);
    }
  }
}
```
杜绝因大模型输出空白、工具调用反序列化异常导致向磁盘写入 0 字节损坏文件的可能。

### 3.2 基于 SHA-256 的源工件同步（syncWorkSourceArtifacts）
系统比对工作区内已有工件内容，计算新生成工件的 SHA-256 哈希值：
- 若内容未变更，跳过冗余写盘；
- 若内容更新，递增生成新的修订版本号（`currentRevisionId`），记录在 `.inkos/works/<projectId>.json` 中。

---

## 4. DSH（DeepSeek-Harness）等价复刻机制映射方案

依据项目《保真原则》（`AGENTS.md`）和《DSH 机制映射》（`docs/dsh-mapping.md`），我们不得引入 inkos 外部运行时，必须采用 DSH 现有的原生能力实现 100% 行为对齐：

### 4.1 运行时机制等价对照

| 机制维度 | 源工程（inkos）做法 | DSH 复刻落点 | 行为等价保障 |
| :--- | :--- | :--- | :--- |
| **执行主体** | `StoryboardCreationAgent` 自建类 | DSH `subagents` 动态派发分镜师代理 | 继承父级上下文，使用专用分镜 prompt |
| **技能注入** | 自带 `inkos-storyboard` | DSH `skills` 服务（`inkos-storyboard`） | 按阶段通过 `systemPrompt.context()` 主动注入 |
| **交付工具** | `submit_storyboard_package` 工具 | DSH `tools.register` 注册同名 Schema | 严格校验 `storyboard` 与 `imagePrompts` |
| **生图调用** | 自建 `cover-providers.ts` HTTP fetch | DSH 工具集成（注册 `storyboard.generate_image` 工具） | 支持配置 API 端点与 Key，返回图片 Base64 |
| **用户界面** | Studio 前端页面 | DSH React Client 插件 + Slots | 在侧边栏/作品工作台渲染分镜九宫格浏览面 |

### 4.2 DSH 客户端工作台交互面（Client UI）设计

在 DSH 中，通过 `client` 插件的扩展槽（Slot），可以为分镜模块渲染专业的工作台（Storyboard Workbench）：
1. **分镜镜头轨（Shot Reel View）**：
   - 瀑布流或九宫格展示每一个镜头卡片（镜头号、景别、运镜、分镜图预览）；
2. **生图候选变体对比（Variant Comparison Gallery）**：
   - 点击某镜头卡片，侧滑展示该镜头下生成的多个变体图（`assets/generated/`）；
   - 提供一键“设为定稿（Select as Primary）”按钮，自动将选中的图片关联至 `assets/selected/`；
3. **提示词就地微调（Prompt In-place Tuning）**：
   - 允许作者就地编辑某个镜头的 `imagePrompt`，一键触发单镜头重跑生图；
4. **一键打包导出（Export Bundle）**：
   - 导出为标准影视分镜 PDF 文档或包含图文的 HTML 离线包。
