import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { applySettlement } from '../src/core/settle.ts'
import { writeChapterDocument } from '../src/core/chapter-document.ts'
import { chapterReviewPath, reviewChapter } from '../src/core/chapter-review.ts'
import { saveChapterPlan } from '../src/core/chapter-plan.ts'
import { inspectState } from '../src/core/state.ts'
import { installSettleTool } from '../src/pipelines/long/settle-tool.ts'
import { STORY_CHAPTER_SUMMARIES_MD, STORY_CURRENT_STATE_MD, STORY_PENDING_HOOKS, WORK_FILE } from '../src/core/story-paths.ts'

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

async function workspace(options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'see-dsh-novel-settle-'))
  await mkdir(join(root, 'source/story/state'), { recursive: true })
  await mkdir(join(root, 'source/story/runtime'), { recursive: true })
  await mkdir(join(root, 'source/chapters'), { recursive: true })
  await writeFile(join(root, WORK_FILE), JSON.stringify({
    version: 1, id: 'w', title: '标题', profile: 'longform-novel', language: 'zh', status: 'draft',
    metadata: { chapterWordCount: 300 }, createdAt: '2026-11-10T00:00:00.000Z', updatedAt: '2026-11-10T00:00:00.000Z',
  }))
  await writeFile(join(root, 'source/story/state/manifest.json'), JSON.stringify({
    schemaVersion: 2, language: 'zh', lastAppliedChapter: options.lastApplied ?? 0, projectionVersion: 1,
  }))
  await writeFile(join(root, 'source/story/state/hooks.json'), JSON.stringify({ hooks: options.hooks ?? [HOOK] }))
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
  installSettleTool({
    tools: { register: (definition) => { tools.set(definition.name, definition); return () => {} } },
    workingDirectory: { ensure: async () => root },
  })
  return tools.get('story_settle_chapter')
}

const exec = { agent: { session: 's' } }

function delta(overrides = {}) {
  return {
    chapter: 1,
    postSettlement: '甲上山。',
    factOps: { upsert: [{ subject: '甲', predicate: '位置', object: '山门' }], expire: [] },
    hookOps: { upsert: [], mention: ['hook-1'], resolve: [], defer: [] },
    newHookCandidates: [{ type: 'promise', expectedPayoff: '真相', notes: '' }],
    chapterSummary: SUMMARY,
    ...overrides,
  }
}

async function readJson(root, path) {
  return JSON.parse(await readFile(join(root, path), 'utf8'))
}

