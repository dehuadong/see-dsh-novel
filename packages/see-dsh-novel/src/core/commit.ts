/**
 * 整批写入：先 staging，再备份目标，再 rename 到位；失败用备份回滚。
 *
 * 不引入持久 journal：本阶段写入方是单进程单次调用，跨进程恢复属于
 * `runtime.recovery` 那一行。
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
  const tmp = join(dir, `.tmp-${randomUUID()}`)
  try {
    await writeFile(tmp, content, 'utf8')
    await rename(tmp, target)
  } catch (error) {
    await rm(tmp, { force: true })
    throw error
  }
}
