import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { installCommitRevisionTool } from '../src/pipelines/long/revision-commit-tool.ts'
import { installReviewTool } from '../src/pipelines/long/review-tool.ts'
import { installReviseTool } from '../src/pipelines/long/revise-tool.ts'
import { writeChapterDocument } from '../src/core/chapter-document.ts'
import { saveChapterPlan } from '../src/core/chapter-plan.ts'
import { reviewChapter } from '../src/core/chapter-review.ts'
import { inspectState, snapshotWrites } from '../src/core/state.ts'
import { WORK_FILE } from '../src/core/story-paths.ts'
import { revisionProposalPath, revisionSettlementPath } from '../src/core/revision.ts'

const ORIGINAL = '第一段。\n第二段。\n第三段。'
const exec = { agent: { session: 's' } }

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'see-dsh-novel-revision-'))
  await mkdir(join(root, 'source/story/state'), { recursive: true })
  await mkdir(join(root, 'source/story/runtime'), { recursive: true })
  await mkdir(join(root, 'source/chapters'), { recursive: true })
  await writeFile(join(root, WORK_FILE), JSON.stringify({
    version: 1, id: 'w', title: '标题', profile: 'longform-novel', language: 'zh', status: 'draft',
    metadata: { chapterWordCount: 300 }, createdAt: '2026-11-10T00:00:00.000Z', updatedAt: '2026-11-10T00:00:00.000Z',
  }))
  await writeFile(join(root, 'source/story/state/manifest.json'), JSON.stringify({
    schemaVersion: 2, language: 'zh', lastAppliedChapter: 0, projectionVersion: 1,
  }))
  await writeFile(join(root, 'source/story/state/hooks.json'), JSON.stringify({ hooks: [] }))
  await writeFile(join(root, 'source/story/state/current_state.json'), JSON.stringify({ chapter: 0, facts: [] }))
  await writeFile(join(root, 'source/story/state/chapter_summaries.json'), JSON.stringify({ rows: [] }))
  await writeFile(join(root, 'source/story/chapter_summaries.md'), '# 章节摘要\n')
  await saveChapterPlan(root, { chapter: 1, goal: '目标', body: '计划', threadRefs: [] })
  await writeChapterDocument(root, { chapter: 1, title: '雨夜', content: ORIGINAL, language: 'zh' })
  await writeFile(join(root, 'source/chapters/index.json'), JSON.stringify([{
    number: 1,
    title: '雨夜',
    wordCount: 12,
    createdAt: '2026-11-10T00:00:00.000Z',
    updatedAt: '2026-11-10T00:00:00.000Z',
    observations: [],
    provenance: 'generated',
    lengthTelemetry: { target: 300, countingMode: 'zh_chars', writerCount: 12, postReviseCount: 0, finalCount: 12, repairApplied: false },
    tokenUsage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
  }], null, 2) + '\n')
  await reviewChapter(root, { chapter: 1, summary: '初审', observations: [{ code: 'C1', summary: '旧审稿', assessment: 'unavailable' }] })
  const state = await inspectState(root, [], 'zh')
  for (const write of snapshotWrites(state.snapshot, 0)) {
    await mkdir(join(root, write.relativePath, '..'), { recursive: true })
    await writeFile(join(root, write.relativePath), write.content)
  }
  return root
}

function tools(root) {
  const registered = new Map()
  const ctx = {
    tools: { register: (definition) => { registered.set(definition.name, definition); return () => {} } },
    workingDirectory: { ensure: async () => root },
  }
  installReviseTool(ctx)
  installReviewTool(ctx)
  installCommitRevisionTool(ctx)
  return registered
}

const delta = {
  postSettlement: '甲上山。',
  factOps: { upsert: [{ subject: '甲', predicate: '位置', object: '山门' }], expire: [] },
  hookOps: { upsert: [], mention: [], resolve: [], defer: [] },
  newHookCandidates: [],
  chapterSummary: {
    title: '雨夜', characters: '甲', events: '上山', stateChanges: '到山门', hookActivity: '无', mood: '冷', chapterType: '推进',
  },
}

test('the latest published chapter revises through proposal, revision review and one commit', async () => {
  const root = await workspace()
  try {
    const toolsByName = tools(root)
    const revise = await toolsByName.get('story_revise_chapter').execute({
      chapter: 1,
      content: '第一段改。\n第二段。\n第三段。',
    }, exec)
    assert.equal(revise.settleRequired, true)
    assert.equal(revise.proposalPath, revisionProposalPath(1))
    assert.equal(await readFile(join(root, 'source/chapters/0001_雨夜.md'), 'utf8').then((text) => text.includes('第一段。')), true)
    await assert.rejects(stat(join(root, 'source/story/runtime/chapter-0001.review.json')))


    const revision = JSON.parse(await readFile(join(root, revisionProposalPath(1)), 'utf8'))
    await assert.rejects(toolsByName.get('story_review_chapter').execute({
      chapter: 1,
      revisionDigest: 'wrong',
      summary: '错摘要',
      observations: [],
    }, exec), /摘要不匹配/)
    const reviewed = await toolsByName.get('story_review_chapter').execute({
      chapter: 1,
      revisionDigest: revision.contentDigest,
      summary: '修订审稿',
      observations: [{ code: 'C1', summary: '改了', assessment: 'observation', sourceRefs: [{ sourceId: 'chapter-1', quote: '第一段改。' }] }],
    }, exec)
    assert.equal(reviewed.chapter, 1)


    const c1 = await toolsByName.get('story_commit_revision').execute({
      chapter: 1,
      revisionDigest: revision.contentDigest,
      ...delta,
    }, exec)
    assert.equal(c1.status, 'proposal')
    const c2 = await toolsByName.get('story_commit_revision').execute({
      chapter: 1,
      revisionDigest: revision.contentDigest,
      proposalDigest: c1.proposalDigest,
      validation: { proposalDigest: c1.proposalDigest, outcome: 'consistent', reportMarkdown: '一致' },
    }, exec)
    assert.equal(c2.status, 'published')
    const index = JSON.parse(await readFile(join(root, 'source/chapters/index.json'), 'utf8'))
    assert.equal(index[0].wordCount, 13)
    assert.deepEqual(index[0].tokenUsage, { promptTokens: 1, completionTokens: 2, totalTokens: 3 })
    assert.equal(index[0].observations.length, 2)
    assert.equal(await readFile(join(root, 'source/chapters/0001_雨夜.md'), 'utf8').then((text) => text.includes('第一段改。')), true)
    assert.equal((await inspectState(root, [], 'zh')).snapshot.manifest.lastAppliedChapter, 1)
    const state = JSON.parse(await readFile(join(root, 'source/story/state/current_state.json'), 'utf8'))
    assert.equal(state.chapter, 1)
    await assert.rejects(stat(join(root, revisionProposalPath(1))))
    await assert.rejects(stat(join(root, revisionSettlementPath(1))))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
