import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { installDeleteCommand } from '../src/plugin/delete-command.ts'
import { installSettleTool } from '../src/pipelines/long/settle-tool.ts'
import { installFinalizeTool } from '../src/pipelines/long/finalize-tool.ts'
import { saveChapterPlan } from '../src/core/chapter-plan.ts'
import { writeChapterDocument } from '../src/core/chapter-document.ts'
import { reviewChapter } from '../src/core/chapter-review.ts'
import { defaultStateSnapshot, snapshotWrites, stateJsonWrites, stateProjectionWrites } from '../src/core/state.ts'
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

async function writeWrites(root, writes) {
  for (const write of writes) {
    await mkdir(join(root, write.relativePath, '..'), { recursive: true })
    await writeFile(join(root, write.relativePath), write.content)
  }
}

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'see-dsh-novel-delete-command-'))
  await writeFile(join(root, WORK_FILE), JSON.stringify({
    version: 1, id: 'w', title: '标题', profile: 'longform-novel', language: 'zh', status: 'active',
    metadata: { chapterWordCount: 300 }, createdAt: '2026-11-10T00:00:00.000Z', updatedAt: '2026-11-10T00:00:00.000Z',
  }))
  for (const [file, body] of [
    ['source/story/outline/story_frame.md', '# 框架'],
    ['source/story/outline/volume_map.md', '# 卷'],
    ['source/story/book_rules.md', '# 规则'],
    ['source/story/book_rules.json', '{}'],
    ['source/story/pending_hooks.md', '# 伏笔'],
  ]) {
    await mkdir(join(root, 'source/story/outline'), { recursive: true })
    await writeFile(join(root, file), `${body}\n`)
  }
  const seeded = defaultStateSnapshot([], 'zh')
  await writeWrites(root, [...stateJsonWrites(seeded), ...stateProjectionWrites(seeded)])
  await writeWrites(root, snapshotWrites(seeded, 0))
  await saveChapterPlan(root, { chapter: 1, goal: '目标', body: '计划', threadRefs: [] })
  await mkdir(join(root, 'source/chapters'), { recursive: true })
  await writeFile(join(root, 'source/chapters/index.json'), '[]')
  await writeChapterDocument(root, { chapter: 1, title: '雨夜', content: '正文。', language: 'zh' })
  await reviewChapter(root, {
    chapter: 1,
    summary: '初审',
    observations: [{ code: 'C1', summary: '观察', assessment: 'unavailable' }],
  })
  const tools = new Map()
  const ctx = {
    tools: { register: (definition) => { tools.set(definition.name, definition); return () => {} } },
    commands: { register: (definition) => { tools.set(definition.name, definition); return () => {} } },
    workingDirectory: { ensure: async () => root },
  }
  installSettleTool(ctx)
  installFinalizeTool(ctx)
  await tools.get('story_settle_chapter').execute({
    chapter: 1,
    postSettlement: '甲上山。',
    factOps: { upsert: [], expire: [] },
    hookOps: { upsert: [], mention: [], resolve: [], defer: [] },
    newHookCandidates: [],
    chapterSummary: SUMMARY,
  }, { agent: { session: 's' } })
  await tools.get('story_finalize_chapter').execute({ chapter: 1 }, { agent: { session: 's' } })
  return root
}

function commandFor(root) {
  let handler
  installDeleteCommand({
    commands: { register: (definition) => { handler = definition.handler; return () => {} } },
    workingDirectory: { ensure: async () => root },
  })
  return handler
}

const invocation = { agent: { session: 's' } }

test('the delete command removes the latest chapter and rolls the state back', async () => {
  const root = await workspace()
  try {
    const result = await commandFor(root)(invocation)
    assert.equal(result.kind, 'success')
    assert.match(result.text, /已删除第 1 章/)
    await assert.rejects(readFile(join(root, 'source/chapters/0001_雨夜.md')), { code: 'ENOENT' })
    const state = JSON.parse(await readFile(join(root, 'source/story/state/current_state.json'), 'utf8'))
    assert.equal(state.chapter, 0)
    const index = JSON.parse(await readFile(join(root, 'source/chapters/index.json'), 'utf8'))
    assert.deepEqual(index, [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the delete command reports an empty work without writing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'see-dsh-novel-delete-command-empty-'))
  try {
    const result = await commandFor(root)(invocation)
    assert.equal(result.kind, 'error')
    assert.match(result.text, /还没有可删除的章节/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
