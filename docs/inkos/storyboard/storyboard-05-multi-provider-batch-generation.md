# 分镜与生图阶段五：文生图底层多 Provider 调度与批量生图引擎（Multi-Provider Generation Plumbing）深度分析报告

> **源工程**：`inkos/`（LLM Image Core: `cover-providers.ts`，Pipeline: `short-fiction-runner.ts`，Tool: `node-image.ts`）  
> **核心源文件**：
> - `inkos/packages/core/src/llm/cover-providers.ts` (`COVER_PROVIDER_PRESETS`, `normalizeCoverModelReference`)
> - `inkos/packages/core/src/pipeline/short-fiction-runner.ts` (`generateImageFromPrompt`, `resolveCoverGenerationRequest`)
> - `inkos/packages/core/src/interactive-film/node-image.ts` (`generateNodeImage`, `defaultNodeImageDeps`)
> - `inkos/packages/core/src/__tests__/cover-model-reference.flow.test.ts`

---

## 1. 阶段概述

文生图底层多 Provider 调度与批量生图引擎（Multi-Provider Generation Plumbing）是**将结构化分镜提示词（imagePrompts）编译并下发给外部大模型/扩散模型 API，批量生成视觉图像资产的核心基础设施**。

在实际生产中，不同用户接入的生图服务各不相同：有的使用 OpenAI（DALL-E 3），有的使用 Google（Imagen 3），有的使用自建或第三方的 SD/Flux 兼容网关（如 `kkaiapi` 或各类 OneAPI/NewAPI 代理）。如果上层分镜代码直接硬编码某一个 SDK，将导致严重的供应商锁定与维护地狱。InkOS 实现了**跨平台文生图统一适配层**，兼顾了多渠道路由、尺寸自适应、Base64 安全解码以及批量并发容错。

---

## 2. 统一生图服务预设与协议路由（CoverProviderPresets）

在 `inkos/packages/core/src/llm/cover-providers.ts` 中，系统预设并归一化了主流文生图提供商：

```typescript
export type CoverProviderId = "kkaiapi" | "openai" | "google";

export interface CoverProviderPreset {
  readonly service: CoverProviderId;
  readonly label: string;
  readonly baseUrl: string;
  readonly api: "images" | "responses";      // 核心 API 协议分支
  readonly defaultModel: string;
}

export const COVER_PROVIDER_PRESETS: readonly CoverProviderPreset[] = [
  {
    service: "kkaiapi",
    label: "KkaiAPI",
    baseUrl: "https://api.kkaiapi.com/v1",
    api: "images",                          // OpenAI /images/generations 兼容协议
    defaultModel: "dall-e-3",
  },
  {
    service: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    api: "images",
    defaultModel: "dall-e-3",
  },
  {
    service: "google",
    label: "Google",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    api: "responses",                       // Google 生成式多模态协议
    defaultModel: "imagen-3.0-generate-002",
  },
];
```

### 协议自动判别算法（resolveCoverEndpoint）：
系统不仅支持预设，还支持任意自定义端点：
- 若 URL 包含 `/responses` $\rightarrow$ 自动切入 Google 生成式图像协议；
- 若 URL 包含 `/images/generations` $\rightarrow$ 自动切入 OpenAI 图像协议；
- 环境变量优先级覆盖：`INKOS_COVER_BASE_URL` > `INKOS_COVER_ENDPOINT` > 工程本地配置。

---

## 3. 生图执行引擎与响应解析（generateImageFromPrompt）

在 `short-fiction-runner.ts` 中，核心生图函数封装了从 HTTP 请求到二进制 Buffer 落盘的完整闭环：

### 3.1 OpenAI Images 协议流转分支
```typescript
if (request.api === "images") {
  const response = await fetch(`${request.baseUrl}/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${request.apiKey}`,
    },
    body: JSON.stringify({
      model: request.model,
      prompt,
      n: 1,
      size,                            // 如 "1024x1792" (9:16), "1792x1024" (16:9), "1024x1024"
      response_format: "b64_json",     // 强制要求 Base64 返回，规避公网临时图片链接过期问题
    }),
    signal,
  });
  const data = await response.json();
  const imageBase64 = data.data?.[0]?.b64_json;
  return { buffer: Buffer.from(imageBase64, "base64"), extension: "png" };
}
```

### 3.2 Google Responses 协议流转分支
```typescript
if (request.api === "responses") {
  // 针对 Google Imagen/Gemini 专有 REST 格式调用
  // 校验 response.candidates[0].content.parts 提取图片字节并返回
}
```

---

## 4. 批量切镜生图与异常隔离策略

在对一个拥有 20 个镜头（`shot-001` 到 `shot-020`）的分镜工程执行生图时，InkOS 采取了以下高可用保障：

1. **单镜头故障不穿透（Fault Isolation）**：
   - 某一个镜头的 Prompt 如果触发了云端安全审核（Content Moderation / NSFW Filter）或发生网络超时，系统不会导致整个分镜流水线崩溃；
   - 系统捕获该异常，在 `assets.json` 中将该变体标记为 `status: "failed"`，并写入 `error: "Safety policy violation on prompt..."`；
   - 其余镜头继续并发生成，保证资产交付率最大化。
2. **多尺寸与画幅严格自适应（Aspect Ratio Alignment）**：
   - 将第一阶段规格书中的 `aspectRatio` 映射为底层生图引擎的合法像素分辨率：
     - `16:9` $\rightarrow$ `1792x1024`（横版影院级）；
     - `9:16` $\rightarrow$ `1024x1792`（微短剧竖屏）；
     - `1:1` $\rightarrow$ `1024x1024`（方形画幅）。
3. **图生图参考垫图支持（ImageReference Buffer Injection）**：
   - `ImageReference` 接口支持向生图请求注入前序关键角色的基准面孔或场景垫图 Buffer，利用 IP-Adapter / 垫图控制提升人物跨镜头的形象一致性。

---

## 5. 二进制文件安全落地（writeBinary）

生图产物直接通过 `node:fs/promises` 写入目标目录，严禁通过文本编码转换造成图片字节损坏：

```typescript
const shotPath = join(args.baseDir, "assets", "generated", `${shotId}_v1.${extension}`);
await writeBinary(options.projectRoot, shotPath, buffer);
```
生成完成后，回写 `assets.json`，将该变体的 `status` 从 `pending` 推进为 `generated`。
