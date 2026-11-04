import test from 'node:test'
import assert from 'node:assert/strict'

/**
 * Consumer test for the browser half.
 *
 * The client module is a plain script that calls `window.__ModuleLoader__.load`
 * at import time, so the loader is stubbed before the dynamic import. `require`
 * is stubbed to return a minimal React: this checks the sentinel that scopes the
 * view to its preset, the three workspace states, the command dispatch and its
 * visible notice, not rendering fidelity.
 */

const SLOT = 'conversation.view'
const SENTINEL_SLOT = 'conversation.session.header.utilities'
const registered = []
let loaded

globalThis.window = {
  __ModuleLoader__: {
    load(declaration) {
      loaded = declaration
    },
  },
}

/** One state slot per hook call, reset for every render. */
let hookStates = []
let hookIndex = 0
let pendingEffects = []
let committedCleanups = []

const React = {
  createElement(type, props, ...children) {
    return { type, props, children }
  },
  useState(initial) {
    const index = hookIndex
    hookIndex += 1
    if (!(index in hookStates)) {
      hookStates[index] = typeof initial === 'function' ? initial() : initial
    }
    const set = (value) => {
      hookStates[index] = typeof value === 'function' ? value(hookStates[index]) : value
    }
    return [hookStates[index], set]
  },
  useEffect(callback) {
    pendingEffects.push(callback)
  },
}

const requireStub = (specifier) => {
  if (specifier === 'react') return React
  throw new Error(`unexpected client dependency: ${specifier}`)
}

await import('../src/plugin/client.ts')

/** Every registration for one slot, in registration order. */
const entriesOf = (slot) => registered.filter((entry) => entry.options.name === slot)

const stateOf = (sessionId, { cwd = 'E:\\work', preset = 'see-dsh-novel' } = {}) => ({
  byId: { [sessionId]: { cwd } },
  projectionsBySession: { [sessionId]: { values: { agentPreset: preset } } },
})

/** Apply the client plugin against a stub slot and session service. */
function mount({ sessionId = 'session-1', bound = true, matched = true } = {}) {
  registered.length = 0
  hookStates = []
  hookIndex = 0
  pendingEffects = []
  committedCleanups = []
  const commands = []
  const disposers = []
  const ctx = {
    slots: {
      inject(slot, register) {
        const dispose = register()
        if (typeof dispose === 'function') disposers.push(dispose)
      },
      register(options, component) {
        registered.push({ options, component })
        return () => {
          const at = registered.indexOf(registered.find((entry) => entry.options === options))
          if (at >= 0) registered.splice(at, 1)
        }
      },
    },
    sessions: {
      binding(id) {
        if (id !== sessionId) return undefined
        if (!bound) return undefined
        return {
          session: {
            command: async (line) => {
              commands.push(line)
              return { ok: true, value: { matched } }
            },
          },
        }
      },
    },
    effect(callback) {
      const dispose = callback()
      if (typeof dispose === 'function') disposers.push(dispose)
      return () => {}
    },
  }
  loaded.factory(requireStub).apply(ctx)

  /** Render the header sentinel: the only thing that decides view eligibility. */
  function showSession(preset) {
    const sentinel = entriesOf(SENTINEL_SLOT)[0]
    assert.ok(sentinel, 'the sentinel must be registered into the session header')
    const props = {
      sessionId,
      useSessions: (select) => select(stateOf(sessionId, { preset })),
      ...sentinel.options.inject(),
    }
    hookIndex = 0
    pendingEffects = []
    for (const cleanup of committedCleanups) cleanup()
    committedCleanups = []
    sentinel.component(props)
    for (const callback of pendingEffects) {
      const cleanup = callback()
      if (typeof cleanup === 'function') committedCleanups.push(cleanup)
    }
    pendingEffects = []
  }

  /** Render the 作品 view, which only exists while the sentinel reports eligible. */
  function renderView({ outline = 'live', manifest = 'failed', preset = 'see-dsh-novel' } = {}) {
    const view = entriesOf(SLOT)[0]
    assert.ok(view, 'the work view must be registered for this preset')
    const props = {
      sessionId,
      useSessions: (select) => select(stateOf(sessionId, { preset })),
      useResource: (address) => ({ status: address.endsWith('/story_frame.md') ? outline : manifest }),
      ...view.options.inject(),
    }
    hookIndex = 0
    return view.component(props)
  }

  return { commands, showSession, renderView, disposers }
}

/** All text children of a rendered tree. */
function texts(node, out = []) {
  if (node === null || node === undefined) return out
  if (typeof node === 'string') {
    out.push(node)
    return out
  }
  if (Array.isArray(node)) {
    for (const child of node) texts(child, out)
    return out
  }
  if (typeof node === 'object') texts(node.children, out)
  return out
}

