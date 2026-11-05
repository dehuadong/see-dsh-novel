# Agent Note: runtime.boundary-check —— 源码只连 DSH，不连参考工程

Status: proposed

## Problem

`AGENTS.md` 的铁律写着：复刻只依赖 DSH 原生机制，不 import、不运行参考工程的代码。这条规则今天没有任何机械检查：`test/boundaries.test.mjs` 管的是**分层方向**（pipeline 之间、`client` 只认宿主客户端包、产品层不碰 `tools`），不检查依赖的**来源**。源码里出现 `import … from 'inkos/…'` 或相对路径钻进 `inkos/`、`deepseek-harness/`，测试与构建都可能照样通过——`inkos/` 与 `deepseek-harness/` 在本仓库是目录联接，本地解析得到，换台机器就断。

宿主包是另一半。现在 15 条 `from '@deepseek-ai/…'` 导入语句全是 `import type`，都在 `client/`；`plugin/` 一条也没有（另有三处是注释与一个字符串常量，不是导入）。这个状态靠的是约定，不是检查：`runtime.package-check` 的 `undeclared-import` 只能看到**产物里残留**的宿主 import（宿主半边的值导入会以裸说明符留在 `lib/agent.js`，因此会被抓到；`client` 半边的值导入会被内联，这条就看不见）。源码层面更早的反馈没有。

本行的脚本只回答一个问题：**这个源码树有没有连到 DSH 之外的东西**。它不重复 `package-check`（查 tarball 里残留了什么），也不重复 `boundaries.test.mjs`（查目录之间的依赖方向）。

## Proposal

### 一条脚本，一个纯函数

- `packages/see-dsh-novel/src/tools/boundary.ts`：纯函数 `boundaryProblems(files: Array<{ path, text }>)`，输入是「相对 `src/` 的路径 + 文件文本」，输出问题码列表；
- `scripts/check-boundary.mjs`：默认扫 `packages/see-dsh-novel/src`，也接受 `--root <dir>`（给真实运行的对照用），读 `.ts`／`.tsx`，调纯函数，打印问题、退出码。

与 `runtime.package-check` 同一形状：判定与遍历分开，判定拿合成文件直接测。

### 规则

说明符从三类语法里取：静态 `import … from 'X'`、`export … from 'X'`、`require('X')`／`import('X')`。注释里的「inkos」不算——规则只针对依赖。

| code | 判据 |
| --- | --- |
| `reference-import` | 说明符命中参考工程：`inkos`、`inkos/…`、`deepseek-harness`、`deepseek-harness/…`，或相对路径里出现 `../inkos`／`../deepseek-harness` |
| `host-value-import` | 静态 `from '@deepseek-ai/…'` 或 `require('@deepseek-ai/…')` 不是 `import type` 形式；在 `core/`／`pipelines/`／`tools/` 里同时命中层规则时，两条都报 |
| `host-import-outside-allowed-layers` | `@deepseek-ai/…` 出现在 `core/`、`pipelines/`、`tools/` 下的**静态导入语句**里（`client/` 与 `plugin/` 是允许的宿主类型层） |
| `dynamic-host-import` | `import('@deepseek-ai/…')` 动态导入：按值依赖对待，**只报这一条**（不再叠加层规则） |

三条判定规则、两点说明：

- **为什么 `tools/` 也要查**：它是仓库工具（不进产物），但它同样不该依赖宿主客户端包——工具跑在 Node 脚本里，`@deepseek-ai/dsh-client-*` 在那种运行时不存在。`packaging.ts` 里出现的 `'@deepseek-ai/dsh-agent-preset'` 是字符串常量，不是导入语句，规则不会误报。
- **为什么 `plugin/` 与 `client/` 放行 type-only**：预设的 agent 半边（`plugin/`）与浏览器半边（`client/`）都需要宿主的类型来编译；`import type` 在构建时被擦除，不留运行时依赖。

### 为什么值导入要拦

不是「会被内联」那么简单，两个半边行为不同（`scripts/bundle.mjs`）：

- 宿主半边外部化 `@deepseek-ai/*` 与 `node:*`。值导入会以裸说明符留在 `lib/agent.js` 里，而本包没有声明任何依赖——装到 profile 里就是一个解析不了的模块。`runtime.package-check` 的 `undeclared-import` 能抓到这一种；
- 浏览器半边只外部化 `react`。值导入会被内联进 `lib/client.js`，产物仍然能跑，但那份代码来自宿主包的内部实现，包的边界已经破了；`package-check` 看不见这一种。

`import { type X }`（内联 type）在 esbuild 下与 `import type` 一样会被擦除，所以这条**不是**运行时必需，而是全仓一个写法：`import type` 一眼可审，内联写法改一个词就变值导入。理由写在规则里，不假装它影响产物。

