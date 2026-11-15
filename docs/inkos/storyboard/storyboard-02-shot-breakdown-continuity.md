# 分镜与生图阶段二：叙事节拍切镜与视听时空连续性保障（Shot Breakdown & Visual Continuity）深度分析报告

> **源工程**：`inkos/`（Skill: `inkos-storyboard`，Reference: `shot-continuity.md`）  
> **核心源文件**：
> - `inkos/packages/core/skills/inkos-storyboard/SKILL.md`
> - `inkos/packages/core/skills/inkos-storyboard/references/shot-continuity.md`
> - `inkos/packages/core/src/agents/script-storyboard.ts`
> - `inkos/packages/core/src/harness/builtin-profiles.ts`

---

## 1. 阶段概述

分镜切镜与时空连续性保障（Shot Breakdown & Visual Continuity）是**将文学叙事与剧本对白编译为视听蒙太奇语言的工业级分镜方法论**。AI 在生成分镜时最常见的通病是：
1. **机械切镜（Over-segmentation）**：每一句话切一个镜头，导致节奏极度细碎混乱；
2. **装饰性空镜（Decorative coverage）**：为了凑镜头数塞入大量对推进剧情毫无作用的静物或风景；
3. **时空跳轴与逻辑撕裂（Continuity Breaks）**：上一镜头角色在左侧向右看，下一镜头无过渡突然跑到右侧；或者白天突然切成深夜，服装颜色道具突变。

InkOS 依托 `inkos-storyboard` 技能与 `shot-continuity.md` 规范，确立了**“镜头服务于戏剧节拍”**与**“跨镜头时空连续性锚点追踪”**两大工业级铁律。

---

## 2. 执行主体与角色编排

- **StoryboardCreationAgent（分镜创作者智能体）**：作为主笔分镜师，挂载 `inkos-storyboard` 专业技能。
- **Shot Continuity Guard（镜头连续性卫士）**：按照 `references/shot-continuity.md` 中的轴线法则与时空一致性规则，审核分镜序列。
- **Beat Extractor（戏剧节拍提取器）**：从剧本中提取人物关系位移、权力消长（Power shifts）与重大冲突转折。

---

## 3. 核心切镜方法论与四大铁律

### 3.1 铁律一：Shots serve the beat（镜头必须服务于戏剧节拍）
> *"Use a new shot when information, power, attention, spatial understanding, or emotion changes. Do not convert every sentence into a shot and do not collapse a full dramatic turn into one decorative image."*

切镜的充分必要条件是**戏剧要素发生了实际位移**，包括：
- **信息差变化（Information）**：新线索、新人物出现，或某个角色的秘密被揭露；
- **权力消长（Power Shift）**：博弈双方攻防逆转，强势者变为弱势者；
- **注意力引导（Attention Focus）**：从全局环境聚焦到某个关键道具（如抽屉里的左轮手枪）；
- **空间认知重建（Spatial Understanding）**：角色移动至新场景或新位置；
- **情绪跃迁（Emotion Peak）**：情绪爆发或极度克制时的微表情反应。

禁止将剧本正文机械地“一段话分配一个镜头”，更禁止无意义地将一个完整戏剧转折折叠为一张空洞概念海报。

### 3.2 铁律二：Visual Continuity Anchors（视听连续性锚点追踪）
在跨镜头的流转中，系统要求必须持续追踪以下 7 大视觉锚点：
1. **视向与轴线（Screen Direction & 180° Rule）**：严格保持人物在画幅中的视线交锋方向（Eyelines）。两人对峙时，一人向右看，另一人必须向左看，严禁无过渡越轴（Jump-axis）；
2. **人物位置相对关系（Character Positions）**：空间相对位置保持稳定，移动必须有镜头内运动轨迹（Blocking）；
3. **关键道具连续性（Props Continuity）**：上一镜头拿在手里的水杯，下一镜头不能凭空消失；
4. **光影与时间统一（Lighting & Time Consistency）**：光源方向（顺光/逆光/侧光）、色温（冷调/暖调）、天气（雨雪阴晴）必须全场稳定；
5. **稳定环境锚点（Stable Visual Anchors）**：反复出现的室内或室外场景，必须保留固定的标志性地标（如办公桌后的百叶窗、墙上的复古挂钟），防止画面环境看起来像换了一个房间。

### 3.3 铁律三：Shot Grammar（严格视听语言语法）
每一个镜头条目必须结构化声明 5 个核心视听维度：
- **镜头编号（Shot ID）**：如 `Shot 01`、`Shot 02`；
- **景别（Shot Size）**：极远景（ELS）、全景（WS）、中景（MS）、近景（MCU）、特写（CU）、大特写（ECU）；
- **摄影机运动与角度（Camera Movement & Angle）**：固定机位（Static）、推镜头（Dolly-in）、拉镜头（Dolly-out）、摇镜（Pan）、移镜头（Tracking）、升降（Crane）、俯拍（High angle）、仰拍（Low angle）；
- **视听画面描述（Visual Description）**：客观描述画面主体、动作、空间构图与光影；
- **声音与技术说明（Audio & Notes）**：画内对白（Dialogue）、画外音（O.S./V.O.）、音效（SFX）、背景音乐（BGM）以及镜头预估时长（Duration）。

---

## 4. 阶段输入契约与分镜表排版规范

在 `ScriptCreationAgent` 的系统提示词中，强制规定分镜正文输出为标准的 Markdown 表格或结构化列表：

```markdown
# {title} 分镜

## 分镜表

### 镜头 01
- **景别**：全景 (WS)
- **机位/运镜**：俯拍固定机位，缓慢推进 (Slow Dolly-in)
- **时长**：3秒
- **画面内容**：雨夜，废弃仓库外景。暴雨倾盆，一道闪电划破夜空，照亮停在门口的一辆黑色越野车。车灯刺破雨幕。
- **角色/动作**：驾驶座车门推开，一只踩着沾泥皮靴的脚踏入水洼中。
- **声音/对白**：【音效】雷声轰鸣，暴雨砸击地面的声音。【画外音】“他终于来了。”
- **连续性锚点**：雨夜、逆光车灯、积水地面的泥泞倒影。

### 镜头 02
- **景别**：特写 (CU)
- **机位/运镜**：低角度仰拍，手持微晃
- **时长**：2秒
...
```

---

## 5. 质量守卫与校验标准

1. **画面与声音严格隔离守卫**：
   - 严禁将人物台词或心理活动混写在画面描述中；
   - 摄影机只看得到画面，对白必须独立放在声音字段。
2. **多余镜头剪裁守卫（Fewer, Stronger Shots）**：
   - 如果两个连续中景镜头的戏剧目的重合，守卫规则触发合并为单镜头运动，保证节奏张弛有度。
3. **镜头数量上限截断阻断**：
   - 严格在 `maxShots` 预算内组织高潮与收尾，严禁在未完结处强行截断。
