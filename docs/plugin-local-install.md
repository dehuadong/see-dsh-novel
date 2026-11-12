# 本地安装插件

把本工作区的 DSH bundle 装进本机 profile 的操作、验证与已知限制。适用对象是 `packages/see-dsh-novel` 这个包，机制对其他本地 bundle 相同。

## 事实

- 工作区包：`packages/see-dsh-novel`，包名 `see-dsh-novel`，版本 0.1.0；`package.json` 的 `dsh.bundle.patch` 指向 `./cordis.patch.yml`，`dsh.client` 声明 `platform: web`、`immediately: true`。
- 运行中的 DSH：`@deepseek-ai/dsh-desktop-runtime` 0.2.2-rc.2，安装目录 `C:\Users\MyPC\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh`。
- profile：`desktop`，目录 `C:\Users\MyPC\.dsh\profiles\desktop`，宿主每次 shell 调用导出为 `DSH_PROFILE` 与 `DSH_PROFILE_DIR`。
- 本机 `dsh` 不在 PATH，`dsh --profile ... --dump-config` 不可用；安装结论改由安装返回与 `cordis_inspect_query` 核对。

## 安装

安装前先构建：`pnpm --filter see-dsh-novel build`。产物是 `packages/see-dsh-novel/lib/` 下的三个单文件（`index.js`、`agent.js`、`client.js`），该目录被 `.gitignore` 的 `/packages/*/lib/` 排除；`install_bundle` 装的是磁盘上的 `lib/`，不是 `src/`。

调用 `plugin_manager`，`action: install_bundle`，`target` 传包目录绝对路径 `E:\see-dsh-novel\packages\see-dsh-novel`。本地目录不走 npm，不带 `registry`。

判定是否装上只看返回的 `application` 与 `warnings`：`application: applied` 且 `warnings: []` 才算生效。`stage: enable`、`changed: true` 只说明做了改动，不说明装载成功；失败时先看返回里的 `logPath`（profile 的 `.plugin-manager/logs/operation-*/pnpm.log`）。

profile 侧的可见结果是：`package.json` 的 `dsh.profile.bundles` 末尾多出 `see-dsh-novel`，`node_modules/see-dsh-novel` 是指向包目录的 Junction，依赖写成 `link:E:/see-dsh-novel/packages/see-dsh-novel`。

`install_bundle` 需要 Full access 或逐次审批；file policy 为 workspace-write 的会话安装时会弹审批。

不手写 profile 的 `package.json` 或 `cordis.patch.yml`，不在 profile 目录跑 pnpm：这些都由 `install_bundle` 完成，手工写 profile 会各自需要审批，并与安装器的状态打架。

## 验证

三层都过才算装上：

| 层 | 查询 | 期望 |
| --- | --- | --- |
| 宿主行 | `cordis_inspect_query` host `Config.listConfigs`，`name: see-dsh-novel` | `entries` 含 `include:see-dsh-novel`，`status: absent` |
| 预设行 | 同查询，`name: @deepseek-ai/dsh-agent-preset` | `entries` 含 `include:preset-see-dsh-novel`，`status: schema` |
| 客户端 | client `Slots.listSubTree`，`root: conversation.session.header.utilities` | `occupants` 含 `id: see-dsh-novel-eligibility`、`active: true` |

宿主行的 `status: absent` 表示该行没有 Config，不表示失败；`schema` 才表示有可投影的配置。

客户端占用者出现，说明 profile 里已装的 bundle 被客户端模块系统装载进了当前页面；本项目的安装没有要求刷新页面。

「作品」视图只在预设为 `see-dsh-novel` 的会话注册：`packages/see-dsh-novel/src/client/index.ts` 用 `EligibilitySentinel` 读会话预设，并用 `ctx.slots.inject(VIEW_SLOT)` 等槽位声明，两者都成立才向 `conversation.view` 注册 id 为 `see-dsh-novel` 的项。所以在其他预设的会话里 `conversation.view` 只有 `chat` 与 `trajectory` 两个占用者，这不是安装失败。

`list_plugins` 不适合判定安装结果：它列的是 Loader 条目并包含大量 shipped 行；结论只认 `application`/`warnings` 与上面的行、槽位查询。

## 卸载与重装

卸载用 `plugin_manager`，`action: remove_bundle`，`target: see-dsh-novel`。卸载只改 profile（bundles 列表、依赖与 Junction），不碰工作区。

重装就是再跑一次 `install_bundle`：同一目录重复安装是幂等的，pnpm 报 `Already up to date`，Junction 重建，`application: applied`。

## 构建在本机沙箱下的限制

`packages/see-dsh-novel/scripts/bundle.mjs` 第一步删 `lib/`（`fs.rmSync`），在 workspace-write 下报 `EPERM`；`pnpm --filter see-dsh-novel build` 还会先报 `spawn EPERM`，因为 pnpm 的 lifecycle 子进程管道被沙箱拦下。因此沙箱内无法重新生成 `lib/`，安装只能用上一次构建的产物。

判断 `lib/` 是否对应当前源码：比对 `packages/see-dsh-novel/src` 与 `packages/see-dsh-novel/lib` 的 mtime，`lib` 不新于最晚的 `src` 就是旧产物；或直接看源码是否改过。要重建，放开一次 Full access 或在沙箱外跑构建，不要手工拼 `lib/`。

## 版本核对

工作区 `devDependencies` 钉的是 0.2.2-rc.1，本机运行的是 0.2.2-rc.2。`typecheck` 用 rc.1 的客户端类型，装进 profile 的插件在 rc.2 上跑；类型检查通过不代表运行期 API 一致。升级 DSH 后先查上面的客户端槽位，占位者还在才说明客户端半边仍能装载。

## 排错

| 现象 | 原因 | 动作 |
| --- | --- | --- |
| `application: applied` 但页面没有「作品」 | 会话预设不是 `see-dsh-novel`，视图按预设条件注册 | 用该预设新建会话再看 |
| 装完行为还是旧的 | `lib/` 是旧产物，安装读的是磁盘文件 | 重建后重装 |
| `pnpm --filter see-dsh-novel build` 报 `spawn EPERM` | 沙箱拦下 pnpm lifecycle 的管道子进程 | 换 Full access 或在沙箱外构建 |
| `bundle.mjs` 报 `EPERM ... rm lib` | 脚本先删 `lib/`，workspace-write 不允许 | 同上 |
| `dsh` 命令找不到 | 本机 CLI 不在 PATH | 用 profile 文件与 `cordis_inspect_query` 核对，不依赖 `--dump-config` |
