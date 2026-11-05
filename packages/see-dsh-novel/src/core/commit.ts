/**
 * 整批写入：先 staging，再备份目标，再 rename 到位；失败用备份回滚。
 *
 * 暂存目录里写一份 `journal.json`（阶段 + 属主 pid + 写入/删除清单），让崩溃后的
 * 下一次运行能判断这批文件改到哪一步；认领与回滚由 `runtime.recovery` 负责。
 */
import { cp, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'

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

/** 一次提交的阶段与内容；写到一半的日志由自检按「读不出来」处理。 */
export interface CommitJournal {
  version: 1
  /** 写这批文件的进程；自检用 liveness 判断属主是否已经死了。 */
  pid: number
  phase: 'prepared' | 'applied'
  writes: string[]
  deletes: string[]
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

/** 写一份提交日志；调用方决定失败时是否吞掉。 */
async function writeJournal(staging: string, journal: CommitJournal): Promise<void> {
  await writeFile(join(staging, JOURNAL_FILE), `${JSON.stringify(journal, null, 2)}\n`, 'utf8')
}

/**
 * @param root 作品根目录
 * @param plan 写入与删除清单；写入项的内容先落 staging
 */
export async function commitFoundation(
  root: string,
  { writes, deletes = [] }: { writes: ReadonlyArray<FileWrite>, deletes?: ReadonlyArray<string> },
): Promise<CommitResult> {
  if (writes.length === 0 && deletes.length === 0) return { written: [], deleted: [] }

  const base = resolve(root)
  const staging = join(base, 'source', `.staging-${randomUUID()}`)
  const workDir = join(staging, 'work')
  const backupDir = join(staging, 'backup')
  const touched = [...writes.map((write) => write.relativePath), ...deletes]
  const applied: string[] = []
  const journal: CommitJournal = {
    version: 1,
    pid: process.pid,
    phase: 'prepared',
    writes: writes.map((write) => write.relativePath),
    deletes: [...deletes],
  }

  try {
    await mkdir(workDir, { recursive: true })
    await mkdir(backupDir, { recursive: true })

    for (const { relativePath, content } of writes) {
      const staged = join(workDir, relativePath)
      await mkdir(dirname(staged), { recursive: true })
      await writeFile(staged, content, 'utf8')
    }

    for (const relativePath of touched) {
      const target = resolve(base, relativePath)
      if (!(await pathExists(target))) continue
      const backup = join(backupDir, relativePath)
      await mkdir(dirname(backup), { recursive: true })
      await cp(target, backup)
    }

    // 从这里开始才有东西需要回收：先落「准备应用」，再动目标。
    await writeJournal(staging, journal)

    for (const { relativePath } of writes) {
      const target = resolve(base, relativePath)
      await mkdir(dirname(target), { recursive: true })
      await rm(target, { force: true })
      await rename(join(workDir, relativePath), target)
      applied.push(relativePath)
    }

    for (const relativePath of deletes) {
      await rm(resolve(base, relativePath), { force: true })
    }

    // 标记已经是尽力而为：写失败不能让下面的 catch 把已应用的文件回滚掉。
    // 失败时删掉 prepared 日志，留下的目录只会被自检报成「读不出来」。
    try {
      await writeJournal(staging, { ...journal, phase: 'applied' })
    } catch {
      try {
        await rm(join(staging, JOURNAL_FILE), { force: true })
      } catch {
        // 连删除都失败：留给自检报 staging-unknown，绝不回滚已应用的文件。
      }
    }

    return { written: writes.map((write) => write.relativePath), deleted: [...deletes] }
  } catch (error) {
    await restore(base, backupDir, touched, applied)
    throw error
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

/** 把备份写回原位；没有备份且已写入的文件删除，避免留下半套产物。 */
async function restore(
  base: string,
  backupDir: string,
  touched: ReadonlyArray<string>,
  applied: ReadonlyArray<string>,
): Promise<void> {
  for (const relativePath of touched) {
    const backup = join(backupDir, relativePath)
    const target = resolve(base, relativePath)
    if (await pathExists(backup)) {
      await mkdir(dirname(target), { recursive: true })
      await cp(backup, target, { force: true })
    } else if (applied.includes(relativePath)) {
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
