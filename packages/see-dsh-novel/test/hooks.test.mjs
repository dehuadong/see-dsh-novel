import test from 'node:test'
import assert from 'node:assert/strict'

import { countHooks, transitionHook, validateHooks } from '../src/core/hooks.ts'

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
  assert.throws(() => validateHooks({ hooks: [hook({ type: '' })] }), /缺少 type/)
  assert.throws(() => validateHooks({ hooks: [hook({ lastAdvancedChapter: -1 })] }), /lastAdvancedChapter/)
  // 源 schema 没有「最近推进不得早于起始章」的约束，这里也不拒绝。
  assert.doesNotThrow(() => validateHooks({ hooks: [hook({ startChapter: 3, lastAdvancedChapter: 1 })] }))
})

test('the hook ledger accepts dependsOn and paysOffInArc, and rejects unknown fields', () => {
  const withFields = hook({ dependsOn: ['H0', 'H2'], paysOffInArc: '第二卷' })
  assert.deepEqual(validateHooks({ hooks: [withFields] }).hooks[0].dependsOn, ['H0', 'H2'])

  // 源 schema 的 min(1)：空串拒绝，纯空白合法（不 trim）。
  assert.throws(() => validateHooks({ hooks: [hook({ dependsOn: [''] })] }), /dependsOn/)
  assert.throws(() => validateHooks({ hooks: [hook({ dependsOn: 'H0' })] }), /dependsOn/)
  assert.throws(() => validateHooks({ hooks: [hook({ paysOffInArc: 3 })] }), /paysOffInArc/)
  assert.throws(() => validateHooks({ hooks: [hook({ expectedPayoff: 3 })] }), /expectedPayoff/)
  assert.throws(() => validateHooks({ hooks: [hook({ notes: null })] }), /notes/)
  assert.throws(() => validateHooks({ hooks: [hook({ extra: true })] }), /未知字段/)
  assert.throws(() => validateHooks({ hooks: [{ extra: true }] }), /缺少 hookId/)
  assert.throws(() => validateHooks({ hooks: [null] }), /必须是对象/)
  assert.throws(() => validateHooks({ hooks: [], extra: 1 }), /状态上的未知字段/)
  assert.doesNotThrow(() => validateHooks({ hooks: [hook({ type: '  ' })] }))
  assert.doesNotThrow(() => validateHooks({ hooks: [hook({ paysOffInArc: '' })] }), '空串合法')

  // 落盘往返：字段在 JSON 里保留，重新读回仍通过校验。
  const roundTrip = JSON.parse(JSON.stringify({ hooks: [withFields] }))
  assert.deepEqual(validateHooks(roundTrip).hooks[0], withFields)
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

test('counts group by status', () => {
  assert.deepEqual(countHooks({ hooks: [hook(), hook({ hookId: 'H2', status: 'resolved' })] }), {
    open: 0,
    progressing: 0,
    deferred: 1,
    resolved: 1,
    superseded: 0,
  })
})
