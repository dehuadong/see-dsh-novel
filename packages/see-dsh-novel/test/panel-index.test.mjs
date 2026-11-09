import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { readArtifacts } from '../src/core/artifacts.ts'
import { buildPanelIndex, writePanelIndex } from '../src/core/panel-index.ts'
import { PANEL_INDEX_PATH, WORK_FILE } from '../src/core/story-paths.ts'

async function workspace(kind = 'foundation') {
  const root = await mkdtemp(join(tmpdir(), 'see-dsh-novel-panel-'))
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
  if (kind === 'chapter') {
    await mkdir(join(root, 'source/story/runtime'), { recursive: true })
    await writeFile(join(root, 'source/story/runtime/chapter-0001.plan.json'), JSON.stringify({ version: 2, memo: { chapter: 1, goal: 'g', body: 'b', threadRefs: [] } }))
  }
  return root
}

test('panel index is built from files and does not become an artifact', async () => {
  const root = await workspace('chapter')
  try {
    const index = await buildPanelIndex(root)
    assert.equal(index.work?.title, '标题')
    assert.equal(index.stages.find((stage) => stage.id === 'foundation')?.status, 'current')
    assert.ok(index.artifacts.some((artifact) => artifact.path === 'source/story/outline/story_frame.md'))
    assert.equal(index.artifacts.some((artifact) => artifact.path === PANEL_INDEX_PATH), false)
    await writePanelIndex(root, index)
    const after = await readArtifacts(root)
    assert.equal(after.files.includes(PANEL_INDEX_PATH), false)
    assert.equal((await readFile(join(root, PANEL_INDEX_PATH), 'utf8')).includes('foundation'), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('no work yields the proposal stage', async () => {
  const root = await mkdtemp(join(tmpdir(), 'see-dsh-novel-panel-empty-'))
  try {
    const index = await buildPanelIndex(root)
    assert.equal(index.work, null)
    assert.equal(index.stages[0].status, 'current')
    assert.equal(index.stages[0].action?.id, 'new-work')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
