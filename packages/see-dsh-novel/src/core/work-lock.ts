/**
 * 跨进程作品锁：`source/.write.lock` + metadata + 心跳 + stale 接管。
 *
 * 锁由 action 边界通过 `withWorkAction` 获取；commit 不感知锁。metadata 与源
 * 工程一致：version/pid/token/startedAt/heartbeatAt。
 */
import { randomUUID } from 'node:crypto'
import { open, mkdir, readFile, stat, unlink } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

export const WORK_LOCK_HEARTBEAT_MS = 30_000
export const WORK_LOCK_LEASE_MS = 3 * 60_000
export const WORK_LOCK_RETRIES = 4

export interface WorkLockMetadata {
  version: 1
  pid: number
  token: string
  startedAt: number
  heartbeatAt: number
}

export type WorkLockRelease = () => Promise<void>

interface ProcessLock {
  metadata: WorkLockMetadata
  heartbeatTimer?: ReturnType<typeof setInterval>
  heartbeatTask?: Promise<void>
}

const processLocks = new Map<string, ProcessLock>()

export class WorkLockError extends Error {
  readonly code = 'BOOK_BUSY'

  constructor(readonly root: string, readonly lockPath: string, lockData?: string) {
    super(
      `作品 "${basename(root)}" 正在被另一个写入任务占用${lockData === undefined ? '' : `（${lockData}）`}；`
        + '等待它完成或停止该任务后重试；stale 锁会自动接管。',
    )
    this.name = 'WorkLockError'
  }
}

export function workLockPath(root: string): string {
  return join(root, 'source/.write.lock')
}

function lockKey(lockPath: string): string {
  const absolute = resolve(lockPath)
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute
}

function serialize(metadata: WorkLockMetadata): string {
  return JSON.stringify(metadata)
}

function parseLockMetadata(raw: string): Partial<WorkLockMetadata> | undefined {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const pid = typeof parsed.pid === 'number' ? parsed.pid : undefined
    const startedAt = typeof parsed.startedAt === 'number' ? parsed.startedAt : undefined
    const heartbeatAt = typeof parsed.heartbeatAt === 'number' ? parsed.heartbeatAt : undefined
    return {
      ...(parsed.version === 1 ? { version: 1 as const } : {}),
      ...(pid === undefined ? {} : { pid }),
      ...(typeof parsed.token === 'string' ? { token: parsed.token } : {}),
      ...(startedAt === undefined ? {} : { startedAt }),
      ...(heartbeatAt === undefined ? {} : { heartbeatAt }),
    }
  } catch {
    return undefined
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH' ? false : true
  }
}

function isStale(metadata: Partial<WorkLockMetadata> | undefined, mtimeMs: number): boolean {
  if (metadata?.pid === process.pid) return true
  if (metadata?.pid !== undefined && !isProcessAlive(metadata.pid)) return true
  const heartbeatAt = metadata?.heartbeatAt ?? mtimeMs
  const hasLeaseMetadata = metadata?.version === 1 && typeof metadata.token === 'string'
  return hasLeaseMetadata && Date.now() - heartbeatAt > WORK_LOCK_LEASE_MS
}

async function readSnapshot(lockPath: string): Promise<{ raw: string, metadata?: Partial<WorkLockMetadata>, mtimeMs: number }> {
  const [raw, lockStat] = await Promise.all([readFile(lockPath, 'utf8'), stat(lockPath)])
  return { raw, metadata: parseLockMetadata(raw), mtimeMs: lockStat.mtimeMs }
}

async function unlinkWithRetry(lockPath: string): Promise<void> {
  for (let attempt = 0; attempt < WORK_LOCK_RETRIES; attempt += 1) {
    try {
      await unlink(lockPath)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code
      if (code === 'ENOENT') return
      const retryable = code === 'EPERM' || code === 'EACCES' || code === 'EBUSY'
      if (!retryable || attempt === WORK_LOCK_RETRIES - 1) throw error
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 25 * (attempt + 1)))
    }
  }
}

async function createLockFile(lockPath: string, metadata: WorkLockMetadata): Promise<void> {
  const handle = await open(lockPath, 'wx')
  try {
    await handle.writeFile(serialize(metadata), 'utf8')
  } catch (error) {
    await handle.close().catch(() => undefined)
    await unlinkWithRetry(lockPath).catch(() => undefined)
    throw error
  }
  await handle.close()
}