test('settle writes facts, hooks, summary, manifest and projections', async () => {
  const root = await workspace()
  try {
    const result = await tool(root).execute(delta(), exec)
    assert.equal(result.chapter, 1)
    assert.equal(result.facts, 1)
    assert.equal(result.hooks, 2)
    assert.equal(result.summaryTitle, '雨夜')

    const manifest = await readJson(root, 'source/story/state/manifest.json')
    assert.equal(manifest.lastAppliedChapter, 1)
    const state = await readJson(root, 'source/story/state/current_state.json')
    assert.equal(state.chapter, 1)
    assert.equal(state.facts[0].subject, '甲')
    assert.equal(state.facts[0].validFromChapter, 1)
    const hooks = await readJson(root, 'source/story/state/hooks.json')
    const created = hooks.hooks.find((hook) => hook.hookId === 'hook')
    assert.equal(created.startChapter, 1)
    assert.equal(created.lastAdvancedChapter, 1)
    assert.equal(created.status, 'open')
    const projections = await readFile(join(root, STORY_CURRENT_STATE_MD), 'utf8')
    assert.match(projections, /甲/)
    assert.match(await readFile(join(root, STORY_CHAPTER_SUMMARIES_MD), 'utf8'), /雨夜/)
    assert.match(await readFile(join(root, STORY_PENDING_HOOKS), 'utf8'), /hook/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('re-settling the same chapter expires the old value and keeps one active fact', async () => {
  const root = await workspace()
  try {
    await tool(root).execute(delta(), exec)
    await tool(root).execute(delta({
      factOps: { upsert: [{ subject: '甲', predicate: '位置', object: '山脚' }], expire: [] },
      newHookCandidates: [],
    }), exec)
    const state = await readJson(root, 'source/story/state/current_state.json')
    const active = state.facts.filter((fact) => fact.validUntilChapter === null)
    assert.equal(active.length, 1)
    assert.equal(active[0].object, '山脚')
    const old = state.facts.find((fact) => fact.object === '山门')
    assert.equal(old.validUntilChapter, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('hook ops: mention and defer do not advance, resolve does, superseded is protected', async () => {
  const root = await workspace()
  try {
    const before = await inspectState(root, [], 'zh')
    const hooked = applySettlement(before.snapshot, delta({
      newHookCandidates: [],
      hookOps: { upsert: [], mention: ['hook-1'], resolve: [], defer: ['hook-1'] },
    }), { allowReapply: false })
    assert.equal(hooked.snapshot.hooks.hooks[0].status, 'deferred')
    assert.equal(hooked.snapshot.hooks.hooks[0].lastAdvancedChapter, 1)

    const resolved = applySettlement(hooked.snapshot, delta({
      newHookCandidates: [],
      hookOps: { upsert: [], mention: [], resolve: ['hook-1'], defer: [] },
    }), { allowReapply: true })
    assert.equal(resolved.snapshot.hooks.hooks[0].status, 'resolved')
    assert.equal(resolved.snapshot.hooks.hooks[0].lastAdvancedChapter, 1)

    assert.throws(() => applySettlement(resolved.snapshot, delta({
      newHookCandidates: [],
      hookOps: { upsert: [], mention: [], resolve: ['missing'], defer: [] },
    }), { allowReapply: true }), /未知伏笔/)

    const superseded = {
      ...HOOK,
      hookId: 'hook-9',
      status: 'superseded',
      notes: '作者撤回',
    }
    const withSuperseded = await inspectState(root, [], 'zh')
    withSuperseded.snapshot.hooks.hooks.push(superseded)
    assert.throws(() => applySettlement(withSuperseded.snapshot, delta({
      newHookCandidates: [],
      hookOps: { upsert: [], mention: [], resolve: ['hook-9'], defer: [] },
    }), { allowReapply: false }), /已撤回/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('withdrawal and history protection follow the merge rules', async () => {
  const root = await workspace()
  try {
    const before = await inspectState(root, [], 'zh')
    const withOpen = applySettlement(before.snapshot, delta({ newHookCandidates: [] }), { allowReapply: false })
    const withResolved = applySettlement(withOpen.snapshot, delta({
      newHookCandidates: [],
      hookOps: { upsert: [], mention: [], resolve: ['hook-1'], defer: [] },
    }), { allowReapply: true })

    assert.throws(() => applySettlement(withResolved.snapshot, delta({
      newHookCandidates: [],
      hookOps: {
        upsert: [{ ...HOOK, status: 'superseded', notes: '' }],
        mention: [], resolve: [], defer: [],
      },
    }), { allowReapply: true }), /撤回已回收/)

    const withNotes = applySettlement(withOpen.snapshot, delta({
      newHookCandidates: [],
      hookOps: {
        upsert: [{ ...HOOK, status: 'superseded', notes: '作者撤回' }],
        mention: [], resolve: [], defer: [],
      },
    }), { allowReapply: true })
    assert.equal(withNotes.snapshot.hooks.hooks[0].status, 'superseded')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('chapter order rules and missing review/state errors', async () => {
  const root = await workspace()
  try {
    await assert.rejects(tool(root).execute(delta({ chapter: 2 }), exec), /还没有正文/)
    await rm(join(root, chapterReviewPath(1)), { force: true })
    await assert.rejects(tool(root).execute(delta(), exec), /还没有审稿记录/)

    const other = await workspace()
    try {
      await writeFile(join(other, 'source/story/state/hooks.json'), '{ bad')
      await assert.rejects(tool(other).execute(delta(), exec), /状态文件损坏/)
    } finally {
      await rm(other, { recursive: true, force: true })
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('applySettlement rejects backwards and out-of-order chapters', async () => {
  const root = await workspace()
  try {
    const before = await inspectState(root, [], 'zh')
    assert.throws(
      () => applySettlement(before.snapshot, delta({ chapter: 2 }), {}),
      /必须前进/,
    )
    const settled = applySettlement(before.snapshot, delta(), {})
    assert.throws(
      () => applySettlement(settled.snapshot, delta({ chapter: 1 }), {}),
      /已经结算过/,
    )
    const ahead = await workspace({ lastApplied: 2 })
    try {
      const aheadState = await inspectState(ahead, [], 'zh')
      assert.throws(
        () => applySettlement(aheadState.snapshot, delta({ chapter: 1 }), {}),
        /D33/,
      )
    } finally {
      await rm(ahead, { recursive: true, force: true })
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
