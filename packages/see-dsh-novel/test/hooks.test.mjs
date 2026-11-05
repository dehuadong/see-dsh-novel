import test from 'node:test'
import assert from 'node:assert/strict'

import { countHooks, transitionHook, validateHooks } from '../src/core/hooks.ts'
import { renderHooksProjection } from '../src/core/state-projections.ts'

const hook = (over = {}) => ({
  hookId: 'H1',
  startChapter: 0,
  type: '悬案',
  status: 'deferred',
  lastAdvancedChapter: 0,
  expectedPayoff: '首卷',
  notes: '',
  ...over,
})

test('validation rejects duplicate ids, unknown status and bad chapters', () => {
  assert.throws(() => validateHooks({ hooks: [hook(), hook()] }), /重复/)
  assert.throws(() => validateHooks({ hooks: [hook({ status: 'bogus' })] }), /status 非法/)
  assert.throws(() => validateHooks({ hooks: [hook({ type: '  ' })] }), /缺少 type/)
  assert.throws(() => validateHooks({ hooks: [hook({ lastAdvancedChapter: -1 })] }), /lastAdvancedChapter/)
  assert.throws(() => validateHooks({ hooks: [hook({ startChapter: 3, lastAdvancedChapter: 1 })] }), /早于起始章节/)
})

test('transitions follow the table and stop at terminal states', () => {
  const progressing = transitionHook(hook(), 'progressing', 2)
  assert.equal(progressing.status, 'progressing')
  assert.equal(progressing.lastAdvancedChapter, 2)

  const resolved = transitionHook(progressing, 'resolved', 3)
  assert.equal(resolved.status, 'resolved')
  assert.throws(() => transitionHook(resolved, 'progressing', 4), /终态/)
  assert.throws(() => transitionHook(hook(), 'resolved', 1), /不允许从 deferred/)
  assert.throws(() => transitionHook(progressing, 'resolved', 1), /倒退/)
  assert.equal(transitionHook(hook(), 'superseded', 0).status, 'superseded')
})

test('projection is deterministic and sorted by the three keys', () => {
  const state = {
    hooks: [
      hook({ hookId: 'B', startChapter: 2 }),
      hook({ hookId: 'A', startChapter: 1, lastAdvancedChapter: 1, status: 'progressing' }),
      hook({ hookId: 'C', startChapter: 1 }),
    ],
  }
  const first = renderHooksProjection(state)
  const second = renderHooksProjection(structuredClone(state))

  assert.equal(first, second)
  assert.match(first, /^# 伏笔池/)
  const order = first.split('\n').filter((line) => /^\| (A|B|C) /.test(line))
  assert.deepEqual(order.map((line) => line.split('|')[1]?.trim()), ['C', 'A', 'B'])
  assert.equal(renderHooksProjection(state, 'en').includes('# Pending Hooks'), true)
})

test('projection escapes pipes and newlines so the table cannot break', () => {
  const text = renderHooksProjection({ hooks: [hook({ notes: 'a|b\nc' })] })
  assert.match(text, /a\\\|b<br>c/)
})

test('counts group by status', () => {
  assert.deepEqual(countHooks({ hooks: [hook(), hook({ hookId: 'H2', status: 'resolved' })] }), {
    open: 0,
    progressing: 0,
    deferred: 1,
    resolved: 1,
    superseded: 0,
  })
})
