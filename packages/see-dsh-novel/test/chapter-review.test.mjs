import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { chapterReviewPath, loadChapterReview, reviewChapter } from '../src/core/chapter-review.ts'
import { resolveObservationSources } from '../src/core/observation.ts'
import { writeChapterDocument } from '../src/core/chapter-document.ts'
import { writeChapterDraft } from '../src/core/chapter-draft.ts'
import { chapterPlanPath, saveChapterPlan } from '../src/core/chapter-plan.ts'

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'see-dsh-novel-review-'))
  await mkdir(join(root, 'source/artifacts'), { recursive: true })
  await mkdir(join(root, 'source/story/runtime'), { recursive: true })
  await mkdir(join(root, 'source/chapters'), { recursive: true })
  await writeFile(join(root, 'source/chapters/0001_雨夜.md'), '# 第1章 雨夜\n\n雨从二十三点下到现在。\n\n沈砚站在巷口。\n')
  await writeFile(join(root, 'source/chapters/index.json'), JSON.stringify([
    {
      number: 1,
      title: '雨夜',
      wordCount: 3,
      createdAt: '2026-11-10T00:00:00.000Z',
      updatedAt: '2026-11-10T00:00:00.000Z',
      observations: [],
      provenance: 'generated',
      lengthTelemetry: {
        target: 3,
        countingMode: 'zh_chars',
        writerCount: 3,
        postReviseCount: 3,
        finalCount: 3,
        repairApplied: false,
      },
      tokenUsage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
    },
  ], null, 2) + '\n')
  await writeFile(join(root, chapterPlanPath(1)), JSON.stringify({
    version: 2,
    intent: { chapter: 1, goal: '接下命案' },
    memo: { chapter: 1, goal: '接下命案', body: '让沈砚接下命案。', threadRefs: [] },
    plannerInputs: [],
  }))
  return root
}

const cleanup = (root) => rm(root, { recursive: true, force: true })

test('review persists validated observations with counts and refuses a second review', async () => {
  const root = await workspace()
  try {
    const beforeMs = Date.now()
    const result = await reviewChapter(root, {
      chapter: 1,
      summary: '首版可继续',
      observations: [
        { code: 'continuity', summary: '编号牌出现得早', assessment: 'issue', sourceRefs: [{ sourceId: 'chapter-1', startLine: 1, endLine: 1 }], evidence: [] },
        { code: 'missing', summary: '没有可对照的上一章', assessment: 'unavailable', sourceRefs: [] },
      ],
    })
    const afterMs = Date.now()
    assert.equal(result.path, chapterReviewPath(1))
    assert.deepEqual(result.counts, { issue: 1, resolved: 0, observation: 0, unavailable: 1 })
    const record = JSON.parse(await readFile(join(root, result.path), 'utf8'))
    assert.equal(record.version, 1)
    assert.equal(record.observations[0].sourceRefs[0].quote, '雨从二十三点下到现在。')
    assert.equal(record.observations[1].assessment, 'unavailable')
    assert.equal(record.reviewedArtifact, undefined)
    assert.deepEqual((await loadChapterReview(root, 1)).counts, result.counts)
    const index = JSON.parse(await readFile(join(root, 'source/chapters/index.json'), 'utf8'))
    assert.equal(index[0].number, 1)
    assert.deepEqual(index[0].observations.map((observation) => observation.code), ['continuity', 'missing'])
    assert.deepEqual(index[0].observations, record.observations)
    assert.deepEqual(index[0].observations[0].sourceRefs, [{ sourceId: 'chapter-1', quote: '雨从二十三点下到现在。' }])
    assert.equal(index[0].title, '雨夜')
    assert.equal(index[0].wordCount, 3)
    assert.equal(index[0].provenance, 'generated')
    assert.equal(index[0].createdAt, '2026-11-10T00:00:00.000Z')
    assert.deepEqual(index[0].lengthTelemetry, {
      target: 3,
      countingMode: 'zh_chars',
      writerCount: 3,
      postReviseCount: 3,
      finalCount: 3,
      repairApplied: false,
    })
    assert.deepEqual(index[0].tokenUsage, { promptTokens: 1, completionTokens: 2, totalTokens: 3 })
    const updatedAt = Date.parse(index[0].updatedAt)
    assert.ok(updatedAt >= beforeMs && updatedAt <= afterMs, `updatedAt ${index[0].updatedAt} 应落在本次审稿区间`)
    await assert.rejects(
      reviewChapter(root, { chapter: 1, summary: '再审', observations: [] }),
      /已经有审稿记录/,
    )
  } finally {
    await cleanup(root)
  }
})

test('review records reviewedArtifact only from a matching chapter revision', async () => {
  const root = await workspace()
  try {
    await rm(join(root, 'source/chapters/0001_雨夜.md'))
    await writeChapterDocument(root, { chapter: 1, title: '雨夜', content: '雨从二十三点下到现在。', language: 'zh' })
    const result = await reviewChapter(root, { chapter: 1, summary: '可继续', observations: [] })
    const record = JSON.parse(await readFile(join(root, result.path), 'utf8'))
    assert.deepEqual(record.reviewedArtifact, { workId: 'work', artifactId: 'chapter-0001', revisionId: 'r1' })
  } finally {
    await cleanup(root)
  }
})

test('a chapter without a draft or plan cannot be reviewed', async () => {
  const root = await workspace()
  try {
    await assert.rejects(reviewChapter(root, { chapter: 2, summary: 's', observations: [] }), /还没有章纲|还没有正文/)
    assert.equal(await loadChapterReview(root, 2), null)
  } finally {
    await cleanup(root)
  }
})

