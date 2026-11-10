import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { installStateCheckTool } from '../src/pipelines/long/state-check-tool.ts'
import { installSettleTool } from '../src/pipelines/long/settle-tool.ts'
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
  const root = await mkdtemp(join(tmpdir(), 'see-dsh-novel-check-'))
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
  await writeChapterDocument(root, { chapter: 1, title: '雨夜', content: '正文。', language: 'zh' })
  await reviewChapter(root, {
    chapter: 1,
    summary: '初审',
    observations: [{ code: 'C1', summary: '观察', assessment: 'unavailable' }],
  })
  return root
}

function registry(root) {
  const tools = new Map()
  const ctx = {
    tools: { register: (definition) => { tools.set(definition.name, definition); return () => {} } },
    workingDirectory: { ensure: async () => root },
  }
  installSettleTool(ctx)
  installStateCheckTool(ctx)
  return tools
}

const exec = { agent: { session: 's' } }

async function settle(root) {
  await registry(root).get('story_settle_chapter').execute({
    chapter: 1,
    postSettlement: '甲上山。',
    factOps: { upsert: [], expire: [] },
    hookOps: { upsert: [], mention: [], resolve: [], defer: [] },
    newHookCandidates: [],
    chapterSummary: SUMMARY,
  }, exec)
}

test('a clear report returns one review observation and stays consistent', async () => {
  const root = await workspace()
  try {
    await settle(root)
    const result = await registry(root).get('story_state_check').execute({
      chapter: 1,
      reconciliationRequired: false,
      reportMarkdown: '第 1 章与 current_state 一致。',
    }, exec)
    assert.equal(result.consistent, true)
    assert.equal(result.reconciliationRequired, false)
    assert.deepEqual(result.observations.map((item) => item.code), ['state-projection-review'])
    assert.match(result.observations[0].summary, /一致/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('an empty report with no reconciliation is a clean check', async () => {
  const root = await workspace()
  try {
    await settle(root)
    const result = await registry(root).get('story_state_check').execute({
      chapter: 1,
      reconciliationRequired: false,
      reportMarkdown: '   ',
    }, exec)
    assert.equal(result.consistent, true)
    assert.deepEqual(result.observations, [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('reconciliation requires a report and its observation uses the reconciliation code', async () => {
  const root = await workspace()
  try {
    await settle(root)
    const tool = registry(root).get('story_state_check')
    await assert.rejects(tool.execute({
      chapter: 1,
      reconciliationRequired: true,
      reportMarkdown: '  ',
    }, exec), /STATE_RECONCILIATION_REASON_REQUIRED/)

    const result = await tool.execute({
      chapter: 1,
      reconciliationRequired: true,
      reportMarkdown: '投影把甲的伤写成了痊愈，但正文仍是重伤。',
    }, exec)
    assert.equal(result.consistent, false)
    assert.equal(result.observations[0].code, 'state-reconciliation')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('state check writes nothing', async () => {
  const root = await workspace()
  try {
    await settle(root)
    const before = await readdir(root, { recursive: true })
    const manifest = await readFile(join(root, 'source/story/state/manifest.json'), 'utf8')
    await registry(root).get('story_state_check').execute({
      chapter: 1,
      reconciliationRequired: false,
      reportMarkdown: '观察一条。',
    }, exec)
    assert.deepEqual(await readdir(root, { recursive: true }), before)
    assert.equal(await readFile(join(root, 'source/story/state/manifest.json'), 'utf8'), manifest)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('check rejects an unsettled chapter and a missing previous snapshot', async () => {
  const root = await workspace()
  try {
    const tool = registry(root).get('story_state_check')
    await assert.rejects(tool.execute({
      chapter: 1,
      reconciliationRequired: false,
      reportMarkdown: '',
    }, exec), /还没有结算/)

    await settle(root)
    await rm(join(root, 'source/story/snapshots/0'), { recursive: true, force: true })
    await assert.rejects(tool.execute({
      chapter: 1,
      reconciliationRequired: false,
      reportMarkdown: '',
    }, exec), /快照缺失/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
