#!/usr/bin/env node
/**
 * `pnpm run check-boundary`：源码只连 DSH，不连参考工程。
 *
 * 扫 `packages/see-dsh-novel/src`（或 `--root` 指定的目录），读出 `.ts`／`.tsx`
 * 的依赖说明符，交给 `boundaryProblems` 判定。问题走 stderr，退出码 1。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { boundaryProblems } from '../packages/see-dsh-novel/src/tools/boundary.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const args = process.argv.slice(2)
const rootIndex = args.indexOf('--root')
const scanRoot = rootIndex >= 0 && args[rootIndex + 1] !== undefined
  ? args[rootIndex + 1]
  : join(root, 'packages/see-dsh-novel/src')

/** 递归收集 `.ts`／`.tsx`。 */
function collect(directory) {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...collect(path))
      continue
    }
    if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) files.push(path)
  }
  return files
}

const paths = collect(scanRoot)
const files = paths.map((path) => ({
  path: relative(scanRoot, path).split(sep).join('/'),
  text: readFileSync(path, 'utf8'),
}))

const problems = boundaryProblems(files)
if (problems.length > 0) {
  for (const problem of problems) process.stderr.write(`${problem.code} ${problem.path}: ${problem.detail}\n`)
  process.stderr.write(`边界检查失败：${problems.length} 个问题\n`)
  process.exitCode = 1
} else {
  process.stdout.write(`${JSON.stringify({ ok: true, root: scanRoot, files: files.length }, null, 2)}\n`)
}
