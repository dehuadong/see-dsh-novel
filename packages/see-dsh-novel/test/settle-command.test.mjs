import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { approveSettlement } from '../src/plugin/settle-command.ts'
import { readSettleApproval } from '../src/core/settle-approval.ts'
import { saveChapterPlan } from '../src/core/chapter-plan.ts'
import { writeChapterDraft } from '../src/core/chapter-draft.ts'
import { reviewChapter } from '../src/core/chapter-review.ts'
import { WORK_FILE } from '../src/core/story-paths.ts'

async function workspace(review = true) {
  const root = await mkdtemp(join(tmpdir(), 'see-dsh-novel-settle-command-'))
  await writeFile(join(root, WORK_FILE), JSON.stringify({
    version: 1, id: 'w', title: '标题', profile: 'longform-novel', language: 'zh', status: 'draft',
    metadata: { chapterWordCount: 300 }, createdAt: '2026-11-15T00:00:00.000Z', updatedAt: '2026-11-15T00:00:00.000Z',
  }))
  await mkdir(join(root, 'source/story/state'), { recursive: true })
  await mkdir(join(root, 'source/story/runtime'), { recursive: true })
  for (const path of ['source/story/outline/story_frame.md', 'source/story/outline/volume_map.md', 'source/story/book_rules.md', 'source/story/book_rules.json', 'source/story/pending_hooks.md']) {
    await mkdir(join(root, path, '..'), { recursive: true })
    await writeFile(join(root, path), 'x\n')
  }
  await writeFile(join(root, 'source/story/state/current_state.json'), JSON.stringify({ chapter: 0 }))
  await writeFile(join(root, 'source/story/state/hooks.json'), JSON.stringify({ hooks: [] }))
  await writeFile(join(root, 'source/story/state/manifest.json'), JSON.stringify({ schemaVersion: 2, language: 'zh', lastAppliedChapter: 0, projectionVersion: 1 }))
  await saveChapterPlan(root, { chapter: 1, goal: '目标', body: '计划', threadRefs: [] })
  await writeChapterDraft(root, { chapter: 1, title: '雨夜', content: '正文。', language: 'zh' })
  if (review) {
    await reviewChapter(root, { chapter: 1, summary: '初审', observations: [] })
  }
  return root
}

test('settle approval writes a chapter marker for the reviewed chapter', async () => {
  const root = await workspace()
  try {
    const { chapter } = await approveSettlement(root)
    assert.equal(chapter, 1)
    assert.equal(readSettleApproval(root, 1)?.source, 'author')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('settle approval refuses before chapter-done', async () => {
  const root = await workspace(false)
  try {
    await assert.rejects(approveSettlement(root), /只有 chapter-done/)
    assert.equal(readSettleApproval(root, 1), null)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('settle approval refuses a published-but-unsettled chapter', async () => {
  const root = await workspace()
  try {
    await mkdir(join(root, 'source/chapters'), { recursive: true })
    await writeFile(join(root, 'source/chapters/0001_雨夜.md'), '# 第1章 雨夜\n\n正文。\n')
    await assert.rejects(approveSettlement(root), /修订提交或重算入口/)
    assert.equal(readSettleApproval(root, 1), null)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
