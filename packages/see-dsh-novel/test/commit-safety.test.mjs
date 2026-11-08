import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, normalize, sep } from 'node:path'

import {
  commitFoundation,
  parseJournal,
  recoverDeadTransactions,
  safeRelativePath,
  TXN_PREFIX,
  withCommitQueue,
} from '../src/core/commit.ts'

async function workspace() {
  return mkdtemp(join(tmpdir(), 'see-dsh-novel-safety-'))
}

const cleanup = (root) => rm(root, { recursive: true, force: true })

test('paths must stay inside the work root', () => {
  assert.equal(safeRelativePath('source/story/a.md'), normalize('source/story/a.md'))
  assert.throws(() => safeRelativePath(''), /留在作品根内/)
  assert.throws(() => safeRelativePath('../x.md'), /留在作品根内/)
  assert.throws(() => safeRelativePath(`..${sep}x.md`), /留在作品根内/)
  if (process.platform === 'win32') assert.throws(() => safeRelativePath('..\\x.md'), /留在作品根内/)
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
    const rootEntries = await readdir(root).catch(() => [])
    assert.equal(rootEntries.some((entry) => entry.startsWith(TXN_PREFIX)), false)
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

test('dead prepared transaction is restored and new targets are removed', async () => {
  const root = await workspace()
  try {
    await mkdir(join(root, 'source/story'), { recursive: true })
    await writeFile(join(root, 'source/story/a.md'), 'half\n')
    await writeFile(join(root, 'source/story/b.md'), 'half-b\n')

    const transaction = join(root, `${TXN_PREFIX}dead`)
    await mkdir(join(transaction, 'backup/source/story'), { recursive: true })
    await writeFile(join(transaction, 'backup/source/story/a.md'), 'original\n')
    await writeFile(join(transaction, 'journal.json'), JSON.stringify({
      version: 1,
      pid: 999999,
      phase: 'prepared',
      entries: [
        { path: 'source/story/a.md', existed: true },
        { path: 'source/story/b.md', existed: false },
      ],
    }))

    await recoverDeadTransactions(root)
    assert.equal(await readFile(join(root, 'source/story/a.md'), 'utf8'), 'original\n')
    await assert.rejects(readFile(join(root, 'source/story/b.md'), 'utf8'), /ENOENT/)
    assert.deepEqual(await readdir(join(root, 'source')), ['story'])
    assert.equal((await readdir(root)).some((entry) => entry.startsWith(TXN_PREFIX)), false)
  } finally {
    await cleanup(root)
  }
})

test('a dead committed transaction is cleaned without touching the files', async () => {
  const root = await workspace()
  try {
    await mkdir(join(root, 'source/story'), { recursive: true })
    await writeFile(join(root, 'source/story/a.md'), 'kept\n')
    const transaction = join(root, `${TXN_PREFIX}done`)
    await mkdir(transaction, { recursive: true })
    await writeFile(join(transaction, 'journal.json'), JSON.stringify({
      version: 1,
      pid: 999999,
      phase: 'committed',
      entries: [{ path: 'source/story/a.md', existed: true }],
    }))
    await recoverDeadTransactions(root)
    assert.equal(await readFile(join(root, 'source/story/a.md'), 'utf8'), 'kept\n')
    assert.equal((await readdir(root)).some((entry) => entry.startsWith(TXN_PREFIX)), false)
  } finally {
    await cleanup(root)
  }
})

test('a journal that says the target existed keeps it when the backup is gone', async () => {
  const root = await workspace()
  try {
    await mkdir(join(root, 'source/story'), { recursive: true })
    await writeFile(join(root, 'source/story/a.md'), 'kept\n')
    const transaction = join(root, `${TXN_PREFIX}nobackup`)
    await mkdir(transaction, { recursive: true })
    await writeFile(join(transaction, 'journal.json'), JSON.stringify({
      version: 1,
      pid: 999999,
      phase: 'prepared',
      entries: [{ path: 'source/story/a.md', existed: true }],
    }))
    await recoverDeadTransactions(root)
    assert.equal(await readFile(join(root, 'source/story/a.md'), 'utf8'), 'kept\n')
    assert.deepEqual(await readdir(join(root, 'source')), ['story'])
  } finally {
    await cleanup(root)
  }
})

test('the journal parser accepts only the source shape', () => {
  const base = { version: 1, pid: 1, phase: 'prepared', entries: [] }
  assert.deepEqual(parseJournal(JSON.stringify(base))?.entries, [])
  assert.deepEqual(parseJournal(JSON.stringify({
    ...base,
    entries: [{ path: 'source/story/a.md', existed: true }],
  }))?.entries, [{ path: 'source/story/a.md', existed: true }])
  assert.equal(parseJournal(JSON.stringify({ ...base, phase: 'applied' })), undefined)
  assert.equal(parseJournal(JSON.stringify({ ...base, extra: true })), undefined)
  assert.equal(parseJournal(JSON.stringify({ ...base, entries: [{ path: 'a' }] })), undefined)
  assert.equal(parseJournal(JSON.stringify({ ...base, entries: [{ path: 'a', existed: 'yes' }] })), undefined)
  assert.equal(parseJournal(JSON.stringify({ ...base, entries: [{ path: 'a', existed: true, extra: 1 }] })), undefined)
  assert.equal(parseJournal(JSON.stringify({ ...base, entries: [{ path: 'a', existed: true }], phase: 'committed' }))?.phase, 'committed')
})
