# 阶段五：正文创作（Writing / Drafting）深度分析报告

> **源工程**：`inkos/`  
> **核心源文件**：
> - `inkos/packages/core/src/agents/writer.ts`
> - `inkos/packages/core/src/agents/writer-tool.ts`
> - `inkos/packages/core/src/agents/writer-prompts.ts`
> - `inkos/packages/core/src/agents/style-guide.ts`
> - `inkos/packages/core/src/utils/length-metrics.ts`
> - `inkos/packages/core/src/utils/chapter-document.ts`
> - `inkos/packages/core/src/utils/narrative-control.ts`
> - `inkos/packages/core/src/models/length-governance.ts`
> - `inkos/packages/core/src/pipeline/runner.ts`
> - `inkos/packages/core/skills/inkos-long-writing/SKILL.md`
> - `inkos/packages/core/skills/inkos-long-writing/references/scene-dialogue-and-length-budget.md`
> - `inkos/packages/core/skills/inkos-long-writing/references/reader-contract-and-progression.md`
> - `inkos/packages/core/src/__tests__/length-metrics.test.ts`
> - `inkos/packages/core/src/__tests__/long-form-completion.test.ts`

---

## 1. 阶段概述

正文创作阶段（Writing）是文学创作成品化的核心执行环节。该阶段的定位是：**严格在受控上下文（`ContextPackage`）与章前规划（`ChapterMemo`）的约束下，由主笔 Agent（WriterAgent）输出具备强叙事张力、风格一致且符合严格字数规格的初稿正文**。在架构原则上，Writer 被剥夺了所有外部工具写权限，是一个纯粹的“受控内容生成器”，杜绝模型在写作中偷改设定、擅自抹消伏笔。

---

## 2. 执行主体与角色编排

- **WriterAgent（主笔子代理）**：扮演专业网络小说主笔，接收场景节拍与人物台账，负责具体的行文描写、对话铺陈与氛围渲染。
- **PipelineRunner**：负责上下文打包、篇幅参数装配（`LengthSpec`）、流式进度监控（`OnStreamProgress`）以及将模型产出转交后续审稿管道。
- **StyleGuide Compiler**：动态编译风格指南，注入目标语言的用词习惯、句式偏好和节奏特征。

---

## 3. 输入契约与上下文来源

- **ChapterMemo（章纲指令）**：包含当前章节序号、核心情节目标（`goal`）以及分解后的场景链。
- **ContextPackage（受治理上下文）**：
  - 核心约束：世界观规则、主角性格锁定条目；
  - 局部记忆：前情提要、上一章末尾现场（保证无缝衔接）；
  - 登场角色卡：人物动机、当下情绪、秘密与能力边界。
- **LengthSpec（篇幅规格书）**：目标字数、计数模式（中文字数 / 英文单词）、硬性上下限约束。
- **StyleGuide（风格规范）**：禁止空洞排比、模式化心理独白等 AI 腔调。

---

## 4. 输出产物与权威形态

- **首版章节草稿文本（Draft Content）**：符合 Markdown 规范的章节正文。
- **章节文档载荷（ChapterDocument）**：包含标题（Title）与正文主体（Body）。
- **字数遥测数据（Length Metrics）**：由系统底层算法（非模型自报）精确计算出的实际字数。
- **Token 消耗回执（TokenUsageSummary）**：`promptTokens`、`completionTokens` 与 `totalTokens`。

---

## 5. 核心流转机制与关键算法

### 5.1 提示词组装与隔离机制
`writer-prompts.ts` 构建严密的系统提示词，确立“铁律”：
- **禁止越界造设**：未在 ContextPackage 中出现的超自然力量或关键背景严禁凭空创造；
- **展现优于讲述（Show, Don't Tell）**：通过具体感官细节、角色的微表情与行动体现冲突，严禁大段灌输设定；
- **场景三要素完整性**：每一个细分场景必须闭环（目标-挫折-反应）。

