/**
 * 工作区自检与可重建的索引。
 *
 * 扫描给出发现，修复只做无歧义的几件事：重建缺失的索引、回收属主已死的提交残留、
 * 删除属主已死的临时文件。判据与动作都是纯函数组合，工具层只负责调它们。
 */
import { cp, readdir, readFile, rm } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'

import { readArtifacts } from './artifacts.js'
import { commitFile, JOURNAL_FILE, pathExists } from './commit.js'
import type { CommitJournal } from './commit.js'
import { defaultStateFiles } from './state.js'
import { readWork } from './work.js'

/** 发现项的严重程度。 */
export type Severity = 'info' | 'warning' | 'error'

/** 发现项的分类。 */
export type FindingCode =
  | 'unbound'
  | 'work-missing'
  | 'work-invalid'
  | 'foundation-empty'
  | 'state-missing'
  | 'hooks-missing'
  | 'staging-active'
  | 'staging-rollback'
  | 'staging-cleanup'
  | 'staging-unknown'
  | 'tmp-residue'

/** 一条发现。 */
export interface Finding {
  code: FindingCode
  severity: Severity
  /** 相对作品根；没有具体文件时是 null。 */
  path: string | null
  detail: string
  fixable: boolean
  /** 残留目录/临时文件的属主进程；只有暂存与临时文件会带。 */
  pid?: number
}

/** 一次扫描的结果。 */
export interface RecoveryScan {
  root: string
  findings: Finding[]
  /** 扫描时的工件集合：文件数与摘要。 */
  digest: string
  files: number
}

const STATE_DIR = 'source/story/state'
/** 三个可重建的索引；`hooks.json` 不在其中（伏笔池是创作事实）。 */
const INDEX_FILES = ['manifest.json', 'current_state.json', 'chapter_summaries.json'] as const
const WORK_DIR = 'source/story'

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
  return journal as CommitJournal
}

/** 递归列出目录里的文件（相对给定根）；目录不存在按空处理。 */
async function listFiles(root: string, prefix = ''): Promise<string[]> {
  const dir = join(root, prefix)
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const files: string[] = []
  for (const entry of entries) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) files.push(...await listFiles(root, path))
    else if (entry.isFile()) files.push(path)
  }
  return files
}

