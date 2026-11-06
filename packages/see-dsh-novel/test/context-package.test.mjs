import test from 'node:test'
import assert from 'node:assert/strict'

import { assembleContext, buildComposerInstruction, estimateTokens } from '../src/core/context-package.ts'

const candidate = (id, kind, source = `source/story/${id}.md`) => ({
  id, kind, source, title: id, excerpt: '一段候选正文', score: 1,
})

test('tokens are estimated CJK-first', () => {
  assert.equal(estimateTokens('四人'), 2)
  assert.equal(estimateTokens('abcd'), 1)
})

test('the composer instruction asks for the four sections and json only', () => {
  const text = buildComposerInstruction(3)
  assert.match(text, /第 3 章/)
  assert.match(text, /"memory"/)
  assert.match(text, /只允许返回候选列表里出现的 id/)
})

test('assemble keeps protected entries, validates ids and records unknown ones', () => {
  const { package: pkg, trace } = assembleContext({
    chapter: 1,
    query: '身份',
    protectedEntries: [{ source: 'source/story/current_focus.md', reason: '当前聚焦', excerpt: '聚焦', protection: 'protected' }],
    candidates: [candidate('memory:hook', 'memory'), candidate('role:甲', 'role')],
    selection: { memory: ['memory:hook'], role: ['role:不存在', 'role:甲'], state: [], outline: [] },
  })
  assert.deepEqual(pkg.selectedContext.map((entry) => entry.source), [
    'source/story/current_focus.md',
    'source/story/memory:hook.md',
    'source/story/role:甲.md',
  ].map((source) => source))
  assert.equal(trace.contextTiers.protectedSources.length, 1)
  assert.equal(trace.contextTiers.compressibleSources.length, 2)
  assert.ok(trace.notes.some((note) => note.includes('丢弃未知 id')))
  assert.equal(trace.retrieval.engine, 'sqlite-fts5-bm25')
  assert.equal(trace.retrieval.selectionMode, 'semantic')
  assert.equal(trace.tokenBudget.totalSelectedTokens, trace.tokenBudget.protectedTokens + trace.tokenBudget.compressibleTokens)
})

test('an empty selection is a complete-mode package with only the protected layer', () => {
  const { package: pkg, trace } = assembleContext({
    chapter: 1,
    query: 'x',
    protectedEntries: [],
    candidates: [candidate('memory:hook', 'memory')],
    selection: { memory: [], role: [], state: [], outline: [] },
  })
  assert.deepEqual(pkg.selectedContext, [])
  assert.equal(trace.retrieval.selectionMode, 'complete')
})

test('over-budget context requires a compression text', () => {
  const input = {
    chapter: 1,
    query: 'x',
    protectedEntries: [{ source: 'source/story/current_focus.md', reason: 'f', excerpt: '甲'.repeat(50), protection: 'protected' }],
    candidates: [candidate('memory:hook', 'memory')],
    selection: { memory: ['memory:hook'], role: [], state: [], outline: [] },
    maxChars: 10,
  }
  assert.throws(() => assembleContext(input), /需要先压缩/)
  const { package: pkg, trace } = assembleContext({ ...input, compression: { text: '压 缩 后 的 上 下 文' } })
  assert.deepEqual(pkg.selectedContext.map((entry) => entry.source), ['source/story/current_focus.md', 'compiled:context'])
  assert.equal(trace.compression.compiledSource, '压 缩 后 的 上 下 文')
  assert.deepEqual(trace.compression.compressedSources, ['source/story/memory:hook.md'])
  assert.equal(trace.compression.budgetTokens, 5)
  assert.throws(() => assembleContext({ ...input, compression: { text: '   ' } }), /不能为空/)
})
