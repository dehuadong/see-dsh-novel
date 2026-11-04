import test from 'node:test'
import assert from 'node:assert/strict'

/**
 * Consumer test for the browser half.
 *
 * The client module is a plain script that calls `window.__ModuleLoader__.load`
 * at import time, so the loader is stubbed before the dynamic import. `require`
 * is stubbed to return a minimal React: this checks registration, the three
 * workspace states, and the command dispatch, not rendering fidelity.
 */

const SLOT = 'conversation.view'
const registered = []
let loaded

globalThis.window = {
  __ModuleLoader__: {
    load(declaration) {
      loaded = declaration
    },
  },
}

const React = {
  createElement(type, props, ...children) {
    return { type, props, children }
  },
}

const requireStub = (specifier) => {
  if (specifier === 'react') return React
  throw new Error(`unexpected client dependency: ${specifier}`)
}

await import('../src/plugin/client.ts')

/** Apply the client plugin against a stub slot and session service. */
function mount({ sessionId = 'session-1', cwd = 'E:\\work', preset = 'see-dsh-novel', outline = 'live', manifest = 'failed', bound = true } = {}) {
  registered.length = 0
  const commands = []
  const dismissed = []
  const injected = []
  const ctx = {
    slots: {
      inject(slot, register) {
        assert.equal(slot, SLOT)
        const dispose = register()
        if (typeof dispose === 'function') injected.push(dispose)
      },
      register(options, component) {
        registered.push({ options, component })
        return () => dismissed.push(options.id)
      },
    },
    sessions: {
      binding(id) {
        assert.equal(id, sessionId)
        if (!bound) return undefined
        return { session: { command: async (line) => { commands.push(line) } } }
      },
    },
  }
  loaded.factory(requireStub).apply(ctx)

  const state = {
    byId: { [sessionId]: { cwd } },
    projectionsBySession: { [sessionId]: { values: { agentPreset: preset } } },
  }
  const props = {
    sessionId,
    useSessions: (select) => select(state),
    useResource: (address) => ({ status: address.endsWith('/story_frame.md') ? outline : manifest }),
    ...registered[0].options.inject(),
  }
  return { props, commands, injected, dismissed }
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

test('the client module declares the package id and its services', () => {
  assert.equal(loaded.id, 'see-dsh-novel')
  assert.equal(typeof loaded.factory, 'function')
  assert.deepEqual(loaded.factory(requireStub).inject, ['slots', 'sessions'])
})

test('apply registers a 作品 view into conversation.view', () => {
  mount()
  assert.equal(registered.length, 1)
  const [{ options, component }] = registered
  assert.equal(options.name, SLOT)
  assert.equal(options.id, 'see-dsh-novel')
  assert.equal(options.label, '作品')
  assert.equal(typeof component, 'function')
})

test('a directory without either anchor file shows the unbound state', () => {
  const { props } = mount({ outline: 'failed', manifest: 'failed' })
  const shown = texts(registered[0].component(props)).join('\n')
  assert.match(shown, /尚未绑定作品/)
  assert.match(shown, /E:\\work/)
  assert.deepEqual(buttons(registered[0].component(props)), [])
})

test('either anchor file is enough to treat the workspace as a work', () => {
  const { props } = mount({ outline: 'failed', manifest: 'live' })
  assert.equal(buttons(registered[0].component(props)).length, 3)
})

test('an unavailable resource channel says so instead of claiming no work', () => {
  const { props } = mount({ outline: 'none', manifest: 'none' })
  const shown = texts(registered[0].component(props)).join('\n')
  assert.match(shown, /资源通道不可用/)
  assert.doesNotMatch(shown, /尚未绑定作品/)
})

test('a work opened under another preset is read-only', () => {
  const { props } = mount({ preset: 'standard' })
  const tree = registered[0].component(props)
  assert.match(texts(tree).join('\n'), /预设「standard」/)
  assert.deepEqual(buttons(tree), [])
})

test('a bound work under this preset offers the three commands', () => {
  const { props, commands } = mount()
  const tree = registered[0].component(props)
  const shown = buttons(tree)
  assert.deepEqual(shown.map((entry) => entry.label), ['查看待确认', '认可', '退回'])

  for (const entry of shown) entry.onClick()
  return Promise.resolve().then(() => {
    assert.deepEqual(commands, ['/story-review', '/story-approve', '/story-reject'])
  })
})

test('without a retained session the actions are withheld', () => {
  const { props } = mount({ bound: false })
  const tree = registered[0].component(props)
  assert.match(texts(tree).join('\n'), /还没有就绪/)
  assert.deepEqual(buttons(tree), [])
})

test('the view registration can be disposed', () => {
  const { injected, dismissed } = mount()
  assert.equal(injected.length, 1)
  injected[0]()
  assert.deepEqual(dismissed, ['see-dsh-novel'])
})
