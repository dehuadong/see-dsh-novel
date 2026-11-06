import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { chapterIntentPath, chapterPlanPath, loadChapterPlan, saveChapterPlan } from '../src/core/chapter-plan.ts'

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'see-dsh-novel-plan-'))
  await mkdir(join(root, 'source/story/runtime'), { recursive: true })
  return root
}

const cleanup = (root) => rm(root, { recursive: true, force: true })

test('save writes the governed plan and its intent projection', async () => {
  const root = await workspace()
  try {
    const { planPath, intentPath } = await saveChapterPlan(root, {
      chapter: 1,
      goal: '让沈砚接下无尸命案',
      body: '场景一：雨夜接案。\n场景二：编号牌。',
      threadRefs: ['H-01'],
      plannerInputs: ['source/story/outline/story_frame.md'],
    })
    assert.equal(planPath, chapterPlanPath(1))
    assert.equal(intentPath, chapterIntentPath(1))
    const persisted = JSON.parse(await readFile(join(root, planPath), 'utf8'))
    assert.equal(persisted.version, 2)
    assert.deepEqual(persisted.intent, { chapter: 1, goal: '让沈砚接下无尸命案' })
    assert.deepEqual(persisted.memo.threadRefs, ['H-01'])
    assert.deepEqual(persisted.plannerInputs, ['source/story/outline/story_frame.md'])
    assert.equal(
      await readFile(join(root, intentPath), 'utf8'),
      '# Chapter Intent\n\n## Goal\n让沈砚接下无尸命案\n\n## Chapter Memo\n### Thread Refs\n- H-01\n\n### Body\n场景一：雨夜接案。\n场景二：编号牌。\n',
    )
  } finally {
    await cleanup(root)
  }
})

test('empty threadRefs render as - (none)', async () => {
  const root = await workspace()
  try {
    await saveChapterPlan(root, { chapter: 1, goal: 'g', body: 'b', threadRefs: [] })
    assert.match(await readFile(join(root, chapterIntentPath(1)), 'utf8'), /### Thread Refs\n- \(none\)\n/)
  } finally {
    await cleanup(root)
  }
})

test('load round-trips, validates identity and falls back to the memo body', async () => {
  const root = await workspace()
  try {
    assert.equal(await loadChapterPlan(root, 1), null)
    await saveChapterPlan(root, { chapter: 1, goal: 'g', body: 'b', threadRefs: ['H-1'] })
    const plan = await loadChapterPlan(root, 1)
    assert.equal(plan.memo.goal, 'g')
    assert.match(plan.intentMarkdown, /# Chapter Intent/)
    await rm(join(root, chapterIntentPath(1)))
    assert.equal((await loadChapterPlan(root, 1)).intentMarkdown, 'b')
    const persisted = JSON.parse(await readFile(join(root, chapterPlanPath(1)), 'utf8'))
    persisted.memo.chapter = 2
    await writeFile(join(root, chapterPlanPath(1)), JSON.stringify(persisted))
    await assert.rejects(loadChapterPlan(root, 1), /不一致/)
  } finally {
    await cleanup(root)
  }
})

test('blank goal/body and a non-array refs are rejected without writing', async () => {
  const root = await workspace()
  try {
    await assert.rejects(saveChapterPlan(root, { chapter: 1, goal: ' ', body: 'b', threadRefs: [] }), /goal/)
    await assert.rejects(saveChapterPlan(root, { chapter: 1, goal: 'g', body: ' ', threadRefs: [] }), /body/)
    await assert.rejects(saveChapterPlan(root, { chapter: 1, goal: 'g', body: 'b', threadRefs: [1] }), /threadRefs/)
    assert.equal(await loadChapterPlan(root, 1), null)
  } finally {
    await cleanup(root)
  }
})