### 5.2 严格字数统计与硬边界（Length Metrics）
```typescript
// packages/core/src/utils/length-metrics.ts
export function countChapterLength(content: string, countingMode: LengthCountingMode): number {
  // 1. 剥离 Markdown Frontmatter 与元数据
  const normalized = stripMarkdownMetadata(content);

  // 2. 区分语言进行精确统计
  if (countingMode === "en_words") {
    const words = normalized.match(/[A-Za-z0-9]+(?:'[A-Za-z0-9]+)?/g);
    return words?.length ?? 0;
  }
  // 中文模式：彻底剔除空白与换行符，只计有效文字符号
  return normalized.replace(/\s+/g, "").length;
}
```
- **中文默认标准**：`DEFAULT_CHAPTER_LENGTH_ZH = 3000` 字；
- **英文默认标准**：`DEFAULT_CHAPTER_LENGTH_EN = 2000` 词；
- **强制范围断言（assertChapterLength）**：若设定了 `minChapterLength` 或 `maxChapterLength` 且超出范围，抛出 `CHAPTER_LENGTH_OUT_OF_RANGE` 强制触发后续修订。

### 5.3 章节文档标准格式（Chapter Document）
正文必须能被 `renderChapterDocument` 和 `chapterDocumentBody` 结构化解析：
```markdown
# 第1章 灵矿异动

（正文第一段，承接上章结尾环境描写...）
```

---

## 6. 数据结构与 Schema 详述

### 6.1 `WriteChapterInput` 与 `WriteChapterOutput`
```typescript
// packages/core/src/agents/writer.ts
export interface WriteChapterInput {
  readonly book: BookConfig;
  readonly bookDir: string;
  readonly chapterNumber: number;
  readonly chapterIntent?: string;
  readonly chapterMemo?: ChapterMemo;
  readonly contextPackage: ContextPackage;
  readonly lengthSpec: LengthSpec;
  readonly wordCountOverride?: number;
  readonly temperatureOverride?: number;
}

export interface WriteChapterOutput {
  readonly title: string;
  readonly content: string;
  readonly wordCount: number;
  readonly tokenUsage?: TokenUsageSummary;
}
```

### 6.2 `LengthSpec` Schema
```typescript
// packages/core/src/models/length-governance.ts
export interface LengthSpec {
  readonly target: number;
  readonly countingMode: "zh_chars" | "en_words";
  readonly minChapterLength?: number;
  readonly maxChapterLength?: number;
}
```

---

## 7. 质量门禁与强校验规则

1. **正文非空硬断言（assertChapterContentNotEmpty）**：
   - 生成内容为空或仅包含空白字符，直接抛出 `draft generation returned empty content` 致命错误。
2. **零工具写权限原则（Zero-Tool Capability）**：
   - Writer 运行环境中不注入任何写文件或修改数据库的工具。它只能通过文本流向标准输出提交结果，从物理上杜绝污染工作区。
3. **字数超界校验（Length Delivery）**：
   - 若命中 `CHAPTER_LENGTH_OUT_OF_RANGE`，生成结果被打上 `needs_revision` 标记，必须在修订阶段裁定或重写。

---

## 8. 一致性与因果链保障

- **时空物理站位继承**：
  上章末尾若角色在“地牢昏迷”，本章开头第一句话必须处于“地牢”环境或交待“移送过程”，禁止出现地点凭空瞬移。
- **能力边界绝不逾越**：
  若角色卡记录主角当前修为为“练气三层”，正文中的破坏力和神识范围严格限制在设定值内，禁止临场突破未经规划的高阶法术。

---

## 9. 创作技能与专业方法论

技能 `inkos-long-writing` 核心参考文献：
- **`scene-dialogue-and-length-budget.md`**：
  - 对话必须承担“双重功能”：既传递信息，又暴露权力关系或潜在谎言；
  - 篇幅预算由场景容量支撑，绝不能依靠水环境描写、反复心理自言自语凑字数。
- **`reader-contract-and-progression.md`**：
  - 核心事件必须在正文中产生“不可逆后果”（关系破裂、底牌曝光、获得新线索、失去庇护）。

---

## 10. 测试覆盖与验证场景

核心测试位于 `inkos/packages/core/src/__tests__/length-metrics.test.ts` 与 `long-form-completion.test.ts`：
1. **字数算法精准度测试**：针对中英混排、标点符号、Markdown 标题、代码块进行测试，断言与主流网络文学平台计字完全对齐。
2. **字数超限拦截测试**：构造一个 500 字的极短初稿，在设定下限为 2000 字时，断言抛出 `CHAPTER_LENGTH_OUT_OF_RANGE`。
3. **长文本流式拼接完整性**：验证长文本流式响应下各 Chunk 的组装正确性，断言无丢包与截断。
