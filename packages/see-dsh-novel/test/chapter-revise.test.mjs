import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { installReviseTool } from '../src/pipelines/long/revise-tool.ts'
import { countChapterLength, loadChapterDocument, reviseChapterDocument, writeChapterDocument } from '../src/core/chapter-document.ts'
import { loadArtifactStore, readArtifactRevision } from '../src/core/artifact-store.ts'
import { chapterReviewPath, reviewChapter } from '../src/core/chapter-review.ts'
import { chapterUsagePath } from '../src/core/chapter-usage.ts'
import { saveChapterPlan } from '../src/core/chapter-plan.ts'
import { applyRangeEdits, assertTargetText, normalizeRangeEdits } from '../src/core/revise.ts'
import { WORK_FILE } from '../src/core/story-paths.ts'
import { readWorkflowStart } from '../src/core/workflow-start.ts'

const ORIGINAL = '第一段。\n第二段。\n第三段。'

async function workspace(withChapter = true, language = 'zh') {
  const root = await mkdtemp(join(tmpdir(), 'see-dsh-novel-revise-'))
  await mkdir(join(root, 'source/story/runtime'), { recursive: true })
  await mkdir(join(root, 'source/story/state'), { recursive: true })
  await mkdir(join(root, 'source/chapters'), { recursive: true })
  await writeFile(join(root, WORK_FILE), JSON.stringify({
    version: 1, id: 'w', title: '标题', profile: 'longform-novel', language, status: 'draft',
    metadata: { chapterWordCount: 300 }, createdAt: '2026-11-10T00:00:00.000Z', updatedAt: '2026-11-10T00:00:00.000Z',
  }))
  await saveChapterPlan(root, { chapter: 1, goal: '目标', body: '正文计划', threadRefs: [] })
  if (withChapter) await writeChapterDocument(root, { chapter: 1, title: '雨夜', content: ORIGINAL, language })
  await writeFile(join(root, 'source/chapters/index.json'), '[]')
  return root
}

function tool(root) {
  const tools = new Map()
  installReviseTool({
    tools: { register: (definition) => { tools.set(definition.name, definition); return () => tools.delete(definition.name) } },
    workingDirectory: { ensure: async () => root },
  })
  return tools.get('story_revise_chapter')
}

const exec = { agent: { session: 's' } }

async function reviewOnce(root) {
  await reviewChapter(root, {
    chapter: 1,
    summary: '初审',
    observations: [{ code: 'C1', summary: '示例观察', assessment: 'unavailable' }],
  })
}

test('range edits pair, sort, validate and construct the body', () => {
  const edits = normalizeRangeEdits(
    [{ startLine: 3, endLine: 3 }, { startLine: 1, endLine: 1 }],
    ['C', 'A'],
    3,
  )
  assert.deepEqual(edits, [
    { range: { startLine: 1, endLine: 1 }, replacement: 'A' },
    { range: { startLine: 3, endLine: 3 }, replacement: 'C' },
  ])
  assert.equal(applyRangeEdits('a\nb\nc', edits), 'A\nb\nC')
  assert.equal(
    applyRangeEdits('a\nb\nc', normalizeRangeEdits([{ startLine: 2, endLine: 2 }], [''], 3)),
    'a\nc',
  )
  assert.equal(
    applyRangeEdits('a\nb\nc', normalizeRangeEdits([{ startLine: 2, endLine: 2 }], ['B1\nB2'], 3)),
    'a\nB1\nB2\nc',
  )
})

test('range edits reject bad shapes, bounds and overlaps', () => {
  assert.throws(() => normalizeRangeEdits([{ startLine: 1, endLine: 1 }], [], 3), /ARTIFACT_EDIT_RANGE_INVALID/u)
  assert.throws(() => normalizeRangeEdits([], [''], 3), /ARTIFACT_EDIT_RANGE_INVALID/u)
  assert.throws(
    () => normalizeRangeEdits([{ startLine: 1, endLine: 1 }, { startLine: 1, endLine: 2 }], ['A', 'B'], 3),
    /ARTIFACT_EDIT_RANGE_INVALID/u,
  )
  assert.throws(
    () => normalizeRangeEdits([{ startLine: 2, endLine: 4 }], ['A'], 3),
    /ARTIFACT_EDIT_RANGE_INVALID/u,
  )
  assert.throws(
    () => normalizeRangeEdits([{ startLine: 1.5, endLine: 2 }], ['A'], 3),
    /ARTIFACT_EDIT_RANGE_INVALID/u,
  )
})

