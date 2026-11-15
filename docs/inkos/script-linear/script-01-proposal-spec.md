# 线性剧本阶段一：立项提议、格式选型与创作规格书（Proposal & Script Spec）深度分析报告

> **源工程**：`inkos/`（Profile: `script`，能力行: `script.spec`）  
> **核心源文件**：
> - `inkos/packages/core/src/pipeline/script-storyboard-runner.ts` (`runScriptCreation`, `renderScriptSpec`)
> - `inkos/packages/core/src/agents/script-storyboard.ts` (`ScriptCreationInput`, `formatScriptTarget`)
> - `inkos/packages/core/src/agent/agent-tools.ts` (`script_create`, `propose_action`)
> - `inkos/packages/core/src/harness/builtin-profiles.ts` (`id: "script"`)
> - `inkos/packages/core/src/__tests__/script-storyboard.test.ts`

---

## 1. 阶段概述

纯线性剧本创作的第一阶段是**从自然语言构思或原著小说中确立剧本的物理格式、篇幅体量与制作边界**。剧本具有强烈的摄制与排演属性，在动笔前必须锁定目标媒介（电影长片、竖屏短剧、分集电视剧、动画脚本）以及集数和时长。InkOS 通过 `propose_action(script_create)` 生成包含自包含指令的确认卡，并在落盘时渲染出不可动摇的《剧本创作规格书》（`script-spec.md`），作为后续分场和正文创作的法定准绳。

---

## 2. 执行主体与角色编排

- **人类作者 / 编剧（Author / Screenwriter）**：提供初步故事题材或小说素材，指定目标类型、集数与单集时长，并在 Studio 界面确认卡上执行批准（Approval）。
- **Creative Assistant Agent**：通过交互工具引导作者澄清戏剧核心，封装 `script_create` 动作。
- **PipelineRunner**：执行 `runScriptCreation`，负责解析源文本（`resolveSourceText`）、检查作品唯一性（`ensureUnwrittenWork`），并将规格书持久化到磁盘。

---

## 3. 输入契约与上下文来源

- **源素材（Source Material）**：
  - `sourceText`：用户直接粘贴的一句话大纲、故事概要或小说原著章节；
  - `sourcePath`：工作区内引用的原著小说 Markdown 文件路径；
- **目标交付格式（targetFormat）**：
  - `vertical_short_drama`：竖屏微短剧（单集 1-2 分钟，强反转高节奏）；
  - `feature_film`：电影长片剧本（90-120 分钟标准三幕式）；
  - `tv_series_episode`：分集电视剧剧本（单集 40-45 分钟）；
  - `anime_script`：动画分集剧本；
- **工程约束参数**：
  - `episodeCount`（集数）；
  - `episodeDuration`（单集时长，如 "90s", "45min"）；
  - `language`（`zh` | `en`）；
  - `requirements`（作者专项要求，如“重在悬疑反转，强化男女主试探”）。

---

## 4. 输出产物与权威形态

- **剧本创作规格书（works/<projectId>/source/script-spec.md）**：
  人类可读且格式固定的规范 Markdown 文档，是本工程唯一的创作规格权威。包含四个法定部分：
  1. `## 目标（Goal）`：交付类型、集数、单集时长、原素材来源；
  2. `## 作者原始请求（Author Request）`：不可擅改的作者原始诉求；
  3. `## 创作任务与方案（Production Brief）`：展开的编剧任务说明；
  4. `## 源素材摘要（Source Material Summary）`：原素材的内容梗概。
- **全局工程清单更新（WorkManifest）**：
  注册 `profileId: "script"`，声明工件集合 `artifactKinds: ["script-spec", "script"]`。

---

## 5. 核心流转机制与关键算法

