import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { finalizeChapter } from '../src/core/finalize.ts'
import { writeChapterDocument } from '../src/core/chapter-document.ts'
import { chapterReviewPath, reviewChapter } from '../src/core/chapter-review.ts'
import { saveChapterPlan } from '../src/core/chapter-plan.ts'
import { installSettleTool } from '../src/pipelines/long/settle-tool.ts'
import { installFinalizeTool } from '../src/pipelines/long/finalize-tool.ts'
import { WORK_FILE } from '../src/core/story-paths.ts'

const SUMMARY = {
  title: '雨夜',
  characters: '甲',
  events: '甲上山',
  stateChanges: '甲知道了真相',
  hookActivity: '提了封印',
  mood: '紧张',
  chapterType: 'advancement',
}

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'see-dsh-novel-finalize-'))
  await mkdir(join(root, 'source/story/state'), { recursive: true })
  await mkdir(join(root, 'source/story/runtime'), { recursive: true })
  await mkdir(join(root, 'source/chapters'), { recursive: true })
  await writeFile(join(root, WORK_FILE), JSON.stringify({
    version: 1, id: 'w', title: '标题', profile: 'longform-novel', language: 'zh', status: 'draft',
    metadata: { chapterWordCount: 300 }, createdAt: '2026-11-10T00:00:00.000Z', updatedAt: '2026-11-10T00:00:00.000Z',
  }))
  await writeFile(join(root, 'source/story/state/manifest.json'), JSON.stringify({
    schemaVersion: 2, language: 'zh', lastAppliedChapter: 0, projectionVersion: 1,
  }))
  await writeFile(join(root, 'source/story/state/hooks.json'), JSON.stringify({
    hooks: [{ hookId: 'hook-1', startChapter: 1, type: 'promise', status: 'deferred', lastAdvancedChapter: 1, expectedPayoff: '回收', notes: '' }],
  }))
  await writeFile(join(root, 'source/story/state/current_state.json'), JSON.stringify({ chapter: 0, facts: [] }))
  await writeFile(join(root, 'source/story/state/chapter_summaries.json'), JSON.stringify({ rows: [] }))
  await saveChapterPlan(root, { chapter: 1, goal: '目标', body: '计划', threadRefs: [] })
  await writeChapterDocument(root, { chapter: 1, title: '雨夜', content: '正文。', language: 'zh' })
  await reviewChapter(root, {
    chapter: 1,
    summary: '初审',
    observations: [{ code: 'C1', summary: '观察', assessment: 'unavailable' }],
  })
  return root
}

function tools(root) {
  const registry = new Map()
  const ctx = {
    tools: { register: (definition) => { registry.set(definition.name, definition); return () => {} } },
    workingDirectory: { ensure: async () => root },
  }
  installSettleTool(ctx)
  installFinalizeTool(ctx)
  return registry
}

const exec = { agent: { session: 's' } }

const DELTA = {
  chapter: 1,
  postSettlement: '甲上山。',
  factOps: { upsert: [{ subject: '甲', predicate: '位置', object: '山门' }], expire: [] },
  hookOps: { upsert: [], mention: [], resolve: [], defer: [] },
  newHookCandidates: [],
  chapterSummary: SUMMARY,
}

async function settle(root) {
  await tools(root).get('story_settle_chapter').execute(DELTA, exec)
}

test('finalize writes the snapshot, the chapter index and moves the work to active', async () => {
  const root = await workspace()
  try {
    await settle(root)
    const result = await tools(root).get('story_finalize_chapter').execute({ chapter: 1 }, exec)
    assert.deepEqual({ chapter: result.chapter, status: result.status, chapters: result.chapters }, { chapter: 1, status: 'active', chapters: 1 })

    const snapshot = join(root, 'source/story/snapshots/1')
    for (const file of ['current_state.md', 'pending_hooks.md', 'chapter_summaries.md', 'state/manifest.json', 'state/current_state.json', 'state/hooks.json', 'state/chapter_summaries.json']) {
      assert.ok((await readFile(join(snapshot, file), 'utf8')).length > 0, file)
    }
    assert.equal(
      await readFile(join(snapshot, 'state/current_state.json'), 'utf8'),
      await readFile(join(root, 'source/story/state/current_state.json'), 'utf8'),
    )

    const index = JSON.parse(await readFile(join(root, 'source/chapters/index.json'), 'utf8'))
    assert.equal(index.length, 1)
    assert.equal(index[0].number, 1)
    assert.equal(index[0].title, '雨夜')
    assert.ok(index[0].wordCount > 0)
    assert.equal(index[0].observations.length, 1)
    assert.equal(index[0].provenance, 'generated')

    const work = JSON.parse(await readFile(join(root, WORK_FILE), 'utf8'))
    assert.equal(work.status, 'active')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('re-finalizing keeps createdAt and does not duplicate the index row', async () => {
  const root = await workspace()
  try {
    await settle(root)
    const tool = tools(root).get('story_finalize_chapter')
    await tool.execute({ chapter: 1 }, exec)
    const first = JSON.parse(await readFile(join(root, 'source/chapters/index.json'), 'utf8'))
    await tool.execute({ chapter: 1 }, exec)
    const again = JSON.parse(await readFile(join(root, 'source/chapters/index.json'), 'utf8'))
    assert.equal(again.length, 1)
    assert.equal(again[0].createdAt, first[0].createdAt)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('finalize requires settlement, a review and a readable index', async () => {
  const root = await workspace()
  try {
    const tool = tools(root).get('story_finalize_chapter')
    await assert.rejects(tool.execute({ chapter: 1 }, exec), /还没有结算/)

    await settle(root)
    await rm(join(root, chapterReviewPath(1)), { force: true })
    await assert.rejects(tool.execute({ chapter: 1 }, exec), /还没有审稿记录/)

    await reviewChapter(root, {
      chapter: 1,
      summary: '复审',
      observations: [{ code: 'C1', summary: '观察', assessment: 'unavailable' }],
    })
    await writeFile(join(root, 'source/chapters/index.json'), '{ bad')
    await assert.rejects(tool.execute({ chapter: 1 }, exec), /不是合法 JSON/)
    assert.equal(await readFile(join(root, 'source/chapters/index.json'), 'utf8'), '{ bad')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('finalizeChapter reports the snapshot directory', async () => {
  const root = await workspace()
  try {
    await settle(root)
    const result = await finalizeChapter(root, 1)
    assert.equal(result.snapshotPath, 'source/story/snapshots/1')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
