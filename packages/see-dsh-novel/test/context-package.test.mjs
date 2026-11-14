import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { renderWriterContract } from '../src/pipelines/long/stages/writer.ts'
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
  parseContextPackageText,
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

test('over-budget assembly returns a compression task and applies validated text', () => {
  const fixed = [{ source: 'fixed', reason: 'r', excerpt: '甲'.repeat(100), protection: 'protected' }]
  const candidate = {
    id: 'memory:x', selectionId: 'memory:x', kind: 'memory', source: 'memory/x', title: 'x',
    excerpt: '乙'.repeat(200), score: 1,
  }
  const groups = [{ kind: 'memory', instruction: 'select', candidates: [candidate] }]
  const budget = { contextWindowTokens: 150, reservedOutputTokens: 0 }
  const task = assembleContext({
    chapter: 1,
    query: '任务',
    fixedEntries: fixed,
    groups,
    selection: { memory: ['memory:x'], role: [], state: [], storyFrame: [], volumeMap: [] },
    mode: 'semantic',
    budget,
    language: 'zh',
  })
  assert.ok(task.compressionTask !== undefined)
  assert.ok(task.compressionTask.maxInputTokens > 0)
  assert.ok(task.compressionTask.chunks.length >= 1)
  assert.equal(task.compressionTask.language, 'zh')
  assert.equal(task.package, undefined)

  const compiled = '短'.repeat(5)
  const assembled = assembleContext({
    chapter: 1,
    query: '任务',
    fixedEntries: fixed,
    groups,
    selection: { memory: ['memory:x'], role: [], state: [], storyFrame: [], volumeMap: [] },
    mode: 'semantic',
    budget,
    language: 'zh',
    compression: { text: compiled },
  })
  assert.ok(assembled.package !== undefined && assembled.trace !== undefined)
  assert.equal(assembled.trace.compression.compiledSource, 'runtime/compiled-compressible-context')
  assert.equal(assembled.trace.compression.budgetTokens, task.compressionTask.maxInputTokens)
  assert.equal(assembled.trace.compression.compressibleTokens > assembled.trace.compression.budgetTokens, true)
  assert.ok(assembled.package.selectedContext.some((entry) => entry.source === 'runtime/compiled-compressible-context'))
})

test('memory candidates split and group under the semantic budget', async () => {
  const root = await workspace()
  try {
    const built = await buildSelectionTasks(root, 'planner', {
      budget: { contextWindowTokens: 800, reservedOutputTokens: 0 },
    })
    const memoryTasks = built.tasks.filter((task) => task.kind === 'memory')
    assert.ok(memoryTasks.length > 1)
    assert.ok(memoryTasks.every((task) => task.candidates.length >= 1))
    assert.ok(memoryTasks.some((task) => task.candidates.some((candidate) => candidate.selectionId.includes(':part-'))))
  } finally {
    await cleanup(root)
  }
})

