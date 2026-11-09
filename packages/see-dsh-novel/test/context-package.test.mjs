import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  assembleContext,
  buildSelectionGroups,
  buildSelectionTasks,
  estimateTokens,
} from '../src/core/context-package.ts'
import {
  chapterContextPath,
  chapterPlannerContextPath,
  loadPlannerContext,
  loadWriterContext,
  savePlannerContext,
  saveWriterContext,
} from '../src/core/chapter-plan.ts'

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'see-dsh-novel-context-'))
  for (const dir of [
    'source/story/state',
    'source/story/outline',
    'source/story/roles/主要角色',
    'source/story/runtime',
    'source/chapters',
  ]) await mkdir(join(root, dir), { recursive: true })
  await writeFile(join(root, 'source/story/state/current_state.json'), JSON.stringify({
    chapter: 1,
    facts: [
      { subject: '甲', predicate: '持有', object: '钥匙', validFromChapter: 1, validUntilChapter: null },
      { subject: '乙', predicate: '隐瞒', object: '身份', validFromChapter: 1, validUntilChapter: null },
    ],
  }), 'utf8')
  await writeFile(join(root, 'source/story/state/hooks.json'), JSON.stringify({
    hooks: [
      { hookId: 'H1', startChapter: 0, type: '悬案', status: 'deferred', lastAdvancedChapter: 0, expectedPayoff: '首卷回收', notes: '开场埋' },
      { hookId: 'H2', startChapter: 0, type: '已解', status: 'resolved', lastAdvancedChapter: 1, expectedPayoff: '已回收', notes: '不再检索' },
    ],
  }), 'utf8')
  await writeFile(join(root, 'source/story/state/chapter_summaries.json'), JSON.stringify({
    rows: [{
      chapter: 1, title: '雨夜', characters: '甲', events: '发现身份线索',
      stateChanges: '身份动摇', hookActivity: 'H1 推进', mood: '压抑', chapterType: '推进',
    }],
  }), 'utf8')
  await writeFile(join(root, 'source/story/volume_summaries.md'), '## 第一卷\n\n卷摘要：雨夜里的身份线。\n', 'utf8')
  await writeFile(join(root, 'source/story/roles/主要角色/甲.md'), '# 甲\n\n雾津的修表匠。\n', 'utf8')
  await writeFile(join(root, 'source/story/roles/主要角色/乙.md'), '# 乙\n\n沉默的账房。\n', 'utf8')
  await writeFile(join(root, 'source/story/outline/story_frame.md'), '# 框架\n\n## 前提\n\n一桩悬案。\n\n## 冲突\n\n身份与记忆。\n', 'utf8')
  await writeFile(join(root, 'source/story/outline/volume_map.md'), '## 第一卷\n\n身份线。\n\n## 第二卷\n\n偿还线。\n', 'utf8')
  await writeFile(join(root, 'source/story/current_focus.md'), '当前聚焦'.repeat(10), 'utf8')
  await writeFile(join(root, 'source/story/author_intent.md'), '作者意图'.repeat(10), 'utf8')
  await writeFile(join(root, 'source/story/style_guide.md'), '风格指南'.repeat(10), 'utf8')
  await writeFile(join(root, 'source/story/parent_canon.md'), '父级正典'.repeat(10), 'utf8')
  await writeFile(join(root, 'source/story/fanfic_canon.md'), '同人正典'.repeat(10), 'utf8')
  await writeFile(join(root, 'source/chapters/0001_雨夜.md'), '# 第1章 雨夜\n\n上一章正文。\n', 'utf8')
  await writeFile(join(root, 'source/story/runtime/chapter-0002.plan.json'), JSON.stringify({
    version: 2,
    intent: { chapter: 2, goal: '追查身份' },
    memo: { chapter: 2, goal: '追查身份', body: '本章追查身份线索。', threadRefs: ['H1'] },
    plannerInputs: ['runtime/chapter_memo', 'runtime/previous_chapter#1'],
  }, null, 2) + '\n', 'utf8')
  await writeFile(join(root, 'source/story/runtime/chapter-0002.intent.md'), '# Chapter Intent\n', 'utf8')
  return root
}

const cleanup = (root) => rm(root, { recursive: true, force: true })

test('tokens are estimated CJK-first', () => {
  assert.equal(estimateTokens('四人'), 2)
  assert.equal(estimateTokens('abcd'), 1)
})

test('planner pass builds fixed sources, previous chapter and five task groups', async () => {
  const root = await workspace()
  try {
    const built = await buildSelectionGroups(root, 'planner')
    assert.equal(built.chapter, 2)
    assert.ok(built.fixedEntries.some((entry) => entry.source === 'runtime/chapter_memo'))
    assert.ok(built.fixedEntries.some((entry) => entry.source === 'runtime/previous_chapter#1'))
    assert.ok(built.fixedEntries.some((entry) => entry.source === 'source/story/style_guide.md'))
    assert.ok(built.fixedEntries.some((entry) => entry.source === 'source/story/parent_canon.md'))
    assert.deepEqual(built.groups.map((group) => group.kind), ['memory', 'role', 'state', 'outline', 'outline'])
    assert.equal(built.groups.filter((group) => group.kind === 'role')[0].candidates.length, 2)
    assert.equal(built.groups.filter((group) => group.kind === 'state')[0].candidates.length, 2)
    const tasks = await buildSelectionTasks(root, 'planner')
    assert.equal(tasks.mode, 'semantic')
    assert.equal(tasks.tasks.length, 5)
  } finally {
    await cleanup(root)
  }
})

