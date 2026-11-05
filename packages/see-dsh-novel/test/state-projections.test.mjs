import test from 'node:test'
import assert from 'node:assert/strict'

import {
  renderChapterSummariesProjection,
  renderCurrentStateProjection,
  renderHooksProjection,
} from '../src/core/state-projections.ts'

const hook = (overrides = {}) => ({
  hookId: 'H1',
  startChapter: 0,
  type: '悬案',
  status: 'deferred',
  lastAdvancedChapter: 0,
  expectedPayoff: '首卷',
  notes: '',
  ...overrides,
})

test('the hooks projection sorts, escapes and ends with one newline', () => {
  const text = renderHooksProjection({
    hooks: [
      hook({ hookId: 'B', startChapter: 2 }),
      hook({ hookId: 'A', startChapter: 1, notes: 'a|b\nc' }),
      hook({ hookId: 'C', startChapter: 1 }),
    ],
  })
  assert.match(text, /^# 伏笔池\n\n\| hook_id \| 起始章节/)
  const rows = text.split('\n').filter((line) => /^\| [ABC] /.test(line))
  assert.deepEqual(rows.map((line) => line.split('|')[1]?.trim()), ['A', 'C', 'B'])
  assert.match(text, /a\\\|b<br>c/)
  assert.equal(text.endsWith('\n'), true)
  assert.equal(text.endsWith('\n\n'), false)
})

test('the hooks projection localizes its title and headers', () => {
  const text = renderHooksProjection({ hooks: [] }, 'en')
  assert.match(text, /^# Pending Hooks/)
  assert.match(text, /start_chapter/)
  assert.match(text, /\| --- \|/)
})

test('the current state projection filters expired facts and shows the chapter', () => {
  const text = renderCurrentStateProjection({
    chapter: 5,
    facts: [
      { subject: '甲', predicate: '身份', object: '司机', validFromChapter: 1, sourceChapter: 1, validUntilChapter: null },
      { subject: '乙', predicate: '状态', object: '失踪', validFromChapter: 3, sourceChapter: 3, validUntilChapter: 4 },
      { subject: '丙', predicate: '位置', object: '雾津', validFromChapter: 2, sourceChapter: 2, validUntilChapter: 5 },
    ],
  })
  assert.match(text, /> 当前章节: 5/)
  assert.match(text, /\| 甲 \|/)
  assert.match(text, /\| 丙 \|/, 'validUntil 等于当前章仍有效')
  assert.doesNotMatch(text, /乙/)
  assert.equal(text.endsWith('\n'), true)
})

test('the chapter summaries projection sorts by chapter and keeps eight columns', () => {
  const text = renderChapterSummariesProjection({
    rows: [
      { chapter: 2, title: '二', characters: '', events: 'e2', stateChanges: '', hookActivity: '', mood: '', chapterType: '' },
      { chapter: 1, title: '一', characters: '甲', events: 'e1', stateChanges: '', hookActivity: '', mood: '', chapterType: '' },
    ],
  }, 'en')
  assert.match(text, /^# Chapter Summaries/)
  const rows = text.split('\n').filter((line) => /^\| [12] /.test(line))
  assert.deepEqual(rows.map((line) => line.split('|')[1]?.trim()), ['1', '2'])
  assert.equal(rows[0].split('|').length - 2, 8)
})

test('empty state still renders the header row and a trailing newline', () => {
  const text = renderCurrentStateProjection({ chapter: 0, facts: [] })
  assert.match(text, /\| 主体 \| 关系 \/ 属性 \| 当前事实 \| 生效章节 \| 来源章节 \|/)
  assert.equal(text.endsWith('\n'), true)
})
