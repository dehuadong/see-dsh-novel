/**
 * 作品写 action 的互斥：whole-action 队列 + 同一异步 mutation scope 的 reentrancy。
 *
 * 锁文件本身由 `work-lock.ts` 负责；这里只决定“同一作品的动作是否串行、嵌套是否
 * 复用同一把锁”。源工程把锁放在 tool/harness action 边界，commit 不感知锁。
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { basename, resolve } from 'node:path'

import { acquireWorkLock } from './work-lock.js'
import type { WorkLockRelease } from './work-lock.js'

const owners = new AsyncLocalStorage<ReadonlySet<string>>()
const queues = new Map<string, Promise<void>>()

function mutationKey(root: string, workId: string): string {
  return `${resolve(root)}\0${workId}`
}

/** 当前 async context 是否已持有该作品的 mutation scope。 */
export function ownsWorkMutation(root: string, workId: string): boolean {
  return owners.getStore()?.has(mutationKey(root, workId)) ?? false
}

/** 在同一 mutation scope 内执行；嵌套调用直接复用外层锁。 */
export async function withWorkMutationScope<T>(
  root: string,
  workId: string,
  acquire: () => Promise<WorkLockRelease>,
  task: () => Promise<T>,
): Promise<T> {
  if (ownsWorkMutation(root, workId)) return task()
  const release = await acquire()
  try {
    return await owners.run(new Set([...(owners.getStore() ?? []), mutationKey(root, workId)]), task)
  } finally {
    await release()
  }
}

/** 同一作品的 whole action 串行；与 commit 事务队列是两层。 */
export async function runInWorkMutationQueue<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolveGate) => { release = resolveGate })
  const queued = previous.catch(() => undefined).then(() => gate)
  queues.set(key, queued)
  await previous.catch(() => undefined)
  try {
    return await task()
  } finally {
    release()
    if (queues.get(key) === queued) queues.delete(key)
  }
}

/** 一个作品写 action：先按作品排队，再获取跨进程锁。 */
export async function withWorkAction<T>(root: string, task: () => Promise<T>): Promise<T> {
  const workId = basename(resolve(root))
  if (ownsWorkMutation(root, workId)) return task()
  const key = mutationKey(root, workId)
  return runInWorkMutationQueue(key, () => withWorkMutationScope(root, workId, () => acquireWorkLock(root), task))
}
