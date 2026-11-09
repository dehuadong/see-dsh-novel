# Agent Note: plan.compression —— 超预算压缩：子代理压缩，宿主校验

Status: implemented

> 部分被 [2026-11-09-plan-compression-budget.md](2026-11-09-plan-compression-budget.md) 取代：模型窗口派生、D25 memory 分组、task spool、compressionTask／分块／重压与 trace 六字段以新篇为准；本篇保留早期 `assembleContext` 压缩入口的历史决定。

## Problem

上下文超出预算时，源工程由 composer 里的 LLM 压缩可压缩层：protected 原样保留，compressible 压成一段 `compiledSource`，把压缩前后的 token 与来源清单写进 `ChapterTrace.compression`；压缩失败就报错，从不静默截断。复刻的上下文装配只记「超预算」，没有压缩。

## Decision

`packages/see-dsh-novel/src/core/context-package.ts` 的 `assembleContext` 增加可选 `compression: { text }`：

- 可用输入预算 = `contextWindowTokens - reservedOutputTokens`（都缺失时不压缩，与源一致）；总 token 超过预算且没给压缩 → 抛错「上下文超预算 N tokens，需要先压缩可压缩层」，不返回 package；protected 自身超预算 → 抛错「不压缩 protected」；
- 给了压缩 → 校验非空；把全部 compressible 条目替换为一条 `compiled:context`；protected 原样保留；trace 写 `compression` 六字段（`compiledSource`／`protectedSources`／`compressedSources`／`protectedTokens`／`compressibleTokens`／`budgetTokens`，`budgetTokens` 就是可用输入预算）；`notes` 记压缩条数；
- 未超预算时传了压缩也接受，但只在实际替换时写 trace。

`story_context_package` 参数增加可选 `compressedText`，透传为 `compression.text`；压缩文本由 composer 子代理在返回 selection 的同时给出（子代理指令要求「超预算时把可压缩层压成一段，protected 原样」）。

## Alternatives considered

**宿主截断。** 否掉：源工程从不截断，截断会静默丢事实。

**宿主裸调 LLM 压缩。** 否掉：压缩与选择都是同一个 composer agent 的行为；DSH 落点是模型 + subagent。

**超预算只标记放行。** 否掉：源工程必须压缩成功或失败。

## Consequences

收益：超预算不再被静默放行；compressible 层被压缩成一段，protected 不动，trace 保留压缩来源与预算数字。

验证见 `test/context-package.test.mjs`：未超预算不压缩、超预算缺压缩报错、有压缩时替换与 trace 六字段、空压缩文本报错。

代价与已知限制：

- 压缩质量取决于子代理；宿主只保证结构、替换范围与预算。
- 预算是 token 估算：`contextWindowTokens` 需由调用方给出（通常来自模型窗口），估算与实际 tokenizer 有差距。
- 压缩文本是语义压缩，不做逐字保留检查。
- 真实运行需要在超预算的工作区触发压缩；普通小工作区不会进入压缩分支。
