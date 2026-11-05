/**
 * `pnpm run check-package`：把真实 tarball 与 manifest 对一遍。
 *
 * 流程固定：先看源码 manifest 有没有安装期 hook（有就不打包，免得先执行它们），
 * 再 `pnpm pack` 到临时目录，读归档、解析 patch、用 esbuild 看入口是否自包含，
 * 最后交给 `packagingProblems` 判定。问题走 stderr 并以退出码 1 结束。
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse } from 'yaml'

import { readPackageEntries } from './pack-tar.mjs'
import { INSTALL_HOOKS, packagingProblems } from '../packages/see-dsh-novel/src/core/packaging.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const packageRoot = join(root, 'packages/see-dsh-novel')

/** 读 JSON；读不出来直接失败，后面没有继续的意义。 */
function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/** 把 YAML 走一遍，收集带 id 或 name 的行；解析失败返回 null。 */
function patchRowsOf(text) {
  let value
  try {
    value = parse(text)
  } catch {
    return null
  }
  const rows = []
  const walk = (node) => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item)
      return
    }
    if (node === null || typeof node !== 'object') return
    const row = {}
    if (typeof node.id === 'string') row.id = node.id
    if (typeof node.name === 'string') row.name = node.name
    if (row.id !== undefined || row.name !== undefined) rows.push(row)
    for (const nested of Object.values(node)) walk(nested)
  }
  walk(value)
  return rows.length === 0 ? null : rows
}

const sourceManifest = readJson(join(packageRoot, 'package.json'))
const sourceHooks = INSTALL_HOOKS.filter((hook) => sourceManifest.scripts?.[hook] !== undefined)
if (sourceHooks.length > 0) {
  for (const hook of sourceHooks) process.stderr.write(`install-hook ${hook}\n`)
  process.stderr.write('源码 manifest 里有安装期 hook，先移除再打包\n')
  process.exit(1)
}

if (process.env.npm_execpath === undefined) {
  process.stderr.write('请通过 pnpm 脚本运行：pnpm run check-package\n')
  process.exit(1)
}

const temp = mkdtempSync(join(tmpdir(), 'see-dsh-novel-pack-'))
try {
  execFileSync(process.execPath, [process.env.npm_execpath, 'pack', '--pack-destination', temp], {
    cwd: packageRoot,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const tarballs = readdirSync(temp).filter((name) => name.endsWith('.tgz'))
  if (tarballs.length !== 1) throw new Error(`pnpm pack 应产出一个 tarball，实际 ${tarballs.length} 个`)
  const tarball = join(temp, tarballs[0])
  const bytes = readFileSync(tarball)
  const entries = readPackageEntries(bytes)
  const paths = entries.map((entry) => entry.path)
  const contents = new Map(entries.map((entry) => [entry.path, entry.content]))
  const manifest = JSON.parse(contents.get('package.json').toString('utf8'))
  const patchText = contents.get('cordis.patch.yml')
  const clientText = contents.get('lib/client.js')?.toString('utf8') ?? ''

  const rootManifest = readJson(join(root, 'package.json'))
  const rootVersions = Object.fromEntries(
    Object.entries(rootManifest.devDependencies ?? {}).filter(([name]) => name.startsWith('@deepseek-ai/')),
  )

  const extracted = join(temp, 'extracted')
  for (const [path, content] of contents) {
    const target = join(extracted, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content)
  }
  const { build } = await import('esbuild')
  const bundles = []
  for (const entry of ['lib/index.js', 'lib/agent.js']) {
    if (!contents.has(entry)) continue
    const result = await build({
      entryPoints: [join(extracted, entry)],
      bundle: true,
      packages: 'external',
      write: false,
      metafile: true,
      platform: 'node',
      format: 'esm',
      logLevel: 'silent',
    })
    const output = Object.values(result.metafile.outputs)[0]
    bundles.push({
      entry,
      // esbuild 会重复列出同一路径；去重后更像「声明了哪些外部模块」。
      imports: [...new Set((output?.imports ?? []).map((item) => item.path))],
      inputs: Object.keys(result.metafile.inputs).length,
    })
  }

  const problems = packagingProblems({
    packageName: manifest.name,
    entries: paths,
    manifest,
    patchRows: patchText === undefined ? null : patchRowsOf(patchText.toString('utf8')),
    clientText,
    bundles,
    rootVersions,
  })

  if (problems.length > 0) {
    for (const problem of problems) process.stderr.write(`${problem.code} ${problem.detail}\n`)
    process.stderr.write(`打包检查失败：${problems.length} 个问题\n`)
    process.exitCode = 1
  } else {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      package: manifest.name,
      version: manifest.version,
      tarball: tarballs[0],
      sha256: createHash('sha256').update(bytes).digest('hex'),
      files: paths.length,
      exports: Object.keys(manifest.exports ?? {}).length,
      patchRows: patchRowsOf(patchText?.toString('utf8') ?? '')?.length ?? 0,
      bundles,
    }, null, 2)}\n`)
  }
} finally {
  if (existsSync(temp)) rmSync(temp, { recursive: true, force: true })
}
