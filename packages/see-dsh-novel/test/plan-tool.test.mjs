import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { installPlanTool, PLAN_NAME } from '../src/pipelines/long/plan-tool.ts'
import { chapterPlanPath } from '../src/core/chapter-plan.ts'

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
const args = { chapter: 1, goal: '接案', body: '场景一。', threadRefs: [], plannerInputs: ['source/story/outline/story_frame.md'] }

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
