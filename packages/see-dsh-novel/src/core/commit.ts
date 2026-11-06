/**
 * 整批写入：先 staging，再备份目标，再 rename 到位；失败用备份回滚。
 *
 * 暂存目录里写一份 `journal.json`（阶段 + 属主 pid + 写入/删除清单 + 提交前已存在的
 * 目标），让崩溃后的下一次运行能判断这批文件改到哪一步；认领与回滚由
 * `runtime.recovery` 负责。提交按作品根排队，提交前先回收属主已死的暂存目录。
 */
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
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

/** 暂存目录里的提交日志文件名。 */
export const JOURNAL_FILE = 'journal.json'

/** 暂存目录前缀；自检按它扫描。 */
export const STAGING_PREFIX = '.staging-'

/** 一次提交的阶段与内容；写到一半的日志由自检按「读不出来」处理。 */
export interface CommitJournal {
  version: 1
  /** 写这批文件的进程；自检用 liveness 判断属主是否已经死了。 */
  pid: number
  phase: 'prepared' | 'applied'
  writes: string[]
  deletes: string[]
  /** 提交前已经存在的目标；旧日志没有这个字段。 */
  existed?: string[]
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
  if (journal.version !== 1) return undefined
  if (journal.phase !== 'prepared' && journal.phase !== 'applied') return undefined
  if (typeof journal.pid !== 'number') return undefined
  if (!Array.isArray(journal.writes) || journal.writes.some((entry) => typeof entry !== 'string')) return undefined
  if (!Array.isArray(journal.deletes) || journal.deletes.some((entry) => typeof entry !== 'string')) return undefined
  if (journal.existed !== undefined
    && (!Array.isArray(journal.existed) || journal.existed.some((entry) => typeof entry !== 'string'))) {
    return undefined
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

/** 写一份提交日志；调用方决定失败时是否吞掉。 */
async function writeJournal(staging: string, journal: CommitJournal): Promise<void> {
  await writeFile(join(staging, JOURNAL_FILE), `${JSON.stringify(journal, null, 2)}\n`, 'utf8')
}

/**
 * 回收属主已死的暂存目录：`applied` 直接删，`prepared` 按备份与 `existed` 恢复。
 * 没有日志的目录、活属主的目录都不动。
 * @param base 作品根
 */
export async function recoverDeadStaging(base: string): Promise<void> {
  const sourceDir = join(base, 'source')
  let entries
  try {
    entries = await readdir(sourceDir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(STAGING_PREFIX)) continue
    const staging = join(sourceDir, entry.name)
    let raw: string
    try {
      raw = await readFile(join(staging, JOURNAL_FILE), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    const journal = parseJournal(raw)
    if (journal === undefined) throw new Error(`暂存目录 ${staging} 的提交日志读不出来`)
    if (pidAlive(journal.pid)) continue
    if (journal.phase === 'prepared') await restoreDeadPrepared(base, staging, journal)
    await rm(staging, { recursive: true, force: true })
  }
}

/** 恢复一批已死属主的 `prepared` 提交；没有备份且原目标不存在的才删除。 */
async function restoreDeadPrepared(base: string, staging: string, journal: CommitJournal): Promise<void> {
  const backupDir = join(staging, 'backup')
  const existed = journal.existed ?? []
  for (const relativePath of [...journal.writes, ...journal.deletes]) {
    let safePath: string
    try {
      safePath = safeRelativePath(relativePath)
    } catch {
      continue
    }
    const backup = join(backupDir, safePath)
    const target = resolve(base, safePath)
    if (await pathExists(backup)) {
      await mkdir(dirname(target), { recursive: true })
      await rm(target, { recursive: true, force: true })
      await cp(backup, target, { recursive: true, force: true })
    } else if (!existed.includes(relativePath)) {
      // 没有备份、提交前也不存在：这是半套产物。旧日志没有 existed，保守不动。
      if (journal.existed !== undefined) await rm(target, { force: true })
    }
  }
}

/**
 * @param root 作品根目录
 * @param plan 写入与删除清单；写入项的内容先落 staging
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
  await recoverDeadStaging(base)
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

  const staging = join(base, 'source', `${STAGING_PREFIX}${randomUUID()}`)
  const workDir = join(staging, 'work')
  const backupDir = join(staging, 'backup')
  const touched = [...writes.map((write) => write.relativePath), ...deletes]
  const applied: string[] = []
  const existed: string[] = []
  for (const relativePath of touched) {
    if (await pathExists(resolve(base, relativePath))) existed.push(relativePath)
  }
  const journal: CommitJournal = {
    version: 1,
    pid: process.pid,
    phase: 'prepared',
    writes: writes.map((write) => write.relativePath),
    deletes: [...deletes],
    existed,
  }

  let journalWritten = false
  try {
    await mkdir(workDir, { recursive: true })
    await mkdir(backupDir, { recursive: true })

    for (const { relativePath, content } of writes) {
      const staged = join(workDir, relativePath)
      await mkdir(dirname(staged), { recursive: true })
      await writeFile(staged, content, 'utf8')
    }

    // 日志先行：崩溃在备份中途时，自检按 existed 判断哪些目标还没被搬走。
    await writeJournal(staging, journal)
    journalWritten = true

    for (const relativePath of touched) {
      const target = resolve(base, relativePath)
      if (!(await pathExists(target))) continue
      const backup = join(backupDir, relativePath)
      await mkdir(dirname(backup), { recursive: true })
      await cp(target, backup, { recursive: true })
    }

    for (const { relativePath } of writes) {
      const target = resolve(base, relativePath)
      await mkdir(dirname(target), { recursive: true })
      await rm(target, { force: true, recursive: true })
      await rename(join(workDir, relativePath), target)
      applied.push(relativePath)
    }

    for (const relativePath of deletes) {
      await rm(resolve(base, relativePath), { force: true, recursive: true })
    }

    // 标记已经是尽力而为：写失败不能让下面的 catch 把已应用的文件回滚掉。
    try {
      await writeJournal(staging, { ...journal, phase: 'applied' })
    } catch {
      try {
        await rm(join(staging, JOURNAL_FILE), { force: true })
      } catch {
        // 连删除都失败：留给自检报 staging-unknown，绝不回滚已应用的文件。
      }
    }

    await rm(staging, { recursive: true, force: true })
    return { written: writes.map((write) => write.relativePath), deleted: [...deletes] }
  } catch (error) {
    if (journalWritten) {
      try {
        await restore(base, backupDir, touched, applied, existed)
      } catch {
        // 回滚也失败：把日志属主改成 0，下一次提交或自检可以接管并保留现场。
        try {
          await writeJournal(staging, { ...journal, pid: 0 })
        } catch {
          // 连日志都写不了：目录仍然保留，留给人工处理。
        }
        throw error
      }
    }
    await rm(staging, { recursive: true, force: true })
    throw error
  }
}

/** 把备份写回原位；没有备份时按 `existed` 判断是否删除半套产物。 */
async function restore(
  base: string,
  backupDir: string,
  touched: ReadonlyArray<string>,
  applied: ReadonlyArray<string>,
  existed: ReadonlyArray<string>,
): Promise<void> {
  for (const relativePath of touched) {
    const backup = join(backupDir, relativePath)
    const target = resolve(base, relativePath)
    if (await pathExists(backup)) {
      await mkdir(dirname(target), { recursive: true })
      await rm(target, { recursive: true, force: true })
      await cp(backup, target, { recursive: true, force: true })
    } else if (applied.includes(relativePath) && !existed.includes(relativePath)) {
      await rm(target, { force: true })
    }
  }
}

/**
 * 单文件写入：同目录临时文件写完再 rename。
 *
 * 与 `commitFoundation` 分工：后者服务多文件批量替换，要 staging 与备份回滚；
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