/** Rendered buttons as { label, onClick }. */
function buttons(tree) {
  const out = []
  const walk = (node) => {
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const child of node) walk(child)
      return
    }
    if (node.type === 'button') out.push({ label: node.children[0], onClick: node.props.onClick })
    walk(node.children)
  }
  walk(tree)
  return out
}

const settle = () => new Promise((resolve) => { setImmediate(resolve) })

test('the client module declares the package id and its services', () => {
  assert.equal(loaded.id, 'see-dsh-novel')
  assert.equal(typeof loaded.factory, 'function')
  assert.deepEqual(loaded.factory(requireStub).inject, ['slots', 'sessions'])
})

test('the view stays unregistered until a session on this preset is shown', () => {
  const { showSession } = mount()
  assert.equal(entriesOf(SLOT).length, 0)
  showSession('standard')
  assert.equal(entriesOf(SLOT).length, 0)
  showSession('see-dsh-novel')
  const [entry] = entriesOf(SLOT)
  assert.equal(entry.options.id, 'see-dsh-novel')
  assert.equal(entry.options.label, '作品')
  assert.equal(entry.options.order, 20)
})

test('leaving a session on this preset removes the view again', () => {
  const { showSession } = mount()
  showSession('see-dsh-novel')
  assert.equal(entriesOf(SLOT).length, 1)
  showSession('standard')
  assert.equal(entriesOf(SLOT).length, 0)
})

test('a directory without either anchor file shows the unbound state', () => {
  const { showSession, renderView } = mount()
  showSession('see-dsh-novel')
  const shown = texts(renderView({ outline: 'failed' })).join('\n')
  assert.match(shown, /尚未绑定作品/)
  assert.match(shown, /E:\\work/)
  assert.deepEqual(buttons(renderView({ outline: 'failed' })), [])
})

test('either anchor file is enough to treat the workspace as a work', () => {
  const { showSession, renderView } = mount()
  showSession('see-dsh-novel')
  assert.equal(buttons(renderView({ outline: 'failed', manifest: 'live' })).length, 3)
})

test('an unavailable resource channel says so instead of claiming no work', () => {
  const { showSession, renderView } = mount()
  showSession('see-dsh-novel')
  const shown = texts(renderView({ outline: 'none', manifest: 'none' })).join('\n')
  assert.match(shown, /资源通道不可用/)
  assert.doesNotMatch(shown, /尚未绑定作品/)
})

test('a work opened under another preset never reaches this view', () => {
  const { showSession } = mount()
  showSession('standard')
  assert.equal(entriesOf(SLOT).length, 0)
})

test('a bound work under this preset offers the three commands', () => {
  const { showSession, renderView } = mount()
  showSession('see-dsh-novel')
  assert.deepEqual(buttons(renderView()).map((entry) => entry.label), ['查看待确认', '认可', '退回'])
})

test('submitting reports that the result lands in the conversation', async () => {
  const { showSession, renderView, commands } = mount()
  showSession('see-dsh-novel')
  buttons(renderView()).find((entry) => entry.label === '认可').onClick()

  // The click reports progress immediately, so the view never looks inert.
  assert.match(texts(renderView()).join('\n'), /正在执行「认可」/)

  await settle()
  assert.deepEqual(commands, ['/story-approve'])
  assert.match(texts(renderView()).join('\n'), /已提交「认可」，结果在「对话」里/)
})

test('each button dispatches its own command', async () => {
  const { showSession, renderView, commands } = mount()
  showSession('see-dsh-novel')
  for (const entry of buttons(renderView())) entry.onClick()
  await settle()
  assert.deepEqual(commands, ['/story-review', '/story-approve', '/story-reject'])
})

test('an unmatched command is reported instead of failing silently', async () => {
  const { showSession, renderView } = mount({ matched: false })
  showSession('see-dsh-novel')
  buttons(renderView()).find((entry) => entry.label === '认可').onClick()
  await settle()
  assert.match(texts(renderView()).join('\n'), /这个会话没有该命令/)
})

test('without a retained session the actions are withheld', () => {
  const { showSession, renderView } = mount({ bound: false })
  showSession('see-dsh-novel')
  const tree = renderView()
  assert.match(texts(tree).join('\n'), /还没有就绪/)
  assert.deepEqual(buttons(tree), [])
})

test('disposing the plugin removes every contribution', () => {
  const { showSession, disposers } = mount()
  showSession('see-dsh-novel')
  assert.equal(entriesOf(SLOT).length, 1)
  assert.equal(entriesOf(SENTINEL_SLOT).length, 1)
  for (const dispose of disposers) dispose()
  assert.equal(entriesOf(SLOT).length, 0)
  assert.equal(entriesOf(SENTINEL_SLOT).length, 0)
})
