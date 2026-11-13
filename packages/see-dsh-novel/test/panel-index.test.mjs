import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { readArtifacts } from '../src/core/artifacts.ts'
import { buildPanelIndex, writePanelIndex } from '../src/core/panel-index.ts'
import { PANEL_INDEX_PATH, WORK_FILE } from '../src/core/story-paths.ts'

async function workspace(kind = 'foundation') {
  const root = await mkdtemp(join(tmpdir(), 'see-dsh-novel-panel-'))
  await writeFile(join(root, WORK_FILE), JSON.stringify({
    version: 1, id: 'w', title: '标题', profile: 'longform-novel', language: 'zh', status: 'draft',
    metadata: {}, createdAt: '2026-11-09T00:00:00.000Z', updatedAt: '2026-11-09T00:00:00.000Z',
  }))
  for (const path of [
    'source/story/outline/story_frame.md',
    'source/story/outline/volume_map.md',
    'source/story/book_rules.md',
    'source/story/book_rules.json',
    'source/story/fanfic_canon.md',
    'source/brief.md',
    'source/story/brief.md',
    'source/story/current_state.md',
    'source/story/pending_hooks.md',
  ]) {
    await mkdir(join(root, path, '..'), { recursive: true })
    await writeFile(join(root, path), 'x\n')
  }
  await mkdir(join(root, 'source/story/state'), { recursive: true })
  await writeFile(join(root, 'source/story/state/current_state.json'), JSON.stringify({ chapter: 0 }))
  await writeFile(join(root, 'source/story/state/hooks.json'), JSON.stringify({ hooks: [] }))
  if (kind === 'chapter') {
    await mkdir(join(root, 'source/story/runtime'), { recursive: true })
    await writeFile(join(root, 'source/story/runtime/chapter-0001.plan.json'), JSON.stringify({ version: 2, memo: { chapter: 1, goal: 'g', body: 'b', threadRefs: [] } }))
    await writeFile(join(root, 'source/story/runtime/chapter-0001.context.json'), JSON.stringify({ chapter: 1 }))
    await writeFile(join(root, 'source/story/runtime/chapter-0001.planner-context.json'), JSON.stringify({ chapter: 1 }))
    await writeFile(join(root, 'source/story/runtime/chapter-0001.review.json'), JSON.stringify({ verdict: 'pass' }))
    await mkdir(join(root, 'source/chapters'), { recursive: true })
    await writeFile(join(root, 'source/chapters/0001_开端.md'), '# 第1章 开端\n\n正文。\n')
  }
  return root
}

