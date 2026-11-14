import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { installWriteTool } from '../src/pipelines/long/write-tool.ts'
import { renderWriterContract } from '../src/pipelines/long/stages/writer.ts'
import { detectStage } from '../src/pipelines/long/stages/index.ts'
import { saveChapterPlan } from '../src/core/chapter-plan.ts'
import { writeWorkflowStart } from '../src/core/workflow-start.ts'
import { WORK_FILE } from '../src/core/story-paths.ts'

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'see-dsh-novel-chapter-write-'))
  await mkdir(join(root, 'source/story/runtime'), { recursive: true })
  await mkdir(join(root, 'source/story/state'), { recursive: true })
  await mkdir(join(root, 'source/chapters'), { recursive: true })
  await mkdir(join(root, 'source/story/outline'), { recursive: true })
  await writeFile(join(root, 'source/story/outline/story_frame.md'), '# 框架\\n')
  await writeFile(join(root, 'source/story/outline/volume_map.md'), '# 卷纲\\n')
  await writeFile(join(root, 'source/story/book_rules.md'), '# 规则\\n')
  await writeFile(join(root, 'source/story/book_rules.json'), JSON.stringify({ narrativePerson: '第三人称' }))
  await writeFile(join(root, 'source/story/pending_hooks.md'), '# 伏笔\\n')
  await writeFile(join(root, WORK_FILE), JSON.stringify({
    version: 1, id: 'w', title: '标题', profile: 'longform-novel', language: 'zh', status: 'draft',
    metadata: { genre: '悬疑', platform: '番茄', chapterWordCount: 300, minChapterLength: 5, maxChapterLength: 20 },
    createdAt: '2026-11-09T00:00:00.000Z', updatedAt: '2026-11-09T00:00:00.000Z',
  }))
  await writeFile(join(root, 'source/story/state/current_state.json'), JSON.stringify({ chapter: 0, facts: [] }))
  await writeFile(join(root, 'source/story/state/manifest.json'), JSON.stringify({ schemaVersion: 2, language: 'zh', lastAppliedChapter: 0, projectionVersion: 1 }))
  await writeFile(join(root, 'source/story/state/hooks.json'), JSON.stringify({ hooks: [] }))
  await writeFile(join(root, 'source/story/state/chapter_summaries.json'), JSON.stringify({ rows: [] }))
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

test('writer contract and write tool share the draft handoff', async () => {
  const root = await workspace()
  try {
    await writeWorkflowStart(root, { chapter: 1, instruction: '写得更冷' })
    const contract = renderWriterContract(root)
    assert.match(contract, /题材：悬疑｜平台：番茄/)
    assert.match(contract, /按已激活的专业 Skill 写作/)
    assert.match(contract, /## 本章指令\n该指令最高优先级；若指定标题，原样使用。\n写得更冷/)
    assert.match(contract, /区间 5–20/)
    const order = ['## 题材与平台', '## 权威顺序', '## 本章指令', '## 字数'].map((heading) => contract.indexOf(heading))
    assert.equal(order.every((value, index) => value >= 0 && (index === 0 || value > order[index - 1])), true)
    const result = await tool(root).execute({ chapter: 1, title: '第 1 章 雨夜', content: '第一段。\n第二段。' }, exec)
    assert.equal(result.path, '.drafts/chapter-0001.md')
    assert.equal(result.wordCount, 8)
    assert.equal(result.delivery.status, 'checks_passed')
    assert.equal(detectStage(root).stage, 'review')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

async function setBounds(root, min, max) {
  const work = JSON.parse(await readFile(join(root, 'work.json'), 'utf8'))
  work.metadata = { ...work.metadata, ...(min === undefined ? {} : { minChapterLength: min }), ...(max === undefined ? {} : { maxChapterLength: max }) }
  await writeFile(join(root, 'work.json'), JSON.stringify(work, null, 2) + '\n')
}

test('write omits delivery when work has no explicit bounds', async () => {
  const root = await workspace()
  try {
    const work = JSON.parse(await readFile(join(root, 'work.json'), 'utf8'))
    delete work.metadata.minChapterLength
    delete work.metadata.maxChapterLength
    await writeFile(join(root, 'work.json'), JSON.stringify(work, null, 2) + '\n')
    await writeWorkflowStart(root, { chapter: 1, instruction: '开始' })
    const result = await tool(root).execute({ chapter: 1, title: '雨夜', content: '第一段。\n第二段。' }, exec)
    assert.equal(result.delivery, undefined)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('write reports needs_revision without rejecting when outside bounds', async () => {
  const root = await workspace()
  try {
    await setBounds(root, 1, 6)
    await writeWorkflowStart(root, { chapter: 1, instruction: '开始' })
    const result = await tool(root).execute({ chapter: 1, title: '雨夜', content: '第一段。\n第二段。' }, exec)
    assert.equal(result.delivery.status, 'needs_revision')
    assert.equal(result.delivery.issues[0].actual, 8)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
