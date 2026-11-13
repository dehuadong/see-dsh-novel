import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { PANEL_INDEX_PATH, WORK_FILE } from '../src/core/story-paths.ts'
import { withWorkAction } from '../src/core/work-mutation.ts'
import { installPanelWarmup, prewarmPanelIndex } from '../src/plugin/panel-projection.ts'

/** 一份可构建索引的最小作品：work.json + 五份基础设定 + 状态。 */
async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'see-dsh-novel-projection-'))
  await writeFile(join(root, WORK_FILE), JSON.stringify({
    version: 1, id: 'w', title: '标题', profile: 'longform-novel', language: 'zh', status: 'draft',
    metadata: {}, createdAt: '2026-11-10T00:00:00.000Z', updatedAt: '2026-11-10T00:00:00.000Z',
  }))
  for (const path of [
    'source/story/outline/story_frame.md',
    'source/story/outline/volume_map.md',
    'source/story/book_rules.md',
    'source/story/book_rules.json',
    'source/story/pending_hooks.md',
  ]) {
    await mkdir(join(root, path, '..'), { recursive: true })
    await writeFile(join(root, path), 'x\n')
  }
  await mkdir(join(root, 'source/story/state'), { recursive: true })
  await writeFile(join(root, 'source/story/state/current_state.json'), JSON.stringify({ chapter: 0 }))
  return root
}

/** 读索引文件；不存在时返回 undefined。 */
async function readIndex(root) {
  try {
    return JSON.parse(await readFile(join(root, PANEL_INDEX_PATH), 'utf8'))
  } catch {
    return undefined
  }
}

/** 轮询直到条件成立或超时；用于后台补建。 */
async function waitFor(predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => { setTimeout(resolve, 20) })
  }
  throw new Error('等待条件超时')
}

/** 一个只实现 effect / on / logger 的假根上下文。 */
function fakeHost() {
  const listeners = new Map()
  const disposers = []
  const warnings = []
  const ctx = {
    effect(execute) { disposers.push(execute()) },
    on(event, listener) {
      listeners.set(event, listener)
      return () => listeners.delete(event)
    },
    logger: { warn: (message) => { warnings.push(message) } },
  }
  return { ctx, listeners, disposers, warnings }
}

test('a successful work action rebuilds the panel index once', async () => {
  const root = await workspace()
  try {
    assert.equal(await readIndex(root), undefined)
    await withWorkAction(root, async () => {})
    const index = await readIndex(root)
    assert.equal(index?.version, 5)
    assert.equal(index?.work?.title, '标题')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a nested action rebuilds once and an opted-out action does not rebuild', async () => {
  const root = await workspace()
  try {
    await withWorkAction(root, async () => {
      await withWorkAction(root, async () => {})
    })
    assert.ok(await readIndex(root), '外层动作成功后应有索引')

    await rm(join(root, PANEL_INDEX_PATH), { force: true })
    await withWorkAction(root, async () => {}, { project: false })
    assert.equal(await readIndex(root), undefined, 'project:false 不重建')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a failing projection never changes the action result', async () => {
  const root = await workspace()
  try {
    // 坏掉的 work.json 会让 buildPanelIndex 抛错；动作本身仍要成功。
    await writeFile(join(root, WORK_FILE), '{ not json')
    const value = await withWorkAction(root, async () => 'done')
    assert.equal(value, 'done')
    assert.equal(await readIndex(root), undefined)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('prewarm builds a missing index once and skips an up-to-date one', async () => {
  const root = await workspace()
  try {
    await prewarmPanelIndex({ cwd: root })
    const index = await readIndex(root)
    assert.equal(index?.version, 5)

    // 已是最新：不再重写（generatedAt 保持不变）。
    await prewarmPanelIndex({ cwd: root })
    const again = await readIndex(root)
    assert.equal(again?.generatedAt, index?.generatedAt)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('prewarm rebuilds an index written by an older format', async () => {
  const root = await workspace()
  try {
    await mkdir(join(root, 'source/story/runtime'), { recursive: true })
    await writeFile(join(root, PANEL_INDEX_PATH), JSON.stringify({ version: 1, generatedAt: 'old' }))
    await prewarmPanelIndex({ cwd: root })
    const index = await readIndex(root)
    assert.equal(index?.version, 5)
    assert.notEqual(index?.generatedAt, 'old')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('prewarm ignores subagent sessions and works without work.json', async () => {
  const root = await workspace()
  const other = await mkdtemp(join(tmpdir(), 'see-dsh-novel-projection-empty-'))
  try {
    await prewarmPanelIndex({ cwd: root, delegationDepth: 1 })
    assert.equal(await readIndex(root), undefined)

    await prewarmPanelIndex({ cwd: other })
    assert.equal(await readIndex(other), undefined)

    await prewarmPanelIndex({})
    // 判据只看工作区，不看会话头的预设：文件在就补建。
    await prewarmPanelIndex({ cwd: root, agentPreset: 'standard' })
    assert.equal((await readIndex(root))?.version, 5)
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(other, { recursive: true, force: true })
  }
})

test('the session/created listener never throws and logs projection failures', async () => {
  const root = await workspace()
  const { ctx, listeners, warnings } = fakeHost()
  installPanelWarmup(ctx)
  try {
    const listener = listeners.get('session/created')
    assert.equal(typeof listener, 'function')
    // 同步返回，不抛；补建在后台完成。
    assert.doesNotThrow(() => listener({ header: { cwd: root } }))
    await waitFor(async () => (await readIndex(root))?.version === 5)
    assert.equal((await readIndex(root))?.version, 5)

    // 坏掉的 work.json：补建失败只记录，不把异常抛回会话创建。
    await rm(join(root, PANEL_INDEX_PATH), { force: true })
    await writeFile(join(root, WORK_FILE), '{ not json')
    assert.doesNotThrow(() => listener({ header: { cwd: root } }))
    await waitFor(async () => warnings.length > 0)
    assert.match(warnings[0], /面板索引补建失败/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

