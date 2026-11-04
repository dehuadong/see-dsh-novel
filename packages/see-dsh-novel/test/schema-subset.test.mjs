import test from 'node:test'
import assert from 'node:assert/strict'

import {
  CAST_INDEX_PARAMETERS,
  COMMIT_OUTPUT,
  DETAILS_PARAMETERS,
  GATE_OUTPUT,
  NO_PARAMETERS,
  OUTLINE_PARAMETERS,
  SIGNOFF_OUTPUT,
  castDocumentsParameters,
} from '../src/pipelines/long/contract.ts'
import { storyNextOutput, storyNextParameters } from '../src/plugin/story-next.ts'
import { violations } from './support/schema-subset.mjs'

test('story_next schemas stay inside the runtime subset', () => {
  assert.deepEqual(violations(storyNextParameters), [])
  assert.deepEqual(violations(storyNextOutput), [])
})

test('foundation schemas stay inside the runtime subset', () => {
  assert.deepEqual(violations(OUTLINE_PARAMETERS), [])
  assert.deepEqual(violations(DETAILS_PARAMETERS), [])
  assert.deepEqual(violations(CAST_INDEX_PARAMETERS), [])
  assert.deepEqual(violations(COMMIT_OUTPUT), [])
})

test('approval schemas stay inside the runtime subset', () => {
  assert.deepEqual(violations(NO_PARAMETERS), [])
  assert.deepEqual(violations(GATE_OUTPUT), [])
  assert.deepEqual(violations(SIGNOFF_OUTPUT), [])
})

test('the dynamic character-card schema stays inside the runtime subset', () => {
  for (const roles of [
    [],
    [{ tier: 'major', name: '甲' }],
    [{ tier: 'major', name: '甲' }, { tier: 'minor', name: '乙' }, { tier: 'minor', name: '丙' }],
  ]) {
    assert.deepEqual(violations(castDocumentsParameters(roles)), [])
  }
})

test('the subset mirror rejects type arrays', () => {
  assert.match(
    violations({ type: 'object', properties: { work: { type: ['string', 'null'] } } }).join('\n'),
    /type arrays are not supported/,
  )
})

test('the subset mirror rejects constraint keywords beside oneOf', () => {
  const schema = {
    oneOf: [{ type: 'string' }, { type: 'null' }],
    properties: { a: { type: 'string' } },
  }
  assert.match(violations(schema).join('\n'), /properties is not supported beside oneOf/)
})
