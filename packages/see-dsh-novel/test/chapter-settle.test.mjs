import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { applySettlement } from '../src/core/settle.ts'
import { writeChapterDocument } from '../src/core/chapter-document.ts'
import { chapterReviewPath, reviewChapter } from '../src/core/chapter-review.ts'
import { saveChapterPlan } from '../src/core/chapter-plan.ts'
import { inspectState, readStateSnapshot, snapshotWrites } from '../src/core/state.ts'
import { reopenChapter } from '../src/core/reopen.ts'
import { installSettleTool } from '../src/pipelines/long/settle-tool.ts'
import { installResettleTool } from '../src/pipelines/long/resettle-tool.ts'
import { STORY_CHAPTER_SUMMARIES_MD, STORY_CURRENT_STATE_MD, STORY_PENDING_HOOKS, WORK_FILE } from '../src/core/story-paths.ts'
import { clearWorkflowStart, WORKFLOW_START_PATH, writeWorkflowStart } from '../src/core/workflow-start.ts'

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
  await writeFile(join(root, 'source/story/state/current_state.json'), JSON.stringify({
    chapter: options.lastApplied ?? 0, facts: [],
  }))
  await writeFile(join(root, 'source/story/state/chapter_summaries.json'), JSON.stringify({ rows: options.rows ?? [] }))
  await writeFile(join(root, STORY_CHAPTER_SUMMARIES_MD), '# 章节摘要\n')
  await saveChapterPlan(root, { chapter: 1, goal: '目标', body: '计划', threadRefs: [] })
  await writeChapterDocument(root, { chapter: 1, title: '雨夜', content: '正文。', language: 'zh' })
  await reviewChapter(root, {
    chapter: 1,
    summary: '初审',
    observations: [{ code: 'C1', summary: '观察', assessment: 'unavailable' }],
  })
  return root
}

function toolsFor(root) {
  const tools = new Map()
  const ctx = {
    tools: { register: (definition) => { tools.set(definition.name, definition); return () => {} } },
    workingDirectory: { ensure: async () => root },
  }
  installSettleTool(ctx)
  installResettleTool(ctx)
  return tools
}

function tool(root) {
  return toolsFor(root).get('story_settle_chapter')
}

function resettleTool(root) {
  return toolsFor(root).get('story_resettle_chapter')
}

/** 把当前状态写成第 chapter 章快照（foundation 的正常产物是 0）。 */
async function seedSnapshot(root, chapter) {
  const read = await inspectState(root, [], 'zh')
  for (const write of snapshotWrites(read.snapshot, chapter)) {
    await mkdir(join(root, write.relativePath, '..'), { recursive: true })
    await writeFile(join(root, write.relativePath), write.content)
  }
}

