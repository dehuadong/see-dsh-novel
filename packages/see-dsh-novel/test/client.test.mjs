import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import { act, create } from 'react-test-renderer'

import { apply } from '../src/client/index.ts'
import { outcomeOf } from '../src/client/outcome.ts'
import { presetOf } from '../src/client/preset.ts'
import { StoryView } from '../src/client/StoryView.tsx'

/**
 * 浏览器半边的消费测试。
 *
 * 组件用 react-test-renderer 真实渲染（不装浏览器），注册逻辑用假 ctx 直接
 * 驱动 `apply`；样式安装需要 `document`，所以先补一个最小桩。
 */

const SLOT = 'conversation.view'
const SENTINEL_SLOT = 'conversation.session.header.utilities'
const SESSION = 'session-1'
const packageRoot = fileURLToPath(new URL('..', import.meta.url))

/** 最小 document 桩：样式元素只需要 createElement / head / remove。 */
function installDocumentStub() {
  const head = {
    children: [],
    appendChild(element) { this.children.push(element) },
  }
  globalThis.document = {
    head,
    createElement() {
      return {
        textContent: '',
        remove() {
          const index = head.children.indexOf(this)
          if (index >= 0) head.children.splice(index, 1)
        },
      }
    },
  }
  return head
}

/** 一个会话行 + 投影的假快照。 */
function sessionState(preset, cwd = '/work') {
  return {
    ids: [SESSION],
    byId: { [SESSION]: { sessionId: SESSION, cwd } },
    projectionsBySession: { [SESSION]: { values: preset === undefined ? {} : { agentPreset: preset } } },
  }
}

/** 渲染时给组件用的 useSessions 选择器钩子。 */
const selectorOf = (state) => (selector) => selector(state)

/** 假 ctx：只实现 apply 用到的四个面。 */
function fakeContext(binding) {
  const registrations = []
  const injected = new Map()
  const effects = []
  const ctx = {
    slots: {
      register(spec, component) {
        registrations.push({ spec, component })
        return () => {
          const index = registrations.findIndex((entry) => entry.spec === spec)
          if (index >= 0) registrations.splice(index, 1)
        }
      },
      inject(name, callback) {
        injected.set(name, callback)
        return () => { injected.delete(name) }
      },
    },
    sessions: { binding: (id) => (binding === undefined ? undefined : binding(id)) },
    effect(callback) {
      const dispose = callback()
      effects.push(dispose)
      return () => { dispose?.() }
    },
  }
  return { ctx, registrations, injected, effects }
}

/** 把树里的文本拼起来，用来断言作者看到的话。 */
function textOf(tree) {
  const chunks = []
  const visit = (node) => {
    if (node === null || node === undefined) return
    if (typeof node === 'string' || typeof node === 'number') {
      chunks.push(String(node))
      return
    }
    if (Array.isArray(node)) {
      for (const child of node) visit(child)
      return
    }
    visit(node.children)
  }
  visit(tree.toJSON())
  return chunks.join('')
}

/** 渲染一个元素并返回树。 */
async function render(element) {
  let tree
  await act(async () => {
    tree = create(element)
  })
  return tree
}

/** 按槽位名取注册项。 */
const entryFor = (registrations, slot) => registrations.find((entry) => entry.spec.name === slot)

