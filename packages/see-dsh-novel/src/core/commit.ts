/**
 * 整批写入：先 staged，再把目标 rename 到 backup，最后把 staged 写入 rename 到位；
 * 失败用备份回滚。
 *
 * 事务目录在作品根 `.inkos-file-txn-<随机>`，里面有 `staged/` 与 `backup/`，以及
 * `journal.json`（阶段 + 属主 pid + entries[{path,existed}]）。崩溃后的认领与回滚
 * 由 `runtime.recovery` 负责。提交按作品根排队，提交前先回收属主已死的事务目录。
 */
import { copyFile, cp, lstat, mkdir, mkdtemp, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, isAbsolute, join, normalize, resolve, sep } from 'node:path'

export interface FileWrite {
  relativePath: string
  content: string
}

export interface CommitResult {
  written: string[]
  deleted: string[]
}

/** 事务目录里的提交日志文件名。 */
export const JOURNAL_FILE = 'journal.json'

/** 事务目录前缀；自检按它扫描作品根。 */
export const TXN_PREFIX = '.inkos-file-txn-'

/** 一次提交触及的一条路径：本次请求的路径，以及提交前它是否存在。 */
export interface CommitEntry {
  path: string
  existed: boolean
}

/** 一次提交的阶段与内容；写到一半的日志由自检按「读不出来」处理。 */
export interface CommitJournal {
  version: 1
  /** 写这批文件的进程；自检用 liveness 判断属主是否已经死了。 */
  pid: number
  phase: 'prepared' | 'committed'
  entries: CommitEntry[]
}

/** 进程是否还活着；`ESRCH` 才算已死，其它错误（如 `EPERM`）一律当活着，宁可不碰。 */
export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

/** 解析提交日志；形状不对就是 `undefined`，交给「读不出来」的分支。 */
export function parseJournal(raw: string): CommitJournal | undefined {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (value === null || typeof value !== 'object') return undefined
  const journal = value as Partial<CommitJournal>
  if (Object.keys(journal).some((key) => !['version', 'pid', 'phase', 'entries'].includes(key))) return undefined
  if (journal.version !== 1) return undefined
  if (journal.phase !== 'prepared' && journal.phase !== 'committed') return undefined
  if (!Number.isInteger(journal.pid) || (journal.pid as number) < 0) return undefined
  if (!Array.isArray(journal.entries)) return undefined
  for (const entry of journal.entries) {
    if (entry === null || typeof entry !== 'object') return undefined
    if (Object.keys(entry).some((key) => !['path', 'existed'].includes(key))) return undefined
    const record = entry as Partial<CommitEntry>
    if (typeof record.path !== 'string' || typeof record.existed !== 'boolean') return undefined
  }
  return journal as CommitJournal
}

/** 路径存在与否；只把 ENOENT 当成「不在」，其它错误照常抛出。 */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/**
 * 校验并规范化一条相对路径：不能为空、不能是绝对路径、不能跳出作品根。
 * @param relativePath 调用方给的路径
 * @returns 规范化后的相对路径
 */
export function safeRelativePath(relativePath: string): string {
  const normalized = normalize(relativePath)
  if (
    relativePath.trim() === ''
    || isAbsolute(relativePath)
    || normalized === '..'
    || normalized.startsWith(`..${sep}`)
  ) {
    throw new Error(`提交路径必须留在作品根内：${JSON.stringify(relativePath)}`)
  }
  return normalized
}

/** 按根排队的提交队列；前一批失败不阻塞后一批。 */
const queues = new Map<string, Promise<unknown>>()

/**
 * 同一作品根上的任务串行执行。
 * @param root 作品根
 * @param task 要执行的任务
 */
export async function withCommitQueue<T>(root: string, task: () => Promise<T>): Promise<T> {
  const key = resolve(root)
  const prior = queues.get(key) ?? Promise.resolve()
  const next = prior.catch(() => undefined).then(task)
  queues.set(key, next)
  try {
    return await next
  } finally {
    if (queues.get(key) === next) queues.delete(key)
  }
}

