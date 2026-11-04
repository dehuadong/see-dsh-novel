import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const LAYERS = 'packages/see-dsh-novel/src/pipelines'

/**
 * 分层规则：`pipelines/<name>` 只依赖 `core`，不得横向依赖另一个 pipeline。
 * 短篇、剧本会各自成为一个 pipeline 目录，这条规则是它们不互相污染的保证。
 */
test('pipelines never import another pipeline', () => {
  const pipelines = readdirSync(LAYERS)
  assert.ok(pipelines.length > 0)

  const offenders = []
  for (const name of pipelines) {
    const dir = join(LAYERS, name)
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.ts')) continue
      const text = readFileSync(join(dir, file), 'utf8')
      for (const match of text.matchAll(/from\s+'([^']+)'/g)) {
        const specifier = match[1]
        if (specifier.includes('pipelines/') || /^\.\.\/[a-z-]+\//.test(specifier)) {
          offenders.push(`${name}/${file} -> ${specifier}`)
        }
      }
    }
  }

  assert.deepEqual(offenders, [])
})

/** `plugin` 负责装配，可以被所有 pipeline 依赖；反过来不允许。 */
test('pipelines never import the plugin layer', () => {
  const offenders = []
  for (const name of readdirSync(LAYERS)) {
    const dir = join(LAYERS, name)
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.ts')) continue
      const text = readFileSync(join(dir, file), 'utf8')
      if (/from\s+'[^']*plugin\//.test(text)) offenders.push(`${name}/${file}`)
    }
  }
  assert.deepEqual(offenders, [])
})

/**
 * 浏览器半边是独立层：只认宿主客户端包、`react` 与同目录的相对导入。
 * 它不能碰本仓库的 `core`／`pipelines`／`plugin`，也不能用 node 内置模块。
 */
test('the client layer imports only host client packages, react, and its own files', () => {
  const dir = 'packages/see-dsh-novel/src/client'
  const allowed = [
    /^@deepseek-ai\/cordis$/,
    /^@deepseek-ai\/dsh-[a-z0-9-]+(?:\/client)?$/,
    /^react$/,
    /^react\/jsx-runtime$/,
    /^\.\/[A-Za-z0-9-]+\.js$/,
  ]
  const offenders = []
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.ts') && !file.endsWith('.tsx')) continue
    const text = readFileSync(join(dir, file), 'utf8')
    for (const match of text.matchAll(/from\s+'([^']+)'/g)) {
      const specifier = match[1]
      if (!allowed.some((pattern) => pattern.test(specifier))) {
        offenders.push(`${file} -> ${specifier}`)
      }
    }
  }
  assert.deepEqual(offenders, [])
})
