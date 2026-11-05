# Agent Note: runtime.package-check —— 校验真实 tarball，而不是源码树

Status: proposed

## Problem

插件装进 profile 的两条路都不保证「装上去的东西是对的」：

- **链接安装**（当前 profile 就是这种：`link:E:/see-dsh-novel/packages/see-dsh-novel`）读的是源码目录的 live `exports` 与 `dsh.bundle.patch`，`files` 白名单不参与；
- **打包安装**（换机器、发版、把 `.tgz` 交给别人）只按 `files` 白名单取内容。

本地 `pnpm run build` 成功只说明 `lib/` 被写出来了，不说明 `exports` 指向的文件都进了包、patch 里的每一行都能被解析、包里没有混进源码或本地路径、打包后的 host 没有悄悄依赖一个 devDependency。参考的 DSH 插件把这件事做成 `pack-check`：注释写得很直白——**inspect the actual tarball; never substitute the source files list for release evidence**。它先 `pnpm pack` 出真实 tarball，再从字节里读出条目、逐项断言清单与内容，最后用 esbuild 的 metafile 证明打包后的 host 是自包含的。

本行照这个标准做：不查源码树、不拿 `pack --dry-run` 的列表代替产物，直接对**真实 tarball** 逐项对账。

## Proposal

### 职责分三层

| 层 | 位置 | 做什么 |
| --- | --- | --- |
| 读归档 | `scripts/pack-tar.mjs`（仓库工具，不进包） | 从 `.tgz` 字节里读条目：普通文件、目录；拒绝链接、绝对路径、`..`、重复条目 |
| 判定 | `packages/see-dsh-novel/src/core/packaging.ts` | 纯函数：输入条目清单、包内 manifest、已解析的 patch 行（id 与 name 列表）、客户端脚本文本、esbuild 结果、根版本表；输出问题码列表。不读 YAML |
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
| `unexpected-entry` | 条目必须落在允许集合内：`package.json`、`lib/(index\|agent\|client)\.js`、`skills/[\w-]+/SKILL\.md`、`cordis.patch.yml` |
| `install-hook` | manifest 的 `scripts` 里不得出现 `preinstall`／`install`／`postinstall`／`prepare`／`prepublishOnly`／`prepack`／`postpack`／`publish`／`postpublish` |
| `local-dependency` | 依赖字段里出现 `workspace:`／`file:`／`link:` |
| `version-drift` | 依赖里 `@deepseek-ai/*` 的版本与根 `devDependencies` 不一致（根里没有就不判） |
| `undeclared-import` | 每个打包入口（`lib/index.js`、`lib/agent.js`）的 esbuild metafile：imports 只能是 `node:` 内置或已声明依赖；每个入口 inputs 必须是 1（自包含） |
| `client-id-missing` | `lib/client.js` 里必须出现 `id: "<manifest.name>"`（与参考一样锚到 JSON 字符串形式），而不是任意出现名字 |

`local-dependency` 与 `version-drift` 今天不会触发（本包没有依赖字段），保留它们是给将来加依赖时用的，测试用合成 manifest 覆盖。

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

## Acceptance criteria

- `pnpm run check-package` 在当前包上退出码 0，stdout 报告含 tarball sha256、条目数（当前 7 条：`package.json`、`lib/index.js`、`lib/agent.js`、`lib/client.js`、`cordis.patch.yml`、两份 `SKILL.md`）与 `ok: true`。
- 条目录里出现 `package/src/index.ts` → `unexpected-entry`；出现 `package/lib/extra.js` → `unexpected-entry`（允许集合精确到三个入口文件）；出现 `package/lib/../x.js`、符号链接条目或同名条目 → 读取器报错，脚本以 `tar-read-error` 退出 1（`scripts/pack-tar.test.mjs` 用合成字节覆盖这三类）；条目为空同理。
- 条目里整目录缺 `lib/` → `files-entry-missing lib` 加三条 `export-target-missing`；只缺 `lib/agent.js` 时只报 `export-target-missing lib/agent.js`（`files` 的目录前缀仍然满足）。
- 包内 manifest 把 `dsh.bundle.patch` 指向不存在的文件 → `pack-patch-missing`。
- patch 里出现 `see-dsh-novel/tools` 而 `exports` 没有 `./tools` → `patch-module-unexported`。
- patch 缺 `preset-see-dsh-novel` 行 → `patch-row-missing`。
- manifest 的 `scripts.prepack` 有值 → `install-hook prepack`。
- 依赖写 `"x": "workspace:*"`／`"file:../x"`／`"link:../x"` → `local-dependency x`。
- 依赖写 `"@deepseek-ai/dsh-client-ui-conversation": "0.2.1"` 而根里是 `0.2.2-rc.1` → `version-drift`；根里没有的名字不判。
- 包内 `lib/index.js` 留一个 `import 'esbuild'` → `undeclared-import esbuild`；把 `lib/index.js` 改成 import 一个包内文件（inputs 变 2）→ `undeclared-import` 的 inputs 断言报错。
- 包内 `lib/client.js` 不含 `id: "see-dsh-novel"` → `client-id-missing`。
- 有问题时退出码非零、stderr 列问题码；通过时不写工作区任何文件（临时目录已清理）。
- CI：`.github/workflows/ci.yml` 的 `verify` job 在 `ubuntu-latest` 与 `windows-latest` 上都跑 `pnpm run verify`，`check-package` 因此随链执行；`AGENT_NOTE_ARCHIVE_BASE_REF` 在 job 级 env，两条 runner 都拿到。
- 实现与证据：implementation `packages/see-dsh-novel/src/core/packaging.ts`；consumer `packages/see-dsh-novel/test/packaging.test.mjs`；`scripts/pack-tar.mjs` 由 `scripts/pack-tar.test.mjs` 覆盖（合成一份带链接、`..`、重复条目的 tar 字节），根 `test` 脚本同时跑 `scripts/*.test.mjs`；`scripts/check-package.mjs`、根 `package.json` 的 `verify` 链与 `.github/workflows/ci.yml` 同批改；realRun `artifacts/real-runs/runtime.package-check.json`（含 `date`、`sessionId`、`tests.passed: true` 与非空 `receipts`，与其他行同形）。
- 真实运行：`pnpm run check-package` 在真实 `pnpm pack` 产物上通过；再人为改动一次（把 `files` 里的 `lib` 去掉）重跑，脚本报错并以非零码退出，随后恢复。

## Risks

- 自写 tar 读取器只覆盖普通文件与目录条目；pax 长路径将来出现时要补（参考工程已处理 pax）。
- `pnpm pack` 比 dry-run 慢，且会在临时目录写文件；这是「检查真实产物」的代价。
- `undeclared-import` 用 esbuild 解包内 bundle，等同于再构建一次入口；将来 `lib` 若拆多 chunk，`inputs === 1` 要放宽。
- 允许集合精确到文件名：新增构建产物（例如 preset 子入口）必须同批更新白名单，否则报 `unexpected-entry`——这是有意的摩擦。
- `install-hook` 检查的是 manifest 里的脚本名，不判断脚本内容；一个无害的 hooks 也会被拦，需要作者显式改成别的名字或移除。
- 本行不覆盖「安装成功」：版本要求、profile 权限、host 与 client 的装载顺序仍可能让 `install_bundle` 失败。
- CI 加 Windows runner 会让每次推送多一份机器时间；如果后续觉得太慢，可以先只让 `ubuntu-latest` 跑 `verify`，Windows 改成只在 PR 上跑。
- `local-dependency` 与 `version-drift` 今天恒不触发；它们只有合成 fixture 的证据。
