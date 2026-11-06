import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { renderWriterContract } from '../src/pipelines/long/stages/writer.ts'
import { chapterPlanPath } from '../src/core/chapter-plan.ts'

async function workspace(language = 'zh', withRules = true) {
  const root = await mkdtemp(join(tmpdir(), 'see-dsh-novel-writer-'))
  await mkdir(join(root, 'source/story/state'), { recursive: true })
  await mkdir(join(root, 'source/story/runtime'), { recursive: true })
  await writeFile(join(root, 'work.json'), JSON.stringify({
    version: 1, id: 'w', title: '测试', profile: 'longform-novel', language, status: 'draft',
    metadata: { genre: '悬疑', platform: '番茄', targetChapters: 10, chapterWordCount: 2500 },
    createdAt: '2026-11-06T00:00:00.000Z', updatedAt: '2026-11-06T00:00:00.000Z',
  }))
  await writeFile(join(root, 'source/story/state/current_state.json'), JSON.stringify({ chapter: 0 }))
  await writeFile(join(root, chapterPlanPath(1)), JSON.stringify({
    version: 2,
    intent: { chapter: 1, goal: '接案' },
    memo: { chapter: 1, goal: '接案', body: '场景一：雨夜接案。', threadRefs: [] },
    plannerInputs: [],
  }))
  await writeFile(join(root, 'source/story/runtime/chapter-0001.intent.md'), '# Chapter Intent\n\n## Goal\n接案\n\n## Chapter Memo\n### Thread Refs\n- (none)\n\n### Body\n场景一：雨夜接案。\n')
  if (withRules) {
    await writeFile(join(root, 'source/story/book_rules.json'), JSON.stringify({
      version: '2', narrativePerson: '第三人称限知', prohibitions: ['不写超自然解释'],
      protagonist: { name: '沈砚', personalityLock: ['克制'], behavioralConstraints: ['不主动伤人'] },
      enableFullCastTracking: false, allowedDeviations: [],
    }))
    await writeFile(join(root, 'source/story/book_rules.md'), '# 本书规则\n\n- 不写超自然解释\n')
    await writeFile(join(root, 'source/story/style_guide.md'), '# 风格指南\n\n- 短句为主\n')
  }
  return root
}

const cleanup = (root) => rm(root, { recursive: true, force: true })

test('the Chinese contract carries all six sections', async () => {
  const root = await workspace('zh')
  try {
    const text = renderWriterContract(root)
    assert.match(text, /## 权威顺序/)
    assert.match(text, /## 字数\n用户目标：2500 字/)
    assert.match(text, /## 叙事人称\n第三人称限知/)
    assert.match(text, /## 主角权威\n名字：沈砚/)
    assert.match(text, /## 本书规则\n# 本书规则/)
    assert.match(text, /## 风格指南\n# 风格指南/)
    assert.match(text, /## 本章章纲\n# Chapter Intent/)
  } finally {
    await cleanup(root)
  }
})

test('missing optional rules omit their sections', async () => {
  const root = await workspace('zh', false)
  try {
    const text = renderWriterContract(root)
    assert.match(text, /## 权威顺序/)
    assert.doesNotMatch(text, /## 叙事人称/)
    assert.doesNotMatch(text, /## 主角权威/)
    assert.doesNotMatch(text, /## 风格指南/)
  } finally {
    await cleanup(root)
  }
})

test('an English work gets the English contract', async () => {
  const root = await workspace('en')
  try {
    const text = renderWriterContract(root)
    assert.match(text, /## Authority/)
    assert.match(text, /## Length\nUser target: 2500 words/)
    assert.match(text, /## Narrative person\n第三人称限知/)
    assert.match(text, /## Protagonist authority\nName: 沈砚/)
    assert.match(text, /## Chapter memo/)
  } finally {
    await cleanup(root)
  }
})
