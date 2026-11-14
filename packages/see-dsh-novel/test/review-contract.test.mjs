import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { renderReviewContract } from '../src/pipelines/long/stages/review.ts'
import { chapterContextPath, chapterPlanPath } from '../src/core/chapter-plan.ts'

async function workspace(language = 'zh', options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'see-dsh-novel-review-contract-'))
  await mkdir(join(root, 'source/story/state'), { recursive: true })
  await mkdir(join(root, 'source/story/runtime'), { recursive: true })
  await mkdir(join(root, 'source/chapters'), { recursive: true })
  await writeFile(join(root, 'work.json'), JSON.stringify({ version: 1, id: 'w', title: 't', profile: 'longform-novel', language, status: 'draft', metadata: {}, createdAt: '2026-11-06T00:00:00.000Z', updatedAt: '2026-11-06T00:00:00.000Z' }))
  await writeFile(join(root, 'source/story/state/current_state.json'), JSON.stringify({ chapter: 0 }))
  if (options.plan !== false) {
    await writeFile(join(root, chapterPlanPath(1)), JSON.stringify({
      version: 2,
      intent: { chapter: 1, goal: '接案' },
      memo: { chapter: 1, goal: '接案', body: '场景一：雨夜接案。', threadRefs: [] },
      plannerInputs: [],
    }))
  }
  if (options.chapter !== false) {
    await writeFile(join(root, 'source/chapters/0001_雨夜.md'), '# 第1章 雨夜\n\n雨从二十三点下到现在。\n\n沈砚站在巷口。\n')
  }
  return root
}

const cleanup = (root) => rm(root, { recursive: true, force: true })

test('the contract carries the requirement and both numbered sources', async () => {
  const root = await workspace('zh')
  try {
    const text = renderReviewContract(root, 1)
    assert.match(text, /## 审稿要求/)
    assert.match(text, /## 来源 chapter-1\n1 \| 雨从二十三点下到现在。\n2 \| \n3 \| 沈砚站在巷口。/)
    assert.match(text, /## 来源 governed-context\n1 \| 场景一：雨夜接案。/)
    assert.doesNotMatch(text, /# 第1章 雨夜/)
  } finally {
    await cleanup(root)
  }
})

test('an English work gets the English requirement', async () => {
  const root = await workspace('en')
  try {
    const text = renderReviewContract(root, 1)
    assert.match(text, /## Review request/)
    assert.match(text, /## Source chapter-1/)
    assert.match(text, /## Source governed-context/)
  } finally {
    await cleanup(root)
  }
})

test('a missing chapter yields an empty contract', async () => {
  const root = await workspace('zh', { chapter: false })
  try {
    assert.equal(renderReviewContract(root, 1), '')
  } finally {
    await cleanup(root)
  }
})

test('a published chapter without a readable plan gets no review contract', async () => {
  for (const options of [{ plan: false }, { corruptPlan: true }]) {
    const root = await workspace('zh', options)
    try {
      if (options.corruptPlan === true) {
        await writeFile(join(root, chapterPlanPath(1)), '{"version":2,"memo":')
      }
      assert.equal(renderReviewContract(root, 1), '')
    } finally {
      await cleanup(root)
    }
  }
})

test('the contract prefers the context package and adds the before source for revisions', async () => {
  const root = await workspace('zh')
  try {
    await writeFile(join(root, chapterContextPath(1)), JSON.stringify({
      chapter: 1,
      selectedContext: [{ source: 'runtime/chapter_memo', reason: '包来源', excerpt: '包正文', protection: 'protected' }],
    }))
    const text = renderReviewContract(root, 1, '新正文')
    assert.match(text, /## 来源 governed-context[\s\S]*包正文/)
    assert.match(text, /## 来源 chapter-1@before/)
    assert.match(text, /雨从二十三点下到现在/)
  } finally {
    await cleanup(root)
  }
})
