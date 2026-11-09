import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assembleContext, buildComposerInstruction, collectCandidates, estimateTokens } from '../src/core/context-package.ts'

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
    protectedEntries: [{ source: 'source/story/current_focus.md', reason: '当前聚焦', excerpt: '聚'.repeat(10), protection: 'protected' }],
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
    protectedEntries: [{ source: 'source/story/current_focus.md', reason: 'f', excerpt: '聚'.repeat(10), protection: 'protected' }],
    candidates: [{ ...candidate('memory:hook', 'memory'), excerpt: '候'.repeat(20) }],
    selection: { memory: ['memory:hook'], role: [], state: [], outline: [] },
    contextWindowTokens: 12,
    reservedOutputTokens: 2,
  }
  assert.throws(() => assembleContext(input), /需要先压缩/)
  const { package: pkg, trace } = assembleContext({ ...input, compression: { text: '压 缩 后 的 上 下 文' } })
  assert.deepEqual(pkg.selectedContext.map((entry) => entry.source), ['source/story/current_focus.md', 'compiled:context'])
  assert.equal(trace.compression.compiledSource, '压 缩 后 的 上 下 文')
  assert.deepEqual(trace.compression.compressedSources, ['source/story/memory:hook.md'])
  assert.equal(trace.compression.budgetTokens, 10)
  assert.throws(() => assembleContext({ ...input, compression: { text: 'x' }, contextWindowTokens: 5, reservedOutputTokens: 0 }), /protected 层超过/)
  assert.throws(() => assembleContext({ ...input, compression: { text: '   ' } }), /不能为空/)
})

test('collectCandidates maps story memory kinds and appends non-hits', async () => {
  const root = await mkdtemp(join(tmpdir(), 'see-dsh-novel-candidates-'))
  try {
    await mkdir(join(root, 'source/story/state'), { recursive: true })
    await mkdir(join(root, 'source/story/roles/主要角色'), { recursive: true })
    await writeFile(join(root, 'source/story/state/hooks.json'), JSON.stringify({
      hooks: [
        { hookId: 'H1', startChapter: 0, type: '悬案', status: 'deferred', lastAdvancedChapter: 0, expectedPayoff: '首卷回收', notes: '开场埋' },
        { hookId: 'H2', startChapter: 0, type: '已解', status: 'resolved', lastAdvancedChapter: 1, expectedPayoff: '已回收', notes: '不再检索' },
      ],
    }), 'utf8')
    await writeFile(join(root, 'source/story/state/chapter_summaries.json'), JSON.stringify({
      rows: [{
        chapter: 1,
        title: '雨夜',
        characters: '甲',
        events: '主角发现身份线索',
        stateChanges: '身份动摇',
        hookActivity: 'H1 推进',
        mood: '压抑',
        chapterType: '推进',
      }],
    }), 'utf8')
    await writeFile(join(root, 'source/story/volume_summaries.md'), '## 第一卷\n\n卷摘要：雨夜里的身份线。\n', 'utf8')
    await writeFile(join(root, 'source/story/roles/主要角色/甲.md'), '# 甲\n\n雾津的修表匠。\n', 'utf8')

    const hits = await collectCandidates(root, '悬案')
    assert.equal(hits.find((candidate) => candidate.source.endsWith('#H1'))?.kind, 'memory')
    assert.equal(hits.find((candidate) => candidate.source.includes('chapter_summaries'))?.kind, 'memory')
    assert.equal(hits.find((candidate) => candidate.source.includes('volume_summaries'))?.kind, 'memory')
    assert.equal(hits.find((candidate) => candidate.source.includes('roles/'))?.kind, 'role')

    const none = await collectCandidates(root, '完全不存在的词')
    assert.ok(none.some((candidate) => candidate.kind === 'memory' && candidate.source.includes('chapter_summaries')), '未命中的记忆也作为候选')
    assert.ok(none.some((candidate) => candidate.kind === 'memory' && candidate.source.includes('volume_summaries')))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
