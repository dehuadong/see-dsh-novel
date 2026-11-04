import test from 'node:test'
import assert from 'node:assert/strict'

import * as agentHalf from '../src/plugin/agent.ts'
import * as surface from '../src/plugin/index.ts'
import { PHASES, STORY_NEXT_NAME, storyNext, storyNextOutput, storyNextParameters } from '../src/plugin/story-next.ts'

/** Minimal service stubs: the agent half needs the tool, command, skill and prompt registries plus the Session directory. */
function services() {
  const registered = new Map()
  const commands = new Map()
  const contexts = []
  const skills = []
  return {
    registered,
    commands,
    contexts,
    skills,
    ctx: {
      tools: {
        register(definition) {
          registered.set(definition.name, definition)
          return () => registered.delete(definition.name)
        },
      },
      workingDirectory: { ensure: async () => process.cwd(), get: () => process.cwd() },
      commands: {
        register(definition) {
          commands.set(definition.name, definition)
          return () => commands.delete(definition.name)
        },
      },
      skills: {
        register(skill) {
          skills.push(skill)
          return () => {
            const index = skills.indexOf(skill)
            if (index >= 0) skills.splice(index, 1)
          }
        },
      },
      systemPrompt: {
        context(contribution) {
          contexts.push(contribution)
          return () => contexts.splice(contexts.indexOf(contribution), 1)
        },
      },
      get: () => undefined,
    },
  }
}

test('the root row mounts a no-op surface half', () => {
  assert.equal(surface.name, 'see-dsh-novel')
  assert.equal(typeof surface.apply, 'function')
  assert.equal(surface.apply(), undefined)
})

test('agent half declares loader metadata', () => {
  assert.equal(agentHalf.name, 'see-dsh-novel-agent')
  assert.deepEqual(agentHalf.inject, ['tools', 'workingDirectory', 'commands', 'skills', 'systemPrompt'])
  assert.equal(typeof agentHalf.apply, 'function')
})

test('storyNext reports the unbound phase', () => {
  assert.deepEqual(storyNext(), { work: null, phase: 'unbound', next: 'init' })
  assert.equal(PHASES.includes(storyNext().phase), true)
})

test('apply registers story_next, the foundation and gate tools, the approval commands, the cast context and the bundled skills', () => {
  const { registered, commands, contexts, skills, ctx } = services()

  const dispose = agentHalf.apply(ctx)

  assert.deepEqual([...registered.keys()].sort(), [
    'story_foundation_cast_documents',
    'story_foundation_cast_index',
    'story_foundation_details',
    'story_foundation_outline',
    'story_foundation_signoff',
    'story_gate',
    'story_hooks',
    STORY_NEXT_NAME,
  ])
  assert.deepEqual([...commands.keys()].sort(), ['story-approve', 'story-reject', 'story-review'])
  assert.deepEqual(contexts.map((contribution) => contribution.name), ['story:cast'])
  assert.deepEqual(skills.map((skill) => skill.name), ['longform-writing'])

  const definition = registered.get(STORY_NEXT_NAME)
  assert.deepEqual(definition.parameters, storyNextParameters)
  assert.deepEqual(definition.output.schema, storyNextOutput)
  assert.equal(typeof definition.output.render, 'function')
  assert.equal(typeof definition.execute, 'function')

  dispose()
  assert.equal(registered.size, 0)
  assert.equal(commands.size, 0)
  assert.equal(contexts.length, 0)
  assert.equal(skills.length, 0)
})

test('story_next execute resolves the unbound contract', async () => {
  const { registered, ctx } = services()
  agentHalf.apply(ctx)
  const definition = registered.get(STORY_NEXT_NAME)

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
