# 剧本阶段四：视觉分镜拆解与生图资产清单（Storyboard & Image Assets）深度分析报告

> **源工程**：`inkos/`  
> **核心源文件**：
> - `inkos/packages/core/src/agents/script-storyboard.ts` (`StoryboardCreationAgent`)
> - `inkos/packages/core/src/pipeline/script-storyboard-runner.ts` (`runStoryboardCreation`, `createStoryboardAssetsManifest`)
> - `inkos/packages/core/skills/inkos-storyboard/SKILL.md`
> - `inkos/packages/core/skills/inkos-storyboard/references/shot-continuity.md`
> - `inkos/packages/core/src/__tests__/script-storyboard.test.ts`

---

## 1. 阶段概述

分镜创作阶段（Storyboard & Image Assets）是**文字剧本向影视视听画面、动画分镜及 AI 生图落地的关键转译桥梁**。该阶段的核心定位是：
1. **视听分镜拆解**：依据镜头语言规律（景别、构图、运镜、视线），将戏剧节拍拆解为规范的镜号表；
2. **生图提示词提炼（Prompt Engineering）**：将每个镜头的视觉关键瞬时提取为可执行的高品质生图提示词；
3. **分镜资产清单管理（Assets Manifest）**：生成机器可读的 `assets.json`，追踪每个镜头（`shot-001` 等）从提示词就绪到图像生成、多变体比选（Variants）直至定稿的全生命周期。

---

## 2. 执行主体与角色编排

- **StoryboardCreationAgent（分镜设计子代理）**：扮演资深分镜师与视效总监，负责视听画面构思、镜头调度与生图 Prompt 编写。
- **PipelineRunner（资产编排器）**：调度 `runStoryboardCreation`，负责建立资产目录结构（`source/`, `generated/`, `selected/`），并构建 `assets.json` 清单。
- **Downstream Image Generation Services（生图下游）**：消费分镜资产清单，对接 Midjourney/Stable Diffusion/DALL-E 等模型生成画面。

---

## 3. 输入契约与上下文来源

- **剧本正文（script.md）** 或分场大纲。
- **分镜制作规格（StoryboardCreationInput）**：
  - `visualStyle`（视觉风格：如“冷色写实、胶片颗粒、赛博朋克”）；
  - `aspectRatio`（画幅比例：竖屏 `9:16`、宽银幕 `16:9`、`2.35:1`）；
  - `granularity`（分镜粒度：节拍关键镜、详细镜头组）；
  - `maxShots`（总镜头数上限约束）。
- **专业分镜技能指引（inkos-storyboard）**：注入轴线规律与视听连续性规范。

---

## 4. 输出产物与权威形态

1. **分镜规格说明（storyboard-spec.md）**：记录画幅、风格、镜头上限等约定。
2. **人类可读分镜表（storyboard.md）**：标准的视听语言表格/文档。
3. **按镜排布的生图提示词集（image-prompts.md）**：编号严格对齐镜头的独立提示词。
4. **资产管理清单（assets.json）**：
   - 机器权威的资产元数据清单，版本声明为 `version: 1`，类型为 `storyboard_assets`。
5. **物理资产目录树**：
   ```text
   works/<projectId>/source/assets/
   ├── source/       # 原素材与视觉参考图
   ├── generated/    # 模型生成的候选图变体
   └── selected/     # 人类导演选定的最终定稿图
   ```

---

## 5. 核心流转机制与关键算法

### 5.1 镜头服务于戏剧节拍（Shots Serve the Beat）
`shot-continuity.md` 严禁机械化拆镜：
- **拒绝逐句分镜**：严禁把每一句对白机械地切为一个正反打镜头；
- **镜头切换的五大合法理由**：
  1. 信息发生改变（如展示特写证据）；
  2. 权力关系变化（如俯拍变为仰拍）；
  3. 视线注意力转移（如角色听到异响转头）；
  4. 空间与地理位置重构（全景交代位置关系）；
  5. 情绪爆发或关键心理转折。

### 5.2 视听连续性与轴线保护（Visual Continuity）
- **180度轴线规律（The 180-Degree Rule）**：在两个对话镜头之间，摄影机不得跨越关系轴线，防止观众产生角色左右方位错乱。
- **视线匹配（Eyeline Match）**：A 角色向右看，接下来的 B 角色特写必须向左看。
- **光影与时间锚点**：同场景相邻镜头严格继承天光、天气、阴影方向。

