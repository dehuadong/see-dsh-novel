import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { deleteLatestChapter } from '../src/core/delete-chapter.ts'
import { readChapterIndexStrict } from '../src/core/chapter-index.ts'
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
  await mkdir(join(root, 'source/chapters'), { recursive: true })
  await writeFile(join(root, 'source/chapters/index.json'), '[]')
  await writeChapterDocument(root, { chapter: 1, title: '雨夜', content: '正文。', language: 'zh' })
  await reviewChapter(root, {
    chapter: 1,
    summary: '初审',
    observations: [{ code: 'C1', summary: '观察', assessment: 'unavailable', category: 'quality' }],
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

test('a minimal snapshot with two projections and one state file is enough', async () => {
  const root = await workspace()
  try {
    for (const file of ['chapter_summaries.md', 'state/current_state.json', 'state/hooks.json', 'state/chapter_summaries.json']) {
      await rm(join(root, 'source/story/snapshots/0', file), { force: true })
    }
    const result = await deleteTool(root).execute({ chapter: 1 }, { agent: { session: 's' } })
    assert.equal(result.deletedChapter, 1)
    assert.equal(result.rolledBackTo, 0)
    // 快照缺 summaries 投影：回滚后删除投影。
    await assert.rejects(stat(join(root, 'source/story/chapter_summaries.md')), { code: 'ENOENT' })
    // 活状态里多出的文件被删除。
    await assert.rejects(stat(join(root, 'source/story/state/hooks.json')), { code: 'ENOENT' })
    const stateFiles = (await readdir(join(root, 'source/story/state'))).sort()
    assert.deepEqual(stateFiles, ['manifest.json'])
    const manifest = JSON.parse(await readFile(join(root, 'source/story/state/manifest.json'), 'utf8'))
    assert.equal(manifest.lastAppliedChapter, 0)
    assert.deepEqual(JSON.parse(await readFile(join(root, 'source/chapters/index.json'), 'utf8')), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('an empty snapshot state directory rejects before moving files', async () => {
  const root = await workspace()
  try {
    await rm(join(root, 'source/story/snapshots/0/state'), { recursive: true, force: true })
    await mkdir(join(root, 'source/story/snapshots/0/state'), { recursive: true })
    await assert.rejects(deleteLatestChapter(root, 1), /没有 state 文件/)
    assert.match(await readFile(join(root, 'source/chapters/0001_雨夜.md'), 'utf8'), /正文/)
    await assert.rejects(stat(join(root, 'source/chapters/.trash')), { code: 'ENOENT' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a missing or invalid chapter index rejects before moving files', async () => {
  const root = await workspace()
  try {
    const indexPath = join(root, 'source/chapters/index.json')
    await rm(indexPath, { force: true })
    await assert.rejects(deleteLatestChapter(root, 1), /index\.json 缺失.*未改动任何文件/)
    await assert.rejects(stat(join(root, 'source/chapters/.trash')), { code: 'ENOENT' })

    await writeFile(indexPath, '[{"number":1}]')
    await assert.rejects(deleteLatestChapter(root, 1), /第 1 条记录/)
    await assert.match(await readFile(join(root, 'source/chapters/0001_雨夜.md'), 'utf8'), /正文/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('an unknown key in the index is rejected strictly', async () => {
  const root = await workspace()
  try {
    const indexPath = join(root, 'source/chapters/index.json')
    const index = JSON.parse(await readFile(indexPath, 'utf8'))
    index[0].extra = true
    await writeFile(indexPath, JSON.stringify(index))
    await assert.rejects(deleteLatestChapter(root, 1), /未知字段 extra/)

    const invalidDate = JSON.parse(await readFile(indexPath, 'utf8'))
    delete invalidDate[0].extra
    invalidDate[0].createdAt = '2026-02-31T00:00:00.000Z'
    await writeFile(indexPath, JSON.stringify(invalidDate))
    await assert.rejects(deleteLatestChapter(root, 1), /createdAt 必须是 ISO 时间/)

    invalidDate[0].createdAt = '2028-02-29T00:00:00.000Z'
    await writeFile(indexPath, JSON.stringify(invalidDate))
    assert.equal((await readChapterIndexStrict(root))[0].createdAt, '2028-02-29T00:00:00.000Z')

    const nested = JSON.parse(await readFile(indexPath, 'utf8'))
    nested[0].createdAt = '2026-11-10T00:00:00.000Z'
    nested[0].observations[0].target = { workId: 'w', artifactId: 'a', revisionId: 'r', extra: true }
    await writeFile(indexPath, JSON.stringify(nested))
    await assert.rejects(deleteLatestChapter(root, 1), /target 含未知字段 extra/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('an empty chapter directory reports no chapters', async () => {
  const root = await mkdtemp(join(tmpdir(), 'see-dsh-novel-delete-empty-'))
  try {
    await assert.rejects(deleteLatestChapter(root, 1), /没有可删除的章节/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('deleting does not require work.json', async () => {
  const root = await workspace()
  try {
    await rm(join(root, WORK_FILE), { force: true })
    const result = await deleteTool(root).execute({ chapter: 1 }, { agent: { session: 's' } })
    assert.equal(result.deletedChapter, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a missing single required projection rejects before moving files', async () => {
  const root = await workspace()
  try {
    await rm(join(root, 'source/story/snapshots/0/pending_hooks.md'), { force: true })
    await assert.rejects(deleteLatestChapter(root, 1), /pending_hooks\.md/)
    await assert.rejects(stat(join(root, 'source/chapters/.trash')), { code: 'ENOENT' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a non-array index and empty sourceRefs are rejected strictly', async () => {
  const root = await workspace()
  try {
    const indexPath = join(root, 'source/chapters/index.json')
    await writeFile(indexPath, '{}')
    await assert.rejects(deleteLatestChapter(root, 1), /必须是数组/)

    // 重新构造合法索引，再插入空 sourceRefs。
    const entry = {
      number: 1,
      title: '雨夜',
      wordCount: 2,
      createdAt: '2026-11-10T00:00:00.000Z',
      updatedAt: '2026-11-10T00:00:00.000Z',
      observations: [{
        code: 'C1', summary: '观察', assessment: 'observation', evidence: [], sourceRefs: [{ sourceId: '', quote: '' }],
      }],
      provenance: 'generated',
    }
    await writeFile(indexPath, JSON.stringify([entry]))
    await assert.rejects(deleteLatestChapter(root, 1), /sourceId 不能为空/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a middle chapter in a multi-entry index is rejected', async () => {
  const root = await workspace()
  try {
    const indexPath = join(root, 'source/chapters/index.json')
    const [first] = JSON.parse(await readFile(indexPath, 'utf8'))
    const second = { ...first, number: 2, title: '第二' }
    const third = { ...first, number: 3, title: '第三' }
    await writeFile(indexPath, JSON.stringify([first, second, third]))
    await writeFile(join(root, 'source/chapters/0002_二.md'), '# 第2章 二\n\n二。\n')
    await writeFile(join(root, 'source/chapters/0003_三.md'), '# 第3章 三\n\n三。\n')
    await assert.rejects(deleteLatestChapter(root, 2), /只能删除最新章/)
    await assert.match(await readFile(join(root, 'source/chapters/0002_二.md'), 'utf8'), /二。/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a corrupt work.json does not block deletion', async () => {
  const root = await workspace()
  try {
    await writeFile(join(root, WORK_FILE), '{broken')
    const result = await deleteTool(root).execute({ chapter: 1 }, { agent: { session: 's' } })
    assert.equal(result.deletedChapter, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the latest chapter comes from the index and kept entries are written back verbatim', async () => {
  const root = await workspace()
  try {
    const indexPath = join(root, 'source/chapters/index.json')
    const [first] = JSON.parse(await readFile(indexPath, 'utf8'))
    const second = { ...first, number: 2, title: '第二' }
    const third = {
      ...first,
      number: 3,
      title: '第三',
      wordCount: 12,
      observations: [{
        code: 'C1', summary: '观察', assessment: 'observation', category: 'quality', evidence: [], sourceRefs: [],
      }],
    }
    await writeFile(indexPath, JSON.stringify([second, third, first]))
    await cp(join(root, 'source/story/snapshots/0'), join(root, 'source/story/snapshots/2'), { recursive: true })
    await mkdir(join(root, 'source/story/runtime'), { recursive: true })
    await writeFile(join(root, 'source/story/runtime/chapter-0003.plan.json'), '{}')
    await writeFile(join(root, 'source/chapters/0002_二.md'), '# 第2章 二\n\n二。\n')
    await writeFile(join(root, 'source/chapters/0003_三.md'), '# 第3章 三\n\n三。\n')
    await writeFile(join(root, 'source/chapters/0004_四.md'), '# 第4章 四\n\n四。\n')
    await mkdir(join(root, 'source/story/drafts'), { recursive: true })
    await writeFile(join(root, 'source/story/drafts/0004_草稿.md'), '草稿')
    await writeFile(join(root, 'source/story/drafts/4_旧稿.md'), '旧稿')

    const result = await deleteTool(root).execute({ chapter: 3 }, { agent: { session: 's' } })
    assert.equal(result.deletedChapter, 3)
    assert.equal(result.title, '第三')
    assert.equal(result.rolledBackTo, 2)
    assert.deepEqual(result.discarded, [3])
    const kept = JSON.parse(await readFile(indexPath, 'utf8'))
    assert.deepEqual(kept, [second, first])
    await assert.rejects(stat(join(root, 'source/chapters/0004_四.md')), { code: 'ENOENT' })
    await assert.rejects(stat(join(root, 'source/story/drafts/0004_草稿.md')), { code: 'ENOENT' })
    await assert.rejects(stat(join(root, 'source/story/drafts/4_旧稿.md')), { code: 'ENOENT' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
