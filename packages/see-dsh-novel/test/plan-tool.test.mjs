import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { installPlanTool, PLAN_NAME } from '../src/pipelines/long/plan-tool.ts'
import { detectStage } from '../src/pipelines/long/stages/index.ts'
import { chapterPlanPath } from '../src/core/chapter-plan.ts'
import { writeWorkflowStart } from '../src/core/workflow-start.ts'

const foundation = [
  'source/story/outline/story_frame.md',
  'source/story/outline/volume_map.md',
  'source/story/book_rules.md',
  'source/story/current_state.md',
  'source/story/pending_hooks.md',
  'source/story/chapter_summaries.md',
]

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'see-dsh-novel-plan-tool-'))
  for (const file of foundation) {
    await mkdir(join(root, file, '..'), { recursive: true })
    await writeFile(join(root, file), '# x\n')
  }
  await mkdir(join(root, 'source/story/state'), { recursive: true })
  await writeFile(join(root, 'source/story/state/current_state.json'), JSON.stringify({ chapter: 0 }))
  await mkdir(join(root, 'source/story/runtime'), { recursive: true })
  await writeFile(join(root, 'source/story/runtime/chapter-0001.planner-context.json'), JSON.stringify({
    chapter: 1,
    selectedContext: [{ source: 'source/story/outline/story_frame.md', reason: 'planner', protection: 'protected' }],
  }))
  await writeWorkflowStart(root, { chapter: 1, instruction: '写第一章', instructionSource: 'system' })
  return root
}

function fakeContext(root) {
  const tools = new Map()
  const ctx = {
    tools: { register: (definition) => { tools.set(definition.name, definition); return () => tools.delete(definition.name) } },
    workingDirectory: { ensure: async () => root },
  }
  installPlanTool(ctx)
  return tools.get(PLAN_NAME)
}

const exec = { agent: { session: 's' } }
const args = { chapter: 1, goal: '接案', body: '场景一。', threadRefs: [] }

test('a missing plan is written once and reused afterwards', async () => {
  const root = await workspace()
  try {
    const tool = fakeContext(root)
    const first = await tool.execute(args, exec)
    assert.equal(first.reused, false)
    assert.match(await readFile(join(root, first.planPath), 'utf8'), /"chapter": 1/)
    const before = await readFile(join(root, chapterPlanPath(1)), 'utf8')
    const second = await tool.execute({ ...args, goal: '改了' }, exec)
    assert.equal(second.reused, true)
    assert.equal(second.plannerInputs[0], 'source/story/outline/story_frame.md')
    assert.equal(await readFile(join(root, chapterPlanPath(1)), 'utf8'), before, '已有 plan 不被覆盖')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('an author instruction re-plans and overwrites an existing plan', async () => {
  const root = await workspace()
  try {
    await writeFile(join(root, 'source/story/runtime/workflow-start.json'), JSON.stringify({
      version: 1, action: 'write_next', chapter: 1, instruction: '写得更冷', instructionSource: 'author', createdAt: '2026-11-14T00:00:00.000Z',
    }))
    const tool = fakeContext(root)
    const first = await tool.execute(args, exec)
    assert.equal(first.reused, false)
    const second = await tool.execute({ ...args, goal: '更冷' }, exec)
    assert.equal(second.reused, false)
    assert.match(await readFile(join(root, second.planPath), 'utf8'), /更冷/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})


