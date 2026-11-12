import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildWorkExport, ChapterExportSourceError, writeWorkExport } from '../src/core/export.ts'
import { installExportCommand } from '../src/plugin/export-command.ts'
import { WORK_FILE } from '../src/core/story-paths.ts'

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'see-dsh-novel-export-'))
  await mkdir(join(root, 'source/chapters'), { recursive: true })
  await writeFile(join(root, WORK_FILE), JSON.stringify({
    version: 1, id: 'w', title: '标题', profile: 'longform-novel', language: 'zh', status: 'active',
    metadata: { chapterWordCount: 300 }, createdAt: '2026-11-10T00:00:00.000Z', updatedAt: '2026-11-10T00:00:00.000Z',
  }))
  await writeFile(join(root, 'source/chapters/0001_雨夜.md'), '# 第1章 雨夜\n\n正文第一句。\n\n第二句。\n')
  await writeFile(join(root, 'source/chapters/index.json'), JSON.stringify([{
    number: 1,
    title: '雨夜',
    wordCount: 9,
    createdAt: '2026-11-10T00:00:00.000Z',
    updatedAt: '2026-11-10T00:00:00.000Z',
    observations: [],
    provenance: 'generated',
  }]))
  return root
}

test('builds txt and md with the book title and chapter heading', async () => {
  const root = await workspace()
  try {
    const txt = await buildWorkExport(root, 'txt')
    const txtText = txt.payload.toString('utf8')
    assert.match(txtText, /^标题/u)
    assert.match(txtText, /第1章 雨夜/)
    assert.match(txtText, /正文第一句/)
    assert.equal(txt.chaptersExported, 1)
    assert.equal(txt.totalWords, 9)
    assert.equal(txt.fileName, 'w.txt')

    const md = await buildWorkExport(root, 'md')
    assert.match(md.payload.toString('utf8'), /^# 标题/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('reports index and file mismatches with details', async () => {
  const root = await workspace()
  try {
    await rm(join(root, 'source/chapters/0001_雨夜.md'))
    await assert.rejects(buildWorkExport(root, 'txt'), (error) => {
      assert.ok(error instanceof ChapterExportSourceError)
      assert.equal(error.code, 'CHAPTER_EXPORT_SOURCE_MISMATCH')
      assert.deepEqual(error.details.missingChapterNumbers, [1])
      return true
    })

    await writeFile(join(root, 'source/chapters/0001_雨夜.md'), '# 第1章 雨夜\n\n正文。\n')
    await writeFile(join(root, 'source/chapters/0002_多余.md'), '# 第2章 多余\n\n多余。\n')
    await assert.rejects(buildWorkExport(root, 'txt'), (error) => {
      assert.deepEqual(error.details.unindexedFiles, ['0002_多余.md'])
      return true
    })

    await rm(join(root, 'source/chapters/0002_多余.md'))
    await writeFile(join(root, 'source/chapters/0001_别名.md'), '# 第1章 别名\n\n别名。\n')
    await assert.rejects(buildWorkExport(root, 'txt'), (error) => {
      assert.deepEqual(error.details.duplicateChapterNumbers, [1])
      return true
    })

    await rm(join(root, 'source/chapters/0001_别名.md'))
    const index = JSON.parse(await readFile(join(root, 'source/chapters/index.json'), 'utf8'))
    await writeFile(join(root, 'source/chapters/index.json'), JSON.stringify([...index, { ...index[0] }]))
    await assert.rejects(buildWorkExport(root, 'txt'), (error) => {
      assert.deepEqual(error.details.duplicateIndexNumbers, [1])
      return true
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('writing replaces the existing export atomically', async () => {
  const root = await workspace()
  try {
    const first = await writeWorkExport(root, 'txt')
    assert.match(first.outputPath, /w\.txt$/)
    assert.match(await readFile(join(root, 'w.txt'), 'utf8'), /正文第一句/)

    await writeFile(join(root, 'source/chapters/0001_雨夜.md'), '# 第1章 雨夜\n\n改过的正文。\n')
    await writeWorkExport(root, 'txt')
    const text = await readFile(join(root, 'w.txt'), 'utf8')
    assert.match(text, /改过的正文/)
    assert.doesNotMatch(text, /正文第一句/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('epub is a zip whose first entry is the uncompressed mimetype', async () => {
  const root = await workspace()
  try {
    const epub = await buildWorkExport(root, 'epub')
    const buffer = epub.payload
    assert.equal(buffer.subarray(0, 2).toString('latin1'), 'PK')
    assert.equal(buffer.subarray(30, 38).toString('latin1'), 'mimetype')
    assert.equal(buffer.subarray(38, 58).toString('latin1'), 'application/epub+zip')
    const raw = buffer.toString('latin1')
    for (const entry of ['META-INF/container.xml', 'OEBPS/content.opf', 'OEBPS/nav.xhtml', 'OEBPS/chapter-1.xhtml']) {
      assert.ok(raw.includes(entry), entry)
    }
    assert.equal(epub.fileName, 'w.epub')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('an empty chapter index is rejected', async () => {
  const root = await workspace()
  try {
    await writeFile(join(root, 'source/chapters/index.json'), '[]')
    await rm(join(root, 'source/chapters/0001_雨夜.md'))
    await assert.rejects(buildWorkExport(root, 'txt'), /没有可导出的章节/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the export command parses the format and reports the path', async () => {
  const root = await workspace()
  const commands = new Map()
  const dispose = installExportCommand({
    commands: { register: (definition) => { commands.set(definition.name, definition); return () => {} } },
    workingDirectory: { ensure: async () => root },
  })
  try {
    const command = commands.get('story-export')
    const md = await command.handler({ rawInput: ' md ', agent: { session: 's' } })
    assert.equal(md.kind, 'success')
    assert.match(md.text, /w\.md/)
    assert.match(await readFile(join(root, 'w.md'), 'utf8'), /^# 标题/u)

    const fallback = await command.handler({ rawInput: '', agent: { session: 's' } })
    assert.equal(fallback.kind, 'success')
    assert.match(fallback.text, /w\.txt/)

    const bad = await command.handler({ rawInput: 'pdf', agent: { session: 's' } })
    assert.equal(bad.kind, 'error')
    assert.match(bad.text, /导出格式必须是/)
  } finally {
    dispose()
    await rm(root, { recursive: true, force: true })
  }
})