test('targetText binds a unique fragment and keeps the rest byte-identical', () => {
  assert.doesNotThrow(() => assertTargetText('abc\ndef', 'aXbc\ndef', 'ab'))
  assert.throws(() => assertTargetText('abc\ndef', 'Xbc\ndef', 'bc'), /CHAPTER_EDIT_SCOPE_CONFLICT/u)
  assert.throws(() => assertTargetText('abc\ndef', 'aXbc\ndef', 'zz'), /ARTIFACT_EDIT_TARGET_NOT_FOUND/u)
  assert.throws(() => assertTargetText('ab\nab', 'X\nab', 'ab'), /ARTIFACT_EDIT_TARGET_AMBIGUOUS/u)
  assert.throws(() => assertTargetText('abc', 'abc', ''), /ARTIFACT_EDIT_TARGET_NOT_FOUND/u)
  assert.throws(() => assertTargetText('AB。CD', 'AB。XD', 'AB'), /CHAPTER_EDIT_SCOPE_CONFLICT/u)
})

test('reviseChapterDocument rewrites the chapter, archives the old prose and appends a revision', async () => {
  const root = await workspace()
  try {
    const revised = '第一段。\n第二段重写。\n第三段。'
    const result = await reviseChapterDocument(root, { chapter: 1, content: revised, language: 'zh' })
    assert.equal(result.revisionId, 'r2')
    assert.match(result.archivedPath, /^source\/chapters\/\.versions\/0001\/\d+_revision_[0-9a-f-]+\.md$/u)

    const document = await loadChapterDocument(root, 1)
    assert.match(document.heading, /^# 第1章 雨夜$/u)
    assert.equal(document.content, revised)

    const archived = await readFile(join(root, result.archivedPath), 'utf8')
    assert.match(archived, /第二段。/)
    assert.doesNotMatch(archived, /第二段重写/)

    const store = await loadArtifactStore(root)
    const artifact = store.artifacts.find((entry) => entry.id === 'chapter-0001')
    assert.equal(artifact.revisions.length, 2)
    assert.equal(artifact.currentRevisionId, 'r2')
    assert.equal(artifact.revisions.find((entry) => entry.id === 'r2')?.parentRevisionId, 'r1')
    assert.equal(artifact.revisions.find((entry) => entry.id === 'r1')?.status, 'superseded')
    assert.equal(artifact.revisions.find((entry) => entry.id === 'r1')?.snapshotPath, 'source/artifacts/chapter-0001/revisions/r1.md')
    assert.equal(artifact.revisions.find((entry) => entry.id === 'r2')?.snapshotPath, 'source/artifacts/chapter-0001/revisions/r2.md')

    assert.deepEqual(result.changedRegion, {
      scope: 'contiguous_changed_region',
      before: { startLine: 2, lineCount: 1, content: '第二段。\n', truncated: false },
      after: { startLine: 2, lineCount: 1, content: '第二段重写。\n', truncated: false },
    })
    const index = JSON.parse(await readFile(join(root, 'source/chapters/index.json'), 'utf8'))
    assert.deepEqual(index.map((entry) => [entry.number, entry.provenance]), [[1, 'edited']])
    assert.deepEqual(index[0].observations, [])
    assert.equal(index[0].title, '雨夜')
    assert.equal(index[0].wordCount, countChapterLength(revised, 'zh'))
    assert.equal(index[0].createdAt, index[0].updatedAt)
    assert.deepEqual(index[0].lengthTelemetry, {
      target: 3000,
      countingMode: 'zh_chars',
      writerCount: countChapterLength(ORIGINAL, 'zh'),
      postReviseCount: countChapterLength(revised, 'zh'),
      finalCount: countChapterLength(revised, 'zh'),
      repairApplied: true,
    })
    assert.equal(result.lengthTelemetry.target, 3000)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('revision snapshots stay readable and fail with coded errors', async () => {
  const root = await workspace()
  try {
    await reviewOnce(root)
    await reviseChapterDocument(root, { chapter: 1, content: '第一段。\n第二段重写。\n第三段。', language: 'zh' })
    const originalDocument = `# 第1章 雨夜\n\n${ORIGINAL}\n`
    assert.equal((await readArtifactRevision(root, { artifactId: 'chapter-0001', revisionId: 'r1' })).bytes.toString('utf8'), originalDocument)
    assert.match((await readArtifactRevision(root, { artifactId: 'chapter-0001', revisionId: 'r2' })).bytes.toString('utf8'), /第二段重写/)

    await rm(join(root, 'source/chapters/0001_雨夜.md'), { force: true })
    assert.equal((await readArtifactRevision(root, { artifactId: 'chapter-0001', revisionId: 'r1' })).bytes.toString('utf8'), originalDocument)

    await rm(join(root, 'source/artifacts/chapter-0001/revisions/r1.md'), { force: true })
    await assert.rejects(
      readArtifactRevision(root, { artifactId: 'chapter-0001', revisionId: 'r1' }),
      { code: 'ARTIFACT_SNAPSHOT_UNAVAILABLE' },
    )

    await writeFile(join(root, 'source/artifacts/chapter-0001/revisions/r2.md'), '被改坏')
    await assert.rejects(
      readArtifactRevision(root, { artifactId: 'chapter-0001', revisionId: 'r2' }),
      { code: 'ARTIFACT_REVISION_CONFLICT' },
    )
    await assert.rejects(
      readArtifactRevision(root, { artifactId: 'chapter-0001', revisionId: 'r9' }),
      { code: 'ARTIFACT_NOT_FOUND' },
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the revise tool invalidates the review and the stage can be reviewed again', async () => {
  const root = await workspace()
  try {
    await reviewOnce(root)
    const revise = tool(root)
    const result = await revise.execute({ chapter: 1, content: '第一段。\n第二段重写。\n第三段。' }, exec)
    assert.equal(result.changed, true)
    assert.equal(result.mode, 'rewrite')
    assert.equal(result.reviewInvalidated, true)
    assert.equal(result.changedRegion.scope, 'contiguous_changed_region')
    const text = tool(root).output.render({}, result)[0].text
    assert.match(text, /"scope":"contiguous_changed_region"/)
    assert.match(text, /"content":"第二段重写。\\n"/)
    await assert.rejects(stat(join(root, chapterReviewPath(1))), { code: 'ENOENT' })
    // 复审要过 workflow start 闸门：修订随带重开一章。
    assert.equal((await readWorkflowStart(root))?.chapter, 1)
    assert.match((await readWorkflowStart(root)).instruction, /重审第 1 章/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('an unchanged revise refreshes the index but keeps the chapter and review', async () => {
  const root = await workspace()
  try {
    await reviewOnce(root)
    const before = await readFile(join(root, 'source/artifacts/manifest.json'), 'utf8')
    const chapterBefore = await readFile(join(root, 'source/chapters/0001_雨夜.md'), 'utf8')
    const result = await tool(root).execute({ chapter: 1, content: ORIGINAL }, exec)
    assert.equal(result.changed, false)
    assert.equal(result.reviewInvalidated, false)
    assert.equal(result.changedRegion.before.lineCount, 0)
    assert.equal(result.changedRegion.after.lineCount, 0)
    assert.equal(await readFile(join(root, 'source/artifacts/manifest.json'), 'utf8'), before)
    assert.equal(await readFile(join(root, 'source/chapters/0001_雨夜.md'), 'utf8'), chapterBefore)
    assert.ok((await stat(join(root, chapterReviewPath(1)))).isFile())
    assert.equal(await readWorkflowStart(root), null, '没有改动就不重开一章')
    const index = JSON.parse(await readFile(join(root, 'source/chapters/index.json'), 'utf8'))
    assert.deepEqual(index.map((entry) => [entry.number, entry.provenance, entry.observations.length]), [[1, 'edited', 0]])
    assert.equal(index[0].title, '雨夜')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('spot-fix with no change returns changed=false and keeps the review', async () => {
  const root = await workspace()
  try {
    await reviewOnce(root)
    const result = await tool(root).execute({
      chapter: 1,
      mode: 'spot-fix',
      content: ORIGINAL,
      ranges: [{ startLine: 2, endLine: 2 }],
      replacements: ['第二段。'],
    }, exec)
    assert.equal(result.changed, false)
    assert.equal(result.reviewInvalidated, false)
    assert.equal(result.changedRegion.before.lineCount, 0)
    assert.ok((await stat(join(root, chapterReviewPath(1)))).isFile())
    assert.equal((await loadChapterDocument(root, 1)).content, ORIGINAL)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('revising a chapter marks its descendants upstream-revision and keeps their other fields', async () => {
  const root = await workspace()
  try {
    const row = (number, title) => ({
      number, title, wordCount: 3,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      observations: [{ code: 'upstream-revision', summary: '旧提醒', assessment: 'observation', evidence: [], sourceRefs: [] }],
      provenance: 'generated',
    })
    await writeFile(join(root, 'source/chapters/index.json'), JSON.stringify([row(1, '雨夜'), row(2, '第二')]))
    await reviseChapterDocument(root, { chapter: 1, content: '第一段。\n第二段重写。\n第三段。', language: 'zh' })
    const index = JSON.parse(await readFile(join(root, 'source/chapters/index.json'), 'utf8'))
    assert.equal(index[0].provenance, 'edited')
    assert.equal(index[0].createdAt, '2026-01-01T00:00:00.000Z')
    assert.equal(index[1].provenance, 'generated')
    assert.deepEqual(index[1].observations.map((observation) => observation.code), ['upstream-revision'])
    assert.match(index[1].observations[0].summary, /第1章已重写/)
    assert.equal(index[1].observations[0].summary === '旧提醒', false)
    assert.notEqual(index[1].updatedAt, '2026-01-01T00:00:00.000Z')
    assert.equal(index[1].createdAt, '2026-01-01T00:00:00.000Z')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('revising rejects a missing or malformed index before writing', async () => {
  const root = await workspace()
  try {
    const chapterBefore = await readFile(join(root, 'source/chapters/0001_雨夜.md'), 'utf8')
    await rm(join(root, 'source/chapters/index.json'), { force: true })
    await assert.rejects(tool(root).execute({ chapter: 1, content: '第一段改。\n第二段。\n第三段。' }, exec), /index\.json 缺失/)
    assert.equal(await readFile(join(root, 'source/chapters/0001_雨夜.md'), 'utf8'), chapterBefore)

    await writeFile(join(root, 'source/chapters/index.json'), '{ bad')
    await assert.rejects(tool(root).execute({ chapter: 1, content: '第一段改。\n第二段。\n第三段。' }, exec), /不是合法 JSON/)
    assert.equal(await readFile(join(root, 'source/chapters/0001_雨夜.md'), 'utf8'), chapterBefore)
    await assert.rejects(stat(join(root, 'source/chapters/.versions')), { code: 'ENOENT' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('an English work gets the English downstream notice', async () => {
  const root = await workspace(true, 'en')
  try {
    const row = (number) => ({
      number, title: `Chapter ${number}`, wordCount: 3,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      observations: [], provenance: 'generated',
    })
    await writeFile(join(root, 'source/chapters/index.json'), JSON.stringify([row(1), row(2)]))
    await reviseChapterDocument(root, { chapter: 1, content: '第一段改。\n第二段。\n第三段。', language: 'en' })
    const index = JSON.parse(await readFile(join(root, 'source/chapters/index.json'), 'utf8'))
    assert.match(index[1].observations[0].summary, /^Chapter 1 changed/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a long changed region is truncated to the receipt limit', async () => {
  const root = await workspace()
  try {
    const result = await tool(root).execute({ chapter: 1, content: '甲'.repeat(2100) }, exec)
    assert.equal(result.changedRegion.after.truncated, true)
    assert.equal(result.changedRegion.after.content.length, 2000)
    assert.equal(result.changedRegion.before.truncated, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the revise tool rejects missing chapter, missing plan, empty content and unknown mode', async () => {
  const empty = await workspace(false)
  const root = await workspace()
  try {
    await assert.rejects(tool(empty).execute({ chapter: 1, content: '正文。' }, exec), /还没有正文/)
    await assert.rejects(tool(root).execute({ chapter: 1, content: '   ' }, exec), /content 不能为空/)
    await assert.rejects(tool(root).execute({ chapter: 1, content: '改。', mode: 'nonsense' }, exec), /未知的修订模式/)

    await rm(join(root, 'source/story/runtime/chapter-0001.plan.json'), { force: true })
    await assert.rejects(tool(root).execute({ chapter: 1, content: '第一段改。\n第二段。\n第三段。' }, exec), /还没有章纲/)
  } finally {
    await rm(empty, { recursive: true, force: true })
    await rm(root, { recursive: true, force: true })
  }
})

test('spot-fix applies multiple ranges and rejects content that disagrees with them', async () => {
  const root = await workspace()
  try {
    const revise = tool(root)
    const accepted = await revise.execute({
      chapter: 1,
      mode: 'spot-fix',
      ranges: [{ startLine: 1, endLine: 1 }, { startLine: 3, endLine: 3 }],
      replacements: ['第一段改。', '第三段改。'],
      content: '第一段改。\n第二段。\n第三段改。',
    }, exec)
    assert.equal(accepted.changed, true)
    assert.equal(accepted.changedRegion.before.startLine, 1)
    assert.equal(accepted.changedRegion.before.lineCount, 3)
    assert.equal(accepted.changedRegion.after.lineCount, 3)
    assert.equal((await loadChapterDocument(root, 1)).content, '第一段改。\n第二段。\n第三段改。')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('spot-fix rejects a content mismatch, missing ranges and mixed targetText', async () => {
  const root = await workspace()
  try {
    const revise = tool(root)
    await assert.rejects(revise.execute({
      chapter: 1,
      mode: 'spot-fix',
      ranges: [{ startLine: 2, endLine: 2 }],
      replacements: ['第二段改。'],
      content: '第一段改。\n第二段改。\n第三段。',
    }, exec), /CHAPTER_EDIT_SCOPE_CONFLICT/u)
    await assert.rejects(revise.execute({
      chapter: 1,
      mode: 'spot-fix',
      content: '第一段。\n第二段改。\n第三段。',
    }, exec), /ARTIFACT_EDIT_RANGE_INVALID/u)
    await assert.rejects(revise.execute({
      chapter: 1,
      mode: 'spot-fix',
      ranges: [{ startLine: 2, endLine: 2 }],
      replacements: ['第二段改。'],
      targetText: '第二段。',
      content: '第一段。\n第二段改。\n第三段。',
    }, exec), /ARTIFACT_EDIT_RANGE_INVALID/u)
    await assert.rejects(revise.execute({
      chapter: 1,
      content: '第一段。\n第二段改。\n第三段。',
      ranges: [{ startLine: 2, endLine: 2 }],
      replacements: ['第二段改。'],
    }, exec), /ARTIFACT_EDIT_RANGE_INVALID/u)
    assert.equal((await loadChapterDocument(root, 1)).content, ORIGINAL)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('targetText works outside spot-fix and keeps the fragment surroundings', async () => {
  const root = await workspace()
  try {
    const revised = await tool(root).execute({
      chapter: 1,
      mode: 'rewrite',
      targetText: '第二段。',
      content: '第一段。\n第二段重写。\n第三段。',
    }, exec)
    assert.equal(revised.changed, true)
    assert.equal((await loadChapterDocument(root, 1)).content, '第一段。\n第二段重写。\n第三段。')
    await assert.rejects(tool(root).execute({
      chapter: 1,
      mode: 'rewrite',
      targetText: '第二段重写。',
      content: '第一段改。\n第二段重写。\n第三段。',
    }, exec), /CHAPTER_EDIT_SCOPE_CONFLICT/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('constructed body is normalized before comparing content', async () => {
  const root = await workspace()
  try {
    const result = await tool(root).execute({
      chapter: 1,
      mode: 'spot-fix',
      ranges: [{ startLine: 1, endLine: 1 }],
      replacements: ['\n第一段改。'],
      content: '第一段改。\n第二段。\n第三段。',
    }, exec)
    assert.equal(result.changed, true)
    assert.equal((await loadChapterDocument(root, 1)).content, '第一段改。\n第二段。\n第三段。')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('spot-fix rejects empty ranges, missing replacements and empty construction', async () => {
  const root = await workspace()
  try {
    const revise = tool(root)
    await assert.rejects(revise.execute({
      chapter: 1,
      mode: 'spot-fix',
      ranges: [],
      replacements: [],
      content: '第一段。\n第二段。\n第三段。',
    }, exec), /ARTIFACT_EDIT_RANGE_INVALID/u)
    await assert.rejects(revise.execute({
      chapter: 1,
      mode: 'spot-fix',
      ranges: [{ startLine: 2, endLine: 2 }],
      content: '第一段。\n第二段改。\n第三段。',
    }, exec), /ARTIFACT_EDIT_RANGE_INVALID/u)
    await assert.rejects(revise.execute({
      chapter: 1,
      mode: 'spot-fix',
      ranges: [{ startLine: 1, endLine: 3 }],
      replacements: [''],
      content: '',
    }, exec), /content 不能为空/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('revision archives are hidden from the chapter listing', async () => {
  const root = await workspace()
  try {
    await reviseChapterDocument(root, { chapter: 1, content: '第一段改。\n第二段。\n第三段。', language: 'zh' })
    const entries = await readdir(join(root, 'source/chapters'))
    assert.deepEqual(entries.sort(), ['.versions', '0001_雨夜.md', 'index.json'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('revising prefers the entry target and keeps token usage', async () => {
  const root = await workspace()
  try {
    const entry = {
      number: 1,
      title: '雨夜',
      wordCount: 12,
      createdAt: '2026-11-10T00:00:00.000Z',
      updatedAt: '2026-11-10T00:00:00.000Z',
      observations: [],
      provenance: 'generated',
      lengthTelemetry: {
        target: 999,
        countingMode: 'zh_chars',
        writerCount: 12,
        postReviseCount: 0,
        finalCount: 12,
        repairApplied: false,
      },
      tokenUsage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
    }
    await writeFile(join(root, 'source/chapters/index.json'), JSON.stringify([entry], null, 2) + '\n')
    const result = await tool(root).execute({ chapter: 1, content: '第一段改。\n第二段。\n第三段。' }, exec)
    assert.equal(result.target, 999)
    const index = JSON.parse(await readFile(join(root, 'source/chapters/index.json'), 'utf8'))
    assert.equal(index[0].lengthTelemetry.target, 999)
    assert.equal(index[0].lengthTelemetry.writerCount, 12)
    assert.equal(index[0].lengthTelemetry.finalCount, 13)
    assert.equal(index[0].lengthTelemetry.repairApplied, true)
    assert.deepEqual(index[0].tokenUsage, { promptTokens: 1, completionTokens: 2, totalTokens: 3 })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('an unchanged revise writes equal length telemetry', async () => {
  const root = await workspace()
  try {
    const result = await tool(root).execute({ chapter: 1, content: ORIGINAL }, exec)
    assert.equal(result.changed, false)
    const index = JSON.parse(await readFile(join(root, 'source/chapters/index.json'), 'utf8'))
    assert.equal(index[0].lengthTelemetry.writerCount, index[0].lengthTelemetry.finalCount)
    assert.equal(index[0].lengthTelemetry.postReviseCount, index[0].lengthTelemetry.finalCount)
    assert.equal(index[0].lengthTelemetry.repairApplied, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('revising uses an en_words entry counting mode', async () => {
  const root = await workspace()
  try {
    const entry = {
      number: 1,
      title: '雨夜',
      wordCount: 12,
      createdAt: '2026-11-10T00:00:00.000Z',
      updatedAt: '2026-11-10T00:00:00.000Z',
      observations: [],
      provenance: 'generated',
      lengthTelemetry: {
        target: 100,
        countingMode: 'en_words',
        writerCount: 12,
        postReviseCount: 0,
        finalCount: 12,
        repairApplied: false,
      },
    }
    await writeFile(join(root, 'source/chapters/index.json'), JSON.stringify([entry], null, 2) + '\n')
    const result = await tool(root).execute({ chapter: 1, content: 'one two three' }, exec)
    assert.equal(result.target, 100)
    assert.equal(result.charCount, 3)
    const index = JSON.parse(await readFile(join(root, 'source/chapters/index.json'), 'utf8'))
    assert.equal(index[0].lengthTelemetry.countingMode, 'en_words')
    assert.equal(index[0].lengthTelemetry.finalCount, 3)
    assert.equal(index[0].wordCount, 3)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a usage file does not affect revision and tokenUsage stays absent', async () => {
  const root = await workspace()
  try {
    await mkdir(join(root, 'source/story/runtime'), { recursive: true })
    await writeFile(join(root, chapterUsagePath(1)), JSON.stringify({
      version: 1,
      chapter: 1,
      childSessionIds: ['writer', 'reviewer'],
      tokenUsage: { promptTokens: 1250, completionTokens: 800, totalTokens: 2050 },
      createdAt: '2026-11-10T00:00:00.000Z',
    }, null, 2) + '\n')
    const result = await tool(root).execute({ chapter: 1, content: '第一段改。\n第二段。\n第三段。' }, exec)
    assert.equal(result.changed, true)
    const index = JSON.parse(await readFile(join(root, 'source/chapters/index.json'), 'utf8'))
    assert.equal(index[0].tokenUsage, undefined)
    await stat(join(root, chapterUsagePath(1)))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
