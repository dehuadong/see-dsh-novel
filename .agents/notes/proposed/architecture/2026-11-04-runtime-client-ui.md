# Agent Note: runtime.client-ui —— 面板客户端基线

Status: proposed

## Problem

浏览器半边现在是一个手写脚本：`src/plugin/client.ts` 在导入时调 `window.__ModuleLoader__.load`，工厂里 `const React = require('react')`，全部界面用 `React.createElement` 拼，props 形状（`ViewProps`、`ClientContext`、`ResourceSnapshot`）是手写接口，样式是内联对象，仓库里也没有声明 `react` 或 `@types/react`。

它能跑（真实运行里「作品」标签出现过），但每加一个面板行都要在这份手写结构上继续堆：没有 JSX、没有编译期检查的 props、没有独立的 client 类型检查、样式散在组件里。

参考工程的工作台是一个独立的 React 应用（`inkos:packages/studio/src/App.tsx`、`main.tsx`、`index.css`，Vite 构建）；本项目不另起前端应用，等价物是 DSH 客户端插件里的 `conversation.view` 面板。三个 DSH 写作插件（`dsh-novel`、`oh-story-dsh`、`webnovel-writer`）的形态一致：`src/client/index.ts` 里 `export const inject` + `export function apply(ctx)`，`ctx.slots.inject` / `ctx.slots.register` 注册，`.tsx` 组件，`ConvViewProps` 从 `@deepseek-ai/dsh-client-ui-conversation/client` 引入，单独的 `tsconfig.client.json`，`react` 同时进 peer 与 dev。

## Proposal

### 目录：`src/client/`

- `index.ts`：`export const inject = ['slots', 'sessions']`、`export function apply(ctx: Context)`；负责注册哨兵、按预设条件注册「作品」视图、安装样式。视图注册的判定逻辑（哨兵 → `eligible`、`slots.inject` → `declared`、两者都真才注册）原样搬过来，不改行为。
- `StoryView.tsx`：面板主体。props 是 `ConvViewProps & InjectFace<ViewInjected>`——`sessionId`／`useSessions` 来自 slot 的 owner props，`useResource` 是全局标准 props（`GlobalStandardProps`，`ConvViewProps` 一并带上），`canCommand`／`runCommand` 来自注册时的 `inject` 工厂，两半拼起来才是完整 props；`inject` 工厂写成带返回类型的函数，让 `register({ …, inject }, StoryView)` 的组件与面之间对得上。
- `EligibilitySentinel.tsx`：挂在 `conversation.session.header.utilities` 的空组件，只上报预设是否匹配。
- `styles.ts`：`installStyles()` 用 `document.createElement('style')` 建一个样式元素挂到 `document.head`，返回清理函数；`ctx.effect` 里调用。不用 CSS 文件——单文件产物没有 CSS 通道。
- `types.ts`：只放本项目自己的语义类型（命令结果的四种映射、`ViewInjected` 的形状）；`ConvViewProps`、`InjectFace`、`Context`、`ctx.sessions`、`useResource` 全部用宿主包的真类型。现在手写清单里的漂移（`canSubmit` 与代码里的 `canCommand`）由真类型消灭。

### 构建：CJS + 模块加载器包裹

`window.__ModuleLoader__.load({ id, factory: (require) => { … return module.exports } })` 就是 DSH 客户端产物的正式形态（`packages/client/tsdown.client.ts` 的 banner/footer 模板）。`scripts/bundle.mjs` 的 client 构建改成：

- esbuild `format: 'cjs'`、`platform: 'browser'`、`jsx: 'automatic'`、`external: ['react', 'react/jsx-runtime']`；
- banner 写 `window.__ModuleLoader__.load({ id: "see-dsh-novel", factory: (require) => { var module = { exports: {} }; var exports = module.exports;`，footer 写 `return module.exports; } });`；
- 入口 `src/client/index.ts` 用普通 `export`，不再自己调加载器；
- 残留检查同时覆盖 `from "./…"` 与 `require("./…")`：CJS 产物里前者已经不出现，只查旧形态等于没查。

`react` 与 `react/jsx-runtime` 由宿主模块表提供（`packages/client/web/src/platform.ts` 的 `PLATFORM_MODULES` 两项都在），产物不打包它们。

### 类型检查：单独的 client 配置，真类型

新增 `packages/see-dsh-novel/tsconfig.client.json`（`jsx: 'react-jsx'`，`include: ['src/client/**/*.ts', 'src/client/**/*.tsx']`），并把**主配置**改成 `exclude: ['src/client/**']` 且开启 `jsx: 'react-jsx'`——主配置原本 `include: ['src/**/*.ts']` 会直接收进 `src/client/index.ts`，它的 `.tsx` 导入在没有 `--jsx` 的主程序里会报 TS17004；而 `tsx` 读的是 `tsconfig.json`，JSX 选项必须写在那里，测试里的 `.tsx` 才能编译。

`pnpm run typecheck` 依次跑主配置与 client 配置。

### 依赖：宿主类型进 devDependencies

根 `devDependencies` 增加：

