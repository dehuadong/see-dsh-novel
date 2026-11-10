import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { CHAPTER_SUMMARIES_JSON, writeChapterSummary } from '../src/core/chapter-summary.ts'
import { writeChapterDocument } from '../src/core/chapter-document.ts'
import { chapterReviewPath, reviewChapter } from '../src/core/chapter-review.ts'
import { saveChapterPlan } from '../src/core/chapter-plan.ts'
import { installSummaryTool } from '../src/pipelines/long/summary-tool.ts'
import { STORY_CHAPTER_SUMMARIES_MD, WORK_FILE } from '../src/core/story-paths.ts'

const SUMMARY = {
  title: '雨夜',
  characters: '甲、乙',
  events: '甲在雨夜找到乙',
  stateChanges: '甲知道了真相',
  hookActivity: '提了封印',
  mood: '紧张',
  chapterType: 'advancement',
}

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'see-dsh-novel-summary-'))
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
  await saveChapterPlan(root, { chapter: 1, goal: '目标', body: '计划', threadRefs: [] })
  await writeChapterDocument(root, { chapter: 1, title: '雨夜', content: '正文。', language: 'zh' })
  await reviewChapter(root, {
    chapter: 1,
    summary: '初审',
    observations: [{ code: 'C1', summary: '观察', assessment: 'unavailable' }],
  })
  return root
}

function tool(root) {
  const tools = new Map()
  installSummaryTool({
    tools: { register: (definition) => { tools.set(definition.name, definition); return () => tools.delete(definition.name) } },
    workingDirectory: { ensure: async () => root },
  })
  return tools.get('story_summarize_chapter')
}

const exec = { agent: { session: 's' } }

test('writeChapterSummary writes the seven fields, sorts rows and updates the projection', async () => {
  const root = await workspace()
  try {
    await writeFile(join(root, CHAPTER_SUMMARIES_JSON), JSON.stringify({
      rows: [{ chapter: 2, title: '第二章', characters: '', events: '', stateChanges: '', hookActivity: '', mood: '', chapterType: '' }],
    }))
    const result = await writeChapterSummary(root, { chapter: 1, ...SUMMARY })
    assert.deepEqual({ chapter: result.chapter, title: result.title, total: result.total }, { chapter: 1, title: '雨夜', total: 2 })

    const state = JSON.parse(await readFile(join(root, CHAPTER_SUMMARIES_JSON), 'utf8'))
    assert.deepEqual(state.rows.map((row) => row.chapter), [1, 2])
    assert.equal(state.rows[0].title, '雨夜')
    assert.equal(state.rows[0].hookActivity, '提了封印')

    const projection = await readFile(join(root, STORY_CHAPTER_SUMMARIES_MD), 'utf8')
    assert.match(projection, /雨夜/)
    assert.match(projection, /提了封印/)
    assert.match(projection, /\| 1 \|/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('re-summarizing the same chapter replaces its row', async () => {
  const root = await workspace()
  try {
    await writeChapterSummary(root, { chapter: 1, ...SUMMARY })
    const again = await writeChapterSummary(root, { chapter: 1, ...SUMMARY, title: '雨夜（修订）', mood: '压抑' })
    assert.equal(again.total, 1)
    const state = JSON.parse(await readFile(join(root, CHAPTER_SUMMARIES_JSON), 'utf8'))
    assert.equal(state.rows.length, 1)
    assert.equal(state.rows[0].title, '雨夜（修订）')
    assert.equal(state.rows[0].mood, '压抑')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the summary tool reports the write and the total row count', async () => {
  const root = await workspace()
  try {
    const result = await tool(root).execute({ chapter: 1, summary: SUMMARY }, exec)
    assert.equal(result.chapter, 1)
    assert.equal(result.title, '雨夜')
    assert.equal(result.total, 1)
    const state = JSON.parse(await readFile(join(root, CHAPTER_SUMMARIES_JSON), 'utf8'))
    assert.equal(state.rows[0].chapterType, 'advancement')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a summary without a chapter or a review is rejected', async () => {
  const root = await workspace()
  try {
    await assert.rejects(
      writeChapterSummary(root, { chapter: 2, ...SUMMARY }),
      /还没有正文/,
    )
    await rm(join(root, chapterReviewPath(1)), { force: true })
    await assert.rejects(
      writeChapterSummary(root, { chapter: 1, ...SUMMARY }),
      /还没有审稿记录/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('bad chapter, empty title, wrong field types and corrupt state are rejected without writing', async () => {
  const root = await workspace()
  try {
    await assert.rejects(writeChapterSummary(root, { chapter: 0, ...SUMMARY }), /chapter/)
    await assert.rejects(writeChapterSummary(root, { chapter: 1, ...SUMMARY, title: '   ' }), /title/)
    await assert.rejects(
      writeChapterSummary(root, { chapter: 1, ...SUMMARY, events: 42 }),
      /events 必须是字符串/,
    )
    await writeFile(join(root, CHAPTER_SUMMARIES_JSON), '{ not json')
    await assert.rejects(
      writeChapterSummary(root, { chapter: 1, ...SUMMARY }),
      /不是合法 JSON/,
    )
    assert.equal(await readFile(join(root, CHAPTER_SUMMARIES_JSON), 'utf8'), '{ not json')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
