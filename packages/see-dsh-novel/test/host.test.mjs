import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import * as agentHalf from '../src/plugin/agent.ts'
import * as surface from '../src/plugin/index.ts'
import { PHASES, STORY_NEXT_NAME, storyNext, storyNextOutput, storyNextParameters } from '../src/plugin/story-next.ts'
import { writeWork } from '../src/core/work.ts'

/** Minimal service stubs: the agent half needs the tool, command, skill and prompt registries plus the Session directory. */
function services(root = process.cwd()) {
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
      workingDirectory: { ensure: async () => root, get: () => root },
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

/** A fresh workspace for the probe-driven story_next. */
async function workspace() {
  return mkdtemp(join(tmpdir(), 'see-dsh-novel-host-'))
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

test('storyNext reports the unbound phase and the four-phase ladder', () => {
  assert.deepEqual(storyNext({
    hasWork: false, hasFrame: false, hasVolumeMap: false, hasRulesMd: false, hasRulesJson: false, hasPendingHooks: false, hasRoleCard: false,
    title: null,
  }), {
    work: null,
    phase: 'unbound',
    next: 'story_work_create',
  })
  assert.deepEqual([...PHASES], ['unbound', 'foundation', 'draft', 'ready'])
})

test('apply registers the work, story_next, foundation and gate tools, the approval commands, the cast context and the bundled skills', () => {
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
    'story_propose',
    'story_recover',
    'story_search',
    'story_telemetry',
    'story_truth_file',
    'story_work_create',
    'story_work_show',
  ])
  assert.deepEqual([...commands.keys()].sort(), ['story-approve', 'story-init', 'story-reject', 'story-review'])
  assert.deepEqual(contexts.map((contribution) => contribution.name), ['story:cast'])
  assert.deepEqual(skills.map((skill) => skill.name), ['longform-writing', 'story-proposal'])
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

test('story_next execute reads the workspace instead of guessing', async () => {
  const root = await workspace()
  try {
    const { registered, ctx } = services(root)
    agentHalf.apply(ctx)
    const definition = registered.get(STORY_NEXT_NAME)

    const unbound = await definition.execute({}, { agent: { session: { snapshotEvents: () => [] } } })
    assert.deepEqual(unbound, { work: null, phase: 'unbound', next: 'story_work_create' })

    // 有身份、没大纲：foundation，标题取自 work.json。
    const work = await writeWork(root, { title: '真机作品' })
    const foundation = await definition.execute({}, { agent: { session: { snapshotEvents: () => [] } } })
    assert.deepEqual(foundation, { work: '真机作品', phase: 'foundation', next: 'story_foundation_outline' })
    assert.equal(work.title, '真机作品')

    // 两份大纲就位、规则缺：draft + details。
    await mkdir(join(root, 'source/story/outline'), { recursive: true })
    await writeFile(join(root, 'source/story/outline/story_frame.md'), '# 大纲\n', 'utf8')
    await writeFile(join(root, 'source/story/outline/volume_map.md'), '# 卷图\n', 'utf8')
    const draftPhase = await definition.execute({}, { agent: { session: { snapshotEvents: () => [] } } })
    assert.deepEqual(draftPhase, { work: '真机作品', phase: 'draft', next: 'story_foundation_details' })

    // 规则与伏笔池齐、只剩角色卡：draft + cast_index。
    await writeFile(join(root, 'source/story/book_rules.md'), '# 规则\n', 'utf8')
    await writeFile(join(root, 'source/story/book_rules.json'), '{}\n', 'utf8')
    await writeFile(join(root, 'source/story/pending_hooks.md'), '# 伏笔池\n', 'utf8')
    const castPhase = await definition.execute({}, { agent: { session: { snapshotEvents: () => [] } } })
    assert.deepEqual(castPhase, { work: '真机作品', phase: 'draft', next: 'story_foundation_cast_index' })

    // 角色卡也到位：ready。
    await mkdir(join(root, 'source/story/roles/主要角色'), { recursive: true })
    await writeFile(join(root, 'source/story/roles/主要角色/甲.md'), '# 甲\n', 'utf8')
    const ready = await definition.execute({}, { agent: { session: { snapshotEvents: () => [] } } })
    assert.deepEqual(ready, { work: '真机作品', phase: 'ready', next: 'story_gate' })

    // The runtime renders this as the tool card's content and calls `.some` on
    // it: it must be an array of lossless-JSON content blocks.
    const rendered = definition.output.render({}, ready)
    assert.equal(Array.isArray(rendered), true)
    assert.equal(rendered.length > 0, true)
    assert.equal(rendered.every((block) => block.type === 'text' && typeof block.text === 'string'), true)
    assert.equal(rendered[0].text.includes('真机作品'), true)
    assert.doesNotThrow(() => JSON.stringify(rendered))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
