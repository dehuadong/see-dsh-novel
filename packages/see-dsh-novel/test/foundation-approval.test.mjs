import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  FOUNDATION_APPROVAL_PATH,
  clearFoundationApproval,
  foundationApprovalDigest,
  isFoundationApproved,
  readFoundationApproval,
  rejectFoundationApproval,
  writeFoundationApproval,
} from '../src/core/foundation-approval.ts'
import { readArtifacts } from '../src/core/artifacts.ts'
import { WORK_FILE } from '../src/core/story-paths.ts'

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'see-dsh-novel-foundation-approval-'))
  await writeFile(join(root, WORK_FILE), JSON.stringify({
    version: 1, id: 'w', title: '标题', profile: 'longform-novel', language: 'zh', status: 'draft',
    metadata: {}, createdAt: '2026-11-09T00:00:00.000Z', updatedAt: '2026-11-09T00:00:00.000Z',
  }))
  for (const path of [
    'source/story/outline/story_frame.md',
    'source/story/outline/volume_map.md',
    'source/story/book_rules.md',
    'source/story/book_rules.json',
    'source/story/roles/主要角色/沈砚.md',
    'source/story/pending_hooks.md',
  ]) {
    await mkdir(join(root, path, '..'), { recursive: true })
    await writeFile(join(root, path), 'x\n')
  }
  return root
}

test('foundation approval covers the outline, rules and cast but not pending hooks', async () => {
  const root = await workspace()
  try {
    const before = foundationApprovalDigest(root)
    assert.notEqual(before, '')
    await writeFile(join(root, 'source/story/pending_hooks.md'), 'hook update\n')
    assert.equal(foundationApprovalDigest(root), before)
    await writeFile(join(root, 'source/story/outline/volume_map.md'), 'new volume\n')
    const changed = foundationApprovalDigest(root)
    assert.notEqual(changed, before)

    const record = await writeFoundationApproval(root)
    assert.equal(record.digest, changed)
    assert.equal(record.state, 'approved')
    assert.equal(isFoundationApproved(root), true)
    assert.equal(readFoundationApproval(root)?.files, 5)
    const artifacts = await readArtifacts(root)
    assert.equal(artifacts.files.includes(FOUNDATION_APPROVAL_PATH), false)

    await rejectFoundationApproval(root)
    assert.equal(isFoundationApproved(root), false)
    assert.equal(readFoundationApproval(root)?.state, 'rejected')
    await writeFoundationApproval(root)
    assert.equal(isFoundationApproved(root), true)

    await assert.rejects(writeFoundationApproval(root, 'wrong-digest'), /确认期间发生变化/)

    clearFoundationApproval(root)
    assert.equal(isFoundationApproved(root), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('an empty foundation cannot be approved', async () => {
  const root = await mkdtemp(join(tmpdir(), 'see-dsh-novel-foundation-empty-'))
  try {
    await assert.rejects(writeFoundationApproval(root), /还没有基础设定/)
    assert.equal(isFoundationApproved(root), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
