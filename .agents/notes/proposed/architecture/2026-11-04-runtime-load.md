# Agent Note: runtime.load —— 最小可装载骨架

Status: proposed

## Problem

账本第一行要求「插件／预设加载，注册 `story_next`，client 骨架可见」，但项目此刻没有任何可装载物：没有包结构、没有 bundle 清单、没有装配入口、没有测试入口。这项能力要一次定下后续每个能力都会复用的四件事——包怎么放、bundle 怎么声明、preset 怎么装配、加载证据怎么取。

## Proposal

### 仓库形态

根目录改成 pnpm workspace，`packages/*` 放插件包。P0 只有一个包 `packages/see-dsh-novel`，同时提供 host 入口与 client 入口，避免宿主侧与浏览器侧各建一个包后再拆。

源码用纯 ESM JavaScript（`.js` + JSDoc 类型），不引入 TypeScript 构建。理由是 P0 的验收是「装进去能跑」，多一层构建会让「加载失败」与「构建失败」难以区分；需要类型时再单独引入，不阻塞骨架落地。

### 包内结构

```
packages/see-dsh-novel/
  package.json        # dsh.bundle.patch + dsh.client
  cordis.patch.yml    # 根行 + agent preset 行
  src/index.js        # 根行的 host 入口：空实现，只为让浏览器半边可被发现
  src/agent.js        # preset 子行：注册 story_next
  src/story-next.js   # 工具契约（纯函数、参数与输出 schema）
  src/client.js       # client 入口：注册面板骨架
  icon.svg            # 面板图标
  test/                # 消费者测试 + schema 子集守门
```

`package.json` 的 `dsh.client` 声明 `platform: web`、`immediately: true`、`inject: ['@deepseek-ai/dsh-client-ui-conversation']`，与官方模板一致。

### 装配

`cordis.patch.yml` 插入两行：根行 `see-dsh-novel`，以及 preset。

```yaml
- insert:
    - id: see-dsh-novel
      name: 'see-dsh-novel'

    - id: preset-see-dsh-novel
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: see-dsh-novel
        name: see-dsh-novel
        plugins:
          - id: see-dsh-novel-story
            name: 'see-dsh-novel/agent'
```

两行的分工来自 client 模块的发现规则：浏览器半边由**组合根行**所挂包的清单解析，且只认包根说明符，子路径条目会被当作「不是 client 行」跳过。因此根行挂包根、host 实现为空；工具放在 preset 的子行里，用 `/agent` 子路径挂载，只进入选择该 preset 的会话。若把工具放进根行，它会注册成全局工具；若只保留 preset 子行，面板永远不会被解析。

preset 的 `plugins` 是子组合条目列表（`id`/`name`/`config`），不是对父组合行 id 的引用——工具必须写进 preset 才随 agent 装载。

技能不另建行：工作区的 `.agents/skills` 已由 `skill-filesystem` 的默认项目根扫描，本会话的技能目录即来自那里；在 preset 里再放一个 `skill-filesystem` 会注册第二个 provider，与既有目录重复。

`skill-filesystem` 的 `roots` 键名与相对路径基准以实施时 `Config.listConfigs` 的 schema 为准；设计只确定「技能根指向仓库 `.agents/skills`」这一事实。

### 非目标（本能力）

- 不做作品绑定与工作区发现（`runtime.session-binding`）。
- 不做阶段推进语义，`story_next` 不读写任何作品数据。
- 不做面板的数据加载、状态管理与交互按钮（`panel.workbench`）。

### `story_next` 的 P0 语义

无参数；返回 `{ work: string | null, phase: 'unbound' | 'init', next: string }`。

P0 只产出 `work: null, phase: 'unbound', next: 'init'`：作品绑定属于 `runtime.session-binding`，不在本能力内捏造。工具必须在 preset 装载后即可被调用，调用失败与「未绑定」是两种结果，前者由测试覆盖。

工具定义要满足运行时的两条硬约束：参数与输出 schema 只能落在支持的子集内（单个 `type` 字符串，可空用 `oneOf`），`output.render` 必须返回无损 JSON——返回 `undefined` 会让整次调用报「returned invalid output」。两处都由消费者测试盯住。

### 面板骨架

`src/client.js` 向 `conversation.view` 注册一个面板：该 slot 的条目与对话、轨迹并列，`label` 即标签文字。骨架只有标题、当前阶段与占位正文，不发起任何网络请求。

### 验证切入点

- 消费者测试 `test/host.test.mjs`：用假 `ctx`（记录 `tools.register` 调用）装载 host 入口，断言 `story_next` 已注册且 schema 可解析；再断言 `apply` 返回的注销函数能移除注册。
- client 测试：用 stub slots registry 调用 client 工厂，断言注册到选定 slot 且组件可实例化，不做 jsdom 渲染。
- 真实运行：`plugin_manager install_bundle` 装入当前 profile，新会话中调用 `story_next` 取得返回值，并确认面板出现在会话中；回执写入 `artifacts/real-runs/runtime.load.json`。

## Alternatives considered

**TypeScript + 构建产物。** 与 DSH 自身包一致，类型与发布形态更完整。P0 否掉：多一层构建会让「装载失败」和「构建失败」混在一起，且当前没有共享类型需要分发；等第二个包出现再引入更划算。

**host 与 client 分成两个包。** 依赖边界更清晰，client 包可以独立发布。P0 否掉：两个包要两次 install、两份 patch 行，而本阶段只验证一条装载链；包内双入口已足够。

**不写 preset，只装 bundle。** 少一行配置。但能力要求「插件／预设加载」，且后续角色与技能都要经 preset 装配；P0 不落这个入口，P1 会被迫补一遍装配设计。

**`story_next` 在 P0 直接返回作品绑定结果。** 更接近最终语义，但会把 `runtime.session-binding` 提前拉进本能力，验收也随之变成两行账本。

## Acceptance criteria

- `packages/see-dsh-novel` 能作为 bundle 被 `plugin_manager install_bundle` 应用，`application: applied`。
- 新会话的 preset 列表出现 `see-dsh-novel-story`，其中的 `story_next` 可调用并返回 `{ work: null, phase: 'unbound', next: 'init' }`。
- client 骨架挂载到与对话、轨迹并列的容器 slot，可见标题与当前阶段。
- `test/host.test.mjs` 通过，且断言注册与注销两侧。
- 账本 `runtime.load` 三份证据齐备，`check-capabilities -- --write` 置为 `verified`。

## Risks

- `install_bundle` 写入当前 profile，影响所有会话；卸载与回滚需要明确步骤，验证后要还原用户状态。
- 纯 JS 没有编译期类型检查，工具 schema 与返回结构靠测试保证。
- slot 名称依赖运行时查询，若该容器无可用 slot，面板需退回 `conversation.composer.dock`，属于实施期可接受的分支。
- preset 若引用了未安装的插件行，装载会失败且错误指向组合而非插件，首次排查成本在 preset 那一行。
- 工具注册在 agent 作用域还是根作用域，P0 按 preset 内装配处理；若装载后发现根已存在同名工具，改为只在根注册并去掉 preset 内的工具行，两处不并存。