| 包 | 用途 |
| --- | --- |
| `react@18.3.1`、`@types/react@18` | JSX 与类型 |
| `@deepseek-ai/cordis@4.0.5` | `apply(ctx)` 的 `Context` |
| `@deepseek-ai/dsh-client-ui-conversation@0.2.1-rc.5` | `ConvViewProps` 与 slot 声明 |
| `@deepseek-ai/dsh-client-ui-slots@0.2.1-rc.5`、`@deepseek-ai/dsh-client-ui-renderer@0.2.1-rc.5`、`@deepseek-ai/dsh-client-ui-session@0.2.1-rc.5` | slot 注册面、`InjectFace`、`useSessions` 的声明合并 |
| `@deepseek-ai/dsh-client-resources@0.2.1-rc.5` | `useResource` 作为标准 props 的声明 |
| `@deepseek-ai/dsh-api-session-controller@0.2.1-rc.5` | `Context.sessions`（`ctx.sessions.binding`）的声明 |
| `react-test-renderer@18.3.1`、`@types/react-test-renderer@18` | 组件测试 |

版本对齐**已安装的宿主**（0.2.1-rc.5；`app.asar` 里就是这个版本，cordis 4.0.5）。仓库里链接的 DSH 源码工程是 0.2.2-alpha.2，不拿它当对齐目标。这些包只参与构建、类型检查与测试，运行时由宿主模块表提供，所以进 devDependencies，不进 `dependencies`。

### 测试

- `test/client.test.mjs` 用 `react-test-renderer` 渲染 `StoryView` 与哨兵：断言三态文案、按钮只在预设匹配时出现、提交后的可见回执、命令结果的四种映射；注册逻辑（条件注册与注销）用假 ctx 直接调 `apply` 验证。
- 测试环境补一个最小的 `document` 桩（`createElement`、`head.appendChild`、`removeChild`），断言样式元素被挂上、处置后被移除——`react-test-renderer` 不带 DOM，Node 里没有 `document`，不补桩这一行测试直接抛错。
- 新增构建冒烟：用假的 `window.__ModuleLoader__` 与 `require` 求值 `lib/client.js`，断言工厂返回 `{ inject, apply }`、`apply` 会注册哨兵、产物里没有 `require("./`。

### 不改变的行为

界面文案、三种工作区状态、提交后的回执、按预设条件注册与注销、命令结果的四种映射，全部保持现有语义；「角色档案面板」之类的新内容属于后续 `panel.*` 行。

## Alternatives considered

**继续用 `React.createElement` 手写，只补类型。** 改动最小。否掉：每加一个视图都要手写元素树，props 没有编译期检查；三个参考插件都用 JSX + 独立 client 配置，没有理由逆着来。

**手写 `ViewProps` 而不装宿主类型包。** 少四个 devDependencies。否掉：手写声明证明不了宿主契约，已经漂过一次（`canSubmit` vs `canCommand`）；装真类型才能让「props 写错就编译失败」成立。

**把客户端拆成独立包（`packages/see-dsh-novel-client`）。** 边界更干净。否掉：现在只有一个视图，拆包会多一份构建与版本；等面板行多起来再拆。

**引入 CSS Modules / 构建期 CSS。** 样式更好管。否掉：当前产物是单文件脚本，没有 CSS 通道；DSH 的样式方案要求客户端走它自己的构建，属于后续行。

## Acceptance criteria

- `src/client/` 下的 `index.ts`、`StoryView.tsx`、`EligibilitySentinel.tsx`、`styles.ts`、`types.ts` 存在；`apply` 与注册逻辑的语义与现在一致。
- `StoryView` 的 props 类型来自宿主包：`ConvViewProps` 提供 `sessionId`／`useSessions`／`useResource`，`InjectFace<ViewInjected>` 提供 `canCommand`／`runCommand`；把任一名字写错，`pnpm run typecheck` 的 client 配置失败，而正确的名字必须通过。
- `pnpm run build` 产出 `lib/client.js`，形态是 `window.__ModuleLoader__.load({ id, factory })`，工厂返回 `{ inject, apply }`；产物里没有内联 React、没有 `require("./…")`。
- `pnpm run typecheck` 跑两个配置；主配置不包含 `src/client/**`，client 配置包含。
- `test/client.test.mjs` 用 `react-test-renderer` 断言三态、按钮可见性、提交回执、命令结果映射；样式元素挂载与移除；条件注册的注册与注销。
- 构建冒烟断言产物形态与工厂返回值。
- 真实运行：写作会话里「作品」标签仍在、其它预设会话没有该标签、按钮仍能把命令提交出去。
- 实现与证据：implementation `packages/see-dsh-novel/src/client/index.ts`、consumer `packages/see-dsh-novel/test/client.test.mjs`、realRun `artifacts/real-runs/runtime.client-ui.json`。

## Risks

- 新增一批 devDependencies 需要一次 `pnpm install`（react、宿主客户端类型包、测试渲染器）；装不上这一行就停，不退回手写元素树。
- 宿主类型包要跟 DSH 版本对齐（当前 0.2.1-rc.5）：升宿主时同批升这几个 devDependencies，否则 props 类型会与运行时漂移。
- `react-test-renderer` 在 React 18 下已标记弃用，但仍是参考插件用的方案；将来跟随 DSH 的前端测试方式再换。
- 构建从 IIFE 改成 CJS + 包裹，产物形态变了；靠构建冒烟与真实运行两道证据守住。
- 样式走 `<style>` 注入，拿不到 DSH 的 `--dsw-*` 令牌体系；面板外观与内置界面会有差异，后续面板行再对齐。