test('apply installs styles, wires both slots, and registers the view only when eligible', async () => {
  const head = installDocumentStub()
  const { ctx, registrations, injected, effects } = fakeContext()
  apply(ctx)

  assert.equal(head.children.length, 1, '样式元素应挂到 document.head')
  assert.deepEqual([...injected.keys()].sort(), [SLOT, SENTINEL_SLOT].sort())
  assert.equal(entryFor(registrations, SLOT), undefined, '槽位未声明前不应注册')

  // 槽位声明：真实渲染器在槽位出现后才调用 inject 回调。
  const releaseSentinel = injected.get(SENTINEL_SLOT)()
  const releaseSlot = injected.get(SLOT)()
  assert.ok(entryFor(registrations, SENTINEL_SLOT), '哨兵应在槽位声明后注册')
  assert.equal(entryFor(registrations, SLOT), undefined, '还没有预设匹配时不注册视图')

  // 哨兵渲染（预设匹配）→ 上报 eligible → 视图注册。
  const sentinel = entryFor(registrations, SENTINEL_SLOT)
  const sentinelTree = await render(React.createElement(sentinel.component, {
    sessionId: SESSION,
    useSessions: selectorOf(sessionState('see-dsh-novel')),
    ...sentinel.spec.inject(),
  }))
  const view = entryFor(registrations, SLOT)
  assert.ok(view, '预设匹配且槽位已声明时应注册视图')
  assert.equal(view.spec.id, 'see-dsh-novel')
  assert.equal(view.spec.label, '作品')

  // 卸载哨兵 → 上报 false → 视图移除。
  await act(async () => { sentinelTree.unmount() })
  assert.equal(entryFor(registrations, SLOT), undefined)

  // 注销槽位与样式：清理函数把注册与样式都带走。
  releaseSlot()
  releaseSentinel()
  assert.equal(entryFor(registrations, SENTINEL_SLOT), undefined)
  for (const dispose of effects) dispose()
  assert.equal(head.children.length, 0)
})

test('the preset reader tolerates both projection channels', () => {
  assert.equal(presetOf(sessionState('see-dsh-novel'), SESSION), 'see-dsh-novel')
  const legacy = {
    ids: [SESSION],
    byId: { [SESSION]: { sessionId: SESSION, cwd: '/work', projectionValues: { agentPreset: 'legacy' } } },
    projectionsBySession: {},
  }
  assert.equal(presetOf(legacy, SESSION), 'legacy')
  assert.equal(presetOf(sessionState(undefined), SESSION), undefined)
})

/** 直接渲染 StoryView，绕过条件注册：组件行为单独测。 */
async function renderView({ state = sessionState('see-dsh-novel'), statuses = ['live', 'live'], canCommand = true, outcome = 'ok', runCommand } = {}) {
  const calls = []
  const props = {
    sessionId: SESSION,
    useSessions: selectorOf(state),
    useResource: (address) => ({
      status: address.includes('story_frame') ? statuses[0] : statuses[1],
      value: undefined,
      failure: undefined,
    }),
    canCommand: () => canCommand,
    runCommand: async (sessionId, line) => {
      calls.push({ sessionId, line })
      return runCommand === undefined ? outcome : runCommand
    },
  }
  const tree = await render(React.createElement(StoryView, props))
  return { tree, calls }
}

test('the view shows the gate and dispatches the three commands', async () => {
  installDocumentStub()
  const { tree, calls } = await renderView()
  const buttons = tree.root.findAllByType('button')
  assert.deepEqual(buttons.map((node) => node.children.join('')), ['查看待确认', '认可', '退回'])

  await act(async () => { buttons[1].props.onClick() })
  assert.deepEqual(calls, [{ sessionId: SESSION, line: '/story-approve' }])
  assert.match(textOf(tree), /已提交「认可」，结果在「对话」里/)
})

test('the view reports failure and unmatched results in words', async () => {
  installDocumentStub()
  const failed = await renderView({ outcome: 'error' })
  await act(async () => { failed.tree.root.findAllByType('button')[0].props.onClick() })
  assert.match(textOf(failed.tree), /提交失败，稍后再试/)

  const unmatched = await renderView({ outcome: 'unmatched' })
  await act(async () => { unmatched.tree.root.findAllByType('button')[0].props.onClick() })
  assert.match(textOf(unmatched.tree), /这个会话没有该命令/)
})

