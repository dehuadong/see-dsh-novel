import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { chapterReviewPath, loadChapterReview, reviewChapter } from '../src/core/chapter-review.ts'
import { writeChapterDocument } from '../src/core/chapter-document.ts'
import { chapterPlanPath } from '../src/core/chapter-plan.ts'

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'see-dsh-novel-review-'))
  await mkdir(join(root, 'source/artifacts'), { recursive: true })
  await mkdir(join(root, 'source/story/runtime'), { recursive: true })
  await mkdir(join(root, 'source/chapters'), { recursive: true })
  await writeFile(join(root, 'source/chapters/0001_雨夜.md'), '# 第1章 雨夜\n\n雨从二十三点下到现在。\n\n沈砚站在巷口。\n')
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
    const result = await reviewChapter(root, {
      chapter: 1,
      summary: '首版可继续',
      observations: [
        { code: 'continuity', summary: '编号牌出现得早', assessment: 'issue', sourceRefs: [{ sourceId: 'chapter-1', startLine: 1, endLine: 1 }], evidence: [] },
        { code: 'missing', summary: '没有可对照的上一章', assessment: 'unavailable', sourceRefs: [] },
      ],
    })
    assert.equal(result.path, chapterReviewPath(1))
    assert.deepEqual(result.counts, { issue: 1, resolved: 0, observation: 0, unavailable: 1 })
    const record = JSON.parse(await readFile(join(root, result.path), 'utf8'))
    assert.equal(record.version, 1)
    assert.equal(record.observations[0].sourceRefs[0].quote, '雨从二十三点下到现在。')
    assert.equal(record.observations[1].assessment, 'unavailable')
    assert.equal(record.reviewedArtifact, undefined)
    assert.deepEqual((await loadChapterReview(root, 1)).counts, result.counts)
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
