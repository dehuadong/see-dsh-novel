import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { renderPlannerContract } from '../src/pipelines/long/stages/planner.ts'

async function workspace(language = 'zh') {
  const root = await mkdtemp(join(tmpdir(), 'see-dsh-novel-planner-'))
  await mkdir(join(root, 'source/story/state'), { recursive: true })
  await mkdir(join(root, 'source/chapters'), { recursive: true })
  await writeFile(join(root, 'work.json'), JSON.stringify({ version: 1, id: 'w', title: 't', profile: 'longform-novel', language, status: 'draft', metadata: { chapterWordCount: 3000 }, createdAt: '2026-11-06T00:00:00.000Z', updatedAt: '2026-11-06T00:00:00.000Z' }))
  await writeFile(join(root, 'source/story/state/current_state.json'), JSON.stringify({ chapter: 1 }))
  await writeFile(join(root, 'source/story/state/hooks.json'), JSON.stringify({ hooks: [{ hookId: 'H-01' }, { hookId: 'H-02' }] }))
  await writeFile(join(root, 'source/story/brief.md'), '写《夜行》的基础设定与第一卷大纲。')
  await writeFile(join(root, 'source/chapters/0001_雨夜.md'), '# 第1章 雨夜\n\n雨从二十三点下到现在。\n\n沈砚站在巷口。\n')
  return root
}

const cleanup = (root) => rm(root, { recursive: true, force: true })

test('the Chinese contract carries the method, the memo skeleton, previous ending and hook ids', async () => {
  const root = await workspace('zh')
  try {
    const text = renderPlannerContract(root)
    assert.match(text, /## planner 契约/)
    assert.match(text, /不写正文/)
    assert.match(text, /只使用输入中存在的 hook id/)
    assert.match(text, /# 第2章 memo 请求/)
    assert.match(text, /## 当前用户指令\n写《夜行》的基础设定/)
    assert.match(text, /## 上一章正文\n雨从二十三点下到现在。/)
    assert.match(text, /## 宿主字数遥测\n用户目标：3000 字/)
    assert.match(text, /## 可用 hook id\nH-01、H-02/)
  } finally {
    await cleanup(root)
  }
})

test('the English contract uses the English method and request header', async () => {
  const root = await workspace('en')
  try {
    const text = renderPlannerContract(root)
    assert.match(text, /## Planner contract/)
    assert.match(text, /Do not write prose/)
    assert.match(text, /# Chapter 2 memo request/)
    assert.match(text, /## Host length telemetry\nUser target: 3000 words/)
  } finally {
    await cleanup(root)
  }
})

test('missing instruction, previous chapter and hooks omit their sections', async () => {
  const root = await workspace('zh')
  try {
    await rm(join(root, 'source/story/brief.md'))
    await rm(join(root, 'source/chapters/0001_雨夜.md'))
    await writeFile(join(root, 'source/story/state/hooks.json'), JSON.stringify({ hooks: [] }))
    const text = renderPlannerContract(root)
    assert.match(text, /# 第2章 memo 请求/)
    assert.doesNotMatch(text, /## 当前用户指令/)
    assert.doesNotMatch(text, /## 上一章正文/)
    assert.doesNotMatch(text, /## 可用 hook id/)
  } finally {
    await cleanup(root)
  }
})
