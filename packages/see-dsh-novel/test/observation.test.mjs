import test from 'node:test'
import assert from 'node:assert/strict'

import { countObservations, numberSourceLines, resolveObservationSources } from '../src/core/observation.ts'

const sources = new Map([
  ['chapter-1', '雨从二十三点下到现在。\n\n沈砚站在巷口。\n\n编号牌在灯下反光。'],
])

const observation = (over = {}) => ({
  code: 'continuity',
  summary: '编号牌出现得太早',
  assessment: 'issue',
  evidence: ['第二卷才该出现'],
  sourceRefs: [{ sourceId: 'chapter-1', startLine: 1, endLine: 1 }],
  ...over,
})

test('numbered sources keep every line addressable', () => {
  assert.equal(numberSourceLines('a\nb'), '1 | a\n2 | b')
})

test('line ranges resolve to exact quotes and quotes are verified', () => {
  const [resolved] = resolveObservationSources([observation({ sourceRefs: [{ sourceId: 'chapter-1', startLine: 3, endLine: 5 }] })], sources)
  assert.equal(resolved.sourceRefs[0].quote, '沈砚站在巷口。\n\n编号牌在灯下反光。')
  const [quoted] = resolveObservationSources([observation({ sourceRefs: [{ sourceId: 'chapter-1', quote: '编号牌在灯下反光。' }] })], sources)
  assert.equal(quoted.sourceRefs[0].quote, '编号牌在灯下反光。')
})

test('missing evidence, unknown sources, bad ranges, blank ranges and mismatched quotes fail by code', () => {
  const errorOf = (input) => {
    try {
      resolveObservationSources([input], sources)
    } catch (error) {
      return JSON.parse(error.message).code
    }
    return 'no-error'
  }
  assert.equal(errorOf(observation({ sourceRefs: [] })), 'REVIEW_SOURCE_REQUIRED')
  assert.equal(errorOf(observation({ sourceRefs: [{ sourceId: 'nope', quote: 'x' }] })), 'REVIEW_SOURCE_UNKNOWN')
  assert.equal(errorOf(observation({ sourceRefs: [{ sourceId: 'chapter-1', startLine: 9, endLine: 12 }] })), 'REVIEW_SOURCE_RANGE_INVALID')
  assert.equal(errorOf(observation({ sourceRefs: [{ sourceId: 'chapter-1', startLine: 2, endLine: 2 }] })), 'REVIEW_SOURCE_REQUIRED')
  assert.equal(errorOf(observation({ sourceRefs: [{ sourceId: 'chapter-1', quote: '不存在的句子' }] })), 'REVIEW_SOURCE_MISMATCH')
  // unavailable 观察可以不带证据。
  assert.equal(errorOf(observation({ assessment: 'unavailable', sourceRefs: [] })), 'no-error')
})

test('counts follow the assessments', () => {
  const resolved = resolveObservationSources([
    observation(),
    observation({ assessment: 'unavailable', sourceRefs: [] }),
    observation({ assessment: 'observation' }),
  ], sources)
  assert.deepEqual(countObservations(resolved), { issue: 1, resolved: 0, observation: 1, unavailable: 1 })
})