test('the view degrades without workspace state, preset, or a session binding', async () => {
  installDocumentStub()
  const unreadable = await renderView({ statuses: ['none', 'none'] })
  assert.match(textOf(unreadable.tree), /读不到工作区状态/)

  const loading = await renderView({ statuses: ['loading', 'loading'] })
  assert.match(textOf(loading.tree), /正在读取工作区/)

  const empty = await renderView({ statuses: ['failed', 'failed'] })
  assert.match(textOf(empty.tree), /尚未绑定作品/)
  assert.match(textOf(empty.tree), /当前工作区：\/work/)

  const waitPreset = await renderView({ state: sessionState(undefined) })
  assert.match(textOf(waitPreset.tree), /正在读取会话预设/)

  const other = await renderView({ state: sessionState('standard') })
  assert.match(textOf(other.tree), /预设「standard」/)

  const unbound = await renderView({ canCommand: false })
  assert.match(textOf(unbound.tree), /暂时不能提交确认/)
  assert.equal(unbound.tree.root.findAllByType('button').length, 0)
})

test('command outcomes map to the four visible states', async () => {
  assert.equal(outcomeOf({ ok: true, value: { matched: true } }), 'ok')
  assert.equal(outcomeOf({ ok: true, value: { matched: false } }), 'unmatched')
  assert.equal(outcomeOf({ ok: false }), 'error')
  assert.equal(outcomeOf(undefined), 'error')

  // 没有会话绑定时，注入面直接给出 unbound，不调用命令。
  installDocumentStub()
  const { ctx, registrations, injected } = fakeContext()
  apply(ctx)
  const releaseSentinel = injected.get(SENTINEL_SLOT)()
  const releaseSlot = injected.get(SLOT)()
  const sentinel = entryFor(registrations, SENTINEL_SLOT)
  const sentinelTree = await render(React.createElement(sentinel.component, {
    sessionId: SESSION,
    useSessions: selectorOf(sessionState('see-dsh-novel')),
    ...sentinel.spec.inject(),
  }))
  const view = entryFor(registrations, SLOT)
  const injectedFace = view.spec.inject()
  assert.equal(await injectedFace.runCommand(SESSION, '/story-approve'), 'unbound')
  assert.equal(injectedFace.canCommand(SESSION), false)

  await act(async () => { sentinelTree.unmount() })
  releaseSlot()
  releaseSentinel()
})

test('the unbound notice is visible to the author', async () => {
  installDocumentStub()
  const { tree } = await renderView({ outcome: 'unbound' })
  await act(async () => { tree.root.findAllByType('button')[0].props.onClick() })
  assert.match(textOf(tree), /当前会话还没有就绪，命令没有执行/)
})

test('the built client artifact keeps the module-loader handoff', () => {
  const source = readFileSync(join(packageRoot, 'lib', 'client.js'), 'utf8')
  assert.equal(/require\(["']\.\//.test(source), false, '产物里不应有相对 require')

  // 产物里的函数在 vm 上下文中解析全局，document 要一并给进去。
  const head = installDocumentStub()
  const loaded = []
  const sandbox = {
    window: { __ModuleLoader__: { load: (declaration) => { loaded.push(declaration) } } },
    document: globalThis.document,
  }
  vm.runInNewContext(source, sandbox)
  assert.equal(loaded.length, 1)
  assert.equal(loaded[0].id, 'see-dsh-novel')
  assert.equal(typeof loaded[0].factory, 'function')

  const plugin = loaded[0].factory((name) => {
    if (name === 'react') return React
    if (name === 'react/jsx-runtime') return jsxRuntime
    throw new Error(`unexpected client dependency: ${name}`)
  })
  assert.deepEqual([...plugin.inject], ['slots', 'sessions'])
  assert.equal(typeof plugin.apply, 'function')

  // 产物的 apply 也要真的能跑：装样式、声明两个槽位。
  const { ctx, injected } = fakeContext()
  plugin.apply(ctx)
  assert.equal(head.children.length, 1)
  assert.deepEqual([...injected.keys()].sort(), [SLOT, SENTINEL_SLOT].sort())
})
