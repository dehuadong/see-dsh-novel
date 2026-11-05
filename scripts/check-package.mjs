#!/usr/bin/env node
/**
 * `pnpm run check-package`：把真实 tarball 与 manifest 对一遍。
 *
 * 先看源码 manifest 有没有安装期 hook（有就不打包，免得先执行它们），再 `pnpm pack`
 * 到临时目录，读归档、解析 patch、用 esbuild 看入口是否自包含，最后交给
 * `packagingProblems` 判定。问题走 stderr 并以退出码 1 结束。
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse } from 'yaml'

import { readPackageEntries } from './pack-tar.mjs'
import { INSTALL_HOOKS, exportTargets, packagingProblems } from '../packages/see-dsh-novel/src/tools/packaging.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const packageRoot = join(root, 'packages/see-dsh-novel')

/** 读 JSON；读不出来直接失败，后面没有继续的意义。 */
function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/** 解析 patch：返回行、preset 插件名与解析是否成功。 */
function readPatch(text) {
  let value
  try {
    value = parse(text)
  } catch {
    return { rows: null, presetPlugins: [] }
  }
  const rows = []
  const presetPlugins = []
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
    if (typeof node.id === 'string' && node.id.startsWith('preset-') && Array.isArray(node.config?.plugins)) {
      for (const plugin of node.config.plugins) {
        if (plugin !== null && typeof plugin === 'object' && typeof plugin.name === 'string') presetPlugins.push(plugin.name)
      }
    }
    for (const nested of Object.values(node)) walk(nested)
  }
  walk(value)
  return { rows: rows.length === 0 ? null : rows, presetPlugins }
}

/** 打印问题并结束。 */
function fail(lines) {
  for (const line of lines) process.stderr.write(`${line}\n`)
  process.exitCode = 1
}

const sourceManifest = readJson(join(packageRoot, 'package.json'))
const sourceHooks = INSTALL_HOOKS.filter((hook) => sourceManifest.scripts?.[hook] !== undefined)
if (sourceHooks.length > 0) {
  fail([...sourceHooks.map((hook) => `install-hook ${hook}`), '源码 manifest 里有安装期 hook，先移除再打包'])
  process.exit()
}

if (process.env.npm_execpath === undefined) {
  fail(['请通过 pnpm 脚本运行：pnpm run check-package'])
  process.exit()
}

const temp = mkdtempSync(join(tmpdir(), 'see-dsh-novel-pack-'))
try {
  try {
    execFileSync(process.execPath, [process.env.npm_execpath, 'pack', '--pack-destination', temp], {
      cwd: packageRoot,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    fail([`pack-failed ${error instanceof Error ? error.message : String(error)}`])
    process.exit()
  }

  const tarballs = readdirSync(temp).filter((name) => name.endsWith('.tgz'))
  if (tarballs.length !== 1) {
    fail([`pack-failed 应产出一个 tarball，实际 ${tarballs.length} 个`])
    process.exit()
  }

  const tarball = join(temp, tarballs[0])
  const bytes = readFileSync(tarball)
  let entries
  try {
    entries = readPackageEntries(bytes)
  } catch (error) {
    fail([
      `tar-read-error ${error instanceof Error ? error.message : String(error)}`,
      '归档读不出来，后面的对账没有意义',
    ])
    process.exit()
  }

  const contents = new Map(entries.map((entry) => [entry.path, entry.content]))
  const manifest = JSON.parse(contents.get('package.json').toString('utf8'))
  const patchText = contents.get('cordis.patch.yml')?.toString('utf8')
  const patch = patchText === undefined ? { rows: null, presetPlugins: [] } : readPatch(patchText)
  const clientText = contents.get('lib/client.js')?.toString('utf8') ?? ''

  // 入口从 exports 推，不另抄一份：清单声明了哪些 lib/*.js 就查哪些。
  const bundleEntries = exportTargets(manifest.exports).filter((target) => /^lib\/.+\.js$/.test(target))
  const extracted = join(temp, 'extracted')
  for (const [path, content] of contents) {
    const target = join(extracted, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content)
  }
  const { build } = await import('esbuild')
  const bundles = []
  for (const entry of bundleEntries) {
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
    entries: entries.map((entry) => entry.path),
    manifest,
    patchRows: patch.rows,
    presetPlugins: patch.presetPlugins,
    clientText,
    bundles,
  })

  if (problems.length > 0) {
    fail([...problems.map((problem) => `${problem.code} ${problem.detail}`), `打包检查失败：${problems.length} 个问题`])
  } else {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      package: manifest.name,
      version: manifest.version,
      tarball: tarballs[0],
      sha256: createHash('sha256').update(bytes).digest('hex'),
      files: entries.length,
      exports: Object.keys(manifest.exports ?? {}).length,
      patchRows: patch.rows?.length ?? 0,
      bundles,
    }, null, 2)}\n`)
  }
} finally {
  if (existsSync(temp)) rmSync(temp, { recursive: true, force: true })
}
