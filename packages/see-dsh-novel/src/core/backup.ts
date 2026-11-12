/**
 * 整本备份与恢复：作品拥有项 = `work.json` + `source/`。
 *
 * 备份放在工作区 `.backups/`；恢复只替换这两项，工作区根上的 `.git`、作者文件、
 * 导出文件与 `.backups/` 不动。备份与恢复都不读 `work.json`，作品损坏时仍可用。
 */
import type { Dirent } from 'node:fs'
import { access, cp, mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

import { recoverDeadTransactions, TXN_PREFIX } from './commit.js'

export const BACKUPS_DIR = '.backups'
export const DEAD_TXN_PREFIX = '.dead-txn-'

const LOCK_FILE = '.write.lock'
const PANEL_INDEX = 'story/runtime/panel.index.json'

export interface BackupInfo {
  id: string
  createdAt: string
}

export interface CreateBackupResult {
  backupId: string
  path: string
}

export interface RestoreBackupResult {
  restoredFrom: string
  preRestoreBackupId: string | null
  isolatedTransactions: number
}

/** 与源 `formatStamp` 一致：UTC 到秒，去掉分隔符。 */
export function formatStamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-')
}

/** 备份根目录。 */
export function backupsDir(root: string): string {
  return join(root, BACKUPS_DIR)
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function copyOwnedItems(root: string, destination: string): Promise<void> {
  const workFile = join(root, 'work.json')
  if (await exists(workFile)) await cp(workFile, join(destination, 'work.json'))
  const source = join(root, 'source')
  if (!(await exists(source))) return
  await cp(source, join(destination, 'source'), {
    recursive: true,
    filter: (entry) => {
      const path = relative(source, entry).split(sep).join('/')
      return path !== LOCK_FILE && path !== PANEL_INDEX
    },
  })
}

async function pickBackupId(dir: string, base: string): Promise<string> {
  let candidate = base
  for (let suffix = 2; await exists(join(dir, candidate)); suffix += 1) candidate = `${base}-${suffix}`
  return candidate
}

/**
 * 创建一次整本备份。
 * @param root 工作区根
 * @param options 可注入时钟与后缀
 */
export async function createBackup(
  root: string,
  options: { now?: () => Date, suffix?: string } = {},
): Promise<CreateBackupResult> {
  const info = await stat(root).catch(() => null)
  if (info === null || !info.isDirectory()) throw new Error(`工作区不存在：${root}`)
  const dir = backupsDir(root)
  await mkdir(dir, { recursive: true })
  const base = options.suffix === undefined
    ? formatStamp((options.now ?? (() => new Date()))())
    : `${formatStamp((options.now ?? (() => new Date()))())}-${options.suffix}`
  const backupId = await pickBackupId(dir, base)
  const path = join(dir, backupId)
  await mkdir(path, { recursive: true })
  await copyOwnedItems(root, path)
  return { backupId, path }
}

/** 列出备份，按 id 倒序（时间戳前缀保证最新在前）。 */
export async function listBackups(root: string): Promise<BackupInfo[]> {
  let entries: Dirent[]
  try {
    entries = await readdir(backupsDir(root), { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const backups: BackupInfo[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const info = await stat(join(backupsDir(root), entry.name))
    backups.push({ id: entry.name, createdAt: info.mtime.toISOString() })
  }
  return backups.sort((left, right) => right.id.localeCompare(left.id))
}

/** 恢复前判据：锁内看 `work.json`，或 `source/` 里除活动锁外的条目。 */
async function hasWorkContent(root: string): Promise<boolean> {
  if (await exists(join(root, 'work.json'))) return true
  let entries: string[]
  try {
    entries = await readdir(join(root, 'source'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
  return entries.some((entry) => entry !== LOCK_FILE)
}

/** 回收死事务；失败时把根下所有事务目录隔离为 `.dead-txn-*`，返回隔离数量。 */
async function recoverOrIsolateTransactions(root: string): Promise<number> {
  try {
    await recoverDeadTransactions(root)
    return 0
  } catch (error) {
    const entries = await readdir(root, { withFileTypes: true })
    const dead = entries.filter((entry) => entry.isDirectory() && entry.name.startsWith(TXN_PREFIX))
    const failures: unknown[] = []
    let isolated = 0
    for (const [index, entry] of dead.entries()) {
      try {
        await rename(
          join(root, entry.name),
          join(root, `${DEAD_TXN_PREFIX}${entry.name.slice(TXN_PREFIX.length)}-${index}`),
        )
        isolated += 1
      } catch (failure) {
        failures.push(failure)
      }
    }
    if (failures.length > 0) {
      throw new AggregateError([error, ...failures], '无法回收或隔离崩溃事务，恢复中止')
    }
    return isolated
  }
}

/** 删除作品拥有项，保留 `source/.write.lock` 与工作区根其它条目。 */
async function clearOwnedItems(root: string): Promise<void> {
  await rm(join(root, 'work.json'), { force: true })
  let entries: string[]
  try {
    entries = await readdir(join(root, 'source'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  for (const entry of entries) {
    if (entry === LOCK_FILE) continue
    await rm(join(root, 'source', entry), { recursive: true, force: true })
  }
}

/**
 * 从备份恢复作品拥有项。
 * @param root 工作区根
 * @param backupId 备份 id
 * @param options 可注入时钟
 */
export async function restoreBackup(
  root: string,
  backupId: string,
  options: { now?: () => Date } = {},
): Promise<RestoreBackupResult> {
  if (!/^[A-Za-z0-9._-]+$/u.test(backupId) || backupId === '.' || backupId === '..') {
    throw new Error(`备份 id 不合法：${backupId}`)
  }
  const backupPath = join(backupsDir(root), backupId)
  const info = await stat(backupPath).catch(() => null)
  if (info === null || !info.isDirectory()) throw new Error(`找不到备份：${backupId}`)

  const preRestore = await hasWorkContent(root)
    ? await createBackup(root, { now: options.now, suffix: 'pre-restore' })
    : null
  const isolatedTransactions = await recoverOrIsolateTransactions(root)

  await clearOwnedItems(root)
  const backupWork = join(backupPath, 'work.json')
  if (await exists(backupWork)) await cp(backupWork, join(root, 'work.json'))
  const backupSource = join(backupPath, 'source')
  if (await exists(backupSource)) {
    await cp(backupSource, join(root, 'source'), { recursive: true })
  }

  return {
    restoredFrom: backupId,
    preRestoreBackupId: preRestore?.backupId ?? null,
    isolatedTransactions,
  }
}
