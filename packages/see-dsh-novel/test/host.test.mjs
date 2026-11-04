import test from 'node:test'
import assert from 'node:assert/strict'

import * as agentHalf from '../src/agent.js'
import * as surface from '../src/index.js'
import { PHASES, STORY_NEXT_NAME, storyNext, storyNextOutput, storyNextParameters } from '../src/story-next.js'

test('the root row mounts a no-op surface half', () => {
  assert.equal(surface.name, 'see-dsh-novel')
  assert.equal(typeof surface.apply, 'function')
  assert.equal(surface.apply(), undefined)
})

test('agent half declares loader metadata', () => {
  assert.equal(agentHalf.name, 'see-dsh-novel-agent')
  assert.deepEqual(agentHalf.inject, ['tools'])
  assert.equal(typeof agentHalf.apply, 'function')
})

const { apply } = agentHalf

test('storyNext reports the unbound phase', () => {
  assert.deepEqual(storyNext(), { work: null, phase: 'unbound', next: 'init' })
  assert.equal(PHASES.includes(storyNext().phase), true)
})

test('apply registers story_next and returns its disposer', () => {
  const registered = []
  const ctx = {
    tools: {
      register(definition) {
        registered.push(definition)
        return () => registered.splice(0, registered.length)
      },
    },
  }

  const dispose = apply(ctx)

  assert.equal(registered.length, 1)
  const [definition] = registered
  assert.equal(definition.name, STORY_NEXT_NAME)
  assert.deepEqual(definition.parameters, storyNextParameters)
  assert.deepEqual(definition.output.schema, storyNextOutput)
  assert.equal(typeof definition.output.render, 'function')
  assert.equal(typeof definition.execute, 'function')

  dispose()
  assert.equal(registered.length, 0)
})

test('story_next execute resolves the unbound contract', async () => {
  let definition
  apply({ tools: { register: (value) => (definition = value, () => {}) } })

  const result = await definition.execute({})
  assert.deepEqual(result, { work: null, phase: 'unbound', next: 'init' })

  // The runtime renders this as the tool card's content and calls `.some` on
  // it: it must be an array of lossless-JSON content blocks.
  const rendered = definition.output.render({}, result)
  assert.equal(Array.isArray(rendered), true)
  assert.equal(rendered.length > 0, true)
  assert.equal(rendered.every((block) => block.type === 'text' && typeof block.text === 'string'), true)
  assert.doesNotThrow(() => JSON.stringify(rendered))
})
