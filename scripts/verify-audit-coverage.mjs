#!/usr/bin/env node
/**
 * 文档审计覆盖检查：v1 P0–P6 的每个能力行都必须在 fidelity-audit.md 有 `### id` 段。
 *
 * P7–P9（short.*／script.*／radar.*／forecast.*）不在 v1 阶段合同内，由审计的
 * 「v1 之外」段统一说明；它们不要求逐行 `###`。
 *
 * 用法：node scripts/verify-audit-coverage.mjs
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LEDGER = join(ROOT, 'capabilities.yaml')
const AUDIT = join(ROOT, 'docs/fidelity-audit.md')
const OUT_OF_V1 = /^(?:short|script|radar|forecast)\./

function fail(message) {
  console.error(`error: ${message}`)
  process.exitCode = 1
}

if (!existsSync(LEDGER)) {
  fail('capabilities.yaml 不存在')
} else if (!existsSync(AUDIT)) {
  fail('docs/fidelity-audit.md 不存在')
} else {
  const ledger = YAML.parse(readFileSync(LEDGER, 'utf8'))
  const ids = (ledger?.capabilities ?? []).map((row) => row.id).filter((id) => typeof id === 'string')
  const audit = readFileSync(AUDIT, 'utf8')
  const headings = new Set(
    [...audit.matchAll(/^### ([a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+)(?:（[^\n]*）)?/gmu)].map((match) => match[1]),
  )
  const v1 = ids.filter((id) => !OUT_OF_V1.test(id))
  const missing = v1.filter((id) => !headings.has(id))
  if (missing.length > 0) {
    fail(`fidelity-audit.md 缺 ${missing.length} 个 v1 能力段：${missing.join('、')}`)
  } else {
    console.log(`ok: ${v1.length} 个 v1 能力行均有审计段`)
  }
}
