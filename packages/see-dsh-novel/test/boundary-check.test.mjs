import test from 'node:test'
import assert from 'node:assert/strict'

import { boundaryProblems, isHostSpecifier, isReferenceSpecifier, stripComments } from '../src/tools/boundary.ts'

const codes = (problems) => problems.map((problem) => problem.code)

test('a clean file has no problems', () => {
  const problems = boundaryProblems([
    { path: 'core/work.ts', text: "import { readFile } from 'node:fs/promises'\n" },
    { path: 'plugin/agent.ts', text: "import type { Context } from '@deepseek-ai/cordis'\n" },
    { path: 'client/index.ts', text: "import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'\n" },
    { path: 'tools/packaging.ts', text: "export const X = '@deepseek-ai/dsh-agent-preset'\n" },
  ])
  assert.deepEqual(problems, [])
})

test('reference imports are rejected in any layer', () => {
  const problems = boundaryProblems([
    { path: 'core/a.ts', text: "import x from 'inkos/packages/core/x.js'\n" },
    { path: 'core/b.ts', text: "import x from '../../inkos/x.js'\n" },
    { path: 'pipelines/long/c.ts', text: "export { y } from 'deepseek-harness/packages/y'\n" },
    { path: 'plugin/d.ts', text: "const z = require('inkos/z')\n" },
  ])
  assert.deepEqual(codes(problems), ['reference-import', 'reference-import', 'reference-import', 'reference-import'])
})

test('host value imports are rejected; type-only ones pass', () => {
  const value = boundaryProblems([{ path: 'plugin/x.ts', text: "import { z } from '@deepseek-ai/dsh-tools'\n" }])
  assert.deepEqual(codes(value), ['host-value-import'])

  const sideEffect = boundaryProblems([{ path: 'client/x.tsx', text: "import '@deepseek-ai/dsh-tools'\n" }])
  assert.deepEqual(codes(sideEffect), ['host-value-import'])

  const required = boundaryProblems([{ path: 'client/x.tsx', text: "const z = require('@deepseek-ai/dsh-tools')\n" }])
  assert.deepEqual(codes(required), ['host-value-import'])

  const typed = boundaryProblems([{ path: 'plugin/x.ts', text: "import type { X } from '@deepseek-ai/dsh-tools'\n" }])
  assert.deepEqual(typed, [])
})

test('dynamic host imports are reported once', () => {
  const problems = boundaryProblems([{ path: 'core/x.ts', text: "const z = await import('@deepseek-ai/dsh-tools')\n" }])
  assert.deepEqual(codes(problems), ['dynamic-host-import'])
})

test('host imports outside the preset halves are rejected even when type-only', () => {
  const core = boundaryProblems([{ path: 'core/x.ts', text: "import type {} from '@deepseek-ai/cordis'\n" }])
  assert.deepEqual(codes(core), ['host-import-outside-allowed-layers'])

  const tools = boundaryProblems([{ path: 'tools/x.ts', text: "import { z } from '@deepseek-ai/dsh-tools'\n" }])
  assert.deepEqual(codes(tools), ['host-value-import', 'host-import-outside-allowed-layers'])

  const plugin = boundaryProblems([{ path: 'plugin/x.ts', text: "import type {} from '@deepseek-ai/cordis'\n" }])
  assert.deepEqual(plugin, [])
})

test('comments are not dependencies', () => {
  const text = [
    '// import x from \'inkos/x.js\'',
    '/* @deepseek-ai/dsh-tools 在注释里 */',
    "const name = 'inkos'",
    'export {}',
  ].join('\n')
  assert.deepEqual(boundaryProblems([{ path: 'core/x.ts', text }]), [])
  assert.match(stripComments(text), /const name = 'inkos'/)
})

test('specifier helpers match whole segments and the host scope', () => {
  assert.equal(isReferenceSpecifier('inkos'), true)
  assert.equal(isReferenceSpecifier('inkos/x'), true)
  assert.equal(isReferenceSpecifier('../../inkos/x'), true)
  assert.equal(isReferenceSpecifier('deepseek-harness/packages/x'), true)
  assert.equal(isReferenceSpecifier('@scope/inkos'), true, 'scope 下的同名包也会命中')
  assert.equal(isReferenceSpecifier('my-inkos-wrapper'), false, '连字符包名不算同一个段')
  assert.equal(isReferenceSpecifier('node:fs'), false)
  assert.equal(isHostSpecifier('@deepseek-ai/cordis'), true)
  assert.equal(isHostSpecifier('@deepseek-ai'), true)
  assert.equal(isHostSpecifier('@other/x'), false)
})
