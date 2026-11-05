import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import { act, create } from 'react-test-renderer'

import { apply, RESUME_TEXT } from '../src/client/index.ts'
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

/** 两个都属于本预设的会话：测面板实例在会话之间复用时的行为。 */
function twoSessionState(other) {
  return {
    ids: [SESSION, other],
    byId: {
      [SESSION]: { sessionId: SESSION, cwd: '/work' },
      [other]: { sessionId: other, cwd: '/work' },
    },
    projectionsBySession: {
      [SESSION]: { values: { agentPreset: 'see-dsh-novel' } },
      [other]: { values: { agentPreset: 'see-dsh-novel' } },
    },
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

/**
 * 把视图挂到「预设匹配 + 槽位已声明」的状态，返回它的注入面。
 * @param binding 会话绑定工厂；省略表示没有绑定
 */
async function mountEligible(binding) {
  const { ctx, registrations, injected } = fakeContext(binding)
  apply(ctx)
  const releaseSentinel = injected.get(SENTINEL_SLOT)()
  const releaseSlot = injected.get(SLOT)()
  const sentinel = entryFor(registrations, SENTINEL_SLOT)
  const tree = await render(React.createElement(sentinel.component, {
    sessionId: SESSION,
    useSessions: selectorOf(sessionState('see-dsh-novel')),
    ...sentinel.spec.inject(),
  }))
  return {
    face: entryFor(registrations, SLOT).spec.inject(),
    async dispose() {
      await act(async () => { tree.unmount() })
      releaseSlot()
      releaseSentinel()
    },
  }
}

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

  // 宿主把「还没决定预设」投影成 null：应当落到保留行，而不是把 null 当成预设名。
  const pending = {
    ids: [SESSION],
    byId: { [SESSION]: { sessionId: SESSION, cwd: '/work', projectionValues: { agentPreset: 'legacy' } } },
    projectionsBySession: { [SESSION]: { values: { agentPreset: null } } },
  }
  assert.equal(presetOf(pending, SESSION), 'legacy')
  const nothing = {
    ids: [SESSION],
    byId: { [SESSION]: { sessionId: SESSION, cwd: '/work' } },
    projectionsBySession: { [SESSION]: { values: { agentPreset: null } } },
  }
  assert.equal(presetOf(nothing, SESSION), undefined)
})

/** 直接渲染 StoryView，绕过条件注册：组件行为单独测。 */
async function renderView({
  state = sessionState('see-dsh-novel'),
  statuses = ['live', 'live', 'live'],
  canCommand = true,
  outcome = 'ok',
  runCommand,
  resumeOutcome = 'ok',
  resume,
  sessionId = SESSION,
} = {}) {
  const calls = []
  const resumes = []
  const props = {
    sessionId,
    useSessions: selectorOf(state),
    useResource: (address) => ({
      // 顺序与组件里的三个探针一致：大纲、状态清单、身份文件。
      status: address.endsWith('/work.json')
        ? statuses[2]
        : address.includes('story_frame') ? statuses[0] : statuses[1],
      value: undefined,
      failure: undefined,
    }),
    canCommand: () => canCommand,
    runCommand: async (id, line) => {
      calls.push({ sessionId: id, line })
      return runCommand === undefined ? outcome : runCommand()
    },
    resume: async (id) => {
      resumes.push(id)
      return resume === undefined ? resumeOutcome : resume()
    },
  }
  const tree = await render(React.createElement(StoryView, props))
  return { tree, props, calls, resumes }
}

test('the view shows the gate and dispatches the three commands', async () => {
  installDocumentStub()
  const { tree, calls, resumes } = await renderView()
  const buttons = tree.root.findAllByType('button')
  assert.deepEqual(buttons.map((node) => node.children.join('')), ['查看待确认', '认可', '退回'])

  // 认可：先写回执，再把「继续」投回会话。
  await act(async () => { buttons[1].props.onClick() })
  assert.deepEqual(calls, [{ sessionId: SESSION, line: '/story-approve' }])
  assert.deepEqual(resumes, [SESSION])
  assert.match(textOf(tree), /已确认，正在继续…/)
  assert.equal(tree.root.findAllByType('button').length, 0, '认可成功后按钮应消失')
})

