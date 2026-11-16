import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { readArtifacts } from '../src/core/artifacts.ts'
import { rejectFoundationApproval, writeFoundationApproval } from '../src/core/foundation-approval.ts'
import { buildPanelIndex, rebuildPanelIndexWithRetry, writePanelIndex } from '../src/core/panel-index.ts'
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
    'source/story/author_intent.md',
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

/** 第 1 章已结算发布的作品：current_state=1、work 激活、章节索引有第 1 章。 */
async function settledWorkspace() {
  const root = await workspace('chapter')
  await writeFile(join(root, 'source/story/state/current_state.json'), JSON.stringify({ chapter: 1 }))
  const work = JSON.parse(await readFile(join(root, WORK_FILE), 'utf8'))
  work.status = 'active'
  await writeFile(join(root, WORK_FILE), JSON.stringify(work))
  await writeFile(join(root, 'source/chapters/index.json'), JSON.stringify([{
    number: 1, title: '开端', wordCount: 2,
    createdAt: '2026-11-09T00:00:00.000Z', updatedAt: '2026-11-09T00:00:00.000Z',
    observations: [], provenance: 'generated',
  }]))
  return root
}

test('panel index is built from files and does not become an artifact', async () => {
  const root = await workspace('chapter')
  try {
    const index = await buildPanelIndex(root)
    assert.equal(index.version, 8)
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

test('a first-version reviewed chapter offers settle instead of revise', async () => {
  const root = await workspace('chapter')
  try {
    await rm(join(root, 'source/chapters/0001_开端.md'), { force: true })
    const index = await buildPanelIndex(root)
    assert.equal(index.action?.id, 'settle-chapter')
    assert.equal(index.action?.label, '结算本章')
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
    // 长期方向与立项原文（story/brief.md）在建书时同源，显示名必须区分，否则作者分不清该改哪份。
    const intent = index.artifacts.find((artifact) => artifact.path === 'source/story/author_intent.md')
    assert.equal(intent?.title, '作者意图（长期方向）')
    assert.equal(intent?.readonly, true)
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
    assert.deepEqual(chapter?.stages, ['write', 'review', 'settle'])
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

test('foundation in progress keeps the start action and leaves later stages locked', async () => {
  const root = await mkdtemp(join(tmpdir(), 'see-dsh-novel-panel-foundation-'))
  try {
    await writeFile(join(root, WORK_FILE), JSON.stringify({
      version: 1, id: 'w', title: '标题', profile: 'longform-novel', language: 'zh', status: 'draft',
      metadata: {}, createdAt: '2026-11-09T00:00:00.000Z', updatedAt: '2026-11-09T00:00:00.000Z',
    }))
    const index = await buildPanelIndex(root)
    const foundation = index.stages.find((stage) => stage.id === 'foundation')
    assert.equal(foundation?.status, 'current')
    assert.equal(foundation?.action?.id, 'start-foundation')
    assert.equal(index.stages.find((stage) => stage.id === 'plan')?.status, 'locked')
    assert.equal(index.stages.find((stage) => stage.id === 'write')?.status, 'locked')
    assert.equal(index.stages.find((stage) => stage.id === 'review')?.status, 'locked')
    assert.equal(index.stages.find((stage) => stage.id === 'settle')?.status, 'locked')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a settled chapter projects every stage done and offers only the next chapter', async () => {
  const root = await settledWorkspace()
  try {
    await writeFoundationApproval(root)
    const index = await buildPanelIndex(root)
    for (const id of ['proposal', 'foundation', 'plan', 'write', 'review', 'settle']) {
      assert.equal(index.stages.find((stage) => stage.id === id)?.status, 'done', id)
    }
    assert.equal(index.action?.id, 'start-chapter')
    assert.equal(index.action?.label, '开始下一章')
    assert.equal(index.work?.latestChapter, 1)
    assert.deepEqual(index.confirmation, { kind: 'none', state: 'done', reason: '' })
    assert.equal(index.stages.find((stage) => stage.id === 'foundation')?.action, null)
    assert.deepEqual(index.stages.find((stage) => stage.id === 'foundation')?.secondary, [])
    const chapter = index.artifacts.find((artifact) => artifact.path === 'source/chapters/0001_开端.md')
    assert.deepEqual(chapter?.stages, ['write', 'review', 'settle'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('an approved foundation-ready work offers only the next chapter', async () => {
  const root = await workspace()
  try {
    await writeFoundationApproval(root)
    const index = await buildPanelIndex(root)
    const foundation = index.stages.find((stage) => stage.id === 'foundation')
    assert.equal(foundation?.status, 'done')
    assert.equal(foundation?.action, null)
    assert.deepEqual(foundation?.secondary, [])
    assert.equal(index.stages.find((stage) => stage.id === 'plan')?.status, 'locked')
    assert.equal(index.action?.id, 'start-chapter')
    assert.deepEqual(index.confirmation, { kind: 'none', state: 'done', reason: '' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a settled chapter keeps every stage done and only hints at foundation re-confirmation', async () => {
  const cases = [
    {
      state: 'stale',
      reason: '基础设定在确认后修改过；开始下一章前请 `/story-approve` 重新确认',
      async prepare(root) {
        await writeFoundationApproval(root)
        await writeFile(join(root, 'source/story/outline/volume_map.md'), 'changed\n')
      },
    },
    {
      state: 'rejected',
      reason: '作者退回了这一版基础设定；开始下一章前请 `/story-approve` 重新确认',
      async prepare(root) { await rejectFoundationApproval(root) },
    },
    {
      state: 'none',
      reason: '基础设定尚未确认；开始下一章前请 `/story-approve`',
      async prepare() {},
    },
  ]
  for (const { state, reason, prepare } of cases) {
    const root = await settledWorkspace()
    try {
      await prepare(root)
      const index = await buildPanelIndex(root)
      for (const id of ['proposal', 'foundation', 'plan', 'write', 'review', 'settle']) {
        assert.equal(index.stages.find((stage) => stage.id === id)?.status, 'done', `${state}:${id}`)
      }
      // 结算事实不因确认失效回退：根动作仍是开始下一章，且不置灰。
      assert.equal(index.action?.id, 'start-chapter', state)
      assert.equal(index.action?.enabled, true, state)
      // 阶段动作条不再出现「确认基础设定/退回/查看待确认/稍后」。
      const foundation = index.stages.find((stage) => stage.id === 'foundation')
      assert.equal(foundation?.action, null, state)
      assert.deepEqual(foundation?.secondary, [], state)
      assert.deepEqual(index.confirmation, { kind: 'foundation-signoff', state: 'pending', reason }, state)
      // 章节产物照常显示。
      assert.ok(index.artifacts.some((artifact) => artifact.path === 'source/chapters/0001_开端.md'), state)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }
})

test('an approved foundation clears the settled-chapter hint', async () => {
  const root = await settledWorkspace()
  try {
    await writeFoundationApproval(root)
    const index = await buildPanelIndex(root)
    assert.deepEqual(index.confirmation, { kind: 'none', state: 'done', reason: '' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a settled draft shows as a draft artifact until the chapter is published', async () => {
  const root = await workspace('chapter')
  try {
    await rm(join(root, 'source/chapters'), { recursive: true, force: true })
    await rm(join(root, 'source/story/runtime/chapter-0001.review.json'), { force: true })
    await writeFile(join(root, 'source/story/runtime/workflow-start.json'), JSON.stringify({
      version: 1, action: 'write_next', chapter: 1, instruction: '开始第 1 章', createdAt: '2026-11-10T00:00:00.000Z',
    }))
    await mkdir(join(root, '.drafts'), { recursive: true })
    await writeFile(join(root, '.drafts/chapter-0001.md'), '# 第1章 开端\n\n第一版正文。\n')

    const index = await buildPanelIndex(root)
    const draft = index.artifacts.find((artifact) => artifact.path === '.drafts/chapter-0001.md')
    assert.equal(draft?.class, 'draft')
    assert.deepEqual(draft?.stages, ['write', 'review'])
    assert.equal(draft?.title, '第 1 章 · 草稿')
    assert.equal(draft?.readonly, true)
    assert.equal(draft?.bytes, Buffer.byteLength('# 第1章 开端\n\n第一版正文。\n'))
    // 还没有已发布章：同一章只有草稿一份正文。
    assert.equal(index.artifacts.some((artifact) => artifact.class === 'chapter'), false)
    const draftAt = index.artifacts.findIndex((artifact) => artifact.class === 'draft')
    const planAt = index.artifacts.findIndex((artifact) => artifact.class === 'plan')
    assert.ok(draftAt < planAt, '草稿排在章纲之前')

    // 发布后同一章不再出现草稿，改由章节产物显示。
    await mkdir(join(root, 'source/chapters'), { recursive: true })
    await writeFile(join(root, 'source/chapters/0001_开端.md'), '# 第1章 开端\n\n正文。\n')
    const published = await buildPanelIndex(root)
    assert.equal(published.artifacts.some((artifact) => artifact.class === 'draft'), false)
    assert.ok(published.artifacts.some((artifact) => artifact.class === 'chapter'))
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
    assert.deepEqual(index.confirmation, { kind: 'foundation-signoff', state: 'pending', reason: '基础设定已齐，等待作者确认' })
    assert.equal(foundation?.secondary.find((action) => action.id === 'start-chapter')?.enabled, true)
    assert.equal(index.action, null)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a first foundation-ready with a stale or rejected record keeps the confirm actions', async () => {
  const cases = [
    {
      state: 'stale',
      reason: '基础设定在确认后修改过；开始下一章前请 `/story-approve` 重新确认',
      async prepare(root) {
        await writeFoundationApproval(root)
        await writeFile(join(root, 'source/story/outline/volume_map.md'), 'changed\n')
      },
    },
    {
      state: 'rejected',
      reason: '作者退回了这一版基础设定；开始下一章前请 `/story-approve` 重新确认',
      async prepare(root) { await rejectFoundationApproval(root) },
    },
  ]
  for (const { state, reason, prepare } of cases) {
    const root = await workspace()
    try {
      await prepare(root)
      const index = await buildPanelIndex(root)
      const foundation = index.stages.find((stage) => stage.id === 'foundation')
      assert.equal(foundation?.status, 'current', state)
      assert.equal(foundation?.action?.id, 'confirm-foundation', state)
      assert.deepEqual(
        foundation?.secondary.map((action) => action.id),
        ['start-chapter', 'reject-foundation', 'review-foundation', 'later'],
        state,
      )
      assert.equal(index.action, null, state)
      assert.deepEqual(index.confirmation, { kind: 'foundation-signoff', state: 'pending', reason }, state)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }
})

test('a panel index write that cannot succeed surfaces the error instead of retrying forever', async () => {
  const root = await workspace()
  try {
    // 把索引路径占成目录：写入必然失败，重试也没有意义。
    await rm(join(root, PANEL_INDEX_PATH), { force: true })
    await mkdir(join(root, PANEL_INDEX_PATH), { recursive: true })
    await assert.rejects(rebuildPanelIndexWithRetry(root, 1))
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

test('the panel exposes the review target for a restored published chapter', async () => {
  const root = await workspace('chapter')
  try {
    await writeFile(join(root, 'source/story/state/current_state.json'), JSON.stringify({ chapter: 1 }))
    await rm(join(root, 'source/story/runtime/chapter-0001.review.json'), { force: true })
    await writeFile(join(root, 'source/story/runtime/workflow-start.json'), JSON.stringify({
      version: 1, action: 'write_next', chapter: 1, instruction: '恢复第 1 章后复审', createdAt: '2026-11-10T00:00:00.000Z',
    }))
    const index = await buildPanelIndex(root)
    const review = index.stages.find((stage) => stage.id === 'review')
    assert.equal(review?.status, 'current')
    assert.equal(review?.action?.label, '审阅本章')
    assert.equal(index.work?.reviewChapter, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