async function stagingFindings(root: string): Promise<Finding[]> {
  const source = join(root, 'source')
  let entries
  try {
    entries = await readdir(source, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const findings: Finding[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('.staging-')) continue
    const dir = join(source, entry.name)
    const path = `source/${entry.name}`
    let raw: string | undefined
    try {
      raw = await readFile(join(dir, JOURNAL_FILE), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const journal = raw === undefined ? undefined : parseJournal(raw)
    if (journal === undefined) {
      findings.push({
        code: 'staging-unknown',
        severity: 'warning',
        path,
        detail: '残留的提交暂存目录没有可读的日志；无法判断写到哪一步，留给人工检查。',
        fixable: false,
      })
      continue
    }
    if (pidAlive(journal.pid)) {
      findings.push({
        code: 'staging-active',
        severity: 'info',
        path,
        detail: `提交暂存目录的属主进程 ${journal.pid} 还活着，可能正在提交；不动它。`,
        fixable: false,
        pid: journal.pid,
      })
      continue
    }
    if (journal.phase === 'prepared') {
      findings.push({
        code: 'staging-rollback',
        severity: 'warning',
        path,
        detail: `属主进程 ${journal.pid} 已退出，提交停在应用之前；可以用备份还原。`,
        fixable: true,
        pid: journal.pid,
      })
    } else {
      findings.push({
        code: 'staging-cleanup',
        severity: 'info',
        path,
        detail: `属主进程 ${journal.pid} 已退出，文件都已应用；只需要清掉暂存目录。`,
        fixable: true,
        pid: journal.pid,
      })
    }
  }
  return findings
}

/** 临时文件的名字带 pid；旧格式（没有 pid）判不了属主，只报告。 */
function tmpPid(name: string): number | undefined {
  const match = /^\.tmp-(\d+)-/.exec(name)
  return match === null ? undefined : Number(match[1])
}

async function tmpFindings(root: string, files: ReadonlyArray<string>): Promise<Finding[]> {
  const findings: Finding[] = []
  const candidates = new Set<string>()
  // 工作区根的临时文件（`writeWork` 的 `work.json`）与工件目录里的（`commitFile` 重建索引）。
  try {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.startsWith('.tmp-')) candidates.add(entry.name)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  for (const file of files) {
    const name = file.split('/').at(-1) as string
    if (name.startsWith('.tmp-')) candidates.add(file)
  }
  for (const path of candidates) {
    const pid = tmpPid(path.split('/').at(-1) as string)
    if (pid === undefined) {
      findings.push({
        code: 'tmp-residue',
        severity: 'warning',
        path,
        detail: '临时文件没有属主信息，判断不了是否还在写；留给人工清理。',
        fixable: false,
      })
      continue
    }
    if (pidAlive(pid)) {
      findings.push({
        code: 'tmp-residue',
        severity: 'info',
        path,
        detail: `临时文件的属主进程 ${pid} 还活着，可能正在写；不动它。`,
        fixable: false,
        pid,
      })
      continue
    }
    findings.push({
      code: 'tmp-residue',
      severity: 'warning',
      path,
      detail: `属主进程 ${pid} 已退出；这个临时文件从未成为目标内容，可以删掉。`,
      fixable: true,
      pid,
    })
  }
  return findings
}

/**
 * 扫描一个工作区。
 * @param root 作品根
 * @returns 发现、工件摘要与文件数
 */
export async function scanWorkspace(root: string): Promise<RecoveryScan> {
  const base = resolve(root)
  const findings: Finding[] = []
  const artifacts = await readArtifacts(base)
  const workDirExists = await pathExists(join(base, WORK_DIR))
  const workExists = await pathExists(join(base, 'work.json'))
  let workValid = false
  if (workExists) {
    try {
      workValid = (await readWork(base)) !== null
    } catch (error) {
      findings.push({
        code: 'work-invalid',
        severity: 'error',
        path: 'work.json',
        detail: `身份文件读不出来：${(error as Error).message}`,
        fixable: false,
      })
    }
  }

  if (workValid) {
    if (artifacts.files.length === 0) {
      findings.push({
        code: 'foundation-empty',
        severity: 'info',
        path: null,
        detail: '已立项，但 source/story/ 下还没有任何文件；基础设定还没开始写。',
        fixable: false,
      })
    } else {
      for (const name of INDEX_FILES) {
        if (!artifacts.files.includes(`${STATE_DIR}/${name}`)) {
          findings.push({
            code: 'state-missing',
            severity: 'warning',
            path: `${STATE_DIR}/${name}`,
            detail: `状态索引 ${name} 缺失；可以按 foundation 的默认内容重建。`,
            fixable: true,
          })
        }
      }
      if (!artifacts.files.includes(`${STATE_DIR}/hooks.json`)) {
        findings.push({
          code: 'hooks-missing',
          severity: 'warning',
          path: `${STATE_DIR}/hooks.json`,
          detail: '伏笔池缺失；它是创作事实，不能补空，等作者或重跑 details 段。',
          fixable: false,
        })
      }
    }
  } else if (!workExists) {
    if (artifacts.files.length === 0 && !workDirExists) {
      findings.push({
        code: 'unbound',
        severity: 'info',
        path: null,
        detail: '还没有立项，也没有作品内容。',
        fixable: false,
      })
    } else if (artifacts.files.length > 0) {
      findings.push({
        code: 'work-missing',
        severity: 'warning',
        path: 'work.json',
        detail: '有作品内容但没有 work.json；身份要作者给标题，工具不猜。',
        fixable: false,
      })
    }
  }

  findings.push(...await stagingFindings(base))
  findings.push(...await tmpFindings(base, artifacts.files))
  return { root: base, findings, digest: artifacts.digest, files: artifacts.files.length }
}

/** 用备份还原一份 `prepared` 提交，恢复失败时保持暂存目录原样。 */
async function rollback(root: string, staging: string, journal: CommitJournal): Promise<void> {
  const backupDir = join(staging, 'backup')
  for (const relativePath of [...journal.writes, ...journal.deletes]) {
    const target = resolve(root, relativePath)
    const backup = join(backupDir, relativePath)
    if (await pathExists(backup)) {
      await cp(backup, target, { force: true })
      continue
    }
    if (journal.writes.includes(relativePath)) await rm(target, { force: true })
  }
  await rm(staging, { recursive: true, force: true })
}

/**
 * 修复可以安全重建的发现；返回动过的路径。
 * @param root 作品根
 * @param findings 扫描结果（只用 `fixable` 的项）
 * @returns 实际写入或删除过的路径
 */
export async function repairWorkspace(root: string, findings: ReadonlyArray<Finding>): Promise<string[]> {
  const base = resolve(root)
  const defaults = new Map(defaultStateFiles([]).map((write) => [write.relativePath, write.content]))
  const applied: string[] = []
  for (const finding of findings) {
    if (!finding.fixable || finding.path === null) continue
    if (finding.code === 'state-missing') {
      const content = defaults.get(finding.path)
      if (content === undefined) continue
      await commitFile(base, finding.path, content)
      applied.push(finding.path)
      continue
    }
    if (finding.code === 'staging-rollback' || finding.code === 'staging-cleanup') {
      const staging = join(base, finding.path)
      if (finding.code === 'staging-cleanup') {
        await rm(staging, { recursive: true, force: true })
        applied.push(finding.path)
        continue
      }
      const raw = await readFile(join(staging, JOURNAL_FILE), 'utf8')
      const journal = parseJournal(raw)
      if (journal === undefined) continue
      await rollback(base, staging, journal)
      applied.push(finding.path)
      continue
    }
    if (finding.code === 'tmp-residue') {
      await rm(join(base, finding.path), { force: true })
      applied.push(finding.path)
    }
  }
  return applied
}

/** 删掉一段路径的公共前缀，用于展示。 */
export function relativeOf(root: string, path: string): string {
  return relative(resolve(root), resolve(root, path)).split(sep).join('/')
}