### 5.3 资产清单构建算法（createStoryboardAssetsManifest）
```typescript
// packages/core/src/pipeline/script-storyboard-runner.ts:359
export function createStoryboardAssetsManifest(args: { ... }): StoryboardAssetsManifest {
  const assetsDir = relPath(args.baseDir, "assets");
  return {
    version: 1,
    kind: "storyboard_assets",
    title: args.title,
    projectId: args.projectId,
    baseDir: toPosixPath(args.baseDir),
    storyboardPath: toPosixPath(args.storyboardPath),
    imagePromptsPath: toPosixPath(args.imagePromptsPath),
    assetsDir,
    sourceDir: relPath(assetsDir, "source"),
    generatedDir: relPath(assetsDir, "generated"),
    selectedDir: relPath(assetsDir, "selected"),
    createdAt: args.createdAt,
    assets: args.imagePrompts.map((prompt, index) => {
      const shotId = `shot-${String(index + 1).padStart(3, "0")}`;
      return {
        shotId,
        prompt,
        sourceRefs: [],
        variants: [],
        status: "prompt_ready",
      };
    }),
  };
}
```

---

## 6. 数据结构与 Schema 详述

### 6.1 `StoryboardImageAsset` 与 `StoryboardAssetsManifest`
```typescript
// packages/core/src/pipeline/script-storyboard-runner.ts:115
export interface StoryboardImageAssetVariant {
  readonly id: string;
  readonly path: string;
  readonly status: "pending" | "generated" | "selected" | "failed";
  readonly model?: string;
  readonly provider?: string;
  readonly createdAt?: string;
  readonly error?: string;
}

export interface StoryboardImageAsset {
  readonly shotId: string;                     // 镜号（如 "shot-001"）
  readonly prompt: string;                     // 生图提示词
  readonly sourceRefs: readonly string[];      // 关联的剧本行或来源
  readonly variants: readonly StoryboardImageAssetVariant[]; // 多轮生图候选
  readonly selectedPath?: string;              // 最终选定的图片路径
  readonly status: "prompt_ready" | "generated" | "selected" | "failed";
}
```

### 6.2 标准分镜 Markdown 格式规范
```markdown
### 镜头 01 (shot-001)
- **景别/运镜**：全景 (Wide Shot) / 缓慢前推 (Dolly In)
- **画面内容**：风雪呼啸的冷库大门外景，厚重铁门紧闭，昏黄路灯在雪雾中拉出长长的阴影。
- **对白/音效**：【环境音】狂风呼啸声，门锁金属冻裂的细微咔哒声。
- **生图提示词**：Cinematic wide shot of an industrial cold storage facility at night, heavy blizzard, frozen rusty metal door, dim yellow streetlight shining through snow haze, atmospheric shadows, realistic gritty style, 9:16 aspect ratio.
```

---

## 7. 质量门禁与强校验规则

1. **镜号与 Prompt 数量严格对齐**：
   - `assets.json` 中的 assets 数组长度必须与 `image-prompts.md` 的行数完全一致，严禁发生镜号错位。
2. **生图提示词可执行性校验**：
   - 提示词必须具体描写静态可视瞬间（主体、环境、构图、光影），严禁将“十年前的仇恨”等不可画的情绪抽象词写入 Prompt。
3. **画幅与风格强制锁定**：
   - 提示词末尾强制追加预设约定的画幅参数与视觉风格后缀，防止模型自由发挥产生异类图片。

---

## 8. 一致性与因果链保障

- **镜头级状态机追踪**：
  每个镜头通过 `status`（`prompt_ready` → `generated` → `selected`）进行确定性状态跃迁。多图并存时，唯有打上 `selected` 标签的变体才会进入最终成片剪辑通道。
- **视觉锚点继承（Visual Anchors）**：
  同场景人物的服装、发型、随身道具特征，在生成的系列 Prompt 中通过固定的描述词（锚点）强制复用，保证跨镜头角色长相不崩塌。

---

## 9. 创作技能与专业方法论

技能 `inkos-storyboard` 核心方法：
- **静态瞬时选择原则（Single Moment Selection）**：静止画面的 Prompt 必须精选该镜头内最富戏剧张力的一个确定性瞬间，不需要描绘动作从起到落的全过程。
- **视听分离原则**：将摄影机所见（Video）与台词解说（Audio）在格式上彻底拆分，确保后续换配音或微调镜头时互不破坏。

---

## 10. 测试覆盖与验证场景

主要测试位于 `inkos/packages/core/src/__tests__/script-storyboard.test.ts`：
1. **资产清单构建测试**：验证传入带编号的 Prompt 列表能正确映射生成 `shot-001`、`shot-002`，初始状态锁定为 `prompt_ready`。
2. **画幅与风格保真测试**：断言规格书中的视觉风格设定被准确传递到下游生成工具中。
