import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  chapterHeading,
  countChapterLength,
  loadChapterDocument,
  renderChapterDocument,
  safeChapterTitle,
  writeChapterDocument,
} from '../src/core/chapter-document.ts'

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'see-dsh-novel-doc-'))
  await mkdir(join(root, 'source/chapters'), { recursive: true })
  return root
}

const cleanup = (root) => rm(root, { recursive: true, force: true })

test('headings follow the language and the body drops its own title line', () => {
  assert.equal(chapterHeading(3, '雨夜', 'zh'), '# 第3章 雨夜')
  assert.equal(chapterHeading(3, 'Rain', 'en'), '# Chapter 3: Rain')
  assert.equal(
    renderChapterDocument({ chapter: 1, title: '雨夜', content: '# 第1章 雨夜\n\n正文一。\n' , language: 'zh' }),
    '# 第1章 雨夜\n\n正文一。\n',
  )
})

test('file titles are path-safe', () => {
  assert.equal(safeChapterTitle('雨夜/重生: 上'), '雨夜重生-上')
  assert.throws(() => safeChapterTitle('  '), /title/)
})

test('length counts CJK characters or English words', () => {
  assert.equal(countChapterLength('雨夜，沈砚接案。', 'zh'), 6)
  assert.equal(countChapterLength('one two three', 'en'), 3)
})

test('write refuses a second draft for the same chapter and load round-trips', async () => {
  const root = await workspace()
  try {
    const written = await writeChapterDocument(root, { chapter: 1, title: '雨夜', content: '正文一。', language: 'zh' })
    assert.equal(written.path, 'source/chapters/0001_雨夜.md')
    assert.equal(written.charCount, 3)
    assert.match(await readFile(join(root, written.path), 'utf8'), /^# 第1章 雨夜\n\n正文一。\n$/)
    const loaded = await loadChapterDocument(root, 1)
    assert.equal(loaded.heading, '# 第1章 雨夜')
    assert.equal(loaded.content, '正文一。')
    await assert.rejects(
      writeChapterDocument(root, { chapter: 1, title: '另一版', content: 'x', language: 'zh' }),
      /已经有正文/,
    )
    assert.equal(await loadChapterDocument(root, 2), null)
    await assert.rejects(writeChapterDocument(root, { chapter: 2, title: '空', content: '  \n ', language: 'zh' }), /content/)
  } finally {
    await cleanup(root)
  }
})
