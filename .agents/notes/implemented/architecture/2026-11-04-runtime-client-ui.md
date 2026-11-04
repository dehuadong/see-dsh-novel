# Agent Note: runtime.client-ui —— 面板客户端基线

Status: implemented

## Problem

浏览器半边现在是一个手写脚本：`src/plugin/client.ts` 在导入时调 `window.__ModuleLoader__.load`，工厂里 `const React = require('react')`，全部界面用 `React.createElement` 拼，props 形状（`ViewProps`、`ClientContext`、`ResourceSnapshot`）是手写接口，样式是内联对象，仓库里也没有声明 `react` 或 `@types/react`。

它能跑（真实运行里「作品」标签出现过），但每加一个面板行都要在这份手写结构上继续堆：没有 JSX、没有编译期检查的 props、没有独立的 client 类型检查、样式散在组件里。

参考工程的工作台是一个独立的 React 应用（`inkos:packages/studio/src/App.tsx`、`main.tsx`、`index.css`，Vite 构建）；本项目不另起前端应用，等价物是 DSH 客户端插件里的 `conversation.view` 面板。三个 DSH 写作插件（`dsh-novel`、`oh-story-dsh`、`webnovel-writer`）的形态一致：`src/client/index.ts` 里 `export const inject` + `export function apply(ctx)`，`ctx.slots.inject` / `ctx.slots.register` 注册，`.tsx` 组件，`ConvViewProps` 从 `@deepseek-ai/dsh-client-ui-conversation/client` 引入，单独的 `tsconfig.client.json`，`react` 同时进 peer 与 dev。

## Decision

### 目录：`src/client/`

- `index.ts`：`export const inject = ['slots', 'sessions']`、`export function apply(ctx: Context)`；负责注册哨兵、按预设条件注册「作品」视图、安装样式。视图注册的判定逻辑（哨兵 → `eligible`、`slots.inject` → `declared`、两者都真才注册）原样搬过来，不改行为。
- `StoryView.tsx`：面板主体。props 是 `ConvViewProps & InjectFace<ViewInjected>`——`sessionId`／`useSessions` 来自 slot 的 owner props，`useResource` 是全局标准 props（`GlobalStandardProps`，`ConvViewProps` 一并带上），`canCommand`／`runCommand` 来自注册时的 `inject` 工厂，两半拼起来才是完整 props；`inject` 工厂写成带返回类型的函数，让 `register({ …, inject }, StoryView)` 的组件与面之间对得上。
- `EligibilitySentinel.tsx`：挂在 `conversation.session.header.utilities` 的空组件，只上报预设是否匹配。
- `preset.ts`：预设 id、两个槽位名、`presetOf`／`presetSelector`。宿主运行时把预设投影成 `string | null`，但 0.2.1-rc.5 的客户端投影映射没有声明 `agentPreset`，所以这里局部写出 `PresetCarrier` 并按 `??` 合并两处来源（投影与保留行），`null` 与 `undefined` 都归成「还没读到」。等宿主把它登记进投影映射，这个接口与断言一起删掉。
- `outcome.ts`：`outcomeOf` 把 `session.command` 的返回折成四态；返回类型从宿主服务面推出来（`SessionBinding['session']['command']`），不手写形状；结果不是预期对象时按失败处理。
- `styles.ts`：`installStyles()` 用 `document.createElement('style')` 建一个样式元素挂到 `document.head`，返回清理函数；`ctx.effect` 里调用。不用 CSS 文件——单文件产物没有 CSS 通道。
- `types.ts`：只放本项目自己的语义类型（命令结果的四种映射、`ViewInjected` 的形状、从 `ctx.sessions.binding` 推出的 `SessionId`）；`ConvViewProps`、`InjectFace`、`Context`、`ctx.sessions`、`useResource` 全部用宿主包的真类型。

### 构建：CJS + 模块加载器包裹

`window.__ModuleLoader__.load({ id, factory: (require) => { … return module.exports } })` 就是 DSH 客户端产物的正式形态（`packages/client/tsdown.client.ts` 的 banner/footer 模板）。`scripts/bundle.mjs` 的 client 构建改成：

- esbuild `format: 'cjs'`、`platform: 'browser'`、`jsx: 'automatic'`、`external: ['react', 'react/jsx-runtime']`；
- banner 写 `window.__ModuleLoader__.load({ id: …, factory: (require) => { var module = { exports: {} }; var exports = module.exports;`，footer 写 `return module.exports; } });`；`id` 从 `package.json` 的 `name` 读，不另写一份；
- 入口 `src/client/index.ts` 用普通 `export`，不再自己调加载器；
- 残留检查同时覆盖 `from "./…"` 与 `require("./…")`：CJS 产物里前者已经不出现，只查旧形态等于没查。

`react` 与 `react/jsx-runtime` 由宿主模块表提供（`packages/client/web/src/platform.ts` 的 `PLATFORM_MODULES` 两项都在），产物不打包它们。

### 类型检查：单独的 client 配置，真类型

