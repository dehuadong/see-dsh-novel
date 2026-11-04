/**
 * 打成单文件产物，供 DSH 以原生加载器直接吃。
 *
 * 宿主半边（`lib/index.js`、`lib/agent.js`）是 ESM：DSH 用原生 `import()` 装载，
 * Node 的 ESM 解析器不补全扩展名、也不为插件准备跨包 node_modules，所以相对
 * 导入与工作区依赖必须内联。
 *
 * 浏览器半边（`lib/client.js`）走客户端模块系统的正式形态：CJS 产物由
 * `window.__ModuleLoader__.load({ id, factory })` 包起来，`factory(require)`
 * 拿到宿主模块表里的 react 等共享模块，返回插件对象。形态与 DSH 自己的
 * 客户端构建一致（见 harness 的 `packages/client/tsdown.client.ts`）。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** DSH 宿主提供的服务面，不进产物。 */
const HOST_EXTERNAL = ['@deepseek-ai/*', 'node:*']

/** 客户端模块表提供的共享模块，不进产物。 */
const CLIENT_EXTERNAL = ['react', 'react/jsx-runtime']

/** 客户端产物的插件 id：与 `package.json` 的包名一致，不另写一份。 */
const CLIENT_ID = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8')).name

// 清掉上一次的产物，避免旧入口与新入口同时存在。
fs.rmSync(path.join(packageRoot, 'lib'), { recursive: true, force: true })

/** 产物里不允许残留相对导入：单文件是加载器的前提。 */
function assertNoRelativeImports(outfile, output) {
  const leftover = /(?:from\s*|require\(\s*)["']\.[^"']*["']/.exec(output)
  if (leftover !== null) throw new Error(`${outfile} 残留相对导入：${leftover[0]}`)
}

function report(outfile, bytes, modules) {
  console.log(`[bundle] ${outfile} ok (${(bytes / 1024).toFixed(1)} KB, 内联 ${modules} 个模块)`)
}

async function buildNodeEntry(entry, outfile) {
  const result = await esbuild.build({
    entryPoints: [path.join(packageRoot, entry)],
    outfile: path.join(packageRoot, outfile),
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    external: HOST_EXTERNAL,
    sourcemap: false,
    legalComments: 'inline',
    logLevel: 'warning',
    metafile: true,
  })
  const output = fs.readFileSync(path.join(packageRoot, outfile), 'utf8')
  assertNoRelativeImports(outfile, output)
  report(outfile, fs.statSync(path.join(packageRoot, outfile)).size, Object.keys(result.metafile.inputs).length)
}

async function buildClientEntry(entry, outfile) {
  const result = await esbuild.build({
    entryPoints: [path.join(packageRoot, entry)],
    outfile: path.join(packageRoot, outfile),
    bundle: true,
    platform: 'browser',
    target: 'es2022',
    format: 'cjs',
    external: CLIENT_EXTERNAL,
    jsx: 'automatic',
    sourcemap: false,
    legalComments: 'inline',
    logLevel: 'warning',
    metafile: true,
    banner: {
      js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(CLIENT_ID)}, factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;`,
    },
    footer: { js: 'return module.exports; } });' },
  })
  const output = fs.readFileSync(path.join(packageRoot, outfile), 'utf8')
  assertNoRelativeImports(outfile, output)
  report(outfile, fs.statSync(path.join(packageRoot, outfile)).size, Object.keys(result.metafile.inputs).length)
}

await buildNodeEntry('src/plugin/index.ts', 'lib/index.js')
await buildNodeEntry('src/plugin/agent.ts', 'lib/agent.js')
await buildClientEntry('src/client/index.ts', 'lib/client.js')
