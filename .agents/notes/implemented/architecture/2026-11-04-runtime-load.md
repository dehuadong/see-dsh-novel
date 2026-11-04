# Agent Note: runtime.load —— 最小可装载骨架

Status: implemented

## Problem

账本第一行要求「插件／预设加载，注册 `story_next`，client 骨架可见」，而项目此前没有任何可装载物：没有包结构、没有 bundle 清单、没有装配入口、没有测试入口。这项能力一次定下了后续每个能力都会复用的四件事——包怎么放、bundle 怎么声明、preset 怎么装配、加载证据怎么取。

## Decision

### 仓库形态

根目录是 pnpm workspace，`packages/*` 放插件包。当前只有一个包 `packages/see-dsh-novel`，包内同时提供宿主侧与浏览器侧入口，不按侧拆包。

源码是 TypeScript，编译到 `lib/` 后由 Loader 装载；`.js` 只是产物形态，不再直接手写。这一条在 `foundation.architect` 之前改过，理由与代价见 [源码用 TypeScript，产物仍是 JavaScript](../process/2026-11-04-typescript-build.md)。

### 包内结构

目录职责见 [`packages/see-dsh-novel`](../../../../packages/see-dsh-novel)：包根入口只用于让浏览器半边被发现，`agent` 子路径注册工具，`client` 子路径注册视图。`package.json` 的 `dsh.client` 声明 `platform: web`、`immediately: true`、`inject: ['@deepseek-ai/dsh-client-ui-conversation']`。

### 装配

组合内容以 [`cordis.patch.yml`](../../../../packages/see-dsh-novel/cordis.patch.yml) 为准，这里只记为什么是两行。

两行的分工来自 client 模块的发现规则：浏览器半边由**组合根行**所挂包的清单解析，且只认包根说明符，子路径条目会被当作「不是 client 行」跳过。根行因此挂包根、host 实现为空；工具放在 preset 的子行里用 `/agent` 子路径挂载，只进入选择该 preset 的会话。工具放进根行会注册成全局工具；只保留 preset 子行则面板永远不会被解析。

preset 的 `plugins` 是子组合条目列表（`id`/`name`/`config`），不是对父组合行 id 的引用——工具必须写进 preset 才随 agent 装载。

技能不另建行：工作区的 `.agents/skills` 由 `skill-filesystem` 的默认项目根扫描；在 preset 里再放一个 `skill-filesystem` 会注册第二个 provider。

### `story_next` 契约

无参数；返回 `{ work: null, phase: 'unbound', next: 'init' }`。作品绑定属于 `runtime.session-binding`，这里不捏造；阶段词表因此只有 `unbound`，随能力增加再扩。

工具定义受运行时两条硬约束：

- 参数与输出 schema 只能落在支持的子集内（单个 `type` 字符串；可空用 `oneOf`，不能用 type 数组）。
- `output.render(args, value)` 必须返回**内容块数组**（`[{ type: 'text', text }]`）。运行时对它调用 `.some` 渲染工具卡片；返回 `undefined` 或结果对象都会让整次调用失败。

### 面板骨架

`src/client.js` 向 `conversation.view` 注册一个视图：该 slot 的条目与对话、轨迹并列，`label` 即标签文字。骨架只有标题与占位正文，不发起网络请求。

### 非目标

作品绑定与工作区发现、阶段推进语义、面板的数据加载与交互，均不属于本能力。

### 验证

- `npm test`：宿主半边覆盖根入口、工具契约、注册与注销；浏览器半边用 stub 的 `__ModuleLoader__` 与 slot 服务覆盖注册、注销与骨架渲染；另有参数与输出 schema 的运行时子集守门。用例见 [`packages/see-dsh-novel/test`](../../../../packages/see-dsh-novel/test)。
- 真实运行：bundle 装入 profile 后 `application: applied`；`config.listConfigs` 出现 `preset-see-dsh-novel`；桌面应用中「作品」视图与对话、轨迹并列出现；预设会话里 `story_next` 返回 `isError=false`，卡片内容为「阶段 unbound（未绑定作品）」；同一工具在非该预设的会话中不存在。
- 回执写入 `artifacts/real-runs/runtime.load.json`，`check-capabilities -- --write` 将账本置为 `verified`。

## Alternatives considered

**TypeScript + 构建产物。** 与 DSH 自身包一致，类型与发布形态更完整。否掉：多一层构建会让「装载失败」和「构建失败」混在一起，且当前没有共享类型需要分发；等第二个包出现再引入更划算。

**host 与 client 分成两个包。** 依赖边界更清晰，client 包可独立发布。否掉：两个包要两次 install、两份 patch 行，而本阶段只验证一条装载链。

**不写 preset，只装 bundle。** 少一行配置。但能力要求「插件／预设加载」，且后续角色与技能都要经 preset 装配；不落这个入口，下一步会被迫补一遍装配设计。

**`story_next` 直接返回作品绑定结果。** 更接近最终语义，但会把 `runtime.session-binding` 提前拉进本能力，验收也随之变成两行账本。

**只保留 preset 子行。** 看起来更省，但浏览器半边依赖根行；实际表现是宿主侧正常、面板永远缺席，且没有任何报错指向这个缺口。

## Consequences

收益：一条可重复的装载链路成立——根行负责被发现，preset 负责把工具限定到写作会话，浏览器半边由清单自动接上。schema 子集与 `render` 返回形态由测试盯住，同类错误不必再靠「重启后看红卡片」发现。

代价与约束：

- `install_bundle` 写入当前 profile，影响所有会话；卸载要 `remove_bundle`，回滚步骤必须显式执行。
- 宿主插件模块在组合应用时装载，改文件不会热更新；每次改动都要重启应用才能验证，反馈环比纯库代码慢。
- 浏览器半边只在 stub 的 loader 与 slot 服务下测注册、注销与骨架结构；真实渲染、布局与主题仍只能靠运行中的应用观察。
- 安装会把 profile 的 `agent-preset-registry.selectedDefault` 指向本 preset（新会话默认选中），这不是能力的一部分，需要时在应用里改回。
- 纯 JS 没有编译期类型检查，工具契约靠测试与运行时反馈保证。
- preset 引用未安装的插件行时，错误指向组合而非插件，首次排查成本落在 preset 那一行。
