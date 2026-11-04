# Agent Note: 源码用 TypeScript，产物仍是 JavaScript

Status: implemented

## Problem

P0 时把「插件运行时装的是 JS」和「开发时写什么」混成了一个决定，源码直接写成 `.js` + JSDoc。两行能力之后这个选择的代价开始显形：`contract.ts` 的 schema、`commit.ts` 的写入计划、`tools.ts` 的动态 schema 三者共享同一批结构，靠注释维持一致性；改一处字段名时编译器不出声，只有测试或运行时报错。

运行时的约束是真的：Loader 直接 `import` 包的 `exports`，profile 安装不跑构建，所以**装进去的必须是 JS**。但这条约束只约束产物，不约束源码。

## Decision

源码是 TypeScript，`tsc` 编译到 `lib/`，`exports` 指向 `lib/*.js`。

- 根目录是 pnpm workspace（`pnpm-workspace.yaml`，`packages/*`），锁文件换成 `pnpm-lock.yaml`。
- `packages/see-dsh-novel/tsconfig.json`：`NodeNext`、`strict`、`noUncheckedIndexedAccess`、`rootDir: src`、`outDir: lib`。
- `lib/` 不入库：仓库只存源码，构建在本地与 CI 各做一次。
- 测试用 `tsx` 直接跑 `src/*.ts`，不依赖构建产物——测试失败不会和构建失败混在一起。
- `install_bundle` 之前必须 `pnpm run build`，否则装进去的是上一次的产物。

## Alternatives considered

**继续用 JS + JSDoc。** 省掉构建步骤，改完即装。否掉：类型只存在于注释里，跨文件契约（schema、写入计划、路径规则）没有编译期检查，而这三样正是后面 35 行能力都要复用的地基。

**源码 TS，用 tsx 直接运行 TS。** 免构建。否掉：运行时装载插件的是 DSH 的 Loader，不是 tsx；它按 `exports` 里的 `.js` 路径 import，没有 TS 转换。

**产物入库。** 装机即用，不需要构建。否掉：每次改源码都要提交一份生成物，diff 噪音大，且生成物与源码容易不同步却没人发现。

**根目录继续用 npm，只把源码换成 TS。** 少一次锁文件迁移。否掉：workspace 已经是多包结构（`packages/*`），pnpm 的 `-r` 与 workspace 链接是后续拆包时要用到的；两套锁文件并存更糟。

## Consequences

收益：四段 schema、写入计划与路径规则共享类型；字段改名、漏传参数在 `tsc` 阶段暴露；`lib/` 与 `src/` 的边界把「运行时形态」与「开发形态」分开，不再互相污染。

代价：

- 改源码后必须 `pnpm run build` 才影响已安装的插件；忘记构建时，运行中的仍是旧产物，而且没有任何提示。
- CI 与本地都多一步构建；`pnpm install` 需要 `allowBuilds: esbuild` 才能让 tsx 的依赖装好。
- `lib/` 被忽略，干净检出的仓库不能直接装，必须先构建。
