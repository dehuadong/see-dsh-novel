import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

import { installStageContext, detectStage, renderStageProtocol } from '../src/pipelines/long/stages/index.ts'
import { writeWorkflowStart } from '../src/core/workflow-start.ts'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const PRESET = 'see-dsh-novel'

const work = JSON.stringify({
  version: 1, id: 'w', title: '阶段测试', profile: 'longform-novel', language: 'zh', status: 'draft',
  metadata: { targetChapters: 10, chapterWordCount: 3000, genre: '悬疑', platform: '番茄' },
  createdAt: '2026-11-06T00:00:00.000Z', updatedAt: '2026-11-06T00:00:00.000Z',
}, null, 2)

const foundation = [
  'source/story/outline/story_frame.md',
  'source/story/outline/volume_map.md',
  'source/story/book_rules.md',
  'source/story/book_rules.json',
  'source/story/current_state.md',
  'source/story/pending_hooks.md',
  'source/story/chapter_summaries.md',
]

async function workspace(kind) {
  const root = await mkdtemp(join(tmpdir(), 'see-dsh-novel-stage-'))
  if (kind === 'proposal') return root
  await writeFile(join(root, 'work.json'), work)
  if (kind === 'foundation') return root
  for (const file of foundation) {
    await mkdir(dirname(join(root, file)), { recursive: true })
    await writeFile(join(root, file), '# x\n')
  }
  await mkdir(join(root, 'source/story/state'), { recursive: true })
  await writeFile(join(root, 'source/story/state/current_state.json'), JSON.stringify({ chapter: 0 }))
  if (kind === 'foundation-ready') return root
  if (['plan', 'write', 'review', 'chapter-done'].includes(kind)) {
    await writeWorkflowStart(root, { chapter: 1, instruction: '开始第一章' })
  }
  if (kind === 'write' || kind === 'review' || kind === 'chapter-done') {
    if (kind === 'review' || kind === 'chapter-done') await mkdir(join(root, 'source/chapters'), { recursive: true })
    if (kind === 'review' || kind === 'chapter-done') await writeFile(join(root, 'source/chapters/0001_雨夜.md'), '# 第1章 雨夜\n\n正文。\n')
    await mkdir(join(root, 'source/story/runtime'), { recursive: true })
    await writeFile(join(root, 'source/story/runtime/chapter-0001.plan.json'), JSON.stringify({
      version: 2,
      intent: { chapter: 1, goal: '测试' },
      memo: { chapter: 1, goal: '测试', body: '让沈砚接下命案。', threadRefs: [] },
    }))
  }
  if (kind === 'chapter-done') {
    await writeFile(join(root, 'source/story/runtime/chapter-0001.review.json'), JSON.stringify({ version: 1 }))
  }
  return root
}

/** 最小插件上下文：捕获两个 context 注册。 */
function fakeContext(agentRoot) {
  const entries = new Map()
  const ctx = {
    systemPrompt: {
      context: (contribution) => {
        entries.set(contribution.name, contribution)
        return () => entries.delete(contribution.name)
      },
    },
    workingDirectory: { get: () => agentRoot },
    get: (name) => name === 'agentPresets' ? { composedPreset: () => PRESET } : undefined,
  }
  return { ctx, entries }
}

const textOf = (contribution) => contribution.text({ agent: { ctx: {}, session: 's' } })