### 接进 `verify`

根 `package.json` 加 `"check-boundary": "node --import tsx scripts/check-boundary.mjs"`，`verify` 链：

```
typecheck → build → check-package → check-boundary → verify-notes → check-capabilities → test
```

### reference 指向规则的所有者

基础规则在 `AGENTS.md`：开头那段（不 import、不运行参考工程）与铁律 3（只用 DSH 运行时）。`AGENTS.md` 没有写「`@deepseek-ai` 只能 type-only」与「`deepseek-harness/` 也算参考树」——这两条是本行把意图落成可检查形式时的具体化，补充记在本文里；`AGENTS.md` 管意图，本文管可执行的判据，不互相抄。

本行**没有参考源工程证据**：它是项目护栏，不从参考工程映射而来。账本行的 `reference` 因此写 `none:项目护栏（AGENTS.md 前言与铁律 3）`，不用它冒充参考证据。

## Alternatives considered

**扩展现有的 `test/boundaries.test.mjs`。** 少一个脚本。否掉：那个测试的断言都是「某个目录只能 import 什么」，加「全仓不得出现 inkos」会让它同时承担两种职责；脚本能单独跑、能对任意 `--root` 跑，测试做不到。

**用 ESLint 的 `no-restricted-imports`。** 生态现成。否掉：本项目没有 ESLint 配置，为一条规则引入整套 lint 链路不划算；参考工程与 DSH 的边界是项目特有的，写在脚本里更直接。

**只查 `inkos`，不查 `@deepseek-ai` 值导入。** 更省。否掉：值导入是包边界被破的直接信号；`client` 现有用例已经认这条，全局补上才算有机械保证。

**允许 `import { type X }`。** 语法上确实擦除。否掉：统一成 `import type` 更好审查，代价只是写长一点。

**把规则写进 `AGENTS.md` 靠人遵守。** 零成本。否掉：铁律已经写了「只用 DSH 运行时」，仍然需要机械检查兜底；文档管意图，脚本管事实。

## Acceptance criteria

- `pnpm run check-boundary` 在当前源码树退出码 0，打印扫描的文件数。
- 合成文件 `import x from 'inkos/packages/core/x.js'` → `reference-import`；`import x from '../../inkos/x.js'` → `reference-import`；`import x from 'deepseek-harness/packages/y'` → `reference-import`。
- 合成文件 `import { z } from '@deepseek-ai/dsh-tools'` → `host-value-import`；`const z = require('@deepseek-ai/dsh-tools')` → `host-value-import`；`const z = await import('@deepseek-ai/dsh-tools')` → `dynamic-host-import`。
- 合成文件 `core/x.ts` 里 `import type {} from '@deepseek-ai/cordis'` → `host-import-outside-allowed-layers`；同样的行放在 `plugin/x.ts` 或 `client/x.tsx` 里不报；`tools/packaging.ts` 里只出现字符串 `'@deepseek-ai/dsh-agent-preset'`（没有导入语句）不报。
- 注释里出现「inkos」不算问题；`import type { X } from '@deepseek-ai/dsh-tools'` 不报。
- 有问题时退出码非零、stderr 每行一个 `code path: detail`。
- 账本行的 `reference` 改成 `none:项目护栏（AGENTS.md 前言与铁律 3）`，明示没有参考源证据；不改 `docs/dsh-mapping.md`（它只记机制映射）。
- 实现与证据：implementation `packages/see-dsh-novel/src/tools/boundary.ts`；consumer `packages/see-dsh-novel/test/boundary-check.test.mjs`；脚本 `scripts/check-boundary.mjs`、根 `package.json` 的 `verify` 链、`capabilities.yaml` 的 `reference`／implementation／consumer／realRun 字段同批更新；realRun `artifacts/real-runs/runtime.boundary-check.json`。
- 真实运行：`pnpm run check-boundary` 在真实源码树上通过；再用 `--root` 指向一个含 `import 'inkos/x'` 的临时目录，脚本报 `reference-import` 并退出 1。

## Risks

- 只扫描 `.ts`／`.tsx`：`.mjs` 脚本里如果出现参考工程 import 不会被这条检查覆盖（脚本本身不 import 参考工程，但这是缺口）。
- 说明符用正则匹配：把包名起成 `my-inkos-wrapper` 之类会误报（当前没有这种包，也没有计划）。
- `import { type X }` 被判为值导入：这是写法约定，不是运行时事实；团队要按 `import type` 写。
- 动态导入只报不拦：报出来之后仍可能换个写法绕过；检查的是「出现」而不是「不可执行」。
- 与 `runtime.package-check` 有分工但也有重叠：一个看 tarball 里残留的宿主 import，一个看源码的依赖来源；`plugin/` 的值导入两边都会报，这是有意的双保险。
