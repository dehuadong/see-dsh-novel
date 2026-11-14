import test from 'node:test'
import assert from 'node:assert/strict'

import { assertChapterLength, buildLengthSpec, chapterLengthDelivery } from '../src/core/length.ts'

test('length spec and delivery follow explicit bounds', () => {
  const spec = buildLengthSpec(300, 'zh', { minChapterLength: 5, maxChapterLength: 10 })
  assert.deepEqual(spec, { target: 300, countingMode: 'zh_chars', minChapterLength: 5, maxChapterLength: 10 })
  assert.equal(chapterLengthDelivery(7, spec).status, 'checks_passed')
  assert.equal(chapterLengthDelivery(4, spec).issues[0].minimum, 5)
  assert.equal(chapterLengthDelivery(11, spec).issues[0].maximum, 10)
  assert.equal(chapterLengthDelivery(7, buildLengthSpec(300, 'zh')), undefined)
})

test('assertChapterLength throws source code and context', () => {
  const spec = buildLengthSpec(300, 'zh', { minChapterLength: 5, maxChapterLength: 10 })
  assert.throws(
    () => assertChapterLength('短', spec, { scope: 'selected_ranges', source: 'ranges', candidateCommitted: false }),
    (error) => {
      assert.equal(error.code, 'CHAPTER_LENGTH_OUT_OF_RANGE')
      assert.equal(error.delivery.issues[0].minimum, 5)
      assert.equal(error.scope, 'selected_ranges')
      assert.equal(error.candidateCommitted, false)
      return true
    },
  )
  assert.doesNotThrow(() => assertChapterLength('一二三四五六七', spec))
})
