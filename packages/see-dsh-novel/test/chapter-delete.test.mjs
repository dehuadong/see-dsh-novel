import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { deleteLatestChapter } from '../src/core/delete-chapter.ts'
import { detectStage } from '../src/pipelines/long/stages/index.ts'
import { writeChapterDocument } from '../src/core/chapter-document.ts'
import { chapterReviewPath, reviewChapter } from '../src/core/chapter-review.ts'
import { chapterPlanPath, saveChapterPlan } from '../src/core/chapter-plan.ts'
import { defaultStateSnapshot, snapshotWrites, stateJsonWrites, stateProjectionWrites } from '../src/core/state.ts'
import { installSettleTool } from '../src/pipelines/long/settle-tool.ts'
import { installFinalizeTool } from '../src/pipelines/long/finalize-tool.ts'
import { installDeleteTool } from '../src/pipelines/long/delete-tool.ts'
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

const HOOK = {
  hookId: 'hook-1',
  startChapter: 1,
  type: 'promise',
  status: 'deferred',
  lastAdvancedChapter: 1,
  expectedPayoff: '回收',
  notes: '',
}

async function writeWrites(root, writes) {
  for (const write of writes) {
    await mkdir(join(root, write.relativePath, '..'), { recursive: true })
    await writeFile(join(root, write.relativePath), write.content)
  }
}

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'see-dsh-novel-delete-'))
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
  const seeded = defaultStateSnapshot([HOOK], 'zh')
  await writeWrites(root, [...stateJsonWrites(seeded), ...stateProjectionWrites(seeded)])
  await writeWrites(root, snapshotWrites(seeded, 0))

  await saveChapterPlan(root, { chapter: 1, goal: '目标', body: '计划', threadRefs: [] })
  await writeChapterDocument(root, { chapter: 1, title: '雨夜', content: '正文。', language: 'zh' })
  await reviewChapter(root, {
    chapter: 1,
    summary: '初审',
    observations: [{ code: 'C1', summary: '观察', assessment: 'unavailable' }],
  })
  await tool(root, installSettleTool).execute({
    chapter: 1,
    postSettlement: '甲上山。',
    factOps: { upsert: [], expire: [] },
    hookOps: { upsert: [], mention: [], resolve: [], defer: [] },
    newHookCandidates: [],
    chapterSummary: SUMMARY,
  }, { agent: { session: 's' } })
  await tool(root, installFinalizeTool).execute({ chapter: 1 }, { agent: { session: 's' } })
  return root
}

function tool(root, install) {
  const tools = new Map()
  install({
    tools: { register: (definition) => { tools.set(definition.name, definition); return () => {} } },
    workingDirectory: { ensure: async () => root },
  })
  return tools.get([...tools.keys()][0])
}

function deleteTool(root) {
  return tool(root, installDeleteTool)
}

test('snapshotWrites covers the seven initial snapshot files', () => {
  const writes = snapshotWrites(defaultStateSnapshot([HOOK], 'zh'), 0)
  const paths = writes.map((write) => write.relativePath).sort()
  assert.deepEqual(paths, [
    'source/story/current_state.md',
    'source/story/pending_hooks.md',
    'source/story/chapter_summaries.md',
    'source/story/snapshots/0/current_state.md',
    'source/story/snapshots/0/pending_hooks.md',
    'source/story/snapshots/0/chapter_summaries.md',
    'source/story/snapshots/0/state/chapter_summaries.json',
    'source/story/snapshots/0/state/current_state.json',
    'source/story/snapshots/0/state/hooks.json',
    'source/story/snapshots/0/state/manifest.json',
  ].filter((path) => path.includes('snapshots/0')).sort())
})

test('deleting the latest chapter trashes the manuscript and rolls everything back', async () => {
  const root = await workspace()
  try {
    await mkdir(join(root, 'source/story'), { recursive: true })
    await writeFile(join(root, 'source/story/memory.db'), 'index')
    const result = await deleteTool(root).execute({ chapter: 1 }, { agent: { session: 's' } })
    assert.equal(result.deletedChapter, 1)
    assert.equal(result.rolledBackTo, 0)
    assert.deepEqual(result.trashedFiles, ['chapters/.trash/0001_雨夜.md'])
    assert.deepEqual(result.discarded, [1])

    assert.match(await readFile(join(root, 'source/chapters/.trash/0001_雨夜.md'), 'utf8'), /正文/)
    await assert.rejects(stat(join(root, 'source/chapters/0001_雨夜.md')), { code: 'ENOENT' })
    await assert.rejects(stat(join(root, 'source/story/runtime/chapter-0001.review.json')), { code: 'ENOENT' })
    await assert.rejects(stat(join(root, chapterPlanPath(1))), { code: 'ENOENT' })
    await assert.rejects(stat(join(root, 'source/story/memory.db')), { code: 'ENOENT' })
    await assert.rejects(stat(join(root, 'source/story/snapshots/1/current_state.md')), { code: 'ENOENT' })

    const manifest = JSON.parse(await readFile(join(root, 'source/story/state/manifest.json'), 'utf8'))
    assert.equal(manifest.lastAppliedChapter, 0)
    const state = JSON.parse(await readFile(join(root, 'source/story/state/current_state.json'), 'utf8'))
    assert.equal(state.chapter, 0)
    assert.deepEqual(JSON.parse(await readFile(join(root, 'source/chapters/index.json'), 'utf8')), [])
    assert.equal(detectStage(root).stage, 'foundation-ready')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('only the latest chapter can be deleted', async () => {
  const root = await workspace()
  try {
    await assert.rejects(deleteTool(root).execute({ chapter: 0 }, { agent: { session: 's' } }), /只能删除最新章/)
    await assert.rejects(deleteTool(root).execute({ chapter: 2 }, { agent: { session: 's' } }), /只能删除最新章/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a missing previous snapshot rejects before any file moves', async () => {
  const root = await workspace()
  try {
    await rm(join(root, 'source/story/snapshots/0'), { recursive: true, force: true })
    await assert.rejects(deleteLatestChapter(root, 1), /快照缺失/)
    assert.match(await readFile(join(root, 'source/chapters/0001_雨夜.md'), 'utf8'), /正文/)
    await assert.rejects(stat(join(root, 'source/chapters/.trash')), { code: 'ENOENT' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('trash keeps older files and picks a suffix', async () => {
  const root = await workspace()
  try {
    await mkdir(join(root, 'source/chapters/.trash'), { recursive: true })
    await writeFile(join(root, 'source/chapters/.trash/0001_雨夜.md'), '旧稿')
    const result = await deleteTool(root).execute({ chapter: 1 }, { agent: { session: 's' } })
    assert.deepEqual(result.trashedFiles, ['chapters/.trash/0001_雨夜-2.md'])
    assert.equal(await readFile(join(root, 'source/chapters/.trash/0001_雨夜.md'), 'utf8'), '旧稿')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