test('panel index is built from files and does not become an artifact', async () => {
  const root = await workspace('chapter')
  try {
    const index = await buildPanelIndex(root)
    assert.equal(index.version, 5)
    assert.equal(index.action?.id, 'revise-chapter')
    assert.equal(index.work?.title, '标题')
    // 章节正文、章纲与审稿都在：阶段已经走到 chapter-done，基础设定是已完成。
    assert.equal(index.stages.find((stage) => stage.id === 'foundation')?.status, 'done')
    assert.ok(index.artifacts.some((artifact) => artifact.path === 'source/story/outline/story_frame.md'))
    assert.equal(index.artifacts.some((artifact) => artifact.path === PANEL_INDEX_PATH), false)
    await writePanelIndex(root, index)
    const after = await readArtifacts(root)
    assert.equal(after.files.includes(PANEL_INDEX_PATH), false)
    assert.equal((await readFile(join(root, PANEL_INDEX_PATH), 'utf8')).includes('foundation'), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the panel shows the curated set while the approval digest keeps every story file', async () => {
  const root = await workspace('chapter')
  try {
    const index = await buildPanelIndex(root)
    const paths = index.artifacts.map((artifact) => artifact.path)

    // 白名单之外的文件不出现：状态 JSON、流程记账。
    assert.equal(paths.includes('source/story/state/current_state.json'), false)
    assert.equal(paths.includes('source/story/state/hooks.json'), false)

    // 审批摘要仍是 source/story 全量。
    const digest = await readArtifacts(root)
    assert.ok(digest.files.includes('source/story/state/current_state.json'))
    assert.ok(digest.files.includes('source/story/state/hooks.json'))

    // 章节正文、章纲、审稿、运行时诊断各归各类与阶段。
    const frame = index.artifacts.find((artifact) => artifact.path === 'source/story/outline/story_frame.md')
    assert.equal(frame?.title, '故事框架')
    assert.equal(
      index.artifacts.find((artifact) => artifact.path === 'source/story/book_rules.md')?.title,
      '规则正文',
    )
    assert.equal(
      index.artifacts.find((artifact) => artifact.path === 'source/story/fanfic_canon.md')?.title,
      '同人设定',
    )
    // 源白名单没有的四项不出现。
    for (const path of [
      'source/story/book_rules.json',
      'source/brief.md',
      'source/story/brief.md',
      'source/story/runtime/chapter-0001.planner-context.json',
    ]) {
      assert.equal(paths.includes(path), false, path)
    }
    assert.equal(index.work?.latestChapter, 0)
    assert.equal(
      index.artifacts.find((artifact) => artifact.path === 'source/story/pending_hooks.md')?.title,
      '待回收伏笔',
    )

    const chapter = index.artifacts.find((artifact) => artifact.path === 'source/chapters/0001_开端.md')
    assert.equal(chapter?.class, 'chapter')
    assert.deepEqual(chapter?.stages, ['write', 'review'])
    assert.match(chapter?.title ?? '', /第 1 章 · 开端/)

    const plan = index.artifacts.find((artifact) => artifact.path === 'source/story/runtime/chapter-0001.plan.json')
    assert.equal(plan?.class, 'plan')
    assert.deepEqual(plan?.stages, ['plan'])
    assert.match(plan?.title ?? '', /第 1 章 · 章纲/)

    const review = index.artifacts.find((artifact) => artifact.path === 'source/story/runtime/chapter-0001.review.json')
    assert.equal(review?.class, 'review')
    assert.deepEqual(review?.stages, ['review'])

    const context = index.artifacts.find((artifact) => artifact.path === 'source/story/runtime/chapter-0001.context.json')
    assert.equal(context?.class, 'diagnostic')
    assert.deepEqual(context?.stages, ['plan', 'write', 'review'])

    // 诊断排在最后。
    assert.equal(index.artifacts.at(-1)?.class, 'diagnostic')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('latestChapter comes from the chapter index and a broken index falls back to zero', async () => {
  const root = await workspace('chapter')
  try {
    await writeFile(join(root, 'source/chapters/index.json'), JSON.stringify([{
      number: 1,
      title: '开端',
      wordCount: 2,
      createdAt: '2026-11-09T00:00:00.000Z',
      updatedAt: '2026-11-09T00:00:00.000Z',
      observations: [],
      provenance: 'generated',
    }]))
    assert.equal((await buildPanelIndex(root)).work?.latestChapter, 1)

    await writeFile(join(root, 'source/chapters/index.json'), '{ bad')
    const broken = await buildPanelIndex(root)
    assert.equal(broken.work?.latestChapter, 0)
    assert.ok(broken.artifacts.some((artifact) => artifact.path === 'source/chapters/0001_开端.md'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('foundation-ready carries one primary action and the confirm actions beside it', async () => {
  const root = await workspace()
  try {
    const index = await buildPanelIndex(root)
    const foundation = index.stages.find((stage) => stage.id === 'foundation')
    assert.equal(foundation?.action?.id, 'confirm-foundation')
    assert.deepEqual(foundation?.secondary.map((action) => action.id), [
      'start-chapter',
      'reject-foundation',
      'review-foundation',
      'later',
    ])
    assert.equal(index.stages.find((stage) => stage.id === 'proposal')?.secondary.length, 0)
    assert.equal(index.action, null)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('no work yields the proposal stage with no action', async () => {
  const root = await mkdtemp(join(tmpdir(), 'see-dsh-novel-panel-empty-'))
  try {
    const index = await buildPanelIndex(root)
    assert.equal(index.work, null)
    assert.equal(index.stages[0].status, 'current')
    assert.equal(index.stages[0].action, null)
    assert.deepEqual(index.stages[0].secondary, [])
    assert.equal(index.action, null)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
