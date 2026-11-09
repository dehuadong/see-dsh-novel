import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { acquireWorkLock, inspectWorkLock, workLockPath, WorkLockError } from '../src/core/work-lock.ts'
import { withWorkAction } from '../src/core/work-mutation.ts'

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'see-dsh-novel-lock-'))
  await mkdir(join(root, 'source'), { recursive: true })
  return root
}

const cleanup = (root) => rm(root, { recursive: true, force: true })
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('acquire writes metadata, rejects a concurrent in-process lock, and release removes it', async () => {
  const root = await workspace()
  try {
    const release = await acquireWorkLock(root)
    const metadata = JSON.parse(await readFile(workLockPath(root), 'utf8'))
    assert.equal(metadata.version, 1)
    assert.equal(metadata.pid, process.pid)
    assert.equal(typeof metadata.token, 'string')
    assert.equal(typeof metadata.heartbeatAt, 'number')
    await assert.rejects(acquireWorkLock(root), (error) => {
      assert.equal(error.code, 'BOOK_BUSY')
      return true
    })
    await release()
    await assert.rejects(stat(workLockPath(root)), /ENOENT/)
  } finally {
    await cleanup(root)
  }
})

test('a stale same-pid lock is taken over; a live lock with old format is not', async () => {
  const root = await workspace()
  try {
    await writeFile(workLockPath(root), JSON.stringify({
      version: 1, pid: process.pid, token: 'orphan', startedAt: Date.now() - 10_000, heartbeatAt: Date.now() - 10_000,
    }))
    const release = await acquireWorkLock(root)
    await release()

    // 活 pid + 无 lease metadata（旧格式）不能按时间判断，必须 BOOK_BUSY。
    await writeFile(workLockPath(root), JSON.stringify({ pid: process.ppid }))
    const old = new Date(Date.now() - 10 * 60_000)
    await utimes(workLockPath(root), old, old)
    await assert.rejects(acquireWorkLock(root), (error) => {
      assert.equal(error.code, 'BOOK_BUSY')
      return true
    })
  } finally {
    await cleanup(root)
  }
})

test('lease metadata without heartbeatAt uses file mtime for stale takeover', async () => {
  const root = await workspace()
  try {
    await writeFile(workLockPath(root), JSON.stringify({
      version: 1, pid: process.ppid, token: 'legacy-lease', startedAt: Date.now() - 10 * 60_000,
    }))
    const old = new Date(Date.now() - 10 * 60_000)
    await utimes(workLockPath(root), old, old)
    const release = await acquireWorkLock(root)
    await release()
    await assert.rejects(stat(workLockPath(root)), /ENOENT/)
  } finally {
    await cleanup(root)
  }
})

test('release never removes a lock whose token changed', async () => {
  const root = await workspace()
  try {
    const release = await acquireWorkLock(root)
    const current = JSON.parse(await readFile(workLockPath(root), 'utf8'))
    await writeFile(workLockPath(root), JSON.stringify({ ...current, token: 'someone-else' }))
    await release()
    assert.equal(JSON.parse(await readFile(workLockPath(root), 'utf8')).token, 'someone-else')
    assert.notEqual(await inspectWorkLock(root), null)
  } finally {
    await cleanup(root)
  }
})

test('withWorkAction serializes whole actions, supports nested scopes, and leaves the lock released', async () => {
  const root = await workspace()
  try {
    const order = []
    await Promise.all([
      withWorkAction(root, async () => {
        order.push('a-start')
        await delay(20)
        order.push('a-end')
      }),
      withWorkAction(root, async () => {
        order.push('b-start')
        await delay(1)
        order.push('b-end')
      }),
    ])
    assert.deepEqual(order, ['a-start', 'a-end', 'b-start', 'b-end'])

    await withWorkAction(root, async () => {
      await withWorkAction(root, async () => { order.push('nested') })
    })
    assert.deepEqual(order, ['a-start', 'a-end', 'b-start', 'b-end', 'nested'])
    await assert.rejects(stat(workLockPath(root)), /ENOENT/)
  } finally {
    await cleanup(root)
  }
})

test('a cross-process holder makes the second process BOOK_BUSY', async () => {
  const root = await workspace()
  try {
    const moduleUrl = pathToFileURL(join(process.cwd(), 'packages/see-dsh-novel/src/core/work-lock.ts')).href
    const code = `
      import { acquireWorkLock } from ${JSON.stringify(moduleUrl)}
      const release = await acquireWorkLock(process.env.WORK_LOCK_ROOT)
      console.log('LOCKED')
      await new Promise((resolve) => process.stdin.once('data', resolve))
      await release()
      console.log('RELEASED')
    `
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], {
      env: { ...process.env, WORK_LOCK_ROOT: root },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let output = ''
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`child did not lock: ${output}`)), 15_000)
      child.stdout.on('data', (chunk) => {
        output += String(chunk)
        if (output.includes('LOCKED')) {
          clearTimeout(timer)
          resolve()
        }
      })
      child.on('error', reject)
      child.on('exit', (codeValue) => {
        if (!output.includes('LOCKED')) reject(new Error(`child exited ${codeValue}: ${output}`))
      })
    })
    await assert.rejects(acquireWorkLock(root), (error) => {
      assert.equal(error.code, 'BOOK_BUSY')
      return true
    })
    child.stdin.end('release\n')
    await new Promise((resolve, reject) => {
      child.on('exit', resolve)
      child.on('error', reject)
    })
    const release = await acquireWorkLock(root)
    await release()
  } finally {
    await cleanup(root)
  }
})
