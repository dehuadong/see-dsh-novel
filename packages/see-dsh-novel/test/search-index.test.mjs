import test from 'node:test'
import assert from 'node:assert/strict'

import { LocalSearchIndex, buildMatchQuery } from '../src/core/search-index.ts'

const doc = (id, over = {}) => ({
  id,
  kind: 'hook',
  source: `source/story/${id}.md`,
  title: `伏笔 ${id}`,
  body: '主角的身份是一桩悬案',
  ...over,
})

test('the index matches, ranks and filters', () => {
  const index = new LocalSearchIndex(':memory:')
  try {
    index.replaceScope('w', [
      doc('a'),
      doc('b', { body: '身份 悬案 身份', kind: 'summary', source: 'source/story/b.md' }),
      doc('c', { body: '雾津的雨夜', kind: 'role' }),
    ])
    const hits = index.search('身份', { scope: 'w' })
    assert.deepEqual(hits.map((hit) => hit.id).sort(), ['a', 'b'])
    assert.equal(hits[0].id, 'b', 'BM25 更相关的在前')
    assert.deepEqual(index.search('身份', { scope: 'w', kinds: ['role'] }), [])
    assert.equal(index.search('身份', { scope: 'w', limit: 1 }).length, 1)
    assert.deepEqual(index.search('', { scope: 'w' }), [])
    assert.equal(buildMatchQuery('雾津 悬案'), '"雾 津" OR "悬 案"')
    assert.equal(buildMatchQuery('Hook'), '"Hook"*')
  } finally {
    index.close()
  }
})

test('replaceScope updates changed documents and removes vanished ones', () => {
  const index = new LocalSearchIndex(':memory:')
  try {
    index.replaceScope('w', [doc('a'), doc('b')])
    index.replaceScope('w', [doc('a', { body: '完全不同的内容' })])
    assert.deepEqual(index.search('悬案', { scope: 'w' }), [], 'b 已消失，a 已改写')
    assert.equal(index.search('完全不同的内容', { scope: 'w' }).length, 1)
    // 内容未变的文档不重复写入。
    index.replaceScope('w', [doc('a', { body: '完全不同的内容' })])
    assert.equal(index.search('完全不同的内容', { scope: 'w' }).length, 1)
  } finally {
    index.close()
  }
})
