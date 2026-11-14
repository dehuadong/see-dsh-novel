import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { listChapterVersions, readChapterVersion } from '../src/core/chapter-versions.ts'
import { readArtifactRevision } from '../src/core/artifact-store.ts'
import { reopenChapter } from '../src/core/reopen.ts'
import { detectStage } from '../src/pipelines/long/stages/index.ts'
import { writeChapterDraft } from '../src/core/chapter-draft.ts'
import { reviewChapter } from '../src/core/chapter-review.ts'
import { saveChapterPlan } from '../src/core/chapter-plan.ts'
import { installSettleTool } from '../src/pipelines/long/settle-tool.ts'
import { installReopenTools } from '../src/pipelines/long/reopen-tool.ts'
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

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'see-dsh-novel-reopen-'))
  await mkdir(join(root, 'source/story/state'), { recursive: true })
  await mkdir(join(root, 'source/story/runtime'), { recursive: true })
  await mkdir(join(root, 'source/chapters'), { recursive: true })
  await writeFile(join(root, WORK_FILE), JSON.stringify({
    version: 1, id: 'w', title: '标题', profile: 'longform-novel', language: 'zh', status: 'active',
    metadata: { chapterWordCount: 300 }, createdAt: '2026-11-10T00:00:00.000Z', updatedAt: '2026-11-10T00:00:00.000Z',
  }))
  await writeFile(join(root, 'source/story/state/manifest.json'), JSON.stringify({
    schemaVersion: 2, language: 'zh', lastAppliedChapter: 0, projectionVersion: 1,
  }))
  await writeFile(join(root, 'source/story/state/hooks.json'), JSON.stringify({
    hooks: [{ hookId: 'hook-1', startChapter: 1, type: 'promise', status: 'deferred', lastAdvancedChapter: 1, expectedPayoff: '回收', notes: '' }],
  }))
  await writeFile(join(root, 'source/story/state/current_state.json'), JSON.stringify({ chapter: 0, facts: [] }))
  await writeFile(join(root, 'source/story/state/chapter_summaries.json'), JSON.stringify({ rows: [] }))
  for (const [file, body] of [['source/story/outline/story_frame.md', '# 框架'], ['source/story/outline/volume_map.md', '# 卷'], ['source/story/book_rules.md', '# 规则'], ['source/story/book_rules.json', '{}'], ['source/story/pending_hooks.md', '# 伏笔']]) {
    await mkdir(dirname(join(root, file)), { recursive: true })
    await writeFile(join(root, file), `${body}\n`)
  }
  await saveChapterPlan(root, { chapter: 1, goal: '目标', body: '计划', threadRefs: [] })
  await writeChapterDraft(root, { chapter: 1, title: '雨夜', content: '正文。', language: 'zh' })
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
  installReopenTools(ctx)
  return tools
}

const exec = { agent: { session: 's' } }

const DELTA = {
  chapter: 1,
  postSettlement: '甲上山。',
  factOps: { upsert: [], expire: [] },
  hookOps: { upsert: [], mention: [], resolve: [], defer: [] },
  newHookCandidates: [],
  chapterSummary: SUMMARY,
}

async function settle(root, args = DELTA) {
  const tool = registry(root).get('story_settle_chapter')
  const proposal = await tool.execute(args, exec)
  await tool.execute({
    chapter: args.chapter,
    validation: { proposalDigest: proposal.proposalDigest, outcome: 'consistent', reportMarkdown: '' },
  }, exec)
}

async function versionFile(root, content) {
  const dir = join(root, 'source/chapters/.versions/0001')
  await mkdir(dir, { recursive: true })
  const id = `${Date.now()}_revision_${randomUUID()}`
  await writeFile(join(dir, `${id}.md`), content)
  return id
}

