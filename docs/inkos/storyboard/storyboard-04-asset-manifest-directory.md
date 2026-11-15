# 分镜与生图阶段四：分镜资产清单驱动与目录三态生命周期隔离（Assets Manifest & Lifecycle Isolation）深度分析报告

> **源工程**：`inkos/`（Manifest: `assets.json`，Runner: `script-storyboard-runner.ts`）  
> **核心源文件**：
> - `inkos/packages/core/src/pipeline/script-storyboard-runner.ts` (`createStoryboardAssetsManifest`, `ensureProjectDir`)
> - `inkos/packages/core/src/harness/work-store.ts`
> - `inkos/packages/core/src/__tests__/script-storyboard.test.ts`

---

## 1. 阶段概述

分镜资产清单与目录隔离管理（Assets Manifest & Lifecycle Isolation）是**保障多模态多资产工业级组织与版本溯源的数据基石**。

在生成分镜和提示词之后，系统不能仅仅把图片随意扔进一个文件夹，否则会引发严重的工程灾难：
1. **候选混淆**：一次提示词可能会跑 4 张变体图，哪一张是最终确认的？如果全混在一起，下游剪辑和播放器无法识别；
2. **状态丢失**：某张图生成失败（超时、敏感词过滤）、正在生成（Pending）还是已生成，缺乏统一的状态机；
3. **断联风险**：图片文件丢失了与镜头编号（`shotId`）及提示词的严格映射关系。

InkOS 构建了以 **`assets.json`（分镜资产清单）** 为中枢的**“目录物理三态隔离（Source / Generated / Selected）”**管理机制。

---

## 2. 物理目录结构与三态隔离设计

在 `runStoryboardCreation` 执行过程中，系统通过 `ensureProjectDir` 在工作区强行初始化标准三态目录树：

```
works/<projectId>/source/
├── storyboard-spec.md         # 分镜规格书
├── storyboard.md              # 分镜文本总稿
├── image-prompts.md           # 格式化提示词清单
├── assets.json                # 分镜资产法定清单（中枢索引）
└── assets/                    # 多模态资产根目录
    ├── source/                # 【第一态：源态素材】
    │   ├── character-ref.png  # 作者上传的人物设计图、服饰参考图
    │   └── scene-sketch.jpg   # 场景概念草图、环境参考
    │
    ├── generated/             # 【第二态：生成候选池】
    │   ├── shot-001_v1.png    # 镜头 1 变体 1（如 DALL-E 生成）
    │   ├── shot-001_v2.png    # 镜头 1 变体 2（如 Imagen 生成）
    │   └── shot-002_v1.png    # 镜头 2 候选图
    │
    └── selected/              # 【第三态：终选定稿区】
        ├── shot-001.png       # 镜头 1 唯一确认定稿图（符号链接或硬拷贝）
        └── shot-002.png       # 镜头 2 唯一确认定稿图
```

### 三态隔离的工程价值：
- **`source/`（源态）**：只读保护，作为后续图生图（Image-to-Image）或角色换脸的一致性基准参考；
- **`generated/`（生成态）**：容纳多次重跑、多模型比对的全部候选资产，允许批量清理与归档；
- **`selected/`（终选态）**：下游播放器、互动引擎或分镜导出 PDF/视频时**唯一引用的权威目录**，杜绝未审批图流入生产。

---

## 3. 核心数据结构：StoryboardAssetsManifest（assets.json）

源工程中通过 `createStoryboardAssetsManifest` 产出结构化清单：

```typescript
export interface StoryboardImageAssetVariant {
  readonly id: string;                                                // 变体唯一 ID（如 "var-01"）
  readonly path: string;                                              // 相对路径（如 "assets/generated/shot-001_v1.png"）
  readonly status: "pending" | "generated" | "selected" | "failed";   // 资产生命周期四态
  readonly model?: string;                                            // 生图模型（如 "dall-e-3", "imagen-3"）
  readonly provider?: string;                                         // 提供商（如 "openai", "google"）
  readonly generatedAt?: string;                                      // ISO 时间戳
  readonly error?: string;                                            // 失败回执（如内容审核拦截信息）
}

export interface StoryboardShotAsset {
  readonly shotId: string;                                            // 镜头编号（如 "shot-001"）
  readonly prompt: string;                                            // 生图提示词
  readonly sourceRefs: ReadonlyArray<string>;                         // 引用的 source/ 参考图
  readonly variants: ReadonlyArray<StoryboardImageAssetVariant>;      // 候选变体阵列
  readonly selectedVariantId?: string;                                // 选中的终选变体 ID
}

export interface StoryboardAssetsManifest {
  readonly version: 1;
  readonly kind: "storyboard_assets";
  readonly title: string;
  readonly projectId: string;
  readonly baseDir: string;
  readonly storyboardPath: string;                                    // 指向 source/storyboard.md
  readonly imagePromptsPath: string;                                  // 指向 source/image-prompts.md
  readonly assetsDir: string;                                         // "works/<id>/source/assets"
  readonly sourceDir: string;
  readonly generatedDir: string;
  readonly selectedDir: string;
  readonly createdAt: string;
  readonly assets: ReadonlyArray<StoryboardShotAsset>;                // 全量镜头资产数组
}
```

---

## 4. 镜头资产初始化流转算法

在 `script-storyboard-runner.ts` 的 `createStoryboardAssetsManifest` 中，流水线基于 `imagePrompts` 数组执行**确定性镜头 ID 编排算法**：

```typescript
assets: args.imagePrompts.map((prompt, index) => {
  const shotId = `shot-${String(index + 1).padStart(3, "0")}`; // 如 shot-001, shot-002
  return {
    shotId,
    prompt,
    sourceRefs: [],
    variants: [],
  };
})
```

- **三位数字标准化补齐（Padding）**：`shot-001`、`shot-002`，保证文件系统按名称排序时严格符合影视剪辑顺序，避免 `shot-10` 排在 `shot-2` 前面的文件系统排序缺陷；
- **初始变体为空，预备状态机接入**：此时所有 shot 已经预先就绪，等待下游生图任务（Image Generation Jobs）依次认领并填充 `variants`。

---

## 5. 单元测试验证证据

源工程测试套件 `script-storyboard.test.ts` 对该机制进行了明确断言：

```typescript
it("builds image assets directly from typed prompts", () => {
  const manifest = createStoryboardAssetsManifest({
    title: "冷库账页",
    projectId: "cold-ledger",
    baseDir: "works/cold-ledger/source",
    storyboardPath: "works/cold-ledger/source/storyboard.md",
    imagePromptsPath: "works/cold-ledger/source/image-prompts.md",
    imagePrompts: ["冷库门口，女出纳推门，冷色写实，9:16", "旧账页特写，手电光扫过红章"],
    createdAt: "2026-06-16T00:00:00.000Z",
  });
  expect(manifest.assets.map((asset) => asset.prompt)).toEqual([
    "冷库门口，女出纳推门，冷色写实，9:16",
    "旧账页特写，手电光扫过红章",
  ]);
});
```
证明源工程的资产清单与提取提示词之间保持零损耗强绑定。
