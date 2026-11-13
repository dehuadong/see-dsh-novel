import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
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
  await writeFile(join(root, 'source/chapters/index.json'), '[]')
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
    const started = Date.now()
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
    assert.equal(index[0].wordCount, 2)
    assert.deepEqual(index[0].observations.map(({ code, summary, assessment }) => ({ code, summary, assessment })), [
      { code: 'C1', summary: '观察', assessment: 'unavailable' },
    ])
    assert.equal(index[0].provenance, 'generated')
    assert.equal(index[0].createdAt, index[0].updatedAt)
    assert.ok(Date.parse(index[0].updatedAt) >= started)

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
    await new Promise((resolve) => setTimeout(resolve, 10))
    await tool.execute({ chapter: 1 }, exec)
    const again = JSON.parse(await readFile(join(root, 'source/chapters/index.json'), 'utf8'))
    assert.equal(again.length, 1)
    assert.equal(again[0].createdAt, first[0].createdAt)
    assert.notEqual(again[0].updatedAt, first[0].updatedAt)
    assert.ok(Date.parse(again[0].updatedAt) > Date.parse(first[0].updatedAt))
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

test('finalizing preserves the other index rows exactly', async () => {
  const root = await workspace()
  try {
    await settle(root)
    const foreign = {
      number: 9,
      title: '外章',
      wordCount: 7,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      observations: [{ code: 'F', summary: '外章观察', assessment: 'observation', evidence: [], sourceRefs: [] }],
      provenance: 'imported',
    }
    await writeFile(join(root, 'source/chapters/index.json'), JSON.stringify([foreign]))
    await finalizeChapter(root, 1)
    const index = JSON.parse(await readFile(join(root, 'source/chapters/index.json'), 'utf8'))
    assert.deepEqual(index[0], foreign)
    assert.equal(index[1].number, 1)
    assert.equal(index[1].provenance, 'generated')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('re-finalizing a later chapter leaves earlier rows untouched', async () => {
  const root = await workspace()
  try {
    await settle(root)
    await finalizeChapter(root, 1)
    const before = JSON.parse(await readFile(join(root, 'source/chapters/index.json'), 'utf8'))[0]

    await writeChapterDocument(root, { chapter: 2, title: '第二', content: '第二章正文。', language: 'zh' })
    await saveChapterPlan(root, { chapter: 2, goal: '目标', body: '计划', threadRefs: [] })
    await reviewChapter(root, {
      chapter: 2,
      summary: '二审',
      observations: [{ code: 'C2', summary: '观察二', assessment: 'unavailable' }],
    })
    await tools(root).get('story_settle_chapter').execute({ ...DELTA, chapter: 2 }, exec)
    assert.equal((await finalizeChapter(root, 2)).chapters, 2)

    const index = JSON.parse(await readFile(join(root, 'source/chapters/index.json'), 'utf8'))
    assert.deepEqual(index[0], before)
    assert.equal(index[1].number, 2)
    assert.equal(index[1].title, '第二')
    assert.equal(index[1].createdAt, index[1].updatedAt)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a colon heading still yields the chapter title', async () => {
  const root = await workspace()
  try {
    await settle(root)
    await writeFile(
      join(root, 'source/chapters/0001_雨夜.md'),
      '# 第1章：雨夜\n\n正文。\n',
      'utf8',
    )
    await finalizeChapter(root, 1)
    const index = JSON.parse(await readFile(join(root, 'source/chapters/index.json'), 'utf8'))
    assert.equal(index[0].title, '雨夜')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('finalizing rejects a missing or malformed index before writing', async () => {
  const root = await workspace()
  const entries = {
    valid: (overrides = {}) => ({
      number: 1,
      title: '旧章',
      wordCount: 1,
      createdAt: '2026-11-10T00:00:00.000Z',
      updatedAt: '2026-11-10T00:00:00.000Z',
      observations: [],
      provenance: 'generated',
      ...overrides,
    }),
  }
  try {
    await settle(root)
    const workBefore = await readFile(join(root, WORK_FILE), 'utf8')
    await rm(join(root, 'source/chapters/index.json'), { force: true })
    await assert.rejects(finalizeChapter(root, 1), /index\.json 缺失/)
    await assert.rejects(stat(join(root, 'source/story/snapshots/1/current_state.md')), { code: 'ENOENT' })

    for (const [body, pattern] of [
      [JSON.stringify([entries.valid({ extra: true })]), /未知字段 extra/],
      [JSON.stringify([{ number: 1, title: '旧章' }]), /第 1 条记录/],
      [JSON.stringify([entries.valid({ createdAt: '2026-13-40T00:00:00.000Z' })]), /createdAt 必须是 ISO 时间/],
      ['{}', /必须是数组/],
    ]) {
      await writeFile(join(root, 'source/chapters/index.json'), body)
      await assert.rejects(finalizeChapter(root, 1), pattern)
    }
    assert.equal(await readFile(join(root, WORK_FILE), 'utf8'), workBefore)
    await assert.rejects(stat(join(root, 'source/story/snapshots/1/current_state.md')), { code: 'ENOENT' })
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
