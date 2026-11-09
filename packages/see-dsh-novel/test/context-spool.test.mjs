import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  compressionManifestPath,
  loadCompressionChunk,
  loadSelectionSpool,
  loadSelectionTask,
  saveCompressionSpool,
  saveSelectionSpool,
  selectionManifestPath,
  selectionTaskPath,
} from '../src/core/context-spool.ts'

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'see-dsh-novel-spool-'))
  await mkdir(join(root, 'source/story/runtime'), { recursive: true })
  return root
}

test('selection spool writes a manifest and reads one task at a time', async () => {
  const root = await workspace()
  try {
    const handles = await saveSelectionSpool(root, 1, 'writer', [{
      kind: 'memory',
      instruction: 'select memory',
      candidates: [{
        id: 'memory:x', selectionId: 'memory:x', kind: 'memory', source: 'source/story/pending_hooks.md#H1',
        title: 'H1', excerpt: '正文', score: 1,
      }],
    }])
    assert.equal(handles.length, 1)
    assert.equal(handles[0].candidateCount, 1)
    assert.match(selectionManifestPath(1, 'writer'), /chapter-0001\.writer\.tasks\.json$/)
    assert.match(selectionTaskPath(1, 'writer', 'task-1'), /chapter-0001\.writer\.task-1\.json$/)
    const loaded = await loadSelectionTask(root, 1, 'writer', 'task-1')
    assert.equal(loaded.candidates[0].selectionId, 'memory:x')
    const spool = await loadSelectionSpool(root, 1, 'writer')
    assert.equal(spool.manifest.tasks[0].taskId, 'task-1')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('compression spool writes chunk files and reads them by handle', async () => {
  const root = await workspace()
  try {
    const summary = await saveCompressionSpool(root, 1, 'writer', {
      chapter: 1,
      goal: '任务',
      language: 'zh',
      maxInputTokens: 100,
      protectedSources: ['fixed'],
      compressibleEntries: [{ source: 'memory:x', reason: 'r', excerpt: '正文', protection: 'compressible' }],
      chunks: [{ instruction: '压缩这一段', fragments: [], maxTokens: 100 }],
    })
    assert.equal(summary.chunks.length, 1)
    assert.match(compressionManifestPath(1, 'writer'), /chapter-0001\.writer\.compress\.json$/)
    const chunk = await loadCompressionChunk(root, 1, 'writer', 'compress-1')
    assert.equal(chunk.instruction, '压缩这一段')
    assert.equal(chunk.maxTokens, 100)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