/** 写章节索引；resettle 按它判最新章。 */
async function seedIndex(root, numbers) {
  await mkdir(join(root, 'source/chapters'), { recursive: true })
  await writeFile(join(root, 'source/chapters/index.json'), JSON.stringify(numbers.map((number) => ({
    number,
    title: '雨夜',
    wordCount: 1,
    createdAt: '2026-11-10T00:00:00.000Z',
    updatedAt: '2026-11-10T00:00:00.000Z',
    observations: [],
    provenance: 'generated',
  }))))
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

test('settling sorts summaries by chapter and rejects a pre-existing row off the reapply path', async () => {
  const later = { chapter: 2, ...SUMMARY, title: '第二' }
  const root = await workspace({ rows: [later] })
  try {
    const result = await tool(root).execute(delta(), exec)
    assert.equal(result.chapter, 1)
    const summaries = await readJson(root, 'source/story/state/chapter_summaries.json')
    assert.deepEqual(summaries.rows.map((row) => row.chapter), [1, 2])
  } finally {
    await rm(root, { recursive: true, force: true })
  }

  const legacy = await workspace({ rows: [{ chapter: 1, ...SUMMARY }] })
  try {
    const files = ['source/story/state/chapter_summaries.json', 'source/story/state/manifest.json', 'source/story/state/current_state.json', 'source/story/state/hooks.json', STORY_CHAPTER_SUMMARIES_MD]
    const before = await Promise.all(files.map((file) => readFile(join(legacy, file), 'utf8')))
    await assert.rejects(tool(legacy).execute(delta(), exec), /第 1 章已有摘要行/)
    assert.deepEqual(await Promise.all(files.map((file) => readFile(join(legacy, file), 'utf8'))), before)
  } finally {
    await rm(legacy, { recursive: true, force: true })
  }
})

test('settling rejects an empty summary title', async () => {
  const root = await workspace()
  try {
    await assert.rejects(tool(root).execute(delta({ chapterSummary: { ...SUMMARY, title: '' } }), exec), /chapterSummary\.title 不能为空/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('resettling from the baseline drops the previous settlement and refreshes the snapshot', async () => {
  const root = await workspace()
  try {
    await seedSnapshot(root, 0)
    await tool(root).execute(delta({ hookOps: { upsert: [], mention: [], resolve: ['hook-1'], defer: [] } }), exec)
    const chapterPath = join(root, 'source/chapters/0001_雨夜.md')
    const chapterBefore = await readFile(chapterPath, 'utf8')

    const result = await resettleTool(root).execute(delta({
      factOps: { upsert: [{ subject: '甲', predicate: '位置', object: '山脚' }], expire: [] },
      newHookCandidates: [],
      chapterSummary: { ...SUMMARY, mood: '释然' },
    }), exec)
    assert.equal(result.baselineChapter, 0)
    const state = await readJson(root, 'source/story/state/current_state.json')
    assert.deepEqual(state.facts.map((fact) => fact.object), ['山脚'])
    assert.equal(state.facts.some((fact) => fact.object === '山门'), false)
    const hooks = await readJson(root, 'source/story/state/hooks.json')
    assert.equal(hooks.hooks.find((hook) => hook.hookId === 'hook-1').status, 'deferred')
    const summaries = await readJson(root, 'source/story/state/chapter_summaries.json')
    assert.deepEqual(summaries.rows.map((row) => [row.chapter, row.mood]), [[1, '释然']])
    // 快照随重算刷新，正文、索引与 workflow start 不动。
    assert.equal((await readJson(root, 'source/story/snapshots/1/state/manifest.json')).lastAppliedChapter, 1)
    assert.equal(await readFile(chapterPath, 'utf8'), chapterBefore)
    await assert.rejects(readFile(join(root, 'source/chapters/index.json'), 'utf8'), /ENOENT/u)
    await assert.rejects(readFile(join(root, WORKFLOW_START_PATH), 'utf8'), /ENOENT/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('resettling a finalized chapter keeps the chapter index bytes', async () => {
  const root = await workspace()
  try {
    await seedSnapshot(root, 0)
    await seedIndex(root, [1])
    await tool(root).execute(delta(), exec)
    await seedSnapshot(root, 1)
    const indexBefore = await readFile(join(root, 'source/chapters/index.json'), 'utf8')
    await resettleTool(root).execute(delta({ newHookCandidates: [] }), exec)
    assert.equal(await readFile(join(root, 'source/chapters/index.json'), 'utf8'), indexBefore)
    assert.equal((await readJson(root, 'source/story/snapshots/1/state/manifest.json')).lastAppliedChapter, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('resettle rejects non-latest targets and missing baselines', async () => {
  const latest = await workspace()
  try {
    await seedSnapshot(latest, 0)
    await seedIndex(latest, [1, 2])
    await tool(latest).execute(delta(), exec)
    await assert.rejects(
      resettleTool(latest).execute(delta({ chapter: 1 }), exec),
      /只支持最新章重算.*当前最新是第 2 章.*先重算第 2 章/u,
    )
  } finally {
    await rm(latest, { recursive: true, force: true })
  }

  const ahead = await workspace({ lastApplied: 2 })
  try {
    await assert.rejects(
      resettleTool(ahead).execute(delta(), exec),
      /只支持最新章重算.*当前最新是第 2 章.*先重算第 2 章/u,
    )
  } finally {
    await rm(ahead, { recursive: true, force: true })
  }

  const noBaseline = await workspace()
  try {
    await seedIndex(noBaseline, [1])
    await assert.rejects(
      resettleTool(noBaseline).execute(delta(), exec),
      /快照不可用.*manifest\.json 缺失/u,
    )
    const manifest = await readJson(noBaseline, 'source/story/state/manifest.json')
    assert.equal(manifest.lastAppliedChapter, 0)
    await assert.rejects(readFile(join(noBaseline, 'source/story/snapshots/1/state/manifest.json'), 'utf8'), /ENOENT/u)
  } finally {
    await rm(noBaseline, { recursive: true, force: true })
  }

  const badBaseline = await workspace()
  try {
    await seedSnapshot(badBaseline, 0)
    await seedIndex(badBaseline, [1])
    await writeFile(join(badBaseline, 'source/story/snapshots/0/state/hooks.json'), '{ bad')
    await assert.rejects(resettleTool(badBaseline).execute(delta(), exec), /快照不可用.*hooks\.json 不合法/u)
    assert.equal((await readJson(badBaseline, 'source/story/state/manifest.json')).lastAppliedChapter, 0)
    await assert.rejects(readFile(join(badBaseline, 'source/story/snapshots/1/state/manifest.json'), 'utf8'), /ENOENT/u)
  } finally {
    await rm(badBaseline, { recursive: true, force: true })
  }
})

test('readStateSnapshot is strict about files and cross-file invariants', async () => {
  const root = await workspace()
  try {
    await seedSnapshot(root, 0)
    const snapshot = await readStateSnapshot(root, 0)
    assert.equal(snapshot.manifest.lastAppliedChapter, 0)

    await rm(join(root, 'source/story/snapshots/0/state/hooks.json'))
    await assert.rejects(readStateSnapshot(root, 0), /hooks\.json 缺失/u)

    await writeFile(join(root, 'source/story/snapshots/0/state/hooks.json'), '{ bad')
    await assert.rejects(readStateSnapshot(root, 0), /hooks\.json 不合法/u)

    await writeFile(join(root, 'source/story/snapshots/0/state/hooks.json'), JSON.stringify({ hooks: [] }))
    await writeFile(join(root, 'source/story/snapshots/0/state/hooks.json'), JSON.stringify({ hooks: 'bad' }))
    await assert.rejects(readStateSnapshot(root, 0), /hooks\.json 不合法/u)

    await writeFile(join(root, 'source/story/snapshots/0/state/hooks.json'), JSON.stringify({ hooks: [] }))
    await writeFile(join(root, 'source/story/snapshots/0/state/current_state.json'), JSON.stringify({ chapter: 3, facts: [] }))
    await assert.rejects(readStateSnapshot(root, 0), /大于.*lastAppliedChapter/u)

    const duplicate = await workspace()
    try {
      await seedSnapshot(duplicate, 0)
      const row = { chapter: 1, title: '雨夜', characters: '', events: '', stateChanges: '', hookActivity: '', mood: '', chapterType: '' }
      await writeFile(
        join(duplicate, 'source/story/snapshots/0/state/chapter_summaries.json'),
        JSON.stringify({ rows: [row, { ...row }] }),
      )
      await assert.rejects(readStateSnapshot(duplicate, 0), /chapter_summaries\.json.*重复/u)
    } finally {
      await rm(duplicate, { recursive: true, force: true })
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('settle refuses an already settled chapter and any chapter with a snapshot', async () => {
  const root = await workspace()
  try {
    await seedSnapshot(root, 0)
    await seedIndex(root, [1])
    await tool(root).execute(delta(), exec)
    await assert.rejects(tool(root).execute(delta(), exec), /已结算.*story_resettle_chapter/u)

    const snapped = await workspace()
    try {
      await seedSnapshot(snapped, 0)
      await seedSnapshot(snapped, 1)
      await seedIndex(snapped, [1])
      await assert.rejects(tool(snapped).execute(delta(), exec), /已有状态快照.*story_resettle_chapter/u)
    } finally {
      await rm(snapped, { recursive: true, force: true })
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('resettle repairs unreadable state from the highest available evidence', async () => {
  const root = await workspace()
  try {
    await seedSnapshot(root, 0)
    await seedIndex(root, [1])
    await writeFile(join(root, 'source/story/state/current_state.json'), '{ bad')
    const result = await resettleTool(root).execute(delta(), exec)
    assert.equal(result.chapter, 1)
    assert.equal((await readJson(root, 'source/story/state/manifest.json')).lastAppliedChapter, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('resettle keeps the workflow start for the review gate', async () => {
  const root = await workspace()
  try {
    await seedSnapshot(root, 0)
    await tool(root).execute(delta(), exec)
    await writeWorkflowStart(root, { chapter: 1, instruction: '修订后重审第 1 章' })
    await resettleTool(root).execute(delta({ newHookCandidates: [] }), exec)
    assert.match(await readFile(join(root, WORKFLOW_START_PATH), 'utf8'), /修订后重审/u)
    await assert.rejects(
      writeWorkflowStart(root, { chapter: 2, instruction: '下一章' }),
      /还没有消费/u,
    )
    await clearWorkflowStart(root)
    assert.equal((await writeWorkflowStart(root, { chapter: 2, instruction: '下一章' })).chapter, 2)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('resettle refuses when neither the index nor a snapshot has a chapter', async () => {
  const root = await workspace()
  try {
    await assert.rejects(resettleTool(root).execute(delta(), exec), /还没有可重算的章/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a resettled chapter can be resettled again after reopen', async () => {
  const root = await workspace()
  try {
    await seedSnapshot(root, 0)
    await tool(root).execute(delta(), exec)
    await resettleTool(root).execute(delta({ newHookCandidates: [] }), exec)
    await reopenChapter(root, 1)
    const again = await resettleTool(root).execute(delta({ newHookCandidates: [] }), exec)
    assert.equal(again.chapter, 1)
    assert.equal(again.baselineChapter, 0)
    assert.equal((await readJson(root, 'source/story/state/manifest.json')).lastAppliedChapter, 1)
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

test('chapter order rules and missing review errors', async () => {
  const root = await workspace()
  try {
    await assert.rejects(tool(root).execute(delta({ chapter: 2 }), exec), /还没有正文/)
    await rm(join(root, chapterReviewPath(1)), { force: true })
    await assert.rejects(tool(root).execute(delta(), exec), /还没有审稿记录/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('state file guards reject each missing and each corrupt file before writing', async () => {
  const names = ['manifest.json', 'current_state.json', 'hooks.json', 'chapter_summaries.json']
  for (const name of names) {
    const root = await workspace()
    try {
      const stateDir = join(root, 'source/story/state')
      const before = (await readdir(stateDir)).sort()
      await rm(join(stateDir, name), { force: true })
      await assert.rejects(
        tool(root).execute(delta(), exec),
        new RegExp(`状态文件缺失.*${name.replace(/\./gu, '\\.')}`, 'u'),
      )
      assert.deepEqual((await readdir(stateDir)).sort(), before.filter((file) => file !== name))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }

  const empty = await workspace()
  try {
    const stateDir = join(empty, 'source/story/state')
    for (const name of names) await rm(join(stateDir, name), { force: true })
    await assert.rejects(
      tool(empty).execute(delta(), exec),
      /状态文件缺失.*manifest\.json.*current_state\.json.*hooks\.json.*chapter_summaries\.json/u,
    )
    assert.deepEqual(await readdir(stateDir), [])
  } finally {
    await rm(empty, { recursive: true, force: true })
  }

  for (const name of names) {
    const root = await workspace()
    try {
      const stateDir = join(root, 'source/story/state')
      const before = (await readdir(stateDir)).sort()
      await writeFile(join(stateDir, name), '{ bad')
      await assert.rejects(tool(root).execute(delta(), exec), /状态文件损坏/u)
      assert.deepEqual((await readdir(stateDir)).sort(), before)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }
})

test('settle allows a forward chapter gap', async () => {
  const root = await workspace()
  try {
    await writeChapterDocument(root, { chapter: 2, title: '第二', content: '第二章正文。', language: 'zh' })
    await saveChapterPlan(root, { chapter: 2, goal: '目标', body: '计划', threadRefs: [] })
    await reviewChapter(root, {
      chapter: 2,
      summary: '二审',
      observations: [{ code: 'C2', summary: '观察', assessment: 'unavailable' }],
    })
    const result = await tool(root).execute(delta({ chapter: 2 }), exec)
    assert.equal(result.chapter, 2)
    assert.equal((await readJson(root, 'source/story/state/manifest.json')).lastAppliedChapter, 2)
    assert.equal((await readJson(root, 'source/story/state/current_state.json')).chapter, 2)
    const rows = (await readJson(root, 'source/story/state/chapter_summaries.json')).rows
    assert.deepEqual(rows.map((row) => row.chapter), [2])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('applySettlement allows forward gaps and rejects backwards chapters', async () => {
  const root = await workspace()
  try {
    const before = await inspectState(root, [], 'zh')
    const gap = applySettlement(before.snapshot, delta({ chapter: 3 }), {})
    assert.equal(gap.snapshot.manifest.lastAppliedChapter, 3)
    assert.equal(gap.snapshot.currentState.chapter, 3)
    assert.deepEqual(gap.snapshot.chapterSummaries.rows.map((row) => row.chapter), [3])
    assert.throws(
      () => applySettlement(gap.snapshot, delta({ chapter: 2 }), {}),
      /不支持更早章节重算/,
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
        /不支持更早章节重算/,
      )
    } finally {
      await rm(ahead, { recursive: true, force: true })
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
