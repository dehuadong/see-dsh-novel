# Agent Note: runtime.package-check —— 校验真实 tarball，而不是源码树

Status: implemented

## Problem

插件装进 profile 的两条路都不保证「装上去的东西是对的」：

- **链接安装**（当前 profile 就是这种：`link:E:/see-dsh-novel/packages/see-dsh-novel`）读的是源码目录的 live `exports` 与 `dsh.bundle.patch`，`files` 白名单不参与；
- **打包安装**（换机器、发版、把 `.tgz` 交给别人）只按 `files` 白名单取内容。

本地 `pnpm run build` 成功只说明 `lib/` 被写出来了，不说明 `exports` 指向的文件都进了包、patch 里的每一行都能被解析、包里没有混进源码或本地路径、打包后的 host 没有悄悄依赖一个 devDependency。参考的 DSH 插件把这件事做成 `pack-check`：注释写得很直白——**inspect the actual tarball; never substitute the source files list for release evidence**。它先 `pnpm pack` 出真实 tarball，再从字节里读出条目、逐项断言清单与内容，最后用 esbuild 的 metafile 证明打包后的 host 是自包含的。

本行照这个标准做：不查源码树、不拿 `pack --dry-run` 的列表代替产物，直接对**真实 tarball** 逐项对账。

## Decision

### 职责分三层

| 层 | 位置 | 做什么 |
| --- | --- | --- |
| 读归档 | `scripts/pack-tar.mjs`（仓库工具，不进包） | 从 `.tgz` 字节里读条目：普通文件、目录；拒绝链接、绝对路径、`..`、重复条目 |
| 判定 | `packages/see-dsh-novel/src/tools/packaging.ts` | 纯函数：输入条目清单、包内 manifest、已解析的 patch 行（id 与 name 列表）、preset 插件名、客户端脚本文本、esbuild 结果；输出问题码列表。不读 YAML，也不在 `core`（`core` 是产品共享层，这里是仓库工具，`files`／`exports` 都不含它） |
| 编排 | `scripts/check-package.mjs` | `pnpm pack` 到临时目录、读盘、跑 esbuild、调判定、打印报告、退出码 |

tar 读取器不放进 `core`：`core` 是产品共享层（类型、原子写入、状态播种），归档工具属于仓库工具，与参考工程把它放在 `scripts/release/tar.mjs` 是同一个位置。判定函数不读字节，只吃「条目路径 + 需要的文本」，可以在测试里直接构造。

### 条目本身先要安全

参考的读取器拒绝链接、绝对路径、`..`、重复条目；本行同样，且这些判定由读取器抛错、脚本转成 `tar-read-error` 退出 1（坏归档没有「继续检查」的价值）。

### 对账规则

| code | 判据 |
| --- | --- |
| `files-entry-missing` | `files` 里每一项在条目里有对应（目录按前缀、文件按全等） |
| `export-target-missing` | `exports` 的每个字符串目标（去掉 `./`）在条目里；`./package.json` 指向 `package.json` |
| `pack-patch-missing` | `dsh.bundle.patch` 指向的文件在条目里 |
| `patch-module-unexported` | patch 里任何 `see-dsh-novel`／`see-dsh-novel/<sub>` 必须对应 `exports` 的 `.`／`./<sub>` |
| `patch-row-missing` | patch 解析后必须有根行 `see-dsh-novel`、preset 行 `preset-see-dsh-novel`（`name: @deepseek-ai/dsh-agent-preset`）与预设内的 `see-dsh-novel/agent` |
| `patch-invalid` | `cordis.patch.yml` 解析不出任何行（脚本层的 YAML 解析失败也归到这里） |
| `unexpected-entry` | 条目必须落在允许集合内：`package.json`、`exports` 声明的入口、`dsh.bundle.patch`、`skills/[\w-]+/SKILL\.md`（集合从清单推，不再另抄一份） |
| `install-hook` | manifest 的 `scripts` 里不得出现 `preinstall`／`install`／`postinstall`／`prepare`／`prepublishOnly`／`prepack`／`postpack`／`publish`／`postpublish` |
| `undeclared-import` | 每个打包入口（从 `exports` 推出的 `lib/*.js`）的 esbuild metafile：imports 只能是 `node:` 内置（本包没有任何运行时依赖） |
| `bundle-not-self-contained` | 每个入口的 metafile inputs 必须是 1（不把包内源码漏成外部引用） |
| `client-id-missing` | `lib/client.js` 里必须出现 `id: "<manifest.name>"`（与参考一样锚到 JSON 字符串形式），而不是任意出现名字 |

### 脚本

`scripts/check-package.mjs`（`node --import tsx` 运行）：

1. 先读**源码** `packages/see-dsh-novel/package.json`，有 install hook 直接 `install-hook` 退出——检查要在 `pnpm pack` 执行它们**之前**，否则等于检查已经跑过的脚本；
2. 在 `packages/see-dsh-novel` 跑 `pnpm pack --pack-destination <临时目录>`；
3. `scripts/pack-tar.mjs` 读条目与内容；读失败 → `tar-read-error`，退出 1；
4. 读包内 `package.json`、`cordis.patch.yml`（`yaml` 解析成行 id 与 name 列表，解析失败 → `patch-invalid`），再读根 `devDependencies`；
5. 用 esbuild 对包内 `lib/index.js`、`lib/agent.js` 各打一次 metafile（`packages: 'external'`），收集 imports 与 inputs 数；
6. 调 `packagingProblems`，打印报告：`ok`、tarball 的 sha256、条目数、各检查项、imports；有问题时 stderr 列问题码并退出 1；
7. 临时目录在 `finally` 里删除。

