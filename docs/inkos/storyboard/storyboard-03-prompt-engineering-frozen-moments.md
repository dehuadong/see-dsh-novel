# 分镜与生图阶段三：面向生图引擎的 Prompt 提纯与时空单瞬间冻结（Generation-Ready Prompts & Moment Freezing）深度分析报告

> **源工程**：`inkos/`（Agent: `StoryboardCreationAgent`，Schema: `StoryboardPackageToolSchema`）  
> **核心源文件**：
> - `inkos/packages/core/src/agents/script-storyboard.ts` (`writeStoryboard`, `buildStoryboardCreationSystemPrompt`)
> - `inkos/packages/core/src/agents/production-document-tool.ts` (`StoryboardPackageToolSchema`)
> - `inkos/packages/core/skills/inkos-storyboard/SKILL.md`
> - `inkos/packages/core/src/pipeline/script-storyboard-runner.ts` (`renderImagePrompts`)

---

## 1. 阶段概述

面向生图引擎的 Prompt 提纯与时空单瞬间冻结（Generation-Ready Prompts & Moment Freezing）是**将动态连续分镜转化为文生图（Text-to-Image）模型可精确执行 Prompt 的核心编译阶段**。

该阶段解决影视分镜生图领域最根本的技术矛盾：
- **影视镜头的物理属性**：是持续数秒（如 3-5 秒）的**动态时空片段**，包含角色的起承转合位移、多句台词、摄影机推拉摇移与环境光影变化；
- **文生图引擎的物理属性**：扩散模型（Diffusion Models）或生成式模型只能输出**单一静态瞬间的 2D 图像**。

如果直接将分镜画面描述（如“他走过去打开柜子，拿出手枪，然后转身对准门口开火”）直接喂给生图模型，模型必然会发生肢体畸变、多手多脚或概念混合。InkOS 提出了专有的**“时空单瞬间冻结法则（Frozen Visible Moment）”**与**“Prompt 七维显式解耦方法”**。

---

## 2. 执行主体与协议契约

### 2.1 结构化交付契约（StoryboardPackageToolSchema）

在 `StoryboardCreationAgent.writeStoryboard` 中，大模型不是随意输出一段长文本，而是通过结构化工具调用（Tool Call）强制履行强类型契约：

```typescript
export const StoryboardPackageToolSchema = Type.Object({
  storyboard: Type.String({
    minLength: 1,
    description: "Complete Markdown storyboard: shots, camera, action, sound, duration and continuity. Image prompts belong only in imagePrompts, not in this document."
  }),
  imagePrompts: Type.Array(
    Type.String({
      minLength: 1,
      description: "One generation-ready image prompt for a storyboard shot."
    }),
    {
      minItems: 1,
      description: "The single image-prompt list, one prompt per shot in shot order."
    }
  ),
});
```

### 2.2 契约两大铁律：
1. **单一提示词阵列隔离**：`storyboard.md` 分镜文档中**只写排演分镜**，严禁在分镜正文里夹带冗余的提示词清单；所有生图 Prompt 必须提取并放入 `imagePrompts` 数组中；
2. **下标与镜头序号严格一对一绑定（Shot-Order Invariance）**：`imagePrompts[0]` 严格对应 `Shot 01`，`imagePrompts[N-1]` 严格对应 `Shot N`。严禁提示词乱序、遗漏或合并。

---

## 3. 核心机制：时空单瞬间冻结法则（Frozen Visible Moment）

源工程 `inkos-storyboard/SKILL.md` 中给出了极为精辟的工程定义：

> *"A prompt for a still image selects one visible moment within its shot; it does not have to depict every successive movement, line of dialogue, or the shot's final state. Check that the selected moment is possible within the shot and preserves its characters, objects, space and visual direction."*

### 3.1 瞬间冻结选取策略（Peak Dramatic Moment）
对于一个 4 秒的动态镜头，系统指引模型必须且只能冻结**最具备戏剧张力与视觉表现力的一个瞬态（Golden Frame）**：
- **若动作为“入场并拔枪”**：冻结在“手指紧扣扳机、枪口刚刚举平对准目标”的爆发瞬间，而不是“推门进屋”的平淡瞬间；
- **若动作为“惊闻噩耗倒地”**：冻结在“手中水杯脱手下坠在半空中、瞳孔剧烈收缩”的瞬时冲击，而不是已经倒在地上。

---

## 4. Prompt 构成七要素与去抽象化规则

InkOS 要求每一个输出的提示词必须是**“Generation-Ready（直接可供生成）”**的，必须显式具备以下 7 个维度：

| 维度 | 英文标识 | 规范要求 | 错误范例（抽象文本） | 正确范例（显式视听化） |
| :--- | :--- | :--- | :--- | :--- |
| **1. 画面主体** | Subject | 明确主体的外貌特征、年龄、身份与穿戴 | “一个愤怒的中年人” | “40岁亚洲男性，寸头，两鬓微白，身穿深灰色粗呢大衣，领口微敞” |
| **2. 物理动作** | Action | 只写骨骼肌肉能做出的瞬时动作 | “他内心陷入巨大的悔恨” | “双手紧紧抓着散落一地的文件，指节发白，头颅低垂” |
| **3. 空间环境** | Setting | 场景的几何空间、材质、道具与背景深度 | “在一个简陋的办公室” | “逼仄的地下室办公室，脱落墙皮的混凝土墙面，一张堆满账册的掉漆铁皮桌” |
| **4. 构图景别** | Composition | 明确画幅焦段、视线机位与画面纵深 | “特写” | “特写镜头（Close-up shot），浅景深（shallow depth of field），背景虚化” |
| **5. 光影质感** | Lighting | 光源位置、光比（高光/阴影）与色温 | “很暗” | “极暗环境，一道强烈的冷色手电筒光束从斜后方打入，形成锐利的轮廓光” |
| **6. 情绪色调** | Mood / Tone | 整体环境的质感基调与电影色彩 | “悲伤的氛围” | “电影质感，高对比度，青冷调（teal and orange color grade），弥漫着尘埃粒子” |
| **7. 连续性锚点** | Continuity | 继承上文确立的角色外观与关键道具 | 自由发挥角色外表 | “保留右脸颧骨上的淡红色浅伤痕，手中紧握带有银色金属锁扣的黑色皮箱” |

---

## 5. 提示词渲染与多语言适配

在 `script-storyboard-runner.ts` 中，系统通过 `renderImagePrompts` 将数组渲染为格式化的持久化文本文件：

```typescript
function renderImagePrompts(prompts: ReadonlyArray<string>): string {
  return prompts.map((prompt, index) => `${index + 1}. ${prompt}`).join("\n");
}
```

产出的 `image-prompts.md` 可以直接被批量生图引擎、或人类作者复制到 Midjourney / Stable Diffusion / DALL-E 中直接跑图。
