import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { renderWriterContract } from '../src/pipelines/long/stages/writer.ts'
import { chapterContextPath, chapterPlanPath } from '../src/core/chapter-plan.ts'

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
  await writeFile(join(root, chapterContextPath(1)), JSON.stringify({
    chapter: 1,
    selectedContext: [{ source: 'runtime/chapter_memo', reason: '章纲', excerpt: '场景一：雨夜接案。', protection: 'protected' }],
  }))
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

test('the Chinese contract carries the genre, authority and six context sections', async () => {
  const root = await workspace('zh')
  try {
    const text = renderWriterContract(root)
    assert.match(text, /## 题材与平台\n题材：悬疑｜平台：番茄；按已激活的专业 Skill 写作/)
    assert.match(text, /## 权威顺序/)
    assert.match(text, /## 字数\n用户目标：2500 字/)
    assert.doesNotMatch(text, /## 本章指令/)
    assert.match(text, /## 叙事人称\n第三人称限知/)
    assert.match(text, /## 主角权威\n名字：沈砚/)
    assert.match(text, /## 本书规则\n# 本书规则/)
    assert.match(text, /## 风格指南\n# 风格指南/)
    assert.match(text, /## 本章章纲\n# Chapter Intent/)
    assert.match(text, /## 已选上下文\n### 证据 1\n- 原因: 章纲/)
    assert.match(text, /场景一：雨夜接案。/)
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
    assert.match(text, /## Genre and platform\nGenre: 悬疑; platform: 番茄/)
    assert.match(text, /## Authority/)
    assert.match(text, /## Length\nUser target: 2500 words/)
    assert.match(text, /## Narrative person\n第三人称限知/)
    assert.match(text, /## Protagonist authority\nName: 沈砚/)
    assert.match(text, /## Chapter memo/)
    assert.match(text, /## Selected context\n### Evidence 1\n- reason: 章纲/)
  } finally {
    await cleanup(root)
  }
})

test('the direction block is hoisted, uses the source format and leaves the selected context', async () => {
  const root = await workspace('zh')
  try {
    await mkdir(join(root, 'source/story/runtime'), { recursive: true })
    await writeFile(join(root, 'source/story/runtime/workflow-start.json'), JSON.stringify({
      version: 1, action: 'write_next', chapter: 1, instruction: '写冷一点', instructionSource: 'author', createdAt: '2026-11-14T00:00:00.000Z',
    }))
    await writeFile(join(root, chapterContextPath(1)), JSON.stringify({
      chapter: 1,
      selectedContext: [
        { source: 'source/story/current_focus.md', reason: '当前焦点', excerpt: '盯住账本。', protection: 'protected' },
        { source: 'source/story/author_intent.md', reason: '作者意图', excerpt: '写冷一点。', protection: 'protected' },
        { source: 'runtime/chapter_memo', reason: '章纲', excerpt: '场景一', protection: 'protected' },
      ],
    }))
    const text = renderWriterContract(root)
    assert.match(text, /## 用户方向（优先于模型默认，必须遵循）\n### 证据 1\n- 原因: 当前焦点\n- 细节: 盯住账本。/)
    assert.match(text, /### 证据 2\n- 原因: 作者意图\n- 细节: 写冷一点。/)
    assert.match(text, /## 已选上下文\n### 证据 1\n- 原因: 章纲/)
    assert.doesNotMatch(text, /## 已选上下文[\s\S]*盯住账本/)
    const instructionIndex = text.indexOf('## 本章指令')
    const directionIndex = text.indexOf('## 用户方向')
    const lengthIndex = text.indexOf('## 字数')
    assert.ok(instructionIndex > 0 && instructionIndex < directionIndex && directionIndex < lengthIndex)
  } finally {
    await cleanup(root)
  }
})

test('an English work gets the English direction block', async () => {
  const root = await workspace('en')
  try {
    await writeFile(join(root, chapterContextPath(1)), JSON.stringify({
      chapter: 1,
      selectedContext: [
        { source: 'source/story/current_focus.md', reason: 'Current focus', excerpt: 'Watch the ledger.', protection: 'protected' },
        { source: 'source/story/author_intent.md', reason: 'Author intent', excerpt: 'Keep it cold.', protection: 'protected' },
        { source: 'runtime/chapter_memo', reason: 'Chapter memo', excerpt: 'Scene one', protection: 'protected' },
      ],
    }))
    const text = renderWriterContract(root)
    assert.match(text, /## User direction \(overrides model defaults — must follow\)\n### Evidence 1\n- reason: Current focus\n- detail: Watch the ledger\./)
    assert.match(text, /### Evidence 2\n- reason: Author intent\n- detail: Keep it cold\./)
    assert.match(text, /## Selected context\n### Evidence 1\n- reason: Chapter memo/)
  } finally {
    await cleanup(root)
  }
})

test('only an author start instruction becomes the chapter instruction', async () => {
  const root = await workspace('zh')
  try {
    await mkdir(join(root, 'source/story/runtime'), { recursive: true })
    await writeFile(join(root, 'source/story/runtime/workflow-start.json'), JSON.stringify({
      version: 1, action: 'write_next', chapter: 1, instruction: '开始写作', instructionSource: 'system', createdAt: '2026-11-14T00:00:00.000Z',
    }))
    assert.doesNotMatch(renderWriterContract(root), /## 本章指令/)
    await writeFile(join(root, 'source/story/runtime/workflow-start.json'), JSON.stringify({
      version: 1, action: 'write_next', chapter: 1, instruction: '写冷一点', instructionSource: 'author', createdAt: '2026-11-14T00:00:00.000Z',
    }))
    assert.match(renderWriterContract(root), /## 本章指令\n该指令最高优先级[\s\S]*写冷一点/)
  } finally {
    await cleanup(root)
  }
})
