import test from 'node:test'
import assert from 'node:assert/strict'

import { packagingProblems } from '../src/tools/packaging.ts'

/** 一份通过检查的事实；每个用例只改一处。 */
function facts(overrides = {}) {
  return {
    packageName: 'see-dsh-novel',
    entries: [
      'package.json',
      'lib/index.js',
      'lib/agent.js',
      'lib/client.js',
      'cordis.patch.yml',
      'skills/longform-writing/SKILL.md',
      'skills/longform-writing/references/foundation-design.md',
      'skills/story-proposal/SKILL.md',
    ],
    manifest: {
      files: ['lib', 'skills', 'cordis.patch.yml'],
      exports: {
        '.': './lib/index.js',
        './agent': './lib/agent.js',
        './client': './lib/client.js',
        './package.json': './package.json',
      },
      dsh: { bundle: { patch: './cordis.patch.yml' } },
      scripts: { build: 'node scripts/bundle.mjs' },
    },
    patchRows: [
      { id: 'see-dsh-novel', name: 'see-dsh-novel' },
      { id: 'preset-see-dsh-novel', name: '@deepseek-ai/dsh-agent-preset' },
      { id: 'see-dsh-novel-story', name: 'see-dsh-novel/agent' },
    ],
    presetPlugins: ['@deepseek-ai/dsh-persona', 'see-dsh-novel/agent'],
    clientText: 'window.__ModuleLoader__.load({ id: "see-dsh-novel", factory })',
    bundles: [
      { entry: 'lib/index.js', imports: [], inputs: 1 },
      { entry: 'lib/agent.js', imports: ['node:fs', 'node:path'], inputs: 1 },
      { entry: 'lib/client.js', imports: [], inputs: 1 },
    ],
    ...overrides,
  }
}

const codes = (problems) => problems.map((problem) => problem.code)

test('a healthy package has no problems', () => {
  assert.deepEqual(packagingProblems(facts()), [])
})

test('files entries must appear in the tarball', () => {
  const problems = packagingProblems(facts({ entries: ['package.json', 'cordis.patch.yml', 'skills/a/SKILL.md'] }))
  assert.ok(codes(problems).includes('files-entry-missing'))
  assert.ok(problems.some((problem) => problem.detail === 'lib'))
  // 缺 lib/ 时三个入口也一起报。
  assert.equal(problems.filter((problem) => problem.code === 'export-target-missing').length, 3)
})

test('a single missing entry still satisfies the files prefix', () => {
  const problems = packagingProblems(facts({
    entries: ['package.json', 'lib/index.js', 'lib/client.js', 'cordis.patch.yml', 'skills/a/SKILL.md'],
  }))
  // lib 目录前缀仍在，files 不报；只有 exports 少一个。
  assert.deepEqual(codes(problems), ['export-target-missing'])
  assert.equal(problems[0].detail, 'lib/agent.js')
})

test('exports, patch and the allowed set are checked against the entries', () => {
  const missingPatch = packagingProblems(facts({
    manifest: { ...facts().manifest, dsh: { bundle: { patch: './missing.yml' } } },
  }))
  // 声明指向不存在的 patch 时，真正在包里的 cordis.patch.yml 反而成了未声明条目。
  assert.deepEqual(codes(missingPatch), ['pack-patch-missing', 'unexpected-entry'])

  const stray = packagingProblems(facts({ entries: [...facts().entries, 'src/index.ts', 'lib/extra.js'] }))
  assert.deepEqual(codes(stray), ['unexpected-entry', 'unexpected-entry'])
})

test('patch rows must resolve to exports and to the expected rows', () => {
  const unexported = packagingProblems(facts({
    patchRows: [...facts().patchRows, { id: 'tools', name: 'see-dsh-novel/tools' }],
  }))
  assert.deepEqual(codes(unexported), ['patch-module-unexported'])

  // `see-dsh-novel-story` 是 id，不是名字；不能被当成子路径。
  assert.deepEqual(packagingProblems(facts()), [])

  const missingPreset = packagingProblems(facts({
    patchRows: facts().patchRows.filter((row) => row.id !== 'preset-see-dsh-novel'),
  }))
  assert.ok(codes(missingPreset).includes('patch-row-missing'))

  const notInPreset = packagingProblems(facts({ presetPlugins: ['@deepseek-ai/dsh-persona'] }))
  assert.deepEqual(codes(notInPreset), ['patch-row-missing'])

  const unparsable = packagingProblems(facts({ patchRows: null }))
  assert.deepEqual(codes(unparsable), ['patch-invalid'])
})

test('install hooks are rejected', () => {
  const hooks = packagingProblems(facts({
    manifest: { ...facts().manifest, scripts: { build: 'x', prepack: 'node x.mjs' } },
  }))
  assert.deepEqual(codes(hooks), ['install-hook'])
})

test('bundles must be self-contained and declare their imports', () => {
  const undeclared = packagingProblems(facts({
    bundles: [{ entry: 'lib/agent.js', imports: ['esbuild'], inputs: 1 }],
  }))
  assert.deepEqual(codes(undeclared), ['undeclared-import'])

  const chunked = packagingProblems(facts({
    bundles: [{ entry: 'lib/agent.js', imports: [], inputs: 2 }],
  }))
  assert.deepEqual(codes(chunked), ['bundle-not-self-contained'])
})

test('the client bundle must carry the loader id', () => {
  const problems = packagingProblems(facts({ clientText: 'const name = "see-dsh-novel"' }))
  assert.deepEqual(codes(problems), ['client-id-missing'])
})
