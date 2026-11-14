import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { CHAPTER_USAGE_NAME, installChapterUsageTool } from '../src/plugin/chapter-usage-tool.ts'
import { chapterUsagePath, readChapterUsage } from '../src/core/chapter-usage.ts'
import { WORK_FILE } from '../src/core/story-paths.ts'
import { violations } from './support/schema-subset.mjs'

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'see-dsh-novel-usage-'))
  await mkdir(join(root, 'source/story/runtime'), { recursive: true })
  await mkdir(join(root, 'source/story/state'), { recursive: true })
  await mkdir(join(root, 'source/chapters'), { recursive: true })
  await writeFile(join(root, WORK_FILE), JSON.stringify({
    version: 1, id: 'w', title: '标题', profile: 'longform-novel', language: 'zh', status: 'draft',
    metadata: { chapterWordCount: 300 }, createdAt: '2026-11-10T00:00:00.000Z', updatedAt: '2026-11-10T00:00:00.000Z',
  }))
  return root
}

function services(root, { children = [], observations = {}, disposed = [] } = {}) {
  const registered = new Map()
  const ctx = {
    tools: {
      register(definition) {
        registered.set(definition.name, definition)
        return () => registered.delete(definition.name)
      },
    },
    workingDirectory: { ensure: async () => root },
    get(name) {
      if (name === 'subagents') return { listDescendants: async () => children }
      if (name === 'sessionQuery') {
        return {
          observeSession: async (sessionId) => {
            const observation = observations[sessionId]
            if (observation === undefined) throw new Error(`session "${sessionId}" not found`)
            return {
              projections: { values: observation },
              [Symbol.dispose]() { disposed.push(sessionId) },
            }
          },
        }
      }
      return undefined
    },
  }
  return { ctx, registered }
}

const exec = { agent: { session: { id: 'session-root' } } }

const rows = [
  { kind: 'child', id: 'writer', depth: 1 },
  { kind: 'child', id: 'reviewer', depth: 1 },
  { kind: 'child', id: 'grandchild', depth: 2 },
  { kind: 'diagnostic', id: 'broken', depth: 1 },
]

const observations = {
  writer: { tokenUsage: { uncachedInputTokens: 1200, outputTokens: 800, cacheReadTokens: 40, cacheWriteTokens: 10 } },
  reviewer: { tokenUsage: { uncachedInputTokens: 300, outputTokens: 100, cacheReadTokens: 5, cacheWriteTokens: 5 } },
  grandchild: { tokenUsage: { uncachedInputTokens: 1, outputTokens: 1, cacheReadTokens: 1, cacheWriteTokens: 1 } },
}

test('recording usage sums direct children and writes the runtime file', async () => {
  const root = await workspace()
  const disposed = []
  try {
    const { ctx, registered } = services(root, { children: rows, observations, disposed })
    const dispose = installChapterUsageTool(ctx)
    const definition = registered.get(CHAPTER_USAGE_NAME)
    const result = await definition.execute({ chapter: 1, childSessionIds: ['writer', 'reviewer'] }, exec)
    assert.deepEqual(result.tokenUsage, { promptTokens: 1560, completionTokens: 900, totalTokens: 2460 })
    assert.deepEqual(result.childSessionIds, ['writer', 'reviewer'])
    assert.equal(result.path, chapterUsagePath(1))
    const file = JSON.parse(await readFile(join(root, chapterUsagePath(1)), 'utf8'))
    assert.equal(file.version, 1)
    assert.equal(file.chapter, 1)
    assert.deepEqual(file.childSessionIds, ['writer', 'reviewer'])
    assert.deepEqual(file.tokenUsage, result.tokenUsage)
    assert.deepEqual(disposed.sort(), ['reviewer', 'writer'])
    assert.deepEqual(await readChapterUsage(root, 1), result.tokenUsage)
    assert.deepEqual(violations(definition.parameters), [])
    assert.deepEqual(violations(definition.output.schema), [])
    dispose()
    assert.equal(registered.size, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('recording rejects empty, duplicate, unknown, grandchild and published ids', async () => {
  const cases = [
    { chapter: 1, childSessionIds: [] },
    { chapter: 1, childSessionIds: ['writer', 'writer'] },
    { chapter: 1, childSessionIds: ['missing'] },
    { chapter: 1, childSessionIds: ['grandchild'] },
    { chapter: 0, childSessionIds: ['writer'] },
  ]
  for (const args of cases) {
    const root = await workspace()
    try {
      const { ctx, registered } = services(root, { children: rows, observations })
      installChapterUsageTool(ctx)
      await assert.rejects(
        registered.get(CHAPTER_USAGE_NAME).execute(args, exec),
        /childSessionIds|直接 child|chapter|重复/,
      )
      await assert.rejects(stat(join(root, chapterUsagePath(1))))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }

  const root = await workspace()
  try {
    await writeFile(join(root, 'source/chapters/0001_雨夜.md'), '# 第1章 雨夜\n\n正文。\n')
    const { ctx, registered } = services(root, { children: rows, observations })
    installChapterUsageTool(ctx)
    await assert.rejects(
      registered.get(CHAPTER_USAGE_NAME).execute({ chapter: 1, childSessionIds: ['writer'] }, exec),
      /已发布/,
    )
    await assert.rejects(stat(join(root, chapterUsagePath(1))))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('recording rejects a child without the four buckets and releases it', async () => {
  const root = await workspace()
  const disposed = []
  try {
    const { ctx, registered } = services(root, {
      children: rows,
      observations: { writer: { tokenUsage: { uncachedInputTokens: 1 } } },
      disposed,
    })
    installChapterUsageTool(ctx)
    await assert.rejects(
      registered.get(CHAPTER_USAGE_NAME).execute({ chapter: 1, childSessionIds: ['writer'] }, exec),
      { code: 'CHAPTER_USAGE_UNAVAILABLE' },
    )
    assert.deepEqual(disposed, ['writer'])
    await assert.rejects(stat(join(root, chapterUsagePath(1))))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('recording overwrites the previous usage file for the same chapter', async () => {
  const root = await workspace()
  try {
    const { ctx, registered } = services(root, { children: rows, observations })
    installChapterUsageTool(ctx)
    const tool = registered.get(CHAPTER_USAGE_NAME)
    await tool.execute({ chapter: 1, childSessionIds: ['writer'] }, exec)
    const first = JSON.parse(await readFile(join(root, chapterUsagePath(1)), 'utf8'))
    await tool.execute({ chapter: 1, childSessionIds: ['reviewer'] }, exec)
    const second = JSON.parse(await readFile(join(root, chapterUsagePath(1)), 'utf8'))
    assert.deepEqual(second.childSessionIds, ['reviewer'])
    assert.notDeepEqual(second.tokenUsage, first.tokenUsage)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
