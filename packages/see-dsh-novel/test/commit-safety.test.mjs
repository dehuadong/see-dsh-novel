import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  commitFoundation,
  parseJournal,
  recoverDeadStaging,
  safeRelativePath,
  withCommitQueue,
} from '../src/core/commit.ts'

async function workspace() {
  return mkdtemp(join(tmpdir(), 'see-dsh-novel-safety-'))
}

const cleanup = (root) => rm(root, { recursive: true, force: true })

test('paths must stay inside the work root', () => {
  assert.equal(safeRelativePath('source/story/a.md'), 'source/story/a.md')
  assert.throws(() => safeRelativePath(''), /留在作品根内/)
  assert.throws(() => safeRelativePath('../x.md'), /留在作品根内/)
  assert.throws(() => safeRelativePath('..\\x.md'), /留在作品根内/)
  assert.throws(() => safeRelativePath('/abs/x.md'), /留在作品根内/)
})

test('a batch with an escaping path writes nothing', async () => {
  const root = await workspace()
  try {
    await assert.rejects(commitFoundation(root, { writes: [{ relativePath: '../escape.md', content: 'x' }] }))
    const parent = await readdir(join(root, '..'))
    assert.equal(parent.includes('escape.md'), false)
  } finally {
    await cleanup(root)
  }
})

test('duplicate, write-delete and directory-child conflicts are rejected', async () => {
  const root = await workspace()
  try {
    const write = { relativePath: 'source/story/a.md', content: 'x' }
    await assert.rejects(commitFoundation(root, { writes: [write, write] }), /重复写/)
    await assert.rejects(commitFoundation(root, { writes: [write], deletes: ['source/story/a.md'] }), /既写又删/)
    await assert.rejects(commitFoundation(root, {
      writes: [
        { relativePath: 'source/story/a.md', content: 'x' },
        { relativePath: 'source/story/a.md/b.md', content: 'y' },
      ],
    }), /目录和它的子路径/)
    const staging = await readdir(join(root, 'source')).catch(() => [])
    assert.equal(staging.some((entry) => entry.startsWith('.staging-')), false)
  } finally {
    await cleanup(root)
  }
})

test('commits on the same root run in queue order', async () => {
  const root = await workspace()
  const order = []
  try {
    await Promise.all([
      withCommitQueue(root, async () => {
        await new Promise((resolve) => setTimeout(resolve, 30))
        order.push('first')
      }),
      withCommitQueue(root, async () => {
        await new Promise((resolve) => setTimeout(resolve, 1))
        order.push('second')
      }),
    ])
    assert.deepEqual(order, ['first', 'second'])

    await assert.rejects(withCommitQueue(root, async () => { throw new Error('boom') }), /boom/)
    assert.equal(await withCommitQueue(root, async () => 'ok'), 'ok', '前一批失败不阻塞后一批')
  } finally {
    await cleanup(root)
  }
})

test('dead prepared staging is restored, and old journals never delete files', async () => {
  const root = await workspace()
  try {
    await mkdir(join(root, 'source/story'), { recursive: true })
    await writeFile(join(root, 'source/story/a.md'), 'half\n')
    await writeFile(join(root, 'source/story/b.md'), 'kept\n')

    const staging = join(root, 'source/.staging-dead')
    await mkdir(join(staging, 'backup/source/story'), { recursive: true })
    await writeFile(join(staging, 'backup/source/story/a.md'), 'original\n')
    await writeFile(join(staging, 'backup/source/story/b.md'), 'original-b\n')
    const journal = JSON.stringify({
      version: 1, pid: 999999, phase: 'prepared',
      writes: ['source/story/a.md', 'source/story/b.md'], deletes: [], existed: ['source/story/a.md'],
    })
    await writeFile(join(staging, 'journal.json'), journal)

    await recoverDeadStaging(root)
    assert.equal(await readFile(join(root, 'source/story/a.md'), 'utf8'), 'original\n')
    assert.equal(await readFile(join(root, 'source/story/b.md'), 'utf8'), 'original-b\n')
    assert.deepEqual(await readdir(join(root, 'source')), ['story'])
  } finally {
    await cleanup(root)
  }
})

test('a journal without existed leaves an orphaned target alone', async () => {
  const root = await workspace()
  try {
    await mkdir(join(root, 'source/story'), { recursive: true })
    await writeFile(join(root, 'source/story/a.md'), 'orphan\n')
    const staging = join(root, 'source/.staging-old')
    await mkdir(staging, { recursive: true })
    await writeFile(join(staging, 'journal.json'), JSON.stringify({
      version: 1, pid: 999999, phase: 'prepared', writes: ['source/story/a.md'], deletes: [],
    }))
    await recoverDeadStaging(root)
    assert.equal(await readFile(join(root, 'source/story/a.md'), 'utf8'), 'orphan\n')
  } finally {
    await cleanup(root)
  }
})

test('the journal parser rejects malformed entries and accepts existed', () => {
  const base = { version: 1, pid: 1, phase: 'prepared', writes: [], deletes: [] }
  assert.equal(parseJournal(JSON.stringify(base))?.existed, undefined)
  assert.deepEqual(parseJournal(JSON.stringify({ ...base, existed: ['a'] }))?.existed, ['a'])
  assert.equal(parseJournal(JSON.stringify({ ...base, existed: 'a' })), undefined)
  assert.equal(parseJournal(JSON.stringify({ ...base, phase: 'bogus' })), undefined)
})