test('a failed resume says the confirmation stands but the session did not continue', async () => {
  installDocumentStub()
  const { tree, resumes } = await renderView({ resumeOutcome: 'failed' })
  await act(async () => { tree.root.findAllByType('button')[1].props.onClick() })
  assert.deepEqual(resumes, [SESSION])
  assert.match(textOf(tree), /已确认；会话没能自动继续/)
  assert.equal(tree.root.findAllByType('button').length, 0)
})

test('reject and review never wake the session', async () => {
  installDocumentStub()
  const reject = await renderView()
  await act(async () => { reject.tree.root.findAllByType('button')[2].props.onClick() })
  assert.deepEqual(reject.calls, [{ sessionId: SESSION, line: '/story-reject' }])
  assert.deepEqual(reject.resumes, [])
  assert.match(textOf(reject.tree), /已退回；这一版不会签核，等意见后重写再确认/)
  assert.equal(reject.tree.root.findAllByType('button').length, 3, '退回后按钮仍在')

  const review = await renderView()
  await act(async () => { review.tree.root.findAllByType('button')[0].props.onClick() })
  assert.deepEqual(review.calls, [{ sessionId: SESSION, line: '/story-review' }])
  assert.deepEqual(review.resumes, [])
  assert.match(textOf(review.tree), /已提交，结果在「对话」里/)
})

test('a failed command does not wake the session and keeps the buttons', async () => {
  installDocumentStub()
  const { tree, resumes } = await renderView({ outcome: 'error' })
  await act(async () => { tree.root.findAllByType('button')[1].props.onClick() })
  assert.deepEqual(resumes, [])
  assert.match(textOf(tree), /提交失败，稍后再试/)
  assert.equal(tree.root.findAllByType('button').length, 3)
})

test('a throwing command is reported instead of leaving the panel stuck', async () => {
  installDocumentStub()
  const { tree, resumes } = await renderView({
    runCommand: () => { throw new Error('rpc down') },
  })
  await act(async () => { tree.root.findAllByType('button')[1].props.onClick() })
  assert.deepEqual(resumes, [])
  assert.match(textOf(tree), /提交失败，稍后再试/)
  assert.equal(tree.root.findAllByType('button').length, 3, '失败后按钮应恢复可用')
})

test('a resume that rejects is reported as a failed continuation, not a failed confirmation', async () => {
  installDocumentStub()
  const { tree, resumes } = await renderView({ resume: () => { throw new Error('rpc down') } })
  await act(async () => { tree.root.findAllByType('button')[1].props.onClick() })
  assert.deepEqual(resumes, [SESSION])
  assert.match(textOf(tree), /已确认；会话没能自动继续/)
  assert.doesNotMatch(textOf(tree), /提交失败/)
  assert.equal(tree.root.findAllByType('button').length, 0)
})

test('a stale submission does not paint the previous session state', async () => {
  installDocumentStub()
  const other = 'session-2'
  let release
  const pending = new Promise((resolve) => { release = resolve })
  const { tree, props } = await renderView({ state: twoSessionState(other), runCommand: () => pending })
  await act(async () => { tree.root.findAllByType('button')[1].props.onClick() })

  // 切换会话，然后旧请求才完成：结果必须被丢弃。
  await act(async () => { tree.update(React.createElement(StoryView, { ...props, sessionId: other })) })
  await act(async () => { release('ok') })

  assert.doesNotMatch(textOf(tree), /已确认/)
  assert.equal(tree.root.findAllByType('button').length, 3, '新会话的按钮应可用')
})

test('switching sessions resets the panel state', async () => {
  installDocumentStub()
  const other = 'session-2'
  const { tree, props } = await renderView({ state: twoSessionState(other) })
  await act(async () => { tree.root.findAllByType('button')[1].props.onClick() })
  assert.match(textOf(tree), /已确认，正在继续…/)

  await act(async () => {
    tree.update(React.createElement(StoryView, { ...props, sessionId: other }))
  })
  assert.doesNotMatch(textOf(tree), /已确认，正在继续…/)
  assert.equal(tree.root.findAllByType('button').length, 3, '换会话后按钮应回来')
})

