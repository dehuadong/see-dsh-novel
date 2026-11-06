import test from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULT_CHAPTER_LENGTH_EN, DEFAULT_CHAPTER_LENGTH_ZH, defaultChapterLength } from '../src/core/length.ts'

test('chapter length defaults follow the work language', () => {
  assert.equal(defaultChapterLength('zh'), 3000)
  assert.equal(defaultChapterLength('en'), 2000)
  assert.equal(DEFAULT_CHAPTER_LENGTH_ZH, 3000)
  assert.equal(DEFAULT_CHAPTER_LENGTH_EN, 2000)
})
