import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  chapterArtifactWrite,
  currentChapterArtifact,
  loadArtifactStore,
  promoteArtifactRevision,
  readArtifactRevision,
  stageArtifactRevision,
} from '../src/core/artifact-store.ts'

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'see-dsh-novel-artifacts-'))
  await mkdir(join(root, 'source/chapters'), { recursive: true })
  await mkdir(join(root, 'source/artifacts'), { recursive: true })
  await writeFile(join(root, 'work.json'), JSON.stringify({
    version: 1, id: 'w1', title: '产物', profile: 'longform-novel', language: 'zh', status: 'draft',
    metadata: {}, createdAt: '2026-11-09T00:00:00.000Z', updatedAt: '2026-11-09T00:00:00.000Z',
  }))
  return root
}

test('stage, promote and read revisions keep checksums and current invariants', async () => {
  const root = await workspace()
  try {
    const first = await stageArtifactRevision(root, {
      artifactId: 'draft-1', kind: 'chapter', revisionId: 'r1', content: '第一版', fileName: 'draft.md', promote: true,
    })
    assert.equal(first.status, 'current')
    assert.match(first.checksum, /^sha256:[0-9a-f]{64}$/)
    const second = await stageArtifactRevision(root, {
      artifactId: 'draft-1', kind: 'chapter', revisionId: 'r2', content: '第二版', fileName: 'draft.md',
    })
    assert.equal(second.status, 'candidate')
    assert.equal(second.parentRevisionId, 'r1')
    await promoteArtifactRevision(root, { artifactId: 'draft-1', revisionId: 'r2' })
    const store = await loadArtifactStore(root)
    const artifact = store.artifacts[0]
    assert.equal(artifact.currentRevisionId, 'r2')
    assert.deepEqual(artifact.revisions.map((revision) => [revision.id, revision.status]), [
      ['r1', 'superseded'],
      ['r2', 'current'],
    ])
    const read = await readArtifactRevision(root, { artifactId: 'draft-1', revisionId: 'r2' })
    assert.equal(read.bytes.toString('utf8'), '第二版')
    assert.match(await readFile(join(root, artifact.revisions[1].path), 'utf8'), /第二版/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('chapter artifact uses the chapter file as revision path', async () => {
  const root = await workspace()
  try {
    await writeFile(join(root, 'source/chapters/0001_雨夜.md'), '# 第1章 雨夜\n\n正文。\n')
    const write = await chapterArtifactWrite(root, {
      chapter: 1,
      chapterPath: 'source/chapters/0001_雨夜.md',
      content: '# 第1章 雨夜\n\n正文。\n',
    })
    await writeFile(join(root, write.relativePath), write.content)
    const current = await currentChapterArtifact(root, 1)
    assert.equal(current?.artifact.id, 'chapter-0001')
    assert.equal(current?.revision.path, 'source/chapters/0001_雨夜.md')
    assert.equal(current?.revision.parentRevisionId, null)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('artifact ids and paths are rejected when unsafe', async () => {
  const root = await workspace()
  try {
    await assert.rejects(stageArtifactRevision(root, {
      artifactId: '../x', kind: 'chapter', revisionId: 'r1', content: 'x', fileName: 'x.md', promote: true,
    }), /非法的资源 id/)
    await assert.rejects(stageArtifactRevision(root, {
      artifactId: 'x', kind: 'chapter', revisionId: '../r1', content: 'x', fileName: 'x.md', promote: true,
    }), /非法的 revision id/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
