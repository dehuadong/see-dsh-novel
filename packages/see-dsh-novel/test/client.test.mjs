import test from 'node:test'
import assert from 'node:assert/strict'

/**
 * Consumer test for the browser half.
 *
 * The client module is a plain script that calls `window.__ModuleLoader__.load`
 * at import time, so the loader is stubbed before the dynamic import. `require`
 * is stubbed to return a minimal React: this checks registration, the three
 * workspace states, the command dispatch and its visible notice, not rendering
 * fidelity.
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

/** One state slot per hook call, reset for every render. */
let hookStates = []
let hookIndex = 0

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
}

const requireStub = (specifier) => {
  if (specifier === 'react') return React
  throw new Error(`unexpected client dependency: ${specifier}`)
}

await import('../src/plugin/client.ts')

/** Apply the client plugin against a stub slot and session service. */
function mount({
  sessionId = 'session-1',
  cwd = 'E:\\work',
  preset = 'see-dsh-novel',
  outline = 'live',
  manifest = 'failed',
  bound = true,
  matched = true,
} = {}) {
  registered.length = 0
  hookStates = []
  hookIndex = 0
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

/** Render the registered view with a fresh hook cursor. */
function render(props) {
  hookIndex = 0
  return registered[0].component(props)
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
  const shown = texts(render(props)).join('\n')
  assert.match(shown, /尚未绑定作品/)
  assert.match(shown, /E:\\work/)
  assert.deepEqual(buttons(render(props)), [])
})

test('either anchor file is enough to treat the workspace as a work', () => {
  const { props } = mount({ outline: 'failed', manifest: 'live' })
  assert.equal(buttons(render(props)).length, 3)
})

test('an unavailable resource channel says so instead of claiming no work', () => {
  const { props } = mount({ outline: 'none', manifest: 'none' })
  const shown = texts(render(props)).join('\n')
  assert.match(shown, /资源通道不可用/)
  assert.doesNotMatch(shown, /尚未绑定作品/)
})

test('a work opened under another preset is read-only', () => {
  const { props } = mount({ preset: 'standard' })
  const tree = render(props)
  assert.match(texts(tree).join('\n'), /预设「standard」/)
  assert.deepEqual(buttons(tree), [])
})

test('a bound work under this preset offers the three commands', () => {
  const { props } = mount()
  assert.deepEqual(buttons(render(props)).map((entry) => entry.label), ['查看待确认', '认可', '退回'])
})

test('submitting reports that the result lands in the conversation', async () => {
  const { props, commands } = mount()
  const approve = buttons(render(props)).find((entry) => entry.label === '认可')
  approve.onClick()

  // The click reports progress immediately, so the view never looks inert.
  assert.match(texts(render(props)).join('\n'), /正在执行「认可」/)

  await settle()
  assert.deepEqual(commands, ['/story-approve'])
  assert.match(texts(render(props)).join('\n'), /已提交「认可」，结果在「对话」里/)
})

test('each button dispatches its own command', async () => {
  const { props, commands } = mount()
  for (const entry of buttons(render(props))) entry.onClick()
  await settle()
  assert.deepEqual(commands, ['/story-review', '/story-approve', '/story-reject'])
})

test('an unmatched command is reported instead of failing silently', async () => {
  const { props } = mount({ matched: false })
  buttons(render(props)).find((entry) => entry.label === '认可').onClick()
  await settle()
  assert.match(texts(render(props)).join('\n'), /这个会话没有该命令/)
})

test('a command that cannot reach a session reports it', async () => {
  const { props, commands } = mount()
  props.runCommand = async () => 'unbound'
  buttons(render(props)).find((entry) => entry.label === '认可').onClick()
  await settle()
  assert.match(texts(render(props)).join('\n'), /还没有就绪，命令没有执行/)
})

test('without a retained session the actions are withheld', () => {
  const { props } = mount({ bound: false })
  const tree = render(props)
  assert.match(texts(tree).join('\n'), /还没有就绪/)
  assert.deepEqual(buttons(tree), [])
})

test('the view registration can be disposed', () => {
  const { injected, dismissed } = mount()
  assert.equal(injected.length, 1)
  injected[0]()
  assert.deepEqual(dismissed, ['see-dsh-novel'])
})