test('lists and reads archived versions, newest first, ignoring malformed ids', async () => {
  const root = await workspace()
  try {
    const older = await versionFile(root, '# 第1章 旧稿\n\n旧文。\n')
    await new Promise((resolve) => setTimeout(resolve, 5))
    const newer = await versionFile(root, '# 第1章 新稿\n\n新文。\n')
    await writeFile(join(root, 'source/chapters/.versions/0001/not-a-version.md'), 'x')

    const versions = await listChapterVersions(root, 1)
    assert.deepEqual(versions.map((version) => version.id), [newer, older])
    assert.equal(versions[0].source, 'revision')
    assert.match(await readChapterVersion(root, 1, older), /旧文/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('reopening keeps the prose, clears runtime files, reopens the workflow and rolls the pointer back', async () => {
  const root = await workspace()
  try {
    await settle(root)
    const runtime = join(root, 'source/story/runtime')
    for (const file of ['chapter-0001.intent.md', 'chapter-0001.context.json', 'chapter-0001.trace.json', 'chapter-0001.planner-context.json', 'chapter-0001.user-brief.md']) {
      await writeFile(join(runtime, file), 'x')
    }
    const result = await registry(root).get('story_reopen_chapter').execute({ chapter: 1 }, exec)
    assert.equal(result.chapter, 1)
    assert.equal(result.stage, 'plan')
    assert.deepEqual(result.removed, [
      'source/story/runtime/chapter-0001.context.json',
      'source/story/runtime/chapter-0001.intent.md',
      'source/story/runtime/chapter-0001.plan.json',
      'source/story/runtime/chapter-0001.planner-context.json',
      'source/story/runtime/chapter-0001.review.json',
      'source/story/runtime/chapter-0001.trace.json',
    ])
    for (const path of result.removed) await assert.rejects(readFile(join(root, path)), { code: 'ENOENT' })
    assert.equal(await readFile(join(runtime, 'chapter-0001.user-brief.md'), 'utf8'), 'x')
    assert.deepEqual(
      JSON.parse(await readFile(join(root, 'source/story/state/hooks.json'), 'utf8')).hooks,
      [{ hookId: 'hook-1', startChapter: 1, type: 'promise', status: 'deferred', lastAdvancedChapter: 1, expectedPayoff: '回收', notes: '' }],
    )

    const manifest = JSON.parse(await readFile(join(root, 'source/story/state/manifest.json'), 'utf8'))
    assert.equal(manifest.lastAppliedChapter, 0)
    const state = JSON.parse(await readFile(join(root, 'source/story/state/current_state.json'), 'utf8'))
    assert.equal(state.chapter, 0)
    const summaries = JSON.parse(await readFile(join(root, 'source/story/state/chapter_summaries.json'), 'utf8'))
    assert.deepEqual(summaries.rows, [])
    const start = JSON.parse(await readFile(join(root, 'source/story/runtime/workflow-start.json'), 'utf8'))
    assert.equal(start.chapter, 1)
    assert.match(start.instruction, /重开第 1 章/)
    assert.equal(detectStage(root).stage, 'plan')
    assert.match(await readFile(join(root, 'source/chapters/0001_雨夜.md'), 'utf8'), /正文/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('restoring a version archives the current prose, replaces the chapter and keeps runtime state', async () => {
  const root = await workspace()
  try {
    await settle(root)
    const versionId = await versionFile(root, '# 第1章 旧稿\n\n旧文。\n')
    const runtime = join(root, 'source/story/runtime')
    await writeFile(join(runtime, 'chapter-0001.intent.md'), 'x')
    await writeFile(join(runtime, 'chapter-0001.user-brief.md'), 'brief')
    const result = await registry(root).get('story_reopen_chapter').execute({ chapter: 1, versionId }, exec)
    assert.equal(result.versionId, versionId)
    assert.match(result.archived, /_restore_/)
    assert.equal(result.stage, 'foundation-ready')

    assert.match(await readFile(join(root, 'source/chapters/0001_雨夜.md'), 'utf8'), /旧文/)
    const archived = await readFile(join(root, result.archived), 'utf8')
    assert.match(archived, /正文/)
    assert.equal((await readdir(join(root, 'source/chapters/.versions/0001'))).length, 2)
    await assert.rejects(readFile(join(runtime, 'chapter-0001.intent.md')), { code: 'ENOENT' })
    assert.equal(await readFile(join(runtime, 'chapter-0001.user-brief.md'), 'utf8'), 'brief')
    // 恢复追加 revision，旧 revision 仍可读。
    assert.match((await readArtifactRevision(root, { artifactId: 'chapter-0001', revisionId: 'r2' })).bytes.toString('utf8'), /旧文/)
    assert.match((await readArtifactRevision(root, { artifactId: 'chapter-0001', revisionId: 'r1' })).bytes.toString('utf8'), /正文/)

    // 恢复不动运行时状态与摘要行。
    const manifest = JSON.parse(await readFile(join(root, 'source/story/state/manifest.json'), 'utf8'))
    assert.equal(manifest.lastAppliedChapter, 1)
    const summaries = JSON.parse(await readFile(join(root, 'source/story/state/chapter_summaries.json'), 'utf8'))
    assert.deepEqual(summaries.rows.map((row) => row.chapter), [1])
    const hooks = JSON.parse(await readFile(join(root, 'source/story/state/hooks.json'), 'utf8'))
    assert.deepEqual(hooks.hooks.map((hook) => hook.hookId), ['hook-1'])
    const facts = JSON.parse(await readFile(join(root, 'source/story/state/current_state.json'), 'utf8'))
    assert.deepEqual(facts.facts, [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('restoring an earlier chapter works without rolling the state back', async () => {
  const root = await workspace()
  try {
    await settle(root)
    await writeChapterDraft(root, { chapter: 2, title: '第二', content: '第二章正文。', language: 'zh' })
    await saveChapterPlan(root, { chapter: 2, goal: '目标', body: '计划', threadRefs: [] })
    await reviewChapter(root, {
      chapter: 2,
      summary: '二审',
      observations: [{ code: 'C2', summary: '观察二', assessment: 'unavailable' }],
    })
    await settle(root, { ...DELTA, chapter: 2 })

    const manifestPath = join(root, 'source/story/state/manifest.json')
    const statePath = join(root, 'source/story/state/current_state.json')
    const versionId = await versionFile(root, '# 第1章 旧稿\n\n旧文。\n')
    const summariesBefore = await readFile(join(root, 'source/story/state/chapter_summaries.json'), 'utf8')
    const result = await registry(root).get('story_reopen_chapter').execute({ chapter: 1, versionId }, exec)
    assert.equal(result.versionId, versionId)
    assert.match(await readFile(join(root, 'source/chapters/0001_雨夜.md'), 'utf8'), /旧文/)
    assert.equal(JSON.parse(await readFile(manifestPath, 'utf8')).lastAppliedChapter, 2)
    assert.equal(JSON.parse(await readFile(statePath, 'utf8')).chapter, 2)
    const summaries = JSON.parse(await readFile(join(root, 'source/story/state/chapter_summaries.json'), 'utf8'))
    assert.deepEqual(summaries.rows.map((row) => row.chapter), [1, 2])
    assert.equal(await readFile(join(root, 'source/story/state/chapter_summaries.json'), 'utf8'), summariesBefore)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('restoring the same content and reopening an earlier chapter are rejected', async () => {
  const root = await workspace()
  try {
    await settle(root)
    const current = await readFile(join(root, 'source/chapters/0001_雨夜.md'), 'utf8')
    const same = await versionFile(root, current)
    const runtimeBefore = (await readdir(join(root, 'source/story/runtime'))).sort()
    const versionsBefore = (await readdir(join(root, 'source/chapters/.versions/0001'))).sort()
    const manifestBefore = await readFile(join(root, 'source/story/state/manifest.json'), 'utf8')
    await assert.rejects(
      registry(root).get('story_reopen_chapter').execute({ chapter: 1, versionId: same }, exec),
      /相同/,
    )
    assert.equal(await readFile(join(root, 'source/chapters/0001_雨夜.md'), 'utf8'), current)
    assert.deepEqual((await readdir(join(root, 'source/story/runtime'))).sort(), runtimeBefore)
    assert.deepEqual((await readdir(join(root, 'source/chapters/.versions/0001'))).sort(), versionsBefore)
    assert.equal(await readFile(join(root, 'source/story/state/manifest.json'), 'utf8'), manifestBefore)
    await assert.rejects(
      registry(root).get('story_reopen_chapter').execute({ chapter: 1, versionId: 'bad-id' }, exec),
      /版本 id 不合法/,
    )
    const manifestPath = join(root, 'source/story/state/manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    await writeFile(manifestPath, JSON.stringify({ ...manifest, lastAppliedChapter: 2 }))
    await assert.rejects(
      registry(root).get('story_reopen_chapter').execute({ chapter: 1 }, exec),
      /只能重开最后已结算的一章/,
    )
    assert.match(await readFile(join(root, 'source/chapters/0001_雨夜.md'), 'utf8'), /正文/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('reopening keeps an existing workflow start instruction', async () => {
  const root = await workspace()
  try {
    await settle(root)
    const startPath = join(root, 'source/story/runtime/workflow-start.json')
    const existing = JSON.stringify({
      version: 1, action: 'write_next', chapter: 1, instruction: '开始第 1 章', createdAt: '2026-11-10T00:00:00.000Z',
    }, null, 2)
    await writeFile(startPath, existing)
    await registry(root).get('story_reopen_chapter').execute({ chapter: 1 }, exec)
    assert.equal(await readFile(startPath, 'utf8'), existing)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('reopenChapter reports the plan stage', async () => {
  const root = await workspace()
  try {
    await settle(root)
    const result = await reopenChapter(root, 1)
    assert.equal(result.versionId, null)
    assert.equal(detectStage(root).stage, 'plan')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
