import test from 'node:test'
import assert from 'node:assert/strict'
import { link, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildWorkExport, ChapterExportSourceError, writeWorkExport } from '../src/core/export.ts'
import { installExportCommand } from '../src/plugin/export-command.ts'
import { WORK_FILE } from '../src/core/story-paths.ts'

async function workspace({
  language = 'zh',
  indexTitle = '雨夜',
  filename = '0001_雨夜.md',
  heading = '# 第1章 雨夜',
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'see-dsh-novel-export-'))
  await mkdir(join(root, 'source/chapters'), { recursive: true })
  await writeFile(join(root, WORK_FILE), JSON.stringify({
    version: 1, id: 'w', title: '标题', profile: 'longform-novel', language, status: 'active',
    metadata: { chapterWordCount: 300 }, createdAt: '2026-11-10T00:00:00.000Z', updatedAt: '2026-11-10T00:00:00.000Z',
  }))
  await writeFile(join(root, `source/chapters/${filename}`), `${heading}\n\n正文第一句。\n\n第二句。\n`)
  await writeFile(join(root, 'source/chapters/index.json'), JSON.stringify([{
    number: 1,
    title: indexTitle,
    wordCount: 9,
    createdAt: '2026-11-10T00:00:00.000Z',
    updatedAt: '2026-11-10T00:00:00.000Z',
    observations: [],
    provenance: 'generated',
  }]))
  return root
}

function zipEntry(buffer, name) {
  const nameBytes = Buffer.from(name, 'utf8')
  let offset = 0
  while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const size = buffer.readUInt32LE(offset + 18)
    const nameLength = buffer.readUInt16LE(offset + 26)
    const extraLength = buffer.readUInt16LE(offset + 28)
    const entryName = buffer.subarray(offset + 30, offset + 30 + nameLength)
    const start = offset + 30 + nameLength + extraLength
    if (entryName.equals(nameBytes)) return buffer.subarray(start, start + size).toString('utf8')
    offset = start + size
  }
  throw new Error(`ZIP 里没有 ${name}`)
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

