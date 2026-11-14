import test from 'node:test'
import assert from 'node:assert/strict'

import {
  validateCurrentState,
  validateHooksState,
  validateManifest,
  validateSummariesState,
} from '../src/core/state-schema.ts'
import { activateWorkStatus } from '../src/core/work-status.ts'

const manifest = { schemaVersion: 2, language: 'zh', lastAppliedChapter: 0, projectionVersion: 1 }
const hooks = {
  hooks: [{
    hookId: 'hook-1', startChapter: 0, type: 'promise', status: 'open', lastAdvancedChapter: 0,
    expectedPayoff: '', notes: '',
  }],
}
const summaries = {
  rows: [{
    chapter: 1, title: '雨夜', characters: '甲', events: '上山', stateChanges: '到山门', hookActivity: '无', mood: '冷', chapterType: '推进',
  }],
}
const current = {
  chapter: 0,
  facts: [{ subject: '甲', predicate: '位置', object: '山门', validFromChapter: 0, validUntilChapter: null, sourceChapter: 0 }],
}

test('state schemas accept source-shaped files and chapter 0', () => {
  assert.equal(validateManifest(manifest).ok, true)
  assert.equal(validateHooksState(hooks).ok, true)
  assert.equal(validateSummariesState(summaries).ok, true)
  assert.equal(validateCurrentState(current).ok, true)
  assert.equal(validateManifest({ ...manifest, projectionVersion: 2 }).ok, true)
  assert.equal(validateCurrentState({ ...current, chapter: 0 }).ok, true)
})

test('state schemas reject unknown fields and wrong bounds', () => {
  assert.equal(validateManifest({ ...manifest, extra: 1 }).ok, false)
  assert.equal(validateManifest({ ...manifest, lastAppliedChapter: -1 }).ok, false)
  assert.equal(validateManifest({ ...manifest, projectionVersion: 0 }).ok, false)
  assert.equal(validateManifest({ ...manifest, language: 'fr' }).ok, false)
  assert.equal(validateSummariesState({ rows: [{ ...summaries.rows[0], chapter: 0 }] }).ok, false)
  assert.equal(validateSummariesState({ rows: [{ ...summaries.rows[0], title: '' }] }).ok, false)
  assert.equal(validateSummariesState({ rows: [{ ...summaries.rows[0], extra: 1 }] }).ok, false)
  assert.equal(validateCurrentState({ ...current, facts: [{ ...current.facts[0], validFromChapter: -1 }] }).ok, false)
  assert.equal(validateCurrentState({ ...current, facts: [{ ...current.facts[0], extra: 1 }] }).ok, false)
  assert.equal(validateHooksState({ hooks: [{ ...hooks.hooks[0], status: 'nope' }] }).ok, false)
})

test('work status activation maps draft to active only', () => {
  assert.equal(activateWorkStatus({ status: 'draft' }), 'active')
  assert.equal(activateWorkStatus({ status: 'active' }), 'active')
  assert.equal(activateWorkStatus({ status: 'archived' }), 'archived')
})
