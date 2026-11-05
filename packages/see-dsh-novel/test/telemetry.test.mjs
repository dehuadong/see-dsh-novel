import test from 'node:test'
import assert from 'node:assert/strict'

import { installTelemetryTool, readTelemetry, TELEMETRY_NAME, telemetryOutput, telemetryParameters } from '../src/plugin/telemetry-tool.ts'
import { violations } from './support/schema-subset.mjs'

/** 只带工具注册面与可选服务面的假 ctx。 */
function services({ rows = [], observations = {}, subagents, sessionQuery } = {}) {
  const registered = new Map()
  return {
    registered,
    ctx: {
      tools: {
        register(definition) {
          registered.set(definition.name, definition)
          return () => registered.delete(definition.name)
        },
      },
      get(name) {
        if (name === 'subagents') {
          return subagents ?? { listDescendants: async () => rows }
        }
        if (name === 'sessionQuery') {
          return sessionQuery ?? {
            observeSession: async (sessionId) => {
              const observation = observations[sessionId]
              if (observation === undefined) throw new Error(`session "${sessionId}" not found`)
              return observation
            },
          }
        }
        return undefined
      },
    },
  }
}

const exec = { agent: { session: { id: 'session-root', snapshotEvents: () => [] } } }

/** 一份带投影的观察；`disposed` 用来断言释放过。 */
function observation(values, disposed = []) {
  return {
    projections: { values },
    dispose() { disposed.push(true) },
  }
}

/** 一个 completed 的本地子会话。 */
const completed = {
  tokenUsage: { uncachedInputTokens: 1200, outputTokens: 800, cacheReadTokens: 40, cacheWriteTokens: 10 },
  subagentTiming: { settledMs: 42000, lastTurnCompleted: true },
}

