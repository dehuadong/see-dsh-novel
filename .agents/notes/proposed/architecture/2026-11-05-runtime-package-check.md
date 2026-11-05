# Agent Note: runtime.package-check —— 校验真实 tarball，而不是源码树

Status: proposed

## Problem

插件装进 profile 的两条路都不保证「装上去的东西是对的」：

- **链接安装**（当前 profile 就是这种：`link:E:/see-dsh-novel/packages/see-dsh-novel`）读的是源码目录的 live `exports` 与 `dsh.bundle.patch`，`files` 白名单不参与；
- **打包安装**（换机器、发版、把 `.tgz` 交给别人）只按 `files` 白名单取内容。

本地 `pnpm run build` 成功只说明 `lib/` 被写出来了，不说明 `exports` 指向的文件都进了包、patch 里的每一行都能被解析、包里没有混进源码或本地路径、打包后的 host 没有悄悄依赖一个 devDependency。参考的 DSH 插件把这件事做成 `pack-check`：注释写得很直白——**inspect the actual tarball; never substitute the source files list for release evidence**。它先 `pnpm pack` 出真实 tarball，再从字节里读出条目、逐项断言清单与内容，最后用 esbuild 的 metafile 证明打包后的 host 是自包含的（只有 Node 内置模块与显式声明的依赖）。

本行照这个标准做：不查源码树、不拿 `npm pack --dry-run` 的列表代替产物，直接对**真实 tarball** 逐项对账。

## Proposal

### 先打真实包

`scripts/check-package.mjs` 在 `packages/see-dsh-novel` 里跑 `pnpm pack --pack-destination <临时目录>`，得到一个 `.tgz`，然后：

1. 用自己的最小 tar 读取器从字节里取条目（不解压到磁盘、不信任归档里的链接）；
2. 读包内 `package.json` 与 `cordis.patch.yml`；
3. 调纯函数 `packagingProblems`；
4. 生成报告（`ok`、tarball 的 sha256、条目数、检查项、imports 列表），打印到 stdout；有问题时把问题打到 stderr 并退出 1。

临时目录用完即删，不写工作区。

### 条目本身先要安全

参考的 tar 读取器拒绝链接、绝对路径、`..`、重复条目；本行同样：

| code | 判据 |
| --- | --- |
| `tar-entry-unsafe` | 条目名不以 `package/` 开头、含反斜杠或 `:`、含 `..`／`.` 段 |
| `tar-entry-linked` | 条目类型是符号链接或硬链接 |
| `tar-duplicate-entry` | 同名条目出现两次（大小写不敏感，和参考一致） |
| `tar-empty` | 一个文件条目都没有 |

### 清单与产物对账

| code | 判据 |
| --- | --- |
| `files-entry-missing` | `files` 里每一项在条目里有对应（目录按前缀、文件按全等） |
| `export-target-missing` | `exports` 的每个字符串目标（去掉 `./`）在条目里；`./package.json` 指向 `package.json` |
| `pack-patch-missing` | `dsh.bundle.patch` 指向的文件在条目里 |
| `patch-module-unexported` | patch 里任何 `see-dsh-novel` / `see-dsh-novel/<sub>` 必须对应 `exports` 的 `.`／`./<sub>` |
| `patch-row-missing` | patch 解析后必须能找到根行 `see-dsh-novel`、preset 行 `preset-see-dsh-novel`（`name: @deepseek-ai/dsh-agent-preset`）与预设内的 `see-dsh-novel/agent` |
| `unexpected-entry` | 条目不在允许集合内（`package.json`、`lib/*.js`、`skills/**`、`cordis.patch.yml`） |
| `local-dependency` | 依赖字段里出现 `workspace:`／`file:`／`link:` |
| `version-drift` | 依赖里 `@deepseek-ai/*` 的版本与根 `devDependencies` 不一致（根里没有就不判） |
| `undeclared-import` | 用 esbuild metafile 打包包内 `lib/index.js` 与 `lib/agent.js`：imports 只能是 `node:` 内置或已声明依赖；每个入口的 inputs 必须只有 1 个（自包含，不把源码漏成外部引用） |
| `client-id-missing` | `lib/client.js` 里必须出现客户端插件 id `see-dsh-novel`（面板半边靠它被宿主认领） |

tar 读取器、允许集合判定与清单对账都放在 `packages/see-dsh-novel/src/core/packaging.ts`，是纯函数（输入是条目路径与内容映射、manifest、patch 文本、根版本表），可以在测试里直接构造；脚本只负责打包、读盘、调它、打印。

### 接进 `verify`

根 `package.json` 加 `"check-package": "node --import tsx scripts/check-package.mjs"`，`verify` 链排在 `build` 之后：

```
typecheck → build → check-package → verify-notes → check-capabilities → test
```

