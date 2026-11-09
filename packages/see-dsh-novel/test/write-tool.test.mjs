import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { installWriteTool } from '../src/pipelines/long/write-tool.ts'
import { saveChapterPlan } from '../src/core/chapter-plan.ts'
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
    assert.equal(result.charCount, 2)
    assert.match(await readFile(join(root, 'source/chapters/0001_雨夜.md'), 'utf8'), /正文。/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