test('detectStage follows the workspace files', async () => {
  for (const kind of ['proposal', 'foundation', 'foundation-ready', 'plan', 'write', 'review', 'chapter-done']) {
    const root = await workspace(kind)
    try {
      const facts = detectStage(root)
      assert.equal(facts.stage, kind)
      assert.ok(facts.reviewTarget === 0 || facts.stage === 'review')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }
})

test('a restored published chapter becomes the review target', async () => {
  const root = await workspace('chapter-done')
  try {
    await writeFile(join(root, 'source/story/state/current_state.json'), JSON.stringify({ chapter: 1 }))
    await rm(join(root, 'source/story/runtime/chapter-0001.review.json'), { force: true })
    const facts = detectStage(root)
    assert.equal(facts.stage, 'review')
    assert.equal(facts.reviewTarget, 1)
    const text = renderStageProtocol(facts)
    assert.match(text, /审第 1 章/)
    assert.match(text, /重开保留的旧稿/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the repair block is injected once a chapter exists, including when state is corrupt', async () => {
  const byIndex = await workspace('chapter-done')
  try {
    await writeFile(join(byIndex, 'source/chapters/index.json'), JSON.stringify([{ number: 1, title: '雨夜', wordCount: 1 }]))
    const { ctx, entries } = fakeContext(byIndex)
    installStageContext(ctx, packageRoot, PRESET)
    assert.match(textOf(entries.get('story:stage')), /## 重新结算（重算）/)
    assert.match(textOf(entries.get('story:stage')), /story_resettle_chapter/)
    assert.match(textOf(entries.get('story:stage')), /只支持最新章/)
    assert.match(textOf(entries.get('story:stage')), /基线原文/)
    assert.match(textOf(entries.get('story:stage')), /不改正文、章节索引与 workflow-start/)
    assert.match(textOf(entries.get('story:stage')), /failureReport/)
    assert.match(textOf(entries.get('story:stage')), /复审会消费它/)
  } finally {
    await rm(byIndex, { recursive: true, force: true })
  }

  const byChapter = await workspace('chapter-done')
  try {
    await writeFile(join(byChapter, 'source/story/state/current_state.json'), JSON.stringify({ chapter: 1, facts: [] }))
    const { ctx, entries } = fakeContext(byChapter)
    installStageContext(ctx, packageRoot, PRESET)
    assert.match(textOf(entries.get('story:stage')), /story_resettle_chapter/)
  } finally {
    await rm(byChapter, { recursive: true, force: true })
  }

  const corrupt = await workspace('chapter-done')
  try {
    await writeFile(join(corrupt, 'source/story/state/current_state.json'), '{ bad')
    await writeFile(join(corrupt, 'source/chapters/index.json'), JSON.stringify([{ number: 1, title: '雨夜', wordCount: 1 }]))
    assert.equal(detectStage(corrupt).currentChapter, 0)
    assert.equal(detectStage(corrupt).hasChapters, true)
    const { ctx, entries } = fakeContext(corrupt)
    installStageContext(ctx, packageRoot, PRESET)
    assert.match(textOf(entries.get('story:stage')), /story_resettle_chapter/)
  } finally {
    await rm(corrupt, { recursive: true, force: true })
  }
})

test('the repair block follows chapter existence, not the stage name', () => {
  const facts = (stage, currentChapter = 1, hasChapters = false) => ({
    stage, title: '', currentChapter, hasChapters, chapterPublished: false, chapterSnapshot: false,
  })
  for (const stage of ['foundation-ready', 'plan', 'write', 'review', 'chapter-done']) {
    assert.match(renderStageProtocol(facts(stage)), /## 重新结算（重算）/)
  }
  for (const stage of ['proposal', 'foundation']) {
    assert.doesNotMatch(renderStageProtocol(facts(stage)), /## 重新结算（重算）/)
  }
  // 没有章时也不注入。
  for (const stage of ['foundation-ready', 'plan', 'write', 'review', 'chapter-done']) {
    assert.doesNotMatch(renderStageProtocol(facts(stage, 0, false)), /## 重新结算（重算）/)
  }
  // 有索引章、currentChapter 仍为 0 时也注入。
  for (const stage of ['foundation-ready', 'plan', 'write', 'review', 'chapter-done']) {
    assert.match(renderStageProtocol(facts(stage, 0, true)), /## 重新结算（重算）/)
  }
})

test('a published chapter with a snapshot gets the held-state repair line, without one gets the legacy line', async () => {
  const held = await workspace('chapter-done')
  try {
    await mkdir(join(held, 'source/story/snapshots/1/state'), { recursive: true })
    await writeFile(join(held, 'source/story/snapshots/1/state/manifest.json'), JSON.stringify({ lastAppliedChapter: 0 }))
    const facts = detectStage(held)
    assert.equal(facts.chapterPublished, true)
    assert.equal(facts.chapterSnapshot, true)
    const text = renderStageProtocol(facts)
    assert.match(text, /被扣下/)
    assert.match(text, /story_resettle_chapter/)
    assert.match(text, /不要再次结算/)
    assert.doesNotMatch(text, /story_recover/)
  } finally {
    await rm(held, { recursive: true, force: true })
  }

  const legacy = await workspace('chapter-done')
  try {
    const facts = detectStage(legacy)
    assert.equal(facts.chapterPublished, true)
    assert.equal(facts.chapterSnapshot, false)
    const text = renderStageProtocol(facts)
    assert.match(text, /story_recover/)
    assert.doesNotMatch(text, /被扣下/)
  } finally {
    await rm(legacy, { recursive: true, force: true })
  }
})

test('the stage protocol switches with the phase and the craft follows it', async () => {
  for (const kind of ['proposal', 'foundation', 'foundation-ready', 'plan', 'write', 'review', 'chapter-done']) {
    const root = await workspace(kind)
    try {
      const { ctx, entries } = fakeContext(root)
      installStageContext(ctx, packageRoot, PRESET)
      const stageText = textOf(entries.get('story:stage'))
      const craftText = textOf(entries.get('story:craft'))
      if (kind === 'proposal') {
        assert.match(stageText, /提案/)
        assert.match(craftText, /创作方法（story-proposal）/)
      }
      if (kind === 'foundation') {
        assert.match(stageText, /story_foundation_outline/)
        assert.match(stageText, /平台：番茄/)
        assert.match(stageText, /目标章数：10/)
        assert.match(stageText, /每章字数：3000/)
        assert.match(stageText, /入参带上第 1 步的 storyFrame/)
        assert.doesNotMatch(stageText, /外部指令/)
        assert.match(craftText, /创作方法（longform-writing）/)
        assert.match(craftText, /参考：foundation-design/)
      }
      if (kind === 'foundation-ready') {
        assert.match(stageText, /等待作者发起一章的 workflow start/)
        assert.match(stageText, /不要自行调用 `story_plan_chapter`/)
        assert.doesNotMatch(stageText, /story_context_candidates/)
      }
      // 本夹具没有已定稿/已结算的章，重算块不应出现；注入条件由下面的专门用例覆盖。
      assert.doesNotMatch(stageText, /## 重新结算（重算）/)
      if (kind === 'chapter-done') {
        assert.match(stageText, /第 1 章审稿已落盘/)
        assert.match(stageText, /## 来源 chapter-1/)
        assert.match(stageText, /## 来源 governed-context/)
        assert.match(stageText, /1 \| 正文。/)
        assert.doesNotMatch(stageText, /## 审稿要求/)
        assert.match(stageText, /（ranges／replacements 与整段 content）/)
        assert.match(stageText, /空串删段/)
        assert.match(stageText, /本章 workflow 结束/)
        assert.match(stageText, /story_revise_chapter/)
        assert.doesNotMatch(stageText, /story_summarize_chapter/)
        assert.match(stageText, /story_settle_chapter/)
        assert.match(stageText, /不带 validation/)
        assert.match(stageText, /state-check 子代理读提案文件/)
        assert.match(stageText, /failureReport/)
        assert.match(stageText, /outcome: unavailable/)
        assert.match(stageText, /结算前不要调用 `story_state_check`/)
        assert.match(stageText, /story_chapter_versions/)
        assert.match(stageText, /story_reopen_chapter/)
        assert.match(stageText, /story_state_check/)
        assert.match(stageText, /只有换一份真值投影（truth projection）能消解不一致时 reconciliationRequired 才为 true/)
        assert.match(stageText, /只作观察/)
        assert.doesNotMatch(stageText, /story_write_chapter/)
        assert.match(craftText, /创作方法（story-review）/)
      }
      if (kind === 'plan') {
        assert.match(stageText, /story_context_candidates/)
        assert.match(stageText, /story_plan_chapter/)
        assert.match(stageText, /## planner 契约/)
        assert.match(stageText, /# 第1章 memo 请求/)
        assert.match(stageText, /story_revise_chapter/)
        assert.equal(craftText, '')
      }
      if (kind === 'review') {
        assert.match(stageText, /story_review_chapter/)
        assert.match(stageText, /修订后必须重新审稿/)
        assert.match(stageText, /## 来源 chapter-1/)
        assert.match(stageText, /## 来源 governed-context/)
        assert.match(stageText, /`ranges`／`replacements`/)
        assert.match(craftText, /创作方法（story-review）/)
      }
      if (kind === 'write') {
        assert.match(stageText, /story_write_chapter/)
        assert.match(stageText, /## 权威顺序/)
        assert.match(stageText, /## 字数/)
        assert.match(craftText, /参考：scene-dialogue-and-length-budget/)
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }
})

test('another preset gets no stage text', async () => {
  const root = await workspace('plan')
  try {
    const { ctx, entries } = fakeContext(root)
    ctx.get = () => ({ composedPreset: () => 'standard' })
    installStageContext(ctx, packageRoot, PRESET)
    assert.equal(textOf(entries.get('story:stage')), '')
    assert.equal(textOf(entries.get('story:craft')), '')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('an English work gets the English contract and its brief', async () => {
  const root = await workspace('foundation')
  try {
    const workJson = JSON.parse(await readFile(join(root, 'work.json'), 'utf8'))
    workJson.language = 'en'
    await writeFile(join(root, 'work.json'), JSON.stringify(workJson))
    await mkdir(join(root, 'source/story'), { recursive: true })
    await writeFile(join(root, 'source/story/brief.md'), 'Write a rainy-night mystery.')
    const { ctx, entries } = fakeContext(root)
    installStageContext(ctx, packageRoot, PRESET)
    const stageText = textOf(entries.get('story:stage'))
    assert.match(stageText, /## External Instructions/)
    assert.match(stageText, /Write a rainy-night mystery\./)
    assert.match(stageText, /Platform: 番茄|Platform: /)
    assert.match(stageText, /Target chapters: 10/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
