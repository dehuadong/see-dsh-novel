import test from 'node:test'
import assert from 'node:assert/strict'

import {
  boundaryProblems,
  classifyDependency,
  isHostSpecifier,
  isSourceSpecifier,
  stripComments,
} from '../src/tools/boundary.ts'

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

test('source imports are rejected in any layer', () => {
  const problems = boundaryProblems([
    { path: 'core/a.ts', text: "import x from 'inkos/packages/core/x.js'\n" },
    { path: 'core/b.ts', text: "import x from '../../inkos/x.js'\n" },
    { path: 'pipelines/long/c.ts', text: "export { y } from 'deepseek-harness/packages/y'\n" },
    { path: 'plugin/d.ts', text: "const z = require('inkos/z')\n" },
    { path: 'core/e.ts', text: "import './vendor/inkos/e.js'\n" },
  ])
  assert.deepEqual(codes(problems), Array(5).fill('source-import'))
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

  const sideEffectCore = boundaryProblems([{ path: 'core/x.ts', text: "import '@deepseek-ai/dsh-tools'\n" }])
  assert.deepEqual(codes(sideEffectCore), ['host-value-import', 'host-import-outside-allowed-layers'])

  const plugin = boundaryProblems([{ path: 'plugin/x.ts', text: "import type {} from '@deepseek-ai/cordis'\n" }])
  assert.deepEqual(plugin, [])
})

test('comments and string literals are not dependencies', () => {
  const text = [
    '// import x from \'inkos/x.js\'',
    '/* @deepseek-ai/dsh-tools 在注释里 */',
    "const name = 'inkos'",
    'export const S = "read from \'inkos\'"',
    'export {}',
  ].join('\n')
  assert.deepEqual(boundaryProblems([{ path: 'core/x.ts', text }]), [])
  assert.match(stripComments(text), /const name = 'inkos'/)
})

test('a side-effect import does not swallow the next statement', () => {
  const text = [
    "import './setup.js'",
    "import type { T } from '@deepseek-ai/cordis'",
  ].join('\n')
  assert.deepEqual(boundaryProblems([{ path: 'client/x.tsx', text }]), [])
})

test('declarations without from do not leak into the next statement', () => {
  const afterTypeAlias = [
    'export type Id = string',
    "import { z } from '@deepseek-ai/dsh-tools'",
  ].join('\n')
  assert.deepEqual(codes(boundaryProblems([{ path: 'client/x.ts', text: afterTypeAlias }])), ['host-value-import'])

  const afterReexport = [
    'export { X }',
    "import { z } from '@deepseek-ai/dsh-tools'",
  ].join('\n')
  assert.deepEqual(codes(boundaryProblems([{ path: 'client/x.ts', text: afterReexport }])), ['host-value-import'])

  const multiline = [
    'import {',
    '  a,',
    '  b,',
    "} from '@deepseek-ai/dsh-tools'",
  ].join('\n')
  assert.deepEqual(codes(boundaryProblems([{ path: 'client/x.ts', text: multiline }])), ['host-value-import'])
})

test('specifiers: exact, subpath, relative, and the host scope', () => {
  assert.equal(isSourceSpecifier('inkos'), true)
  assert.equal(isSourceSpecifier('inkos/x'), true)
  assert.equal(isSourceSpecifier('../../inkos/x'), true)
  assert.equal(isSourceSpecifier('./vendor/inkos/x'), true)
  assert.equal(isSourceSpecifier('deepseek-harness/packages/x'), true)
  assert.equal(isSourceSpecifier('@scope/inkos'), false, 'scoped 包不算')
  assert.equal(isSourceSpecifier('my-inkos-wrapper'), false)
  assert.equal(isSourceSpecifier('node:fs'), false)
  assert.equal(isHostSpecifier('@deepseek-ai/cordis'), true)
  assert.equal(isHostSpecifier('@deepseek-ai'), true)
  assert.equal(isHostSpecifier('@other/x'), false)
})

test('the classifier is the single dispatch point', () => {
  assert.deepEqual(classifyDependency({ specifier: 'inkos/x', typeOnly: false, dynamic: false }, 'client/x.ts'), ['source-import'])
  assert.deepEqual(classifyDependency({ specifier: '@deepseek-ai/x', typeOnly: true, dynamic: false }, 'core/x.ts'), ['host-import-outside-allowed-layers'])
  assert.deepEqual(classifyDependency({ specifier: '@deepseek-ai/x', typeOnly: false, dynamic: true }, 'core/x.ts'), ['dynamic-host-import'])
  assert.deepEqual(classifyDependency({ specifier: 'node:fs', typeOnly: false, dynamic: false }, 'core/x.ts'), [])
})