test('a double click dispatches one command and one resume', async () => {
  installDocumentStub()
  const { tree, calls, resumes } = await renderView()
  const button = tree.root.findAllByType('button')[1]
  await act(async () => {
    button.props.onClick()
    button.props.onClick()
  })
  assert.equal(calls.length, 1)
  assert.equal(resumes.length, 1)
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
  const unreadable = await renderView({ statuses: ['none', 'none', 'none'] })
  assert.match(textOf(unreadable.tree), /读不到工作区状态/)

  const loading = await renderView({ statuses: ['loading', 'loading', 'loading'] })
  assert.match(textOf(loading.tree), /正在读取工作区/)

  const empty = await renderView({ statuses: ['failed', 'failed', 'failed'] })
  assert.match(textOf(empty.tree), /尚未立项/)
  assert.match(textOf(empty.tree), /当前工作区：\/work/)

  const waitPreset = await renderView({ state: sessionState(undefined) })
  assert.match(textOf(waitPreset.tree), /正在读取会话预设/)

  const other = await renderView({ state: sessionState('standard') })
  assert.match(textOf(other.tree), /预设「standard」/)

  const unbound = await renderView({ canCommand: false })
  assert.match(textOf(unbound.tree), /暂时不能提交确认/)
  assert.equal(unbound.tree.root.findAllByType('button').length, 0)
})

test('the identity file decides between 未立项 and 已立项 without touching the gate', async () => {
  installDocumentStub()

  // 已立项、还没有基础设定：两个锚点都缺，身份在。
  const created = await renderView({ statuses: ['failed', 'failed', 'live'] })
  assert.match(textOf(created.tree), /已立项，还没有基础设定/)
  assert.doesNotMatch(textOf(created.tree), /尚未立项/)

  // 有基础设定、身份缺：闸门照旧，只加一行提示。
  const missing = await renderView({ statuses: ['live', 'live', 'failed'] })
  assert.match(textOf(missing.tree), /身份文件缺失/)
  assert.match(textOf(missing.tree), /作者确认闸门/)
  assert.equal(missing.tree.root.findAllByType('button').length, 3)

  // 身份与设定都在：闸门 + 按钮，没有提示。
  const complete = await renderView()
  assert.doesNotMatch(textOf(complete.tree), /身份文件缺失/)
  assert.equal(complete.tree.root.findAllByType('button').length, 3)
})

test('command outcomes map to the four visible states', async () => {
  assert.equal(outcomeOf({ ok: true, value: { matched: true } }), 'ok')
  assert.equal(outcomeOf({ ok: true, value: { matched: false } }), 'unmatched')
  assert.equal(outcomeOf({ ok: false }), 'error')
  assert.equal(outcomeOf(undefined), 'error')

  // 没有会话绑定时，注入面直接给出 unbound，不调用命令。
  installDocumentStub()
  const { face, dispose } = await mountEligible()
  assert.equal(await face.runCommand(SESSION, '/story-approve'), 'unbound')
  assert.equal(face.canCommand(SESSION), false)
  await dispose()
})

test('the unbound notice is visible to the author', async () => {
  installDocumentStub()
  const { tree } = await renderView({ outcome: 'unbound' })
  await act(async () => { tree.root.findAllByType('button')[0].props.onClick() })
  assert.match(textOf(tree), /当前会话还没有就绪，命令没有执行/)
})

test('the resume inject face sends one queue-mode continuation prompt', async () => {
  installDocumentStub()
  const prompts = []
  const binding = {
    session: {
      prompt: async (content, mode) => {
        prompts.push({ content, mode })
        return { ok: true, value: { accepted: true } }
      },
    },
  }
  const { face, dispose } = await mountEligible(() => binding)
  assert.deepEqual(await face.resume(SESSION), 'ok')
  assert.equal(prompts.length, 1)
  assert.equal(prompts[0].mode, 'queue')
  assert.deepEqual(prompts[0].content, [{ type: 'text', text: RESUME_TEXT }])
  assert.match(RESUME_TEXT, /story_gate/)
  assert.match(RESUME_TEXT, /story_foundation_signoff/)
  assert.match(RESUME_TEXT, /不要再次请作者确认/)
  assert.doesNotMatch(RESUME_TEXT, /[0-9a-f]{64}/, '消息里不应带摘要')
  await dispose()
})

test('resume reports failure for a rejected prompt or a missing binding', async () => {
  installDocumentStub()
  const failing = { session: { prompt: async () => ({ ok: false }) } }
  const first = await mountEligible(() => failing)
  assert.equal(await first.face.resume(SESSION), 'failed')
  await first.dispose()

  // 没有会话绑定：直接失败，不调用 prompt。
  const second = await mountEligible()
  assert.equal(await second.face.resume(SESSION), 'failed')
  await second.dispose()
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

