import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { installWriteTool } from '../src/pipelines/long/write-tool.ts'
import { saveChapterPlan } from '../src/core/chapter-plan.ts'
import { chapterReviewPath, reviewChapter } from '../src/core/chapter-review.ts'
import { installReviseTool } from '../src/pipelines/long/revise-tool.ts'
import { existsSync } from 'node:fs'
import { writeWorkflowStart } from '../src/core/workflow-start.ts'
import { WORK_FILE } from '../src/core/story-paths.ts'

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'see-dsh-novel-write-tool-'))
  await mkdir(join(root, 'source/story/runtime'), { recursive: true })
  await mkdir(join(root, 'source/chapters'), { recursive: true })
  await writeFile(join(root, WORK_FILE), JSON.stringify({
    version: 1, id: 'w', title: '标题', profile: 'longform-novel', language: 'zh', status: 'draft',
    metadata: { chapterWordCount: 300 }, createdAt: '2026-11-09T00:00:00.000Z', updatedAt: '2026-11-09T00:00:00.000Z',
  }))
  await saveChapterPlan(root, { chapter: 1, goal: '目标', body: '正文计划', threadRefs: [] })
  return root
}

function tool(root) {
  const tools = new Map()
  installWriteTool({
    tools: { register: (definition) => { tools.set(definition.name, definition); return () => tools.delete(definition.name) } },
    workingDirectory: { ensure: async () => root },
  })
  return tools.get('story_write_chapter')
}

const exec = { agent: { session: 's' } }

test('write rejects a chapter without a workflow start and accepts it after the author start', async () => {
  const root = await workspace()
  try {
    const write = tool(root)
    await assert.rejects(
      write.execute({ chapter: 1, title: '雨夜', content: '正文。' }, exec),
      /workflow start/,
    )
    await writeWorkflowStart(root, { chapter: 1, instruction: '开始第一章' })
    const result = await write.execute({ chapter: 1, title: '雨夜', content: '正文。' }, exec)
    assert.equal(result.chapter, 1)
    assert.equal(result.charCount, 3)
    assert.equal(result.path, '.drafts/chapter-0001.md')
    assert.match(await readFile(join(root, '.drafts/chapter-0001.md'), 'utf8'), /正文。/)
    await assert.rejects(readFile(join(root, 'source/chapters/0001_雨夜.md'), 'utf8'), /ENOENT/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a draft can be reviewed and revised without publishing it', async () => {
  const root = await workspace()
  try {
    await writeWorkflowStart(root, { chapter: 1, instruction: '开始第一章' })
    await tool(root).execute({ chapter: 1, title: '雨夜', content: '正文。' }, exec)
    await reviewChapter(root, {
      chapter: 1,
      summary: '初审',
      observations: [{ code: 'C1', summary: '观察', assessment: 'unavailable' }],
    })
    const review = JSON.parse(await readFile(join(root, chapterReviewPath(1)), 'utf8'))
    assert.equal(review.reviewedArtifact, undefined)
    const tools = new Map()
    installReviseTool({
      tools: { register: (definition) => { tools.set(definition.name, definition); return () => {} } },
      workingDirectory: { ensure: async () => root },
    })
    await tools.get('story_revise_chapter').execute({ chapter: 1, content: '改后的正文。' }, exec)
    assert.match(await readFile(join(root, '.drafts/chapter-0001.md'), 'utf8'), /改后的正文/)
    assert.equal(existsSync(join(root, chapterReviewPath(1))), false)
    assert.equal(existsSync(join(root, 'source/chapters/0001_雨夜.md')), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
test('write refuses published chapters and drafts that already have a review', async () => {
  const root = await workspace()
  try {
    await writeWorkflowStart(root, { chapter: 1, instruction: '开始第一章' })
    const write = tool(root)
    await write.execute({ chapter: 1, title: '雨夜', content: '正文。' }, exec)
    await reviewChapter(root, { chapter: 1, summary: '初审', observations: [] })
    await assert.rejects(write.execute({ chapter: 1, title: '雨夜', content: '再写。' }, exec), /已有审稿记录/)
    await rm(join(root, chapterReviewPath(1)), { force: true })
    await writeFile(join(root, 'source/chapters/0001_雨夜.md'), '# 第1章 雨夜\n\n正文。\n')
    await assert.rejects(write.execute({ chapter: 1, title: '雨夜', content: '再写。' }, exec), /已经发布/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})