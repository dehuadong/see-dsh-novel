# Agent Note: runtime.package-check —— 链接面与打包面各查一遍

Status: proposed

## Problem

插件装进 profile 有两条路，读的是同一份 `packages/see-dsh-novel/package.json`，但解析面不同：

- **链接面**：`install_bundle` 用 `link:` 装（profile 的 `node_modules/see-dsh-novel` 是指向源码包的 junction），宿主直接读 live 的 `exports` 与 `dsh.bundle.patch`，按路径取 `lib/agent.js`、`cordis.patch.yml` 这些文件。`files` 白名单在这里**不生效**；
- **打包面**：换一台机器或换成 tarball 安装时，装的是 `npm pack` 的产物，进包的文件只由 `files` 白名单决定。

两条路会坏的地方不同：链接面坏在「`exports` 指的文件构建没产出」，打包面坏在「`files` 漏了入口、或把源码／测试打进去」。现在没有任何一步在构建之后检查这两件事，构建成功就被当成可安装。

参考工程的 `verify-no-workspace-protocol.mjs` 只查依赖声明：源清单允许 `workspace:*`，但发布前的 registry 版本必须与工作区版本一致。那是「打包面」的一条子规则；本行按上面的两个面把它补全，并保留「版本不得漂移」这条。

## Proposal

### 纯函数做判定，脚本只取真实产物

`src/core/packaging.ts`：

```ts
export interface PackageProblem { code: string, detail: string }
export interface PackageFacts {
  exports?: Record<string, string>
  files?: ReadonlyArray<string>
  patch?: string                      // dsh.bundle.patch，相对包根
  dependencyFields?: Record<string, Record<string, string> | undefined>
  diskFiles?: ReadonlyArray<string>   // 包目录里的真实文件（链接面）
  tarballFiles?: ReadonlyArray<string> // npm pack 的 files[].path（打包面）
  patchNames?: ReadonlyArray<string>  // cordis.patch.yml 里所有 name
  pinnedVersions?: ReadonlyArray<string> // 工作区里 @deepseek-ai/* 的现有版本
}
export function packagingProblems(facts: PackageFacts): PackageProblem[]
```

YAML 由脚本解析（根 `devDependencies` 有 `yaml`），纯函数只收 `patchNames`，不把解析依赖塞进插件包。

### 两个面各自的规则

链接面（`diskFiles`）：

| code | 判据 |
| --- | --- |
| `export-target-missing` | `exports` 的每个目标（去掉前导 `./` 后与文件全等）必须在磁盘上存在 |
| `patch-missing` | `dsh.bundle.patch` 指向的文件存在 |
| `patch-module-unexported` | patch 里 `see-dsh-novel` 或 `see-dsh-novel/<sub>` 必须对应 `exports` 的 `.`／`./<sub>` |

打包面（`tarballFiles`）：

| code | 判据 |
| --- | --- |
| `files-entry-missing` | `files` 里每一项在 tarball 里有条目（目录按前缀，文件按全等） |
| `pack-export-missing` | 每个 `exports` 目标也必须在 tarball 里（否则换 tarball 装就断） |
| `pack-patch-missing` | `dsh.bundle.patch` 必须进包 |
| `forbidden-path` | 出现 `src/`、`test/`、`scripts/`、`tsconfig*.json`、`node_modules/`、`*.tgz` |
| `empty-pack` | tarball 条目为空 |

依赖面（两个面共用）：

| code | 判据 |
| --- | --- |
| `workspace-protocol` | 任何依赖字段里出现 `workspace:`。理由：这个包要装到工作区**之外**（link 或 tarball），`workspace:` 在那边的解析器里没有意义；与参考工程「源清单允许、发布前替换」的差别写在 Alternatives 里 |
| `version-drift` | `@deepseek-ai/*` 的版本在所有出现处必须一致（取自 `pinnedVersions` 的首个值；不一致就报出两个值） |

路径比较统一先去掉前导 `./` 与首尾斜杠，再比。

### 脚本

`scripts/check-package.mjs`（`node --import tsx` 运行，不需要进 tsconfig）：

1. 在 `packages/see-dsh-novel` 跑 `npm pack --dry-run --json`，取 `files[].path`；
2. 递归列包目录的磁盘文件（跳过 `node_modules`、`.git`、`lib` 之外的大目录也要列全——链接面要判断 `lib/agent.js` 在不在）；
3. 读 `package.json` 与 `cordis.patch.yml`（`yaml` 解析，收集所有 `name`）；
4. 调 `packagingProblems`，有问题的码与细节打到 stderr，退出码 1；否则打印「files／exports／patch 行数」与 tarball 条目数。

