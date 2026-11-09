import test from 'node:test'
import assert from 'node:assert/strict'

import {
  LocalSearchIndex,
  buildMatchQuery,
  splitMarkdownForSearch,
  tokenizeSearchText,
} from '../src/core/search-index.ts'

const doc = (id, over = {}) => ({
  id,
  kind: 'hook',
  source: `source/story/${id}.md`,
  title: `伏笔 ${id}`,
  body: '主角的身份是一桩悬案',
  metadata: { hookId: id },
  ...over,
})

test('the index matches, ranks, filters and returns metadata', () => {
  const index = new LocalSearchIndex(':memory:')
  try {
    index.replaceScope('w', [
      doc('a'),
      doc('b', { body: '身份 悬案 身份', kind: 'chapter-summary', source: 'source/story/b.md' }),
      doc('c', { body: '雾津的雨夜', kind: 'role' }),
    ])
    const hits = index.search('身份', { scope: 'w' })
    assert.deepEqual(hits.map((hit) => hit.id).sort(), ['a', 'b'])
    assert.equal(hits[0].id, 'b', 'BM25 更相关的在前')
    assert.deepEqual(hits[0].metadata, { hookId: 'b' })
    assert.deepEqual(index.search('身份', { scope: 'w', kinds: ['role'] }), [])
    assert.equal(index.search('身份', { scope: 'w', limit: 1 }).length, 1)
    assert.deepEqual(index.search('', { scope: 'w' }), [])
  } finally {
    index.close()
  }
})

test('tokenization and match queries follow the segmented word/bigram rules', () => {
  assert.deepEqual(
    tokenizeSearchText('师债 mentor-debt').filter((token) => token === '师债' || token === 'mentor-debt'),
    ['师债', 'mentor-debt'],
  )
  assert.equal(tokenizeSearchText('a').includes('a'), false, '单字符拉丁被过滤')
  assert.ok(tokenizeSearchText('ＡＢＣ').includes('abc'), 'NFKC + 小写')
  const match = buildMatchQuery('导师 誓令')
  assert.match(match, /"导师"/)
  assert.match(match, /"誓令"/)
  assert.equal(match.includes('*'), false)
  const haze = buildMatchQuery('雾津 悬案')
  assert.match(haze, /"雾"/)
  assert.match(haze, /"雾津"/)
  assert.match(haze, /"悬案"/)
  assert.equal(haze.includes('*'), false)
  assert.equal(buildMatchQuery('').includes('*'), false)
  assert.equal(buildMatchQuery('Hook').includes('*'), false)
})

test('the BM25 title weight outranks repeated body matches', () => {
  const index = new LocalSearchIndex(':memory:')
  try {
    index.replaceScope('w', [
      doc('title-hit', { title: '身份', body: '无关' }),
      doc('body-hit', { title: '无关', body: '身份 身份 身份 身份 身份 身份 身份 身份' }),
    ])
    assert.equal(index.search('身份', { scope: 'w' })[0].id, 'title-hit')
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
    index.replaceScope('w', [doc('a', { body: '完全不同的内容' })])
    assert.equal(index.search('完全不同的内容', { scope: 'w' }).length, 1)
  } finally {
    index.close()
  }
})

test('Markdown search segments keep headings and character ranges', () => {
  const markdown = '# 证据\n\n赔偿款被拆成三笔。\n\n## 人物\n\n司机拒绝签字。'
  const segments = splitMarkdownForSearch(markdown)
  assert.deepEqual(segments.map((segment) => segment.body), ['赔偿款被拆成三笔。', '司机拒绝签字。'])
  assert.equal(markdown.slice(segments[1].charStart, segments[1].charEnd), '司机拒绝签字。')
})