async function removeStaleLock(lockPath: string, expectedRaw: string): Promise<void> {
  const currentRaw = await readFile(lockPath, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  if (currentRaw === undefined || currentRaw !== expectedRaw) return
  await unlinkWithRetry(lockPath)
}

function startHeartbeat(lockPath: string, key: string, owner: ProcessLock): void {
  const refresh = async (): Promise<void> => {
    if (processLocks.get(key)?.metadata.token !== owner.metadata.token) return
    const handle = await open(lockPath, 'r+')
    try {
      const current = await handle.readFile('utf8')
      if (parseLockMetadata(current)?.token !== owner.metadata.token) return
      owner.metadata.heartbeatAt = Date.now()
      const bytes = Buffer.from(serialize(owner.metadata), 'utf8')
      await handle.write(bytes, 0, bytes.length, 0)
      await handle.truncate(bytes.length)
    } finally {
      await handle.close()
    }
  }
  owner.heartbeatTimer = setInterval(() => {
    if (owner.heartbeatTask !== undefined) return
    const task = refresh()
      .catch((error: unknown) => { console.warn(`[see-dsh-novel] Failed to refresh work lock ${lockPath}: ${String(error)}`) })
      .finally(() => {
        if (owner.heartbeatTask === task) owner.heartbeatTask = undefined
      })
    owner.heartbeatTask = task
  }, WORK_LOCK_HEARTBEAT_MS)
  owner.heartbeatTimer.unref?.()
}

/** 获取作品锁；同进程并发、跨进程活跃锁都抛 `BOOK_BUSY`。 */
export async function acquireWorkLock(root: string): Promise<WorkLockRelease> {
  const lockPath = workLockPath(root)
  await mkdir(dirname(lockPath), { recursive: true })
  const key = lockKey(lockPath)
  const existing = processLocks.get(key)
  if (existing !== undefined) throw new WorkLockError(root, lockPath, `pid:${existing.metadata.pid} started:${new Date(existing.metadata.startedAt).toISOString()}`)

  const now = Date.now()
  const owner: ProcessLock = {
    metadata: { version: 1, pid: process.pid, token: randomUUID(), startedAt: now, heartbeatAt: now },
  }
  // 先同步占位，避免同一进程两个 acquire 都撞 EEXIST 后互相把对方当 stale。
  processLocks.set(key, owner)

  try {
    let acquired = false
    for (let attempt = 0; attempt < WORK_LOCK_RETRIES && !acquired; attempt += 1) {
      try {
        await createLockFile(lockPath, owner.metadata)
        acquired = true
      } catch (error) {
        if ((error as NodeJS.ErrnoException | undefined)?.code !== 'EEXIST') throw error
        let snapshot: Awaited<ReturnType<typeof readSnapshot>>
        try {
          snapshot = await readSnapshot(lockPath)
        } catch (snapshotError) {
          if ((snapshotError as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') continue
          throw snapshotError
        }
        if (!isStale(snapshot.metadata, snapshot.mtimeMs)) throw new WorkLockError(root, lockPath, snapshot.raw)
        await removeStaleLock(lockPath, snapshot.raw)
      }
    }
    if (!acquired) throw new WorkLockError(root, lockPath)
    startHeartbeat(lockPath, key, owner)
    let released = false
    return async (): Promise<void> => {
      if (released) return
      released = true
      if (owner.heartbeatTimer !== undefined) clearInterval(owner.heartbeatTimer)
      await owner.heartbeatTask
      if (processLocks.get(key)?.metadata.token === owner.metadata.token) processLocks.delete(key)
      try {
        const snapshot = await readSnapshot(lockPath)
        if (snapshot.metadata?.token !== owner.metadata.token) return
        await unlinkWithRetry(lockPath)
      } catch (error) {
        if ((error as NodeJS.ErrnoException | undefined)?.code !== 'ENOENT') {
          console.warn(`[see-dsh-novel] Failed to release work lock ${lockPath}: ${String(error)}`)
        }
      }
    }
  } catch (error) {
    if (processLocks.get(key)?.metadata.token === owner.metadata.token) processLocks.delete(key)
    throw error
  }
}

/** 只读查看当前锁；测试/诊断用。 */
export async function inspectWorkLock(root: string): Promise<{ metadata?: Partial<WorkLockMetadata>, mtimeMs: number } | null> {
  try {
    const snapshot = await readSnapshot(workLockPath(root))
    return { ...(snapshot.metadata === undefined ? {} : { metadata: snapshot.metadata }), mtimeMs: snapshot.mtimeMs }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}
