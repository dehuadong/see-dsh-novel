import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { listChapterVersions, readChapterVersion } from '../src/core/chapter-versions.ts'
import { reopenChapter } from '../src/core/reopen.ts'
import { detectStage } from '../src/pipelines/long/stages/index.ts'
import { writeChapterDocument } from '../src/core/chapter-document.ts'
import { chapterReviewPath, reviewChapter } from '../src/core/chapter-review.ts'
import { chapterPlanPath, saveChapterPlan } from '../src/core/chapter-plan.ts'
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
  for (const [file, body] of [['source/story/outline/story_frame.md', '# 框架'], ['source/story/outline/volume_map.md', '# 卷'], ['source/story/book_rules.md', '# 规则'], ['source/story/book_rules.json', '{}'], ['source/story/pending_hooks.md', '# 伏笔']]) {
    await mkdir(dirname(join(root, file)), { recursive: true })
    await writeFile(join(root, file), `${body}\n`)
  }
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

async function settle(root) {
  await registry(root).get('story_settle_chapter').execute(DELTA, exec)
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

test('reopening keeps the prose, deletes review and plan, reopens the workflow and rolls the pointer back', async () => {
  const root = await workspace()
  try {
    await settle(root)
    const result = await registry(root).get('story_reopen_chapter').execute({ chapter: 1 }, exec)
    assert.equal(result.chapter, 1)
    assert.deepEqual(result.removed, [chapterReviewPath(1), chapterPlanPath(1)])
    assert.deepEqual(result.removed.map((path) => path.includes('chapter-0001')), [true, true])

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

test('restoring a version archives the current prose as restore and replaces the chapter', async () => {
  const root = await workspace()
  try {
    await settle(root)
    const versionId = await versionFile(root, '# 第1章 旧稿\n\n旧文。\n')
    const result = await registry(root).get('story_reopen_chapter').execute({ chapter: 1, versionId }, exec)
    assert.equal(result.versionId, versionId)
    assert.match(result.archived, /_restore_/)

    assert.match(await readFile(join(root, 'source/chapters/0001_雨夜.md'), 'utf8'), /旧文/)
    const archived = await readFile(join(root, result.archived), 'utf8')
    assert.match(archived, /正文/)
    assert.equal((await readdir(join(root, 'source/chapters/.versions/0001'))).length, 2)
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
    await assert.rejects(
      registry(root).get('story_reopen_chapter').execute({ chapter: 1, versionId: same }, exec),
      /相同/,
    )
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

test('reopenChapter reports the plan stage', async () => {
  const root = await workspace()
  try {
    await settle(root)
    const result = await reopenChapter(root, 1)
    assert.equal(result.stage, 'plan')
    assert.equal(result.versionId, null)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