test('no children yields an empty receipt and a readable card', async () => {
  const { ctx, registered } = services()
  const dispose = installTelemetryTool(ctx)
  const definition = registered.get(TELEMETRY_NAME)

  const result = await definition.execute({}, exec)
  assert.deepEqual(result.delegations, [])
  assert.deepEqual(result.diagnostics, [])
  assert.deepEqual(result.summary, {
    delegations: 0,
    incomplete: 0,
    diagnostics: 0,
    partial: 0,
    durationMs: 0,
    usage: { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
  })

  const rendered = definition.output.render({}, result)
  assert.equal(rendered.length, 1)
  assert.match(rendered[0].text, /委派 0 笔/)
  assert.equal(Array.isArray(rendered), true)
  dispose()
  assert.equal(registered.size, 0)
})

test('a completed child reports its usage, duration and state', async () => {
  const disposed = []
  const { ctx, registered } = services({
    rows: [{ kind: 'child', id: 'session-child', parentId: 'session-root', depth: 1, mode: 'one-shot', label: 'writer', activity: 'inactive' }],
    observations: { 'session-child': observation(completed, disposed) },
  })
  installTelemetryTool(ctx)
  const result = await registered.get(TELEMETRY_NAME).execute({}, exec)

  assert.deepEqual(result.delegations, [{
    childSessionId: 'session-child',
    label: 'writer',
    mode: 'one-shot',
    depth: 1,
    state: 'completed',
    durationMs: 42000,
    usage: { uncachedInputTokens: 1200, outputTokens: 800, cacheReadTokens: 40, cacheWriteTokens: 10 },
  }])
  assert.equal(result.summary.delegations, 1)
  assert.equal(result.summary.durationMs, 42000)
  assert.deepEqual(disposed, [true], '观察用完要释放')
})

test('running requires both residency and an open turn', async () => {
  const { ctx, registered } = services({
    rows: [{ kind: 'child', id: 'session-running', depth: 1, mode: 'continuable', label: 'reviewer', activity: 'running' }],
    observations: {
      'session-running': observation({
        ...completed,
        subagentTiming: { settledMs: 1000, active: { since: 500, through: 3500 }, lastTurnCompleted: true },
      }),
    },
  })
  installTelemetryTool(ctx)
  const result = await registered.get(TELEMETRY_NAME).execute({}, exec)
  assert.equal(result.delegations[0].state, 'running')
  assert.equal(result.delegations[0].durationMs, 4000)

  // 住着但轮次之间空闲：不算在跑，按最近一轮的正常收尾给 completed。
  const idle = services({
    rows: [{ kind: 'child', id: 'session-idle', depth: 1, mode: 'continuable', label: 'reviewer', activity: 'running' }],
    observations: { 'session-idle': observation(completed) },
  })
  installTelemetryTool(idle.ctx)
  const idleResult = await idle.registered.get(TELEMETRY_NAME).execute({}, exec)
  assert.equal(idleResult.delegations[0].state, 'completed')

  // 没有驻留但留下未闭合轮次（崩溃残留）：不算在跑。
  const orphan = services({
    rows: [{ kind: 'child', id: 'session-orphan', depth: 1, mode: 'one-shot', activity: 'inactive' }],
    observations: {
      'session-orphan': observation({ subagentTiming: { settledMs: 0, active: { since: 1, through: 2 } } }),
    },
  })
  installTelemetryTool(orphan.ctx)
  const orphanResult = await orphan.registered.get(TELEMETRY_NAME).execute({}, exec)
  assert.equal(orphanResult.delegations[0].state, 'unknown')
})

test('incomplete children are counted', async () => {
  const { ctx, registered } = services({
    rows: [{ kind: 'child', id: 'session-failed', depth: 1, mode: 'one-shot', activity: 'inactive' }],
    observations: { 'session-failed': observation({ ...completed, subagentTiming: { settledMs: 100, lastTurnCompleted: false } }) },
  })
  installTelemetryTool(ctx)
  const result = await registered.get(TELEMETRY_NAME).execute({}, exec)
  assert.equal(result.delegations[0].state, 'incomplete')
  assert.equal(result.summary.incomplete, 1)
})

test('diagnostics stay out of the delegation list', async () => {
  const { ctx, registered } = services({
    rows: [
      { kind: 'child', id: 'session-child', depth: 1, mode: 'one-shot', activity: 'inactive' },
      { kind: 'diagnostic', id: 'session-broken', reason: 'unsupported' },
    ],
    observations: { 'session-child': observation(completed) },
  })
  installTelemetryTool(ctx)
  const result = await registered.get(TELEMETRY_NAME).execute({}, exec)
  assert.deepEqual(result.diagnostics, [{ childSessionId: 'session-broken', reason: 'unsupported' }])
  assert.equal(result.summary.diagnostics, 1)
  assert.equal(result.summary.delegations, 1)
  assert.equal(result.delegations.length, 1)
})

test('an unreadable child is null, counted as partial, and never zero-filled', async () => {
  const { ctx, registered } = services({
    rows: [
      { kind: 'child', id: 'session-child', depth: 1, mode: 'one-shot', activity: 'inactive' },
      { kind: 'child', id: 'session-external', depth: 1, mode: 'external', activity: 'inactive' },
    ],
    observations: { 'session-child': observation(completed) },
  })
  installTelemetryTool(ctx)
  const result = await registered.get(TELEMETRY_NAME).execute({}, exec)

  const external = result.delegations.find((row) => row.childSessionId === 'session-external')
  assert.equal(external.state, 'unknown')
  assert.equal(external.durationMs, null)
  assert.equal(external.usage, null)
  assert.equal(result.summary.partial, 1)
  assert.equal(result.summary.durationMs, 42000, '合计只含读得到的那条')
  assert.equal(result.summary.usage.outputTokens, 800)
})

test('limit keeps the most recent rows only', async () => {
  const rows = [1, 2, 3].map((index) => ({
    kind: 'child', id: `session-${index}`, depth: 1, mode: 'one-shot', activity: 'inactive',
  }))
  const { ctx, registered } = services({
    rows,
    observations: {
      'session-1': observation(completed),
      'session-2': observation(completed),
      'session-3': observation(completed),
    },
  })
  installTelemetryTool(ctx)
  const result = await registered.get(TELEMETRY_NAME).execute({ limit: 2 }, exec)
  assert.deepEqual(result.delegations.map((row) => row.childSessionId), ['session-2', 'session-3'])
  assert.equal(result.summary.delegations, 2)
})

test('a bad limit and missing services fail loud', async () => {
  const { ctx, registered } = services()
  installTelemetryTool(ctx)
  const definition = registered.get(TELEMETRY_NAME)
  await assert.rejects(definition.execute({ limit: 0 }, exec), /limit 必须是正整数/)
  await assert.rejects(definition.execute({ limit: 2.5 }, exec), /limit 必须是正整数/)

  // 服务缺失：点名缺的是哪一个。
  const bare = { tools: { register: () => () => {} }, get: () => undefined }
  await assert.rejects(readTelemetry(bare, exec, {}), /subagents/)
  await assert.rejects(
    readTelemetry({ ...bare, get: (name) => (name === 'subagents' ? { listDescendants: async () => [] } : undefined) }, exec, {}),
    /sessionQuery/,
  )
})

test('the schemas stay inside the runtime subset', () => {
  assert.deepEqual(violations(telemetryParameters), [])
  assert.deepEqual(violations(telemetryOutput), [])
})
