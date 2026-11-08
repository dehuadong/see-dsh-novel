import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { commitFoundation, parseJournal, recoverDeadTransactions, TXN_PREFIX } from '../src/core/commit.ts'

async function workspace() {
  return mkdtemp(join(tmpdir(), 'see-dsh-novel-txn-'))
}

const cleanup = (root) => rm(root, { recursive: true, force: true })

test('a commit leaves no transaction directory behind at the work root', async () => {
  const root = await workspace()
  try {
    await commitFoundation(root, { writes: [{ relativePath: 'source/story/a.md', content: '# a\n' }] })
    assert.equal(await readFile(join(root, 'source/story/a.md'), 'utf8'), '# a\n')
    assert.equal((await readdir(root)).some((entry) => entry.startsWith(TXN_PREFIX)), false)
    assert.equal((await readdir(join(root, 'source'))).some((entry) => entry.startsWith('.staging-')), false)
  } finally {
    await cleanup(root)
  }
})

test('a running commit exposes the root transaction, staged/backup and the entries journal', async () => {
  const root = await workspace()
  try {
    await mkdir(join(root, 'source/story'), { recursive: true })
    await writeFile(join(root, 'source/story/existing.md'), 'old\n')
    const writes = [
      { relativePath: 'source/story/existing.md', content: 'new\n' },
      ...Array.from({ length: 2000 }, (_, index) => ({
        relativePath: `source/story/${index}.md`,
        content: `# ${index}\n`,
      })),
    ]
    const pending = commitFoundation(root, { writes })
    let finished = false
    void pending.then(() => { finished = true })

    let seen
    let sawBackup = false
    for (let attempt = 0; attempt < 5000 && !sawBackup && !finished; attempt += 1) {
      if (seen === undefined) {
        const names = await readdir(root)
        const name = names.find((entry) => entry.startsWith(TXN_PREFIX))
        if (name !== undefined) {
          const layout = await readdir(join(root, name))
          if (layout.includes('journal.json')) {
            const raw = await readFile(join(root, name, 'journal.json'), 'utf8').catch(() => undefined)
            const journal = raw === undefined ? undefined : parseJournal(raw)
            if (journal !== undefined) seen = { layout, journal, raw, name }
          }
        }
      }
      if (seen !== undefined) {
        const backup = await readFile(join(root, seen.name, 'backup/source/story/existing.md'), 'utf8').catch(() => undefined)
        if (backup === 'old\n') sawBackup = true
      }
      if (!sawBackup) await new Promise((resolve) => setTimeout(resolve, 1))
    }
    await pending

    assert.ok(seen, '提交进行中应能看到根目录事务')
    assert.ok(seen.layout.includes('staged'))
    assert.ok(seen.layout.includes('backup'))
    assert.equal(seen.journal.entries.length, writes.length)
    assert.equal(seen.raw.includes('\n'), false, '日志是紧凑 JSON')
    assert.equal(sawBackup, true, '旧目标用 rename 移到了 backup/')
    assert.equal(await readFile(join(root, 'source/story/existing.md'), 'utf8'), 'new\n')
    assert.equal((await readdir(root)).some((entry) => entry.startsWith(TXN_PREFIX)), false)
  } finally {
    await cleanup(root)
  }
})

test('a dead prepared transaction at the work root is rolled back through entries', async () => {
  const root = await workspace()
  try {
    await mkdir(join(root, 'source/story'), { recursive: true })
    await writeFile(join(root, 'source/story/a.md'), 'half\n')
    const transaction = join(root, `${TXN_PREFIX}dead`)
    await mkdir(join(transaction, 'backup/source/story'), { recursive: true })
    await mkdir(join(transaction, 'staged'), { recursive: true })
    await writeFile(join(transaction, 'backup/source/story/a.md'), 'old\n')
    await writeFile(join(transaction, 'journal.json'), JSON.stringify({
      version: 1,
      pid: 999999,
      phase: 'prepared',
      entries: [{ path: 'source/story/a.md', existed: true }],
    }))

    await recoverDeadTransactions(root)
    assert.equal(await readFile(join(root, 'source/story/a.md'), 'utf8'), 'old\n')
    assert.equal((await readdir(root)).some((entry) => entry.startsWith(TXN_PREFIX)), false)
  } finally {
    await cleanup(root)
  }
})

test('a dead committed transaction is only removed', async () => {
  const root = await workspace()
  try {
    await mkdir(join(root, 'source/story'), { recursive: true })
    await writeFile(join(root, 'source/story/a.md'), 'new\n')
    const transaction = join(root, `${TXN_PREFIX}done`)
    await mkdir(transaction, { recursive: true })
    await writeFile(join(transaction, 'journal.json'), JSON.stringify({
      version: 1,
      pid: 999999,
      phase: 'committed',
      entries: [{ path: 'source/story/a.md', existed: true }],
    }))

    await recoverDeadTransactions(root)
    assert.equal(await readFile(join(root, 'source/story/a.md'), 'utf8'), 'new\n')
    assert.equal((await readdir(root)).some((entry) => entry.startsWith(TXN_PREFIX)), false)
  } finally {
    await cleanup(root)
  }
})

test('the old source/.staging format is not scanned', async () => {
  const root = await workspace()
  try {
    const old = join(root, 'source/.staging-legacy')
    await mkdir(old, { recursive: true })
    await writeFile(join(old, 'journal.json'), JSON.stringify({
      version: 1, pid: 999999, phase: 'staged-empty', writes: [], deletes: [],
    }))
    await recoverDeadTransactions(root)
    assert.equal((await readdir(join(root, 'source'))).includes('.staging-legacy'), true)
  } finally {
    await cleanup(root)
  }
})