### 5.1 提案动作自包含封套
编剧助手调用 `propose_action` 工具：
```typescript
// packages/core/src/agent/agent-tools.ts
await proposeActionTool.execute(toolCallId, {
  action: "script_create",
  title: "《冷库账页》竖屏微短剧剧本",
  summary: "12集悬疑微短剧，单集90秒，女主通过冷库发票调查父亲意外身亡真相。",
  instruction: "编写12集竖屏微短剧剧本《冷库账页》，主打强情节反转与高密度冲突。",
  // 结构化 execution args
});
```
`instruction` 必须自包含，确保在切换会话执行时无记忆依赖。

### 5.2 规格文档渲染引擎（renderScriptSpec）
```typescript
// packages/core/src/agents/script-storyboard.ts:182
export function renderScriptSpec(input: ScriptCreationInput): string {
  return [
    `# ${input.title} 剧本创作规格`,
    "",
    "## 目标",
    `- 交付类型：${formatScriptTarget(input.targetFormat)}`,
    input.episodeCount ? `- 集数/段落数：${input.episodeCount}` : "- 集数/段落数：未指定，按素材和用户要求判断",
    input.episodeDuration ? `- 单集/单段时长：${input.episodeDuration}` : "- 单集/单段时长：未指定",
    input.sourceKind ? `- 原素材：${input.sourceKind}` : "- 原素材：用户输入/对话需求",
    "",
    ...productionBrief(input, "zh"),
    "",
    "## 源素材摘要",
    summarizeSourceForSpec(input.sourceText),
  ].join("\n");
}
```

### 5.3 作者诉求与制作方案的双层隔离（productionBrief）
- `authorRequest`：记录作者的原始意图（如“必须保留父亲的怀表道具”），属于最高约束；
- `requirements`：由 Agent 补充的编剧工艺方案（如“每集结尾必须设置悬念翻转”），允许在作者约束内动态调整。

---

## 6. 数据结构与 Schema 详述

### 6.1 `ScriptCreationInput` 接口
```typescript
// packages/core/src/agents/script-storyboard.ts:8
export interface ScriptCreationInput {
  readonly authorRequest?: string;        // 作者原始输入
  readonly title: string;                 // 剧本标题
  readonly sourceKind?: string;           // 素材类型（小说章节/原创概念）
  readonly targetFormat?: ScriptTargetFormat; // 目标格式
  readonly sourceText?: string;           // 原素材完整正文
  readonly requirements?: string;         // 编剧创作要求
  readonly episodeCount?: number;         // 集数
  readonly episodeDuration?: string;      // 单集时长
  readonly language?: "zh" | "en";        // 语言
}
```

---

## 7. 质量门禁与强校验规则

1. **工作区防覆盖断言（ensureUnwrittenWork）**：
   - 检查 `works/<projectId>/`，若该剧本工程已定稿或已存在正文文件，抛出明确异常，防止误操作覆盖已有剧本资产。
2. **格式合法性匹配（formatScriptTarget）**：
   - 输入的格式标识必须能被识别（如 `vertical_short_drama` 映射为“竖屏微短剧”，`feature_film` 映射为“电影长片”），非法格式拒绝通过。

---

## 8. 一致性与因果链保障

- **首个工件权威（First Artifact Anchor）**：
  渲染生成的 `script-spec.md` 会在剧本正文动笔前先行持久化，并纳入 WorkManifest 版本跟踪。正文生成时强制将该规格全文作为 User Prompt 的第一节载入，锁定剧本集数与时长上限。

---

## 9. 创作技能与专业方法论

技能 `inkos-script-writing` 的开篇要求：
- **格式即语言**：微短剧以秒为单位计算信息密度；电影以幕（Act）为单位计算情绪弧光。选定格式后，后续一切场景节奏均必须服从该格式的工业物理规律。

---

## 10. 测试覆盖与验证场景

核心测试位于 `inkos/packages/core/src/__tests__/script-storyboard.test.ts`：
- **规格参数保真度断言**：测试传入特定集数（12集）和业务要求（“调查线七成，家怨三成”），断言生成的 `script-spec.md` 包含完全一致的文字表述。