根 `package.json` 加 `"check-package": "node --import tsx scripts/check-package.mjs"`，`verify` 链排在 `build` 之后：

```
typecheck → build → check-package → verify-notes → check-capabilities → test
```

### 与 `install_bundle` 的关系

本行不重复宿主的解析：链接面保证「宿主按 `exports` 与 patch 取的东西真的在」，打包面保证「换成 tarball 也取得一样的东西」。装上去是否 `applied` 仍由 `install_bundle` 的结果说了算。

## Alternatives considered

**照抄参考脚本，只查依赖版本。** 最省。否掉：本项目坏过的不是依赖，是「构建没产出 `lib/agent.js` 而 `exports` 已经声明」；只查依赖会把这类断链留到装包时才发现。

**只查 tarball，不查链接面。** 一个面。否掉：当前实际安装是 `link:`，`files` 不参与；tarball 全绿也可能链接面缺文件（例如构建输出被 gitignore 影响、或 `lib` 被手工删）。两个面各自有独立的坏法。

**保留「源清单允许 `workspace:*`」的参考语义。** 更贴近参考工程。否掉：我们的插件包没有内部依赖，写 `workspace:` 只可能出现在「本来就不该有」的场景；与其做一次替换再校验，不如直接禁止，错误更早出现。参考的「发布前替换」是在 monorepo 内部包之间用的，本项目没有这种包。

**把检查塞进 `build`。** 少一个脚本。否掉：`build` 的职责是产出 `lib/`，检查要在产出之后；混在一起会让「构建失败」与「清单不一致」分不开。

**在单测里跑真实 `npm pack`。** 端到端。否掉：单测跑 npm 会变慢且依赖缓存；纯函数覆盖全部规则，真实 `pack` 由 `verify` 跑一次。

## Acceptance criteria

- `pnpm run check-package` 在当前包上退出码 0，打印 `files` 条目数、`exports` 数、patch 行数与 tarball 文件数。
- 链接面：`exports` 去掉 `./` 后指向 `lib/agent.js`，磁盘上缺失 → `export-target-missing lib/agent.js`。
- 打包面：tarball 条目里没有 `lib/agent.js` → `pack-export-missing lib/agent.js`；`files` 声明 `skills` 但 tarball 里没有 `skills/` 条目 → `files-entry-missing skills`。
- 打包面：条目里出现 `src/index.ts` → `forbidden-path src/index.ts`；条目为空 → `empty-pack`。
- 依赖面：`"x": "workspace:*"` → `workspace-protocol x`；两个 `@deepseek-ai/*` 版本不一致 → `version-drift` 并给出两个值。
- patch：`dsh.bundle.patch` 指向不存在的文件 → `patch-missing`；patch 里出现 `see-dsh-novel/tools` 而 `exports` 没有 `./tools` → `patch-module-unexported see-dsh-novel/tools`。
- 有问题时退出码非零，stderr 列出问题码与细节；没有问题时不写任何文件。
- `verify` 链里排在 `build` 之后；实现与证据：implementation `packages/see-dsh-novel/src/core/packaging.ts`；consumer `packages/see-dsh-novel/test/packaging.test.mjs`；脚本 `scripts/check-package.mjs` 与根 `package.json`；realRun `artifacts/real-runs/runtime.package-check.json`。
- 真实运行：`pnpm run check-package` 在真实 `npm pack` 产物上通过；人为删掉 `lib/agent.js` 再跑，脚本报 `export-target-missing` 并退出非零（随后恢复构建产物）。

## Risks

- `npm pack --dry-run --json` 是 npm 的行为；pnpm 打出的包理论上可能不同。本项目按 npm 语义声明 `files`，且 tarball 只是打包面的近似，真实安装当前走 link。
- 链接面与打包面都通过，不代表宿主一定能装上：版本要求、profile 权限、preset 引用仍可能挡住。
- `version-drift` 用「所有出现处必须一致」代替「等于工作区声明的版本」：它抓得到单个字段漂移，抓不到「全部一起被改错」。
- `files` 里写目录时按前缀匹配，空目录不会出现在 tarball，会被 `files-entry-missing` 报出来——这通常正是想要的提醒。
- 脚本依赖 PATH 里的 `npm`；只有 pnpm 的环境会在取 entries 时失败，而不是静默跳过。
