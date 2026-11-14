import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
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
import { installReviewTool } from '../src/pipelines/long/review-tool.ts'
import { installReviseTool } from '../src/pipelines/long/revise-tool.ts'
import { WORK_FILE } from '../src/core/story-paths.ts'
import { inspectState, snapshotWrites, stateJsonWrites, stateProjectionWrites } from '../src/core/state.ts'
import { roughChapterLength } from '../src/core/chapter-document.ts'
import { readWorkflowStart } from '../src/core/workflow-start.ts'

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
  // 重开回退要求第 0 章基线快照；真实工作区在 foundation 落盘时就有。
  const read = await inspectState(root, [], 'zh')
  for (const write of [...stateJsonWrites(read.snapshot), ...stateProjectionWrites(read.snapshot), ...snapshotWrites(read.snapshot, 0)]) {
    await mkdir(dirname(join(root, write.relativePath)), { recursive: true })
    await writeFile(join(root, write.relativePath), write.content)
  }
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
  installReviewTool(ctx)
  installReviseTool(ctx)
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
    assert.equal(result.stateRewoundTo, 0)
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
    assert.equal(result.stage, 'review')
    assert.equal(result.replacedStartChapter, undefined)

    assert.match(await readFile(join(root, 'source/chapters/0001_雨夜.md'), 'utf8'), /旧文/)
    const archived = await readFile(join(root, result.archived), 'utf8')
    assert.match(archived, /正文/)
    assert.equal((await readdir(join(root, 'source/chapters/.versions/0001'))).length, 2)
    await assert.rejects(readFile(join(runtime, 'chapter-0001.intent.md')), { code: 'ENOENT' })
    assert.equal(await readFile(join(runtime, 'chapter-0001.user-brief.md'), 'utf8'), 'brief')
    // 章纲保留，供恢复后的复审契约使用。
    assert.ok((await stat(join(runtime, 'chapter-0001.plan.json'))).isFile())
    // 恢复追加 revision，旧 revision 仍可读。
    assert.match((await readArtifactRevision(root, { artifactId: 'chapter-0001', revisionId: 'r2' })).bytes.toString('utf8'), /旧文/)
    assert.match((await readArtifactRevision(root, { artifactId: 'chapter-0001', revisionId: 'r1' })).bytes.toString('utf8'), /正文/)

    // 恢复写索引人工编辑观察，保留其它观察，并按 rough 口径更新字数。
    const index = JSON.parse(await readFile(join(root, 'source/chapters/index.json'), 'utf8'))
    assert.equal(index.length, 1)
    assert.equal(index[0].number, 1)
    assert.equal(index[0].provenance, 'edited')
    assert.equal(index[0].wordCount, roughChapterLength(await readFile(join(root, 'source/chapters/0001_雨夜.md'), 'utf8')))
    assert.deepEqual(index[0].observations.map((observation) => observation.code).sort(), ['C1', 'manual-edit-review'])
    const manual = index[0].observations.find((observation) => observation.code === 'manual-edit-review')
    assert.match(manual.summary, /replaced by an explicit edit action/)
    assert.deepEqual(manual.evidence, [])

    // 恢复写本章复审 start。
    assert.equal((await readWorkflowStart(root))?.chapter, 1)
    assert.match((await readWorkflowStart(root)).instruction, /恢复第 1 章后复审/)

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
    assert.equal(result.stage, 'review')
    assert.equal(detectStage(root).reviewTarget, 1)
    assert.equal((await readWorkflowStart(root))?.chapter, 1)
    assert.match(await readFile(join(root, 'source/chapters/0001_雨夜.md'), 'utf8'), /旧文/)
    assert.equal(JSON.parse(await readFile(manifestPath, 'utf8')).lastAppliedChapter, 2)
    assert.equal(JSON.parse(await readFile(statePath, 'utf8')).chapter, 2)
    const summaries = JSON.parse(await readFile(join(root, 'source/story/state/chapter_summaries.json'), 'utf8'))
    assert.deepEqual(summaries.rows.map((row) => row.chapter), [1, 2])
    assert.equal(await readFile(join(root, 'source/story/state/chapter_summaries.json'), 'utf8'), summariesBefore)
    const review = await registry(root).get('story_review_chapter').execute({
      chapter: 1,
      summary: '早期章复审',
      observations: [{ code: 'C5', summary: '早期章', assessment: 'unavailable' }],
    }, exec)
    assert.equal(review.chapter, 1)
    assert.equal(detectStage(root).stage, 'foundation-ready')
    assert.equal(JSON.parse(await readFile(statePath, 'utf8')).chapter, 2)
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
    assert.equal(result.stateRewoundTo, 0)
    assert.equal(detectStage(root).stage, 'plan')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('reopening refuses when a later chapter is published', async () => {
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
    await registry(root).get('story_reopen_chapter').execute({ chapter: 2 }, exec)
    await assert.rejects(
      registry(root).get('story_reopen_chapter').execute({ chapter: 1 }, exec),
      /只能重开最新已发布的一章：第 2 章已发布/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('reopening refuses when the previous snapshot is missing', async () => {
  const root = await workspace()
  try {
    await settle(root)
    await rm(join(root, 'source/story/snapshots/0'), { recursive: true, force: true })
    await assert.rejects(
      registry(root).get('story_reopen_chapter').execute({ chapter: 1 }, exec),
      /第 0 章快照不可用/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a restored chapter can be reviewed and returns to the next chapter', async () => {
  const root = await workspace()
  try {
    await settle(root)
    const versionId = await versionFile(root, '# 第1章 旧稿\n\n旧文。\n')
    await registry(root).get('story_reopen_chapter').execute({ chapter: 1, versionId }, exec)
    assert.equal(detectStage(root).stage, 'review')
    const review = await registry(root).get('story_review_chapter').execute({
      chapter: 1,
      summary: '恢复后复审',
      observations: [{ code: 'C9', summary: '按要求恢复', assessment: 'unavailable' }],
    }, exec)
    assert.equal(review.chapter, 1)
    assert.equal(await readWorkflowStart(root), null)
    assert.equal(detectStage(root).stage, 'foundation-ready')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a restored published chapter without a plan can still be reviewed', async () => {
  const root = await workspace()
  try {
    await settle(root)
    await rm(join(root, 'source/story/runtime/chapter-0001.plan.json'), { force: true })
    const versionId = await versionFile(root, '# 第1章 旧稿\n\n旧文。\n')
    await registry(root).get('story_reopen_chapter').execute({ chapter: 1, versionId }, exec)
    assert.equal(detectStage(root).stage, 'review')
    const review = await registry(root).get('story_review_chapter').execute({
      chapter: 1,
      summary: '缺章纲复审',
      observations: [{ code: 'C8', summary: '只按正文', assessment: 'unavailable' }],
    }, exec)
    assert.equal(review.chapter, 1)
    assert.equal(await readWorkflowStart(root), null)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('reopening rewinds facts and summaries to the previous snapshot', async () => {
  const root = await workspace()
  try {
    await settle(root, {
      ...DELTA,
      factOps: { upsert: [{ subject: '甲', predicate: '位置', object: '山脚' }], expire: [] },
    })
    const before = JSON.parse(await readFile(join(root, 'source/story/state/current_state.json'), 'utf8'))
    assert.equal(before.facts.length, 1)
    await registry(root).get('story_reopen_chapter').execute({ chapter: 1 }, exec)
    const state = JSON.parse(await readFile(join(root, 'source/story/state/current_state.json'), 'utf8'))
    assert.deepEqual(state.facts, [])
    const summaries = JSON.parse(await readFile(join(root, 'source/story/state/chapter_summaries.json'), 'utf8'))
    assert.deepEqual(summaries.rows, [])
    const projections = await readFile(join(root, 'source/story/current_state.md'), 'utf8')
    assert.match(projections, /当前章节: 0|当前章节：0/)
    for (const file of ['manifest.json', 'current_state.json', 'hooks.json', 'chapter_summaries.json']) {
      assert.equal(
        await readFile(join(root, 'source/story/state', file), 'utf8'),
        await readFile(join(root, 'source/story/snapshots/0/state', file), 'utf8'),
        `${file} 应与第 0 章快照一致`,
      )
    }
    for (const file of ['current_state.md', 'pending_hooks.md', 'chapter_summaries.md']) {
      assert.equal(
        await readFile(join(root, 'source/story', file), 'utf8'),
        await readFile(join(root, 'source/story/snapshots/0', file), 'utf8'),
        `${file} 应与第 0 章快照一致`,
      )
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('reopening requires the chapter snapshot, index row and artifact', async () => {
  const snapshotRoot = await workspace()
  try {
    await settle(snapshotRoot)
    await rm(join(snapshotRoot, 'source/story/snapshots/1'), { recursive: true, force: true })
    await assert.rejects(
      registry(snapshotRoot).get('story_reopen_chapter').execute({ chapter: 1 }, exec),
      /缺状态快照.*可 apply 补齐/,
    )
  } finally {
    await rm(snapshotRoot, { recursive: true, force: true })
  }

  const artifactRoot = await workspace()
  try {
    await settle(artifactRoot)
    await writeFile(join(artifactRoot, 'source/artifacts/manifest.json'), '{broken')
    await assert.rejects(
      registry(artifactRoot).get('story_reopen_chapter').execute({ chapter: 1 }, exec),
      /缺章节 artifact.*需按它的人工步骤处理/,
    )
  } finally {
    await rm(artifactRoot, { recursive: true, force: true })
  }

  const missingArtifactRoot = await workspace()
  try {
    await settle(missingArtifactRoot)
    await rm(join(missingArtifactRoot, 'source/artifacts/manifest.json'), { force: true })
    await assert.rejects(
      registry(missingArtifactRoot).get('story_reopen_chapter').execute({ chapter: 1 }, exec),
      /缺章节 artifact.*可 apply 补齐/,
    )
  } finally {
    await rm(missingArtifactRoot, { recursive: true, force: true })
  }

  const root = await workspace()
  try {
    await settle(root)
    await writeFile(join(root, 'source/chapters/index.json'), '[]\n')
    await assert.rejects(
      registry(root).get('story_reopen_chapter').execute({ chapter: 1 }, exec),
      /缺章节索引条目.*可 apply 补齐/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('revising a published chapter sends the stage back to its review', async () => {
  const root = await workspace()
  try {
    await settle(root)
    const startPath = join(root, 'source/story/runtime/workflow-start.json')
    await writeFile(startPath, JSON.stringify({
      version: 1, action: 'write_next', chapter: 2, instruction: '开始第 2 章', createdAt: '2026-11-10T00:00:00.000Z',
    }, null, 2))
    const result = await registry(root).get('story_revise_chapter').execute({ chapter: 1, content: '改后的正文。' }, exec)
    assert.equal(result.changed, true)
    assert.equal(result.replacedStartChapter, 2)
    assert.equal((await readWorkflowStart(root))?.chapter, 1)
    assert.match((await readWorkflowStart(root)).instruction, /修订后重审第 1 章/)
    assert.equal(detectStage(root).stage, 'review')
    assert.equal(detectStage(root).reviewTarget, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('restoring replaces another chapter start', async () => {
  const root = await workspace()
  try {
    await settle(root)
    const startPath = join(root, 'source/story/runtime/workflow-start.json')
    await writeFile(startPath, JSON.stringify({
      version: 1, action: 'write_next', chapter: 2, instruction: '开始第 2 章', createdAt: '2026-11-10T00:00:00.000Z',
    }, null, 2))
    const versionId = await versionFile(root, '# 第1章 旧稿\n\n旧文。\n')
    const result = await registry(root).get('story_reopen_chapter').execute({ chapter: 1, versionId }, exec)
    assert.equal(result.replacedStartChapter, 2)
    assert.equal((await readWorkflowStart(root))?.chapter, 1)
    assert.match((await readWorkflowStart(root)).instruction, /恢复第 1 章后复审/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('restoring reports a skipped start when the state is unreadable', async () => {
  const root = await workspace()
  try {
    await settle(root)
    const versionId = await versionFile(root, '# 第1章 旧稿\n\n旧文。\n')
    await rm(join(root, 'source/story/state/manifest.json'))
    const result = await registry(root).get('story_reopen_chapter').execute({ chapter: 1, versionId }, exec)
    assert.equal(result.startSkipped, 'state-unreadable')
    assert.equal(await readWorkflowStart(root), null)
    assert.match(await readFile(join(root, 'source/chapters/0001_雨夜.md'), 'utf8'), /旧文/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('restoring a chapter beyond the next one reports a skipped start', async () => {
  const root = await workspace()
  try {
    await settle(root)
    const dir = join(root, 'source/chapters/.versions/0003')
    await mkdir(dir, { recursive: true })
    const versionId = `${Date.now()}_revision_${randomUUID()}`
    await writeFile(join(dir, `${versionId}.md`), '# 第3章 旧稿\n\n旧文。\n')
    await writeFile(join(root, 'source/chapters/0003_第三.md'), '# 第3章 第三\n\n正文。\n')
    const result = await registry(root).get('story_reopen_chapter').execute({ chapter: 3, versionId }, exec)
    assert.equal(result.startSkipped, 'later-chapter')
    assert.equal(await readWorkflowStart(root), null)
    assert.match(await readFile(join(root, 'source/chapters/0003_第三.md'), 'utf8'), /旧文/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
