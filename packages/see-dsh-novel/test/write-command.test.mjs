import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { acquireWorkLock } from '../src/core/work-lock.ts'
import { COMMAND_WRITE, installWriteCommand, startChapter } from '../src/plugin/write-command.ts'
import { WORKFLOW_START_PATH } from '../src/core/workflow-start.ts'
import { WORK_FILE } from '../src/core/story-paths.ts'

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'see-dsh-novel-write-command-'))
  await writeFile(join(root, WORK_FILE), JSON.stringify({
    version: 1, id: 'w', title: '标题', profile: 'longform-novel', language: 'zh', status: 'draft',
    metadata: {}, createdAt: '2026-11-09T00:00:00.000Z', updatedAt: '2026-11-09T00:00:00.000Z',
  }))
  for (const path of [
    'source/story/outline/story_frame.md',
    'source/story/outline/volume_map.md',
    'source/story/book_rules.md',
    'source/story/book_rules.json',
    'source/story/current_state.md',
    'source/story/pending_hooks.md',
  ]) {
    await mkdir(join(root, path, '..'), { recursive: true })
    await writeFile(join(root, path), 'x\n')
  }
  await mkdir(join(root, 'source/story/state'), { recursive: true })
  await writeFile(join(root, 'source/story/state/current_state.json'), JSON.stringify({ chapter: 0 }))
  return root
}

test('the command confirms one workflow start and rejects a second one', async () => {
  const root = await workspace()
  try {
    const first = await startChapter(root)
    assert.equal(first.chapter, 1)
    assert.equal(JSON.parse(await readFile(join(root, WORKFLOW_START_PATH), 'utf8')).action, 'write_next')
    await assert.rejects(startChapter(root), /当前阶段/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the command reports BOOK_BUSY while another holder owns the lock', async () => {
  const root = await workspace()
  try {
    const release = await acquireWorkLock(root)
    try {
      await assert.rejects(startChapter(root), (error) => {
        assert.equal(error.code, 'BOOK_BUSY')
        return true
      })
    } finally {
      await release()
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('installWriteCommand registers one handler and follows up with a user message', async () => {
  const root = await workspace()
  try {
    const commands = new Map()
    installWriteCommand({
      commands: { register: (definition) => { commands.set(definition.name, definition); return () => commands.delete(definition.name) } },
      workingDirectory: { ensure: async () => root },
    })
    const messages = []
    const result = await commands.get(COMMAND_WRITE).handler({
      agent: { session: { snapshotEvents: () => [] }, followup: (message) => messages.push(message) },
      rawInput: '',
      signal: new AbortController().signal,
    })
    assert.equal(result.kind, 'success')
    assert.equal(messages.length, 1)
    assert.equal(messages[0].role, 'user')
    assert.deepEqual(messages[0].source, { kind: 'story-command', command: COMMAND_WRITE })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