test('complete mode selects all candidates and returns no tasks', async () => {
  const root = await workspace()
  try {
    const built = await buildSelectionTasks(root, 'writer', { budget: { contextWindowTokens: 1_000_000, reservedOutputTokens: 0 } })
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

test('previous chapter excerpt keeps the full chapter and strips its heading', async () => {
  const root = await workspace()
  try {
    await writeFile(join(root, 'source/chapters/0001_雨夜.md'), `# 第1章 雨夜\n\n${'长'.repeat(3000)}\n`, 'utf8')
    const built = await buildSelectionGroups(root, 'planner')
    const entry = built.fixedEntries.find((item) => item.source === 'runtime/previous_chapter#1')
    assert.ok(entry)
    assert.equal(entry.excerpt.length, 3000)
    assert.doesNotMatch(entry.excerpt, /第1章/)
  } finally {
    await cleanup(root)
  }
})

test('semantic selection always keeps the previous chapter summary', async () => {
  const root = await workspace()
  try {
    const built = await buildSelectionGroups(root, 'planner')
    const assembled = assembleContext({
      chapter: built.chapter,
      query: built.query,
      fixedEntries: built.fixedEntries,
      groups: built.groups,
      selection: { memory: [], role: [], state: [], outline: [], storyFrame: [], volumeMap: [] },
      mode: 'semantic',
    })
    assert.ok(assembled.package.selectedContext.some((entry) => entry.source.includes('chapter_summaries')))
  } finally {
    await cleanup(root)
  }
})

test('context package strict rejects unknown fields and bad entries', () => {
  assert.throws(() => parseContextPackageText('{"chapter":2,"selectedContext":[],"extra":1}', 2, 'context'), /未知/)
  assert.throws(() => parseContextPackageText('{"chapter":2,"selectedContext":[{"source":"a","reason":"","protection":"protected"}]}', 2, 'context'), /reason/)
  assert.throws(() => parseContextPackageText('{"chapter":2,"selectedContext":[{"source":"a","reason":"r","protection":"x"}]}', 2, 'context'), /protection/)
})

test('referenced hooks render English text for an English work', async () => {
  const root = await workspace()
  try {
    await writeFile(join(root, 'work.json'), JSON.stringify({ version: 1, id: 'w', title: 'T', profile: 'longform-novel', language: 'en', status: 'draft', metadata: { chapterWordCount: 300 }, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }))
    const built = await buildSelectionGroups(root, 'writer')
    const entry = built.fixedEntries.find((item) => item.source.startsWith('runtime/referenced_hook'))
    assert.ok(entry)
    assert.doesNotMatch(entry.reason + entry.excerpt, /读者承诺|种于|推进于/)
  } finally {
    await cleanup(root)
  }
})

test('summary candidates are ordered by chapter even when N-1 is required', async () => {
  const root = await workspace()
  try {
    await writeFile(join(root, 'source/story/state/current_state.json'), JSON.stringify({ chapter: 10, facts: [] }))
    await writeFile(join(root, 'source/story/state/chapter_summaries.json'), JSON.stringify({ rows: [
      { chapter: 2, title: '二', characters: '甲', events: '二', stateChanges: '二', hookActivity: '二', mood: '二', chapterType: '推进' },
      { chapter: 10, title: '十', characters: '甲', events: '十', stateChanges: '十', hookActivity: '十', mood: '十', chapterType: '推进' },
    ] }))
    const built = await buildSelectionGroups(root, 'planner')
    const assembled = assembleContext({
      chapter: built.chapter,
      query: built.query,
      fixedEntries: built.fixedEntries,
      groups: built.groups,
      selection: { memory: ['memory:source/story/chapter_summaries.md#2'], role: [], state: [], outline: [], storyFrame: [], volumeMap: [] },
      mode: 'semantic',
    })
    const summaries = assembled.package.selectedContext.map((entry) => entry.source).filter((source) => source.includes('chapter_summaries'))
    assert.deepEqual(summaries, ['source/story/chapter_summaries.md#2', 'source/story/chapter_summaries.md#10'])
    assert.ok(assembled.trace.retrieval.semanticSelectedIds.includes('memory:source/story/chapter_summaries.md#2'))
  } finally {
    await cleanup(root)
  }
})

test('context and planner packages reject bad fields; writer refuses a bad context', async () => {
  assert.throws(() => parseContextPackageText('{"chapter":0,"selectedContext":[]}', 0, 'context'), /chapter/)
  assert.throws(() => parseContextPackageText('{"chapter":2,"selectedContext":[{"source":"a","reason":"r","protection":"protected","kind":"x"}]}', 2, 'context'), /字段/)
  const root = await workspace()
  try {
    await savePlannerContext(root, 2, { chapter: 2, selectedContext: [] })
    await writeFile(join(root, chapterPlannerContextPath(2)), '{"chapter":2,"selectedContext":[],"extra":1}')
    await assert.rejects(loadPlannerContext(root, 2), /未知/)
    await writeFile(join(root, chapterContextPath(2)), '{"chapter":2,"selectedContext":[{"source":"a","reason":"r","protection":"protected","kind":"x"}]}')
    assert.throws(() => renderWriterContract(root), /字段/)
  } finally {
    await cleanup(root)
  }
})
