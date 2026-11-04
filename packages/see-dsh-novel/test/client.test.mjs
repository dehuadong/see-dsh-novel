import test from 'node:test'
import assert from 'node:assert/strict'

/**
 * Consumer test for the browser half.
 *
 * The client module is a plain script that calls `window.__ModuleLoader__.load`
 * at import time, so the loader is stubbed before the dynamic import. `require`
 * is stubbed to return a minimal React: this checks registration and disposal,
 * not rendering fidelity.
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

await import('../src/client.js')

/** Apply the client plugin against a stub slot service. */
function mount() {
  const plugin = loaded.factory(requireStub)
  const disposed = []
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
        return () => disposed.push(options.id)
      },
    },
  }
  plugin.apply(ctx)
  return { plugin, injected, disposed }
}

test('the client module declares the package id', () => {
  assert.equal(loaded.id, 'see-dsh-novel')
  assert.equal(typeof loaded.factory, 'function')
})

test('apply registers a 作品 view into conversation.view', () => {
  registered.length = 0
  const { plugin } = mount()

  assert.deepEqual(plugin.inject, ['slots'])
  assert.equal(registered.length, 1)
  const [{ options, component }] = registered
  assert.equal(options.name, SLOT)
  assert.equal(options.id, 'see-dsh-novel')
  assert.equal(options.label, '作品')
  assert.equal(typeof component, 'function')
})

test('the registered view renders a skeleton without fetching', () => {
  registered.length = 0
  mount()

  const tree = registered[0].component()
  assert.equal(tree.type, 'section')
  assert.deepEqual(tree.children.map((child) => child.type), ['h2', 'p'])
  assert.deepEqual(tree.children[0].children, ['作品'])
})

test('the view registration can be disposed', () => {
  registered.length = 0
  const { injected, disposed } = mount()

  assert.equal(injected.length, 1)
  injected[0]()
  assert.deepEqual(disposed, ['see-dsh-novel'])
})