包内 manifest 的 install hook 仍然要查一次（源码与产物理论上应一致，但检查产物才算对账）；源码那次是为了「不让 hook 跑起来」。

### 接进 `verify`

根 `package.json` 加 `"check-package": "node --import tsx scripts/check-package.mjs"`，`verify` 链排在 `build` 之后：

```
typecheck → build → check-package → verify-notes → check-capabilities → test
```

`pnpm pack` 会执行 `prepack`／`prepare`／`postpack` 这些 hook；本包不该有它们，脚本用 `install-hook` 规则检查，而不是靠 pack 时「看它有没有副作用」。

### 接进 CI

`.github/workflows/ci.yml` 同批改：

- 把「Build／Verify Notes／Check capabilities ledger／Run plugin tests」四步收成一条 `pnpm run verify`，`AGENT_NOTE_ARCHIVE_BASE_REF` 提到 job 级 env；这样 CI 与本地跑的是同一条链，以后给 `verify` 加步骤不用再改 yaml；
- `verify` job 加 `windows-latest` 与 `ubuntu-latest` 矩阵：真实宿主是 Windows，`link:` 安装、路径大小写、junction 这些差异只有 Windows runner 覆盖得到；包很小，两个 runner 的代价可控；
- 隔离安装冒烟（参考工程的 `install-smoke`：装一棵 DSH、fresh profile、`dsh plugin add <tgz>`、`--dump-config`）不在本行：它验证「装得上」而不是「产物对」，且要下载整棵依赖，等包稳定后作为 `workflow_dispatch`／nightly 单独加。

## Alternatives considered

**查源码树，不打包。** 快，不依赖 pnpm。否掉：`files` 白名单、`prepack`、pnpm 对目录的处理都不在源码树里体现；参考工程的注释明确否定了「用源码文件列表代替 release evidence」。

**用 `pack --dry-run --json` 的列表。** 一行命令拿到条目，不用读 tar。否掉：dry-run 的列表是打包器的预告，不是产物；条目安全（链接、重复、`..`）与「真实字节里有什么」都得从 tarball 读。

**把 tar 读取器与判定都塞进 `src/core/packaging.ts`。** 少一个文件。否掉：`core` 是产品共享层，读归档是仓库工具的职责；而且判定函数一旦读字节就无法用纯数据测。

**依赖现成的 `tar` 包。** 稳。否掉：只需要读普通文件条目并拒绝链接，几十行够用；为了脚本引入一个长期维护的依赖不划算，参考工程也是自写。

**像参考工程那样再做隔离安装冒烟（fresh profile + `plugin add`）。** 端到端最强。否掉：那是 `install-smoke` 的职责，要下载整棵 DSH 依赖；本行只做 tarball 内容对账。

**检查包里每个文件的内容（凭证、绝对路径）。** 更严。否掉：本包内容全是构建产物与技能文档；先把结构对账做对，内容级扫描等出现第一份外部素材时再加。

## Consequences

收益：发出去或装上去的那份产物，和 manifest 是同一件事。CI 与本地都从 `pnpm run check-package` 得到同一个结论——真实 `.tgz` 里有 7 个条目、`exports` 的四个目标齐全、patch 的 21 行都能被解析、两个打包入口自包含（各 1 个输入、只 import `node:`），客户端脚本带着 `id: "see-dsh-novel"`。

三层职责固定下来：读归档（拒绝链接、绝对路径、`..`、同名条目、空归档，出错即 `tar-read-error`）、纯数据判定、编排与打印。判定规则以 Decision 的表格为准，这里不复述。

`verify` 链是 `typecheck → build → check-package → verify-notes → check-capabilities → test`；CI 收成一条 `pnpm run verify`，在 `ubuntu-latest` 与 `windows-latest` 上各跑一次，Agent Note 的 base ref 在 job 级 env。

验证见 `test/packaging.test.mjs`（十三类问题的合成事实，含「整目录缺 lib 时 files 与 exports 各报什么」与「只缺一个入口时 files 前缀仍满足」）与 `scripts/pack-tar.test.mjs`（链接、pax 长路径、`..`、绝对路径、同名条目、空归档）。

### 代价与已知限制

- tar 读取器只覆盖普通文件与目录；pax 长路径与 GNU 长名已处理，其它扩展头遇到再补。
- `pnpm pack` 比 dry-run 慢，且要在临时目录落盘；这是「检查真实产物」的代价。
- `undeclared-import` 用 esbuild 再解一次入口；`lib` 若拆成多 chunk，`inputs === 1` 的断言要放宽。
- 允许集合精确到文件名：新增构建产物必须同批更新白名单，否则报 `unexpected-entry`——这是有意的摩擦。
- `install-hook` 只看脚本名不判断内容；命名相同的无害脚本也会被拦。
- 本行不覆盖「安装成功」：版本要求、profile 权限、host 与 client 的装载顺序仍可能让 `install_bundle` 失败。
- CI 的 Windows runner 让每次推送多一份机器时间；慢了可以先只让 `ubuntu-latest` 跑 `verify`，Windows 只在 PR 上跑。