test('a published chapter without a plan is reviewed from prose only', async () => {
  const root = await workspace()
  try {
    await rm(join(root, chapterPlanPath(1)), { force: true })
    const result = await reviewChapter(root, {
      chapter: 1,
      summary: '只看正文',
      observations: [{ code: 'C7', summary: '无章纲', assessment: 'unavailable' }],
    })
    assert.equal(result.counts.unavailable, 1)
    assert.ok(await loadChapterReview(root, 1))
  } finally {
    await cleanup(root)
  }
})

test('a draft review does not write the chapter index', async () => {
  const root = await workspace()
  try {
    await saveChapterPlan(root, { chapter: 2, goal: '目标', body: '计划', threadRefs: [] })
    await writeChapterDraft(root, { chapter: 2, title: '第二', content: '第二章正文。', language: 'zh' })
    const before = await readFile(join(root, 'source/chapters/index.json'), 'utf8')
    const result = await reviewChapter(root, {
      chapter: 2,
      summary: '草稿审稿',
      observations: [{ code: 'C2', summary: '草稿', assessment: 'unavailable' }],
    })
    assert.ok(await loadChapterReview(root, 2))
    assert.equal(result.path, chapterReviewPath(2))
    assert.equal(await readFile(join(root, 'source/chapters/index.json'), 'utf8'), before)
  } finally {
    await cleanup(root)
  }
})

test('a published review refuses a missing or broken index', async () => {
  const missing = await workspace()
  try {
    await rm(join(missing, 'source/chapters/index.json'))
    await assert.rejects(
      reviewChapter(missing, { chapter: 1, summary: 's', observations: [] }),
      /缺失，但章节文件仍存在/,
    )
    assert.equal(await loadChapterReview(missing, 1), null)
  } finally {
    await cleanup(missing)
  }

  const broken = await workspace()
  try {
    await writeFile(join(broken, 'source/chapters/index.json'), '{broken')
    await assert.rejects(
      reviewChapter(broken, { chapter: 1, summary: 's', observations: [] }),
      /不是合法 JSON/,
    )
    assert.equal(await loadChapterReview(broken, 1), null)
  } finally {
    await cleanup(broken)
  }
})

test('a published review leaves an index without the chapter row unchanged', async () => {
  const root = await workspace()
  try {
    await writeFile(join(root, 'source/chapters/index.json'), '[]\n')
    const result = await reviewChapter(root, {
      chapter: 1,
      summary: '无索引行',
      observations: [{ code: 'C6', summary: '无行', assessment: 'unavailable' }],
    })
    assert.ok(await loadChapterReview(root, 1))
    assert.equal(result.path, chapterReviewPath(1))
    assert.equal(await readFile(join(root, 'source/chapters/index.json'), 'utf8'), '[]\n')
  } finally {
    await cleanup(root)
  }
})

test('review rejects empty code, summary or quote without writing', async () => {
  for (const observation of [
    { code: '', summary: '空 code', assessment: 'unavailable' },
    { code: 'C0', summary: '', assessment: 'unavailable' },
    { code: 'C0', summary: '空引文', assessment: 'issue', sourceRefs: [{ sourceId: 'chapter-1', quote: '' }] },
  ]) {
    const root = await workspace()
    try {
      const before = await readFile(join(root, 'source/chapters/index.json'), 'utf8')
      await assert.rejects(
        reviewChapter(root, { chapter: 1, summary: 's', observations: [observation] }),
        { code: 'REVIEW_SOURCE_REQUIRED' },
      )
      assert.equal(await loadChapterReview(root, 1), null)
      assert.equal(await readFile(join(root, 'source/chapters/index.json'), 'utf8'), before)
    } finally {
      await cleanup(root)
    }
  }
})

test('a published review refuses an index with invalid schema', async () => {
  const root = await workspace()
  try {
    await writeFile(join(root, 'source/chapters/index.json'), JSON.stringify([
      {
        number: 1,
        title: '雨夜',
        wordCount: 3,
        createdAt: '2026-11-10T00:00:00.000Z',
        updatedAt: '2026-11-10T00:00:00.000Z',
        observations: [],
        provenance: 'bogus',
      },
    ]))
    await assert.rejects(
      reviewChapter(root, { chapter: 1, summary: 's', observations: [] }),
      /provenance 不合法/,
    )
    assert.equal(await loadChapterReview(root, 1), null)
  } finally {
    await cleanup(root)
  }
})

test('explicit whitespace quotes are not rejected', () => {
  const observations = resolveObservationSources([
    { code: 'C0', summary: '空白引文', assessment: 'issue', sourceRefs: [{ sourceId: 'chapter-1', quote: ' ' }] },
  ], new Map([['chapter-1', 'a b']]))
  assert.equal(observations[0].sourceRefs[0].quote, ' ')
})

test('the index accepts the source tokenUsage shape without extra constraints', async () => {
  const root = await workspace()
  try {
    const index = JSON.parse(await readFile(join(root, 'source/chapters/index.json'), 'utf8'))
    index[0].tokenUsage = { promptTokens: -1, completionTokens: 2, totalTokens: 0 }
    await writeFile(join(root, 'source/chapters/index.json'), JSON.stringify(index, null, 2) + '\n')
    await reviewChapter(root, {
      chapter: 1,
      summary: '源形状',
      observations: [{ code: 'C0', summary: '保留', assessment: 'unavailable' }],
    })
    assert.ok(await loadChapterReview(root, 1))
    const updated = JSON.parse(await readFile(join(root, 'source/chapters/index.json'), 'utf8'))
    assert.deepEqual(updated[0].tokenUsage, { promptTokens: -1, completionTokens: 2, totalTokens: 0 })
  } finally {
    await cleanup(root)
  }
})