必须在 `build` 之后：`lib/` 是构建产物；`pnpm pack` 会跑 `prepack` 之类脚本，所以包里一旦残留带写副作用的 hook 也会在这里暴露（本包没有，检查仍会覆盖）。

## Alternatives considered

**查源码树，不打包。** 快，不依赖 pnpm。否掉：`files` 白名单、`prepack`、pnpm 对目录的处理都不在源码树里体现；参考工程的注释明确否定了「用源码文件列表代替 release evidence」。当前是链接安装不代表永远不用 tarball，而只有 tarball 能证明「发出去的东西是对的」。

**用 `npm/pnpm pack --dry-run --json` 的列表。** 一行命令拿到条目，不用写 tar 读取器。否掉：dry-run 的列表是打包器的**预告**，不是产物；条目安全（链接、重复、`..`）与「真实字节里有什么」都得从 tarball 读。参考工程也是真的读字节。

**写一个完整 tar 库或依赖 `tar` 包。** 稳。否掉：我们只需要读「普通文件条目、拒绝链接与 pax 全局覆盖」这一小块，几十行就够；引入依赖会让插件包多一个运行时依赖（虽然只在脚本里用，但也要在根 devDependencies 里长期维护），而参考工程的 `tar.mjs` 也是自写的。

**像参考工程那样再做一次隔离安装冒烟（fresh profile + `plugin add`）。** 端到端最强。否掉：那是 `install-smoke` 的职责，要下载整棵 DSH 依赖、几分钟起步；本行只做 tarball 内容对账，装不装得上仍由 `install_bundle` 的真实结果说了算。

**检查包里每个文件的内容（凭证、绝对路径）。** 更严。否掉：本包内容全是构建产物与技能文档，没有模板与许可证文件；先把结构对账做对，内容级扫描等出现第一份外部素材时再加。

## Acceptance criteria

- `pnpm run check-package` 在当前包上退出码 0，stdout 报告里有 tarball sha256、条目数（当前应为 7：`package.json`、`lib/index.js`、`lib/agent.js`、`lib/client.js`、`cordis.patch.yml`、两份 `SKILL.md`）与 `ok: true`。
- 条目里出现 `package/src/index.ts` → `unexpected-entry`；出现 `package/lib/../x.js` → `tar-entry-unsafe`；出现两个同名条目 → `tar-duplicate-entry`；条目为空 → `tar-empty`。
- 条目里缺 `lib/agent.js` → `export-target-missing lib/agent.js` 与 `files-entry-missing lib`（`files` 声明的目录下没有条目）。
- 包内 `package.json` 把 `dsh.bundle.patch` 指向不存在的文件 → `pack-patch-missing`。
- patch 里出现 `see-dsh-novel/tools` 而 `exports` 没有 `./tools` → `patch-module-unexported`。
- patch 缺 `preset-see-dsh-novel` 行 → `patch-row-missing`。
- 依赖写 `"x": "workspace:*"`／`"file:../x"`／`"link:../x"` → `local-dependency x`。
- 依赖写 `"@deepseek-ai/dsh-client-ui-conversation": "0.2.1"` 而根里是 `0.2.2-rc.1` → `version-drift`；根里没有的名字不判。
- 包内 `lib/index.js` 留了一个 `import 'esbuild'` → `undeclared-import esbuild`。
- 包内 `lib/client.js` 不含 `see-dsh-novel` → `client-id-missing`。
- 有问题时退出码非零、stderr 列出问题码；没有问题时不写工作区任何文件（临时目录已清理）。
- 实现与证据：implementation `packages/see-dsh-novel/src/core/packaging.ts`；consumer `packages/see-dsh-novel/test/packaging.test.mjs`；脚本 `scripts/check-package.mjs` 与根 `package.json` 的 `verify` 链；realRun `artifacts/real-runs/runtime.package-check.json`。
- 真实运行：`pnpm run check-package` 在真实 `pnpm pack` 产物上通过；再人为改动一次（例如把 `files` 里的 `lib` 去掉）重跑，脚本报错并以非零码退出。

## Risks

- 自写的 tar 读取器只覆盖普通文件与目录条目；如果打包器将来用 pax 长路径，读取器需要跟着补（参考工程已处理 pax，本行先覆盖当前产物形态，遇到再补）。
- `pnpm pack` 比 dry-run 慢，且会在临时目录写文件；这是「检查真实产物」的代价。
- `undeclared-import` 用 esbuild 解析包内 bundle，等同于再构建一次入口文件；如果将来 `lib` 变成多 chunk 共享，`inputs === 1` 的断言要放宽。
- 允许集合是按当前文件结构写死的：新增构建产物（例如 preset 子入口）时必须同批更新白名单，否则会报 `unexpected-entry`——这是有意的摩擦。
- 本行不覆盖「安装成功」：版本要求、profile 权限、host 与 client 的装载顺序仍可能让 `install_bundle` 失败。