test('writing replaces the existing export in place', async (t) => {
  const root = await workspace()
  try {
    const first = await writeWorkExport(root, 'txt')
    assert.match(first.outputPath, /w\.txt$/)
    assert.match(await readFile(join(root, 'w.txt'), 'utf8'), /正文第一句/)

    try {
      await link(join(root, 'w.txt'), join(root, 'probe.txt'))
    } catch (error) {
      if (!['EPERM', 'ENOTSUP', 'EXDEV'].includes(error.code)) throw error
      t.diagnostic(`hard links unavailable: ${error.code}`)
      t.skip('hard links unavailable on this filesystem')
      return
    }

    await writeFile(join(root, 'source/chapters/0001_雨夜.md'), '# 第1章 雨夜\n\n改过的正文。\n')
    await writeWorkExport(root, 'txt')
    const text = await readFile(join(root, 'w.txt'), 'utf8')
    assert.match(text, /改过的正文/)
    assert.doesNotMatch(text, /正文第一句/)
    assert.match(await readFile(join(root, 'probe.txt'), 'utf8'), /改过的正文/, '直写应原地截断覆盖，不换 inode')
    assert.equal((await stat(join(root, 'probe.txt'))).ino, (await stat(join(root, 'w.txt'))).ino)
    assert.deepEqual((await readdir(root)).filter((name) => name.endsWith('.tmp')), [])
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

test('epub chapter titles come from the rendered heading', async () => {
  const root = await workspace()
  try {
    const epub = await buildWorkExport(root, 'epub')
    const chapter = zipEntry(epub.payload, 'OEBPS/chapter-1.xhtml')
    assert.match(chapter, /<title>第1章 雨夜<\/title>/u)
    assert.match(chapter, /<h1>第1章 雨夜<\/h1>/u)
    const nav = zipEntry(epub.payload, 'OEBPS/nav.xhtml')
    assert.match(nav, /<a href="chapter-1.xhtml">第1章 雨夜<\/a>/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('epub language follows the work language', async () => {
  const zh = await workspace()
  try {
    const epub = await buildWorkExport(zh, 'epub')
    const chapter = zipEntry(epub.payload, 'OEBPS/chapter-1.xhtml')
    assert.match(chapter, /<html xmlns="http:\/\/www.w3.org\/1999\/xhtml" xml:lang="zh-CN" lang="zh-CN">/u)
    const nav = zipEntry(epub.payload, 'OEBPS/nav.xhtml')
    assert.match(nav, /xml:lang="zh-CN" lang="zh-CN"/u)
    assert.match(zipEntry(epub.payload, 'OEBPS/content.opf'), /<dc:language>zh-CN<\/dc:language>/u)
  } finally {
    await rm(zh, { recursive: true, force: true })
  }

  const en = await workspace({ language: 'en', indexTitle: 'Rain', filename: '0001_Rain.md', heading: '# Chapter 1: Rain' })
  try {
    const epub = await buildWorkExport(en, 'epub')
    const chapter = zipEntry(epub.payload, 'OEBPS/chapter-1.xhtml')
    assert.match(chapter, /<html xmlns="http:\/\/www.w3.org\/1999\/xhtml" xml:lang="en" lang="en">/u)
    assert.doesNotMatch(chapter, /zh-CN/u)
    assert.match(zipEntry(epub.payload, 'OEBPS/nav.xhtml'), /xml:lang="en" lang="en"/u)
    assert.match(zipEntry(epub.payload, 'OEBPS/content.opf'), /<dc:language>en<\/dc:language>/u)
    assert.match(chapter, /<title>Chapter 1: Rain<\/title>/u)
    assert.match(chapter, /<h1>Chapter 1: Rain<\/h1>/u)
    assert.match(zipEntry(epub.payload, 'OEBPS/nav.xhtml'), /<a href="chapter-1.xhtml">Chapter 1: Rain<\/a>/u)
  } finally {
    await rm(en, { recursive: true, force: true })
  }
})

test('epub navigation title is Table of Contents', async () => {
  for (const options of [
    {},
    { language: 'en', indexTitle: 'Rain', filename: '0001_Rain.md', heading: '# Chapter 1: Rain' },
  ]) {
    const root = await workspace(options)
    try {
      const nav = zipEntry((await buildWorkExport(root, 'epub')).payload, 'OEBPS/nav.xhtml')
      assert.match(nav, /<h1>Table of Contents<\/h1>/u)
      assert.doesNotMatch(nav, /目录/u)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }
})

test('an unwritable target fails without side effects', async () => {
  const root = await workspace()
  try {
    const chapterPath = join(root, 'source/chapters/0001_雨夜.md')
    const chapterBefore = await readFile(chapterPath, 'utf8')
    await mkdir(join(root, 'w.txt'))
    await assert.rejects(writeWorkExport(root, 'txt'), (error) => {
      assert.equal(error.code, 'EISDIR')
      return true
    })
    assert.deepEqual((await readdir(root)).filter((name) => name.endsWith('.tmp')), [])
    assert.match(await readFile(join(root, WORK_FILE), 'utf8'), /"id":"w"/u)
    assert.equal(await readFile(chapterPath, 'utf8'), chapterBefore)

    const commands = new Map()
    const dispose = installExportCommand({
      commands: { register: (definition) => { commands.set(definition.name, definition); return () => {} } },
      workingDirectory: { ensure: async () => root },
    })
    try {
      const result = await commands.get('story-export').handler({ rawInput: 'txt', agent: { session: 's' } })
      assert.equal(result.kind, 'error')
    } finally {
      dispose()
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('empty index titles do not fall back to the file name', async () => {
  for (const options of [
    { indexTitle: '' },
    { indexTitle: '', language: 'en', filename: '0001_Rain.md', heading: '# Chapter 1: Rain' },
  ]) {
    const root = await workspace(options)
    try {
      const txt = (await buildWorkExport(root, 'txt')).payload.toString('utf8')
      assert.match(txt, options.language === 'en' ? /# Chapter 1: ?\n/u : /# 第1章 ?\n/u)
      assert.doesNotMatch(txt, /Rain|雨夜/u)
      const md = (await buildWorkExport(root, 'md')).payload.toString('utf8')
      assert.match(md, options.language === 'en' ? /# Chapter 1: ?\n/u : /# 第1章 ?\n/u)
      assert.doesNotMatch(md, /Rain|雨夜/u)

      const epub = await buildWorkExport(root, 'epub')
      const chapter = zipEntry(epub.payload, 'OEBPS/chapter-1.xhtml')
      assert.match(chapter, options.language === 'en' ? /<title>Chapter 1:<\/title>/u : /<title>第1章<\/title>/u)
      assert.match(chapter, options.language === 'en' ? /<h1>Chapter 1:<\/h1>/u : /<h1>第1章<\/h1>/u)
      assert.match(zipEntry(epub.payload, 'OEBPS/nav.xhtml'), options.language === 'en' ? />Chapter 1:</u : />第1章</u)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
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