新增 `packages/see-dsh-novel/tsconfig.client.json`（`jsx: 'react-jsx'`，`include: ['src/client/**/*.ts', 'src/client/**/*.tsx']`），并把**主配置**改成 `exclude: ['src/client/**']` 且开启 `jsx: 'react-jsx'`——主配置原本 `include: ['src/**/*.ts']` 会直接收进 `src/client/index.ts`，它的 `.tsx` 导入在没有 `--jsx` 的主程序里会报 TS17004；而 `tsx` 读工作区根的 `tsconfig.json`（本行新增，只提供 JSX 设置），测试里的 `.tsx` 才能编译。

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

- `test/client.test.mjs` 用 `react-test-renderer` 渲染 `StoryView` 与哨兵：断言三态文案、按钮只在预设匹配时出现、提交后的可见回执、命令结果的四种映射（含 `unbound`）；注册逻辑（条件注册与注销）用假 ctx 直接调 `apply` 验证。
- 测试环境补一个最小的 `document` 桩（`createElement`、`head.appendChild`、`removeChild`），断言样式元素被挂上、处置后被移除——`react-test-renderer` 不带 DOM，Node 里没有 `document`，不补桩这一行测试直接抛错。
- 构建冒烟：用假的 `window.__ModuleLoader__` 与 `require` 求值 `lib/client.js`，断言 `id`／工厂返回 `{ inject, apply }`、产物里没有 `require("./`，并把产物里的 `apply` 真的跑一遍（装样式、声明两个槽位）。
- `test/boundaries.test.mjs` 增加一条：`src/client/` 只允许 `@deepseek-ai/*`、`react`／`react/jsx-runtime` 与同目录相对导入，不得引用本仓库的 `core`／`pipelines`／`plugin`。

### 不改变的行为

界面文案、三种工作区状态、提交后的回执、按预设条件注册与注销、命令结果的四种映射，全部保持现有语义；「角色档案面板」之类的新内容属于后续 `panel.*` 行。

## Alternatives considered

**继续用 `React.createElement` 手写，只补类型。** 改动最小。否掉：每加一个视图都要手写元素树，props 没有编译期检查；三个参考插件都用 JSX + 独立 client 配置，没有理由逆着来。

**手写 `ViewProps` 而不装宿主类型包。** 少四个 devDependencies。否掉：手写声明证明不了宿主契约，已经漂过一次（`canSubmit` vs `canCommand`）；装真类型才能让「props 写错就编译失败」成立。

**把 `agentPreset` 当普通字符串读，不做 `null` 合并。** 代码更短。否掉：运行时该投影是 `string | null`，`null` 会被当成「预设名是 null」，面板既不显示「正在读取」也不按预设隐藏，等于把上一版的 `??` 语义改坏。

**把客户端拆成独立包（`packages/see-dsh-novel-client`）。** 边界更干净。否掉：现在只有一个视图，拆包会多一份构建与版本；等面板行多起来再拆。

**引入 CSS Modules / 构建期 CSS。** 样式更好管。否掉：当前产物是单文件脚本，没有 CSS 通道；DSH 的样式方案要求客户端走它自己的构建，属于后续行。

## Consequences

产物与源码：`src/client/` 七个文件（`index.ts`、`StoryView.tsx`、`EligibilitySentinel.tsx`、`preset.ts`、`outcome.ts`、`styles.ts`、`types.ts`），`lib/client.js` 是 CJS + 加载器包裹；`src/plugin/client.ts` 删除。构建脚本从 `package.json` 读插件 id，残留检查覆盖两种导入写法。主 `tsconfig.json` 排除 `src/client/**` 并开 `react-jsx`，`tsconfig.client.json` 单独检查；工作区根的 `tsconfig.json` 只给 `tsx` 提供 JSX 设置。

验证：`test/client.test.mjs` 8 例（预设读取、三态、按钮、回执四态、条件注册与注销、产物形态与 `apply` 冒烟），`test/boundaries.test.mjs` 增加客户端层规则；`pnpm run verify` 全绿。props 写错会同时让 client 类型检查失败（`ViewInjected` 的成员校验）。

代价与已知限制：

- 新增一批 devDependencies 需要 `pnpm install`（react、宿主客户端类型包、测试渲染器）；宿主升级时要同批升它们的版本。
- `preset.ts` 里 `PresetCarrier` 与两处断言是宿主类型缺口的手工补丁，宿主把 `agentPreset` 登记进客户端投影映射后应删除。
- `react-test-renderer` 在 React 18 下已标记弃用，但仍是参考插件用的方案；将来跟随 DSH 的前端测试方式再换。
- 样式走 `<style>` 注入，拿不到 DSH 的 `--dsw-*` 令牌体系；面板外观与内置界面会有差异，后续面板行再对齐。
- 浏览器半边只能靠真实运行确认视觉效果；单元测试覆盖的是逻辑与产物形态。
- 真实运行：写作会话里「作品」标签仍在、其它预设会话没有该标签、按钮仍能把命令提交出去。
- 实现与证据：implementation `packages/see-dsh-novel/src/client/index.ts`、consumer `packages/see-dsh-novel/test/client.test.mjs`、realRun `artifacts/real-runs/runtime.client-ui.json`。

