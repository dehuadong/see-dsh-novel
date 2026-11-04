/**
 * 打成单文件 ESM 产物，供 DSH 以原生 ESM 直接加载。
 *
 * 为什么必须打包：DSH 用原生 `import()` 吃插件入口，Node 的 ESM 解析器不补全
 * 扩展名，也不会为插件准备跨包 node_modules。单文件产物把相对导入与工作区依赖
 * 一并内联，形态对齐 DSH 自身的插件（`main` 指向 `lib/*.js`，产物内零相对导入）。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** DSH 宿主提供的服务面，不进产物。 */
const HOST_EXTERNAL = ['@deepseek-ai/*', 'node:*']

// 清掉上一次的产物，避免旧入口与新入口同时存在。
fs.rmSync(path.join(packageRoot, 'lib'), { recursive: true, force: true })

async function buildEntry(entry, outfile, platform = 'node') {
  const result = await esbuild.build({
    entryPoints: [path.join(packageRoot, entry)],
    outfile: path.join(packageRoot, outfile),
    bundle: true,
    platform,
    target: platform === 'node' ? 'node22' : 'es2022',
    format: platform === 'node' ? 'esm' : 'iife',
    external: platform === 'node' ? HOST_EXTERNAL : [],
    sourcemap: false,
    legalComments: 'inline',
    logLevel: 'warning',
    metafile: true,
  })
  const output = fs.readFileSync(path.join(packageRoot, outfile), 'utf8')
  const leftover = /from\s*["']\.[^"']*["']/.exec(output)
  if (leftover !== null) throw new Error(`${outfile} 残留相对导入：${leftover[0]}`)
  const bytes = fs.statSync(path.join(packageRoot, outfile)).size
  console.log(`[bundle] ${outfile} ok (${(bytes / 1024).toFixed(1)} KB, 内联 ${Object.keys(result.metafile.inputs).length} 个模块)`)
}

await buildEntry('src/plugin/index.ts', 'lib/index.js')
await buildEntry('src/plugin/agent.ts', 'lib/agent.js')
await buildEntry('src/plugin/client.ts', 'lib/client.js', 'browser')