test('writer pass reads the plan memo and does not add previous chapter', async () => {
  const root = await workspace()
  try {
    const built = await buildSelectionGroups(root, 'writer')
    assert.match(built.query, /追查身份/)
    assert.match(built.fixedEntries.find((entry) => entry.source === 'runtime/chapter_memo').excerpt, /追查身份/)
    assert.equal(built.fixedEntries.some((entry) => entry.source.startsWith('runtime/previous_chapter')), false)
    assert.ok(built.fixedEntries.some((entry) => entry.source === 'runtime/referenced_hook#H1'))
  } finally {
    await cleanup(root)
  }
})

test('assembleContext protects fixed and selected non-memory entries', async () => {
  const root = await workspace()
  try {
    const built = await buildSelectionGroups(root, 'writer')
    const candidates = built.groups.flatMap((group) => group.candidates)
    const byKind = (kind) => candidates.filter((candidate) => candidate.kind === kind).map((candidate) => candidate.id)
    const byOutline = (file) => candidates.filter((candidate) => candidate.kind === 'outline' && candidate.source.includes(file)).map((candidate) => candidate.id)
    const assembled = assembleContext({
      chapter: built.chapter,
      query: built.query,
      fixedEntries: built.fixedEntries,
      groups: built.groups,
      selection: {
        memory: [byKind('memory')[0]],
        role: byKind('role'),
        state: byKind('state'),
        storyFrame: byOutline('story_frame.md'),
        volumeMap: byOutline('volume_map.md'),
      },
      mode: 'semantic',
      plannerInputs: ['runtime/chapter_memo'],
      composerInputs: ['source/story/runtime/chapter-0002.intent.md'],
    })
    const selected = assembled.package.selectedContext
    assert.ok(selected.some((entry) => entry.source === 'source/story/style_guide.md' && entry.protection === 'protected'))
    assert.ok(selected.some((entry) => entry.protection === 'compressible' && (entry.source.includes('chapter_summaries') || entry.source.includes('pending_hooks') || entry.source.includes('volume_summaries'))))
    assert.ok(selected.some((entry) => entry.source === 'source/story/roles/主要角色/甲.md' && entry.protection === 'protected'))
    assert.ok(selected.some((entry) => entry.source.startsWith('runtime/current_state#') && entry.protection === 'protected'))
    assert.deepEqual(assembled.trace.plannerInputs, ['runtime/chapter_memo'])
    assert.deepEqual(assembled.trace.composerInputs, ['source/story/runtime/chapter-0002.intent.md'])
    assert.equal(assembled.trace.retrieval.selectionMode, 'semantic')
    assert.ok(assembled.trace.retrieval.candidates.length >= 1)
  } finally {
    await cleanup(root)
  }
})

test('outline selections are validated per file', async () => {
  const root = await workspace()
  try {
    const built = await buildSelectionGroups(root, 'writer')
    const outline = built.groups.filter((group) => group.kind === 'outline').flatMap((group) => group.candidates)
    const storyFrame = outline.find((candidate) => candidate.source.includes('story_frame.md'))
    const volumeMap = outline.find((candidate) => candidate.source.includes('volume_map.md'))
    assert.ok(storyFrame !== undefined && volumeMap !== undefined)
    assert.throws(() => assembleContext({
      chapter: built.chapter,
      query: built.query,
      fixedEntries: built.fixedEntries,
      groups: built.groups,
      selection: {
        memory: [],
        role: [],
        state: [],
        storyFrame: [volumeMap.id],
        volumeMap: [storyFrame.id],
      },
      mode: 'semantic',
    }), /未知的候选 id/)
  } finally {
    await cleanup(root)
  }
})

test('complete mode selects all candidates and returns no tasks', async () => {
  const root = await workspace()
  try {
    const built = await buildSelectionTasks(root, 'writer', { contextWindowTokens: 1_000_000 })
    assert.equal(built.mode, 'complete')
    assert.deepEqual(built.tasks, [])
    const assembled = assembleContext({
      chapter: built.chapter,
      query: built.query,
      fixedEntries: built.fixedEntries,
      groups: built.groups,
      selection: { memory: [], role: [], state: [], storyFrame: [], volumeMap: [] },
      mode: built.mode,
    })
    assert.equal(assembled.trace.retrieval.selectionMode, 'complete')
    assert.deepEqual(assembled.trace.retrieval.semanticSelectedIds, [])
    assert.ok(assembled.package.selectedContext.length > built.fixedEntries.length)
  } finally {
    await cleanup(root)
  }
})

test('persists planner and writer context artifacts', async () => {
  const root = await workspace()
  try {
    const built = await buildSelectionGroups(root, 'planner')
    const pkg = { chapter: built.chapter, selectedContext: built.fixedEntries }
    await savePlannerContext(root, built.chapter, pkg)
    assert.equal((await loadPlannerContext(root, built.chapter))?.chapter, 2)
    await saveWriterContext(root, built.chapter, pkg, { chapter: 2 })
    assert.equal((await loadWriterContext(root, built.chapter))?.chapter, 2)
    assert.equal(chapterPlannerContextPath(2), 'source/story/runtime/chapter-0002.planner-context.json')
    assert.equal(chapterContextPath(2), 'source/story/runtime/chapter-0002.context.json')
  } finally {
    await cleanup(root)
  }
})
