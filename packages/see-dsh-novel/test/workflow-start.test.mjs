import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  authorInstruction,
  clearWorkflowStart,
  readWorkflowStart,
  workflowStarted,
  workflowStartedSync,
  writeWorkflowStart,
  WORKFLOW_START_PATH,
} from '../src/core/workflow-start.ts'

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'see-dsh-novel-workflow-'))
  await mkdir(join(root, 'source/story/runtime'), { recursive: true })
  return root
}

test('a workflow start is one record per chapter and can be cleared', async () => {
  const root = await workspace()
  try {
    const start = await writeWorkflowStart(root, { chapter: 1, instruction: '开始第一章' })
    assert.equal(start.action, 'write_next')
    assert.equal(start.chapter, 1)
    assert.equal(await workflowStarted(root, 1), true)
    assert.equal(workflowStartedSync(root, 1), true)
    assert.equal(await workflowStarted(root, 2), false)
    assert.deepEqual(await readWorkflowStart(root), start)
    await assert.rejects(writeWorkflowStart(root, { chapter: 2, instruction: '下一章' }), /还没有消费/)
    await clearWorkflowStart(root)
    assert.equal(await readWorkflowStart(root), null)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a malformed workflow start is rejected instead of treated as absent', async () => {
  const root = await workspace()
  try {
    await writeFile(join(root, WORKFLOW_START_PATH), JSON.stringify({ version: 1, action: 'write_next', chapter: 0 }), 'utf8')
    await assert.rejects(readWorkflowStart(root), /无效/)
    assert.equal(workflowStartedSync(root, 1), false)
    await writeFile(join(root, WORKFLOW_START_PATH), JSON.stringify({ version: 1, action: 'create_book', chapter: 1, instruction: 'x', createdAt: 'x' }), 'utf8')
    await assert.rejects(readWorkflowStart(root), /无效/)
    assert.match(await readFile(join(root, WORKFLOW_START_PATH), 'utf8'), /create_book/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('instructionSource validates and old records are system', async () => {
  const root = await workspace()
  try {
    await writeFile(join(root, WORKFLOW_START_PATH), JSON.stringify({
      version: 1, action: 'write_next', chapter: 1, instruction: '开始第 1 章', instructionSource: 'nope', createdAt: '2026-11-14T00:00:00.000Z',
    }))
    await assert.rejects(readWorkflowStart(root), /instructionSource/)
    await writeFile(join(root, WORKFLOW_START_PATH), JSON.stringify({
      version: 1, action: 'write_next', chapter: 1, instruction: '开始第 1 章', createdAt: '2026-11-14T00:00:00.000Z',
    }))
    const start = await readWorkflowStart(root)
    assert.equal(start.instructionSource, 'system')
    assert.equal(await authorInstruction(root, 1), null)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
