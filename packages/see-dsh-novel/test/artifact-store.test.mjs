import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  MANIFEST_PATH,
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

async function writeAt(root, relativePath, content) {
  await mkdir(dirname(join(root, relativePath)), { recursive: true })
  await writeFile(join(root, relativePath), content)
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

test('chapter revisions keep readable snapshots and backfill the previous current', async () => {
  const root = await workspace()
  try {
    const chapterPath = 'source/chapters/0001_雨夜.md'
    const v1 = '# 第1章 雨夜\n\n第一版。\n'
    const v2 = '# 第1章 雨夜\n\n第二版。\n'
    const v3 = '# 第1章 雨夜\n\n第三版。\n'
    await writeFile(join(root, chapterPath), v1)
    const first = await chapterArtifactWrite(root, { chapter: 1, chapterPath, content: v1 })
    await writeAt(root, first.relativePath, first.content)
    await writeAt(root, first.snapshot.relativePath, first.snapshot.content)
    assert.equal(first.artifact.revisions[0].snapshotPath, 'source/artifacts/chapter-0001/revisions/r1.md')
    assert.equal((await readArtifactRevision(root, { artifactId: 'chapter-0001', revisionId: 'r1' })).bytes.toString('utf8'), v1)

    await writeFile(join(root, chapterPath), v2)
    const second = await chapterArtifactWrite(root, { chapter: 1, chapterPath, content: v2, previousContent: v1 })
    await writeAt(root, second.relativePath, second.content)
    await writeAt(root, second.snapshot.relativePath, second.snapshot.content)
    assert.equal(second.backfill, undefined, 'r1 已有快照，不需要回填')
    assert.equal((await readArtifactRevision(root, { artifactId: 'chapter-0001', revisionId: 'r1' })).bytes.toString('utf8'), v1)

    // 旧 manifest：current 的 snapshotPath 缺失，修订时回填。
    const manifest = JSON.parse(await readFile(join(root, MANIFEST_PATH), 'utf8'))
    const current = manifest.artifacts[0].revisions.find((revision) => revision.id === 'r2')
    delete current.snapshotPath
    await writeFile(join(root, MANIFEST_PATH), JSON.stringify(manifest))
    await rm(join(root, 'source/artifacts/chapter-0001/revisions/r2.md'), { force: true })

    await writeFile(join(root, chapterPath), v3)
    const third = await chapterArtifactWrite(root, { chapter: 1, chapterPath, content: v3, previousContent: v2 })
    assert.equal(third.backfill?.relativePath, 'source/artifacts/chapter-0001/revisions/r2.md')
    await writeAt(root, third.relativePath, third.content)
    await writeAt(root, third.snapshot.relativePath, third.snapshot.content)
    await writeAt(root, third.backfill.relativePath, third.backfill.content)
    assert.equal((await readArtifactRevision(root, { artifactId: 'chapter-0001', revisionId: 'r2' })).bytes.toString('utf8'), v2)

    // 回填前 checksum 不符：拒绝且不返回写入。
    const broken = JSON.parse(await readFile(join(root, MANIFEST_PATH), 'utf8'))
    delete broken.artifacts[0].revisions.find((revision) => revision.id === 'r3').snapshotPath
    await writeFile(join(root, MANIFEST_PATH), JSON.stringify(broken))
    const manifestBefore = await readFile(join(root, MANIFEST_PATH), 'utf8')
    const chapterBefore = await readFile(join(root, chapterPath), 'utf8')
    await assert.rejects(
      chapterArtifactWrite(root, { chapter: 1, chapterPath, content: v3, previousContent: '不是第二版' }),
      { code: 'ARTIFACT_REVISION_CONFLICT' },
    )
    assert.equal(await readFile(join(root, MANIFEST_PATH), 'utf8'), manifestBefore)
    assert.equal(await readFile(join(root, chapterPath), 'utf8'), chapterBefore)
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

test('reader rejects a snapshot that resolves outside the work', async (t) => {
  if (process.platform === 'win32') {
    t.skip('creating file symlinks needs extra privileges on Windows')
    return
  }
  const root = await workspace()
  const outside = await mkdtemp(join(tmpdir(), 'see-dsh-novel-outside-'))
  try {
    const snapshotPath = 'source/artifacts/chapter-0001/revisions/r1.md'
    await mkdir(dirname(join(root, snapshotPath)), { recursive: true })
    await writeFile(join(outside, 'escape.md'), '别处的正文')
    await symlink(join(outside, 'escape.md'), join(root, snapshotPath))
    await writeFile(join(root, MANIFEST_PATH), JSON.stringify({
      version: 1,
      workId: 'w1',
      artifacts: [{
        id: 'chapter-0001',
        kind: 'chapter',
        currentRevisionId: 'r1',
        revisions: [{
          id: 'r1',
          parentRevisionId: null,
          path: 'source/chapters/0001_雨夜.md',
          snapshotPath,
          contentType: 'text/markdown',
          status: 'current',
          checksum: 'sha256:0',
          byteLength: 1,
          createdAt: '2026-11-09T00:00:00.000Z',
        }],
        metadata: {},
      }],
    }))
    await assert.rejects(
      readArtifactRevision(root, { artifactId: 'chapter-0001', revisionId: 'r1' }),
      { code: 'ARTIFACT_PATH_OUTSIDE_WORK' },
    )
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})

test('manifest rejects revisions whose path or snapshotPath escapes the work', async () => {
  const root = await workspace()
  try {
    const revision = (overrides) => ({
      id: 'r1',
      parentRevisionId: null,
      path: 'source/chapters/0001_雨夜.md',
      snapshotPath: 'source/artifacts/chapter-0001/revisions/r1.md',
      contentType: 'text/markdown',
      status: 'current',
      checksum: 'sha256:0',
      byteLength: 1,
      createdAt: '2026-11-09T00:00:00.000Z',
      ...overrides,
    })
    await mkdir(join(root, 'source/artifacts'), { recursive: true })
    for (const bad of [revision({ path: '../escape.md' }), revision({ snapshotPath: '../escape.md' })]) {
      await writeFile(join(root, MANIFEST_PATH), JSON.stringify({
        version: 1,
        workId: 'w1',
        artifacts: [{
          id: 'chapter-0001',
          kind: 'chapter',
          currentRevisionId: 'r1',
          revisions: [bad],
          metadata: {},
        }],
      }))
      await assert.rejects(loadArtifactStore(root), /必须留在作品内/)
    }
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