/** 写一份提交日志：临时文件 + fsync + rename，崩溃不会留下半份日志。 */
async function writeJournal(transaction: string, journal: CommitJournal): Promise<void> {
  const temporary = join(transaction, 'journal.next')
  const handle = await open(temporary, 'w', 0o600)
  try {
    await handle.writeFile(JSON.stringify(journal))
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(temporary, join(transaction, JOURNAL_FILE))
}

/**
 * 按备份还原：有备份就复制回来；没有备份且提交前不存在就删掉半套产物。
 * @param base 作品根
 * @param backupDir 备份目录
 * @param entries 本次提交触及的条目
 */
export async function restoreFromBackups(
  base: string,
  backupDir: string,
  entries: ReadonlyArray<CommitEntry>,
): Promise<void> {
  for (const entry of entries) {
    let relativePath: string
    try {
      relativePath = safeRelativePath(entry.path)
    } catch {
      continue
    }
    const backup = join(backupDir, relativePath)
    const target = resolve(base, relativePath)
    if (await pathExists(backup)) {
      await mkdir(dirname(target), { recursive: true })
      if ((await lstat(backup)).isDirectory()) await cp(backup, target, { recursive: true, force: true })
      else await copyFile(backup, target)
      continue
    }
    if (!entry.existed) await rm(target, { force: true, recursive: true })
  }
}

/**
 * 回收属主已死的事务目录：`committed` 直接删，`prepared` 按备份与 `existed` 恢复。
 * 没有日志的目录、活属主的目录都不动。
 * @param base 作品根
 */
export async function recoverDeadTransactions(base: string): Promise<void> {
  let entries
  try {
    entries = await readdir(base, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(TXN_PREFIX)) continue
    const transaction = join(base, entry.name)
    let raw: string
    try {
      raw = await readFile(join(transaction, JOURNAL_FILE), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    const journal = parseJournal(raw)
    if (journal === undefined) throw new Error(`事务目录 ${transaction} 的提交日志读不出来`)
    if (pidAlive(journal.pid)) continue
    if (journal.phase === 'prepared') {
      await restoreFromBackups(base, join(transaction, 'backup'), journal.entries)
    }
    await rm(transaction, { recursive: true, force: true })
  }
}

/**
 * @param root 作品根目录
 * @param plan 写入与删除清单；写入项的内容先落 staged
 */
export async function commitFoundation(
  root: string,
  { writes, deletes = [] }: { writes: ReadonlyArray<FileWrite>, deletes?: ReadonlyArray<string> },
): Promise<CommitResult> {
  const base = resolve(root)
  if (writes.length === 0 && deletes.length === 0) return { written: [], deleted: [] }
  return withCommitQueue(base, () => commitBatch(base, writes, deletes))
}

/** 实际执行一批提交；调用方已保证队列与空批处理。 */
async function commitBatch(
  base: string,
  rawWrites: ReadonlyArray<FileWrite>,
  rawDeletes: ReadonlyArray<string>,
): Promise<CommitResult> {
  await recoverDeadTransactions(base)
  const writes = rawWrites.map((write) => ({ ...write, relativePath: safeRelativePath(write.relativePath) }))
  const deletes = rawDeletes.map(safeRelativePath)
  const writePaths = new Set(writes.map((write) => write.relativePath))
  if (writePaths.size !== writes.length) throw new Error('同一批提交不能重复写同一路径')
  if (deletes.some((relativePath) => writePaths.has(relativePath))) {
    throw new Error('同一批提交不能既写又删同一路径')
  }
  const allPaths = [...writePaths, ...deletes]
  if (allPaths.some((path) => allPaths.some((other) => other !== path && other.startsWith(`${path}${sep}`)))) {
    throw Object.assign(new Error('同一批提交不能同时触达目录和它的子路径'), { code: 'ATOMIC_PATH_OVERLAP' })
  }

  await mkdir(base, { recursive: true })
  const transaction = await mkdtemp(join(base, TXN_PREFIX))
  const stagedDir = join(transaction, 'staged')
  const backupDir = join(transaction, 'backup')
  const touched = [...writes.map((write) => write.relativePath), ...deletes]
  const entries: CommitEntry[] = []
  let journal: CommitJournal | undefined
  let journalWritten = false
  try {
    for (const path of touched) {
      entries.push({ path, existed: await pathExists(resolve(base, path)) })
    }
    journal = {
      version: 1,
      pid: process.pid,
      phase: 'prepared',
      entries,
    }

    await mkdir(stagedDir, { recursive: true })
    await mkdir(backupDir, { recursive: true })

    for (const { relativePath, content } of writes) {
      const staged = join(stagedDir, relativePath)
      await mkdir(dirname(staged), { recursive: true })
      await writeFile(staged, content, 'utf8')
    }

    // 日志先行：崩溃在备份中途时，自检按 entries 的 existed 判断哪些目标还没被搬走。
    await writeJournal(transaction, journal)
    journalWritten = true

    for (const entry of entries) {
      const target = resolve(base, entry.path)
      await mkdir(dirname(target), { recursive: true })
      if (!(await pathExists(target))) continue
      const backup = join(backupDir, entry.path)
      await mkdir(dirname(backup), { recursive: true })
      await rename(target, backup)
    }

    for (const { relativePath } of writes) {
      const target = resolve(base, relativePath)
      await mkdir(dirname(target), { recursive: true })
      await rename(join(stagedDir, relativePath), target)
    }

    await writeJournal(transaction, { ...journal, phase: 'committed' })
  } catch (error) {
    if (journalWritten && journal !== undefined) {
      let rollbackError: unknown
      try {
        await restoreFromBackups(base, backupDir, entries)
      } catch (failure) {
        rollbackError = failure
        // 回滚也失败：把日志属主改成 0，下一次提交或自检可以接管并保留现场。
        try {
          await writeJournal(transaction, { ...journal, pid: 0 })
        } catch {
          // 连日志都写不了：目录仍然保留，留给人工处理。
        }
      }
      if (rollbackError !== undefined) {
        throw new AggregateError([error, rollbackError], '提交失败且回滚失败；事务日志已保留')
      }
    }
    await rm(transaction, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }

  // 清理失败不能回滚已经提交的文件；留下的 committed 事务由自检清理。
  await rm(transaction, { recursive: true, force: true }).catch(() => undefined)
  return { written: writes.map((write) => write.relativePath), deleted: [...deletes] }
}

/**
 * 单文件写入：同目录临时文件写完再 rename。
 *
 * 与 `commitFoundation` 分工：后者服务多文件批量替换，要 staged 与备份回滚；
 * 单写一份身份文件没有旧内容要保留，也不该为了写它就先把 `source/` 建出来。
 * @param root 作品根目录
 * @param relativePath 相对根本的路径
 * @param content 完整文件内容
 */
export async function commitFile(root: string, relativePath: string, content: string): Promise<void> {
  const target = resolve(root, relativePath)
  const dir = dirname(target)
  await mkdir(dir, { recursive: true })
  // 临时文件名带 pid：崩溃后自检能判断这个残留的属主是否还活着。
  const tmp = join(dir, `.tmp-${process.pid}-${randomUUID()}`)
  try {
    await writeFile(tmp, content, 'utf8')
    await rename(tmp, target)
  } catch (error) {
    await rm(tmp, { force: true })
    throw error
  }
}
