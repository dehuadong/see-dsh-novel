# Agent Note: plan.compression —— 超预算压缩：子代理压缩，宿主校验

Status: proposed

## Problem

上下文超出预算时，源工程由 composer 里的 LLM 压缩可压缩层（`agents/composer.ts:162-300`）：protected 原样保留，compressible 压成一段 `compiledSource`，并把压缩前后的 token 与来源清单写进 `ChapterTrace.compression`；压缩失败就报错，从不静默截断。复刻的 `plan.context-select` 只记「超预算 N 字符」，没有压缩。

## Proposal

压缩仍由模型在 agent 循环里完成，宿主只校验：

1. `plan.context-select` 的 `assembleContext` 增加 `compression?: { text: string }` 选项；
2. 组装时若总字符超过 `maxChars`（默认 24000）而没给 `compression`，报错「上下文超预算，需要先压缩可压缩层」；给了 `compression` 则用它替换全部 compressible 条目（protected 不动），并在 trace 写：

```ts
compression: {
  compiledSource: string
  protectedSources: string[]
  compressedSources: string[]
  protectedTokens: number
  compressibleTokens: number
  budgetTokens: number
}
```

3. `story_context_package` 参数增加可选的 `compressedText`：主编让 composer 子代理在返回 selection 的同时返回压缩文本（子代理指令里说明「超预算时把可压缩层压成一段，protected 原样」），然后把两者一起交给工具；
4. 校验：`compressedText` 非空；未超预算时传了也接受并记录；超预算缺压缩则失败；压缩文本不包含 protected 来源的逐字复制不做机器校验（语义压缩）。

## Alternatives considered

**宿主自己做截断。** 简单。否掉：源工程从不截断；截断会悄悄丢事实。

**宿主直接调 LLM 压缩。** 少一步。否掉：选择与压缩都是同一个 composer agent 的行为，DSH 落点是模型 + subagent，宿主不自建 LLM 客户端。

**超预算不报错，只标记。** 现状。否掉：源工程超预算必须压缩成功或失败；标记等于放行超限上下文。

## Acceptance criteria

- 未超预算：不传 `compressedText` 正常组装，trace 无 `compression`。
- 超预算且无 `compressedText`：报错点名「需要压缩」，不返回 package。
- 超预算且有 `compressedText`：compressible 条目被替换为一条 `compiledSource`，protected 全部保留；trace.compression 六字段齐全，`compressedSources` 是被替换的来源，token 三个数与替换后的条目一致。
- `compressedText` 为空串时报错。
- 测试：`test/context-package.test.mjs` 补三种情况；`story_context_package` 参数 schema 增加 `compressedText`。
- 实现与证据：implementation `packages/see-dsh-novel/src/core/context-package.ts`；工具在 `src/pipelines/long/context-tool.ts`；realRun `artifacts/real-runs/plan.compression.json`。
- 真实运行：在超预算的工作区让主编调 `story_context_candidates`／`subagent`／`story_context_package`，先不传压缩看报错，再传子代理返回的压缩文本看 package 与 trace.compression。

## Risks

- 压缩质量取决于子代理；宿主只保证结构、替换范围与预算。
- 预算按字符估算，与源精确 token 计数有差距。
- 压缩文本是语义压缩，不做逐字保留检查；protected 是否被无损保留靠指令约束。
