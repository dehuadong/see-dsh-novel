/**
 * 工作区自检与可重建的索引。
 *
 * 扫描给出发现，修复只做无歧义的几件事：重建缺失的索引、回收属主已死的提交残留、
 * 删除属主已死的临时文件。判据与动作都是纯函数组合，工具层只负责调它们。
 */
import { cp, readdir, readFile, rm } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'

import { readArtifacts } from './artifacts.js'
import { commitFile, JOURNAL_FILE, pathExists } from './commit.js'
import type { CommitJournal } from './commit.js'
import { defaultStateFiles } from './state.js'
import { readWork } from './work.js'

/** 发现项的严重程度。 */
export type Severity = 'info' | 'warning' | 'error'

/** 全部发现分类；schema 的枚举也从这里来。 */
export const FINDING_CODES = [
  'unbound',
  'work-missing',
  'work-invalid',
  'foundation-empty',
  'state-missing',
  'hooks-missing',
  'staging-active',
  'staging-rollback',
  'staging-cleanup',
  'staging-unknown',
  'tmp-residue',
] as const

/** 发现项的分类。 */
export type FindingCode = typeof FINDING_CODES[number]

/** 一条发现。 */
export interface Finding {
  code: FindingCode
  severity: Severity
  /** 相对作品根；没有具体文件时是 null。 */
  path: string | null
  detail: string
  fixable: boolean
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
const WORK_DIR = 'source/story'
/** 三个可重建的索引；`hooks.json` 不在其中（伏笔池是创作事实）。 */
const INDEX_FILES = ['manifest.json', 'current_state.json', 'chapter_summaries.json'] as const

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

/** 读一个目录；不存在按空处理，其它错误照常抛出。 */
async function entriesOf(dir: string) {
  try {
    return await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

/** 递归数目录里的文件；不存在按 0 处理。 */
async function countFiles(dir: string): Promise<number> {
  let total = 0
  for (const entry of await entriesOf(dir)) {
    if (entry.isDirectory()) total += await countFiles(join(dir, entry.name))
    else if (entry.isFile()) total += 1
  }
  return total
}

/** 提交残留：暂存目录按日志阶段处理，日志读不出来只报告。 */
async function stagingFindings(root: string): Promise<Finding[]> {
  const findings: Finding[] = []
  for (const entry of await entriesOf(join(root, 'source'))) {
    if (!entry.isDirectory() || !entry.name.startsWith('.staging-')) continue
    const dir = join(root, 'source', entry.name)
    const path = `source/${entry.name}`
    let raw: string | undefined
    try {
      raw = await readFile(join(dir, JOURNAL_FILE), 'utf8')
    } catch {
      // 读不出来（不存在、被占用、坏掉）与「没有日志」同样处理：只报告。
      raw = undefined
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
      })
      continue
    }
    if (journal.phase === 'prepared') {
      // 日志没来得及改成 applied 时，用「staged 文件是否已经全部搬走」判进展：
      // 全搬空了说明 rename 已完成，剩下的只是没写成的标记与清理。
      // 只有删除项的提交没有 staged 文件可看，判不出来，一律按回滚（宁可恢复）。
      const pending = journal.writes.length > 0 ? await countFiles(join(dir, 'work')) : 1
      if (pending === 0) {
        findings.push({
          code: 'staging-cleanup',
          severity: 'info',
          path,
          detail: `属主进程 ${journal.pid} 已退出；写入都已完成，只差清理暂存目录。`,
          fixable: true,
        })
      } else {
        findings.push({
          code: 'staging-rollback',
          severity: 'warning',
          path,
          detail: `属主进程 ${journal.pid} 已退出，提交没走完；可以用备份还原。`,
          fixable: true,
        })
      }
    } else {
      findings.push({
        code: 'staging-cleanup',
        severity: 'info',
        path,
        detail: `属主进程 ${journal.pid} 已退出，文件都已应用；只需要清掉暂存目录。`,
        fixable: true,
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

/** 临时文件：工作区根（`work.json`）与工件目录里的都可能残留。 */
async function tmpFindings(root: string, files: ReadonlyArray<string>): Promise<Finding[]> {
  const findings: Finding[] = []
  const candidates = new Set<string>()
  for (const entry of await entriesOf(root)) {
    if (entry.isFile() && entry.name.startsWith('.tmp-')) candidates.add(entry.name)
  }
  for (const file of files) {
    if ((file.split('/').at(-1) as string).startsWith('.tmp-')) candidates.add(file)
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
      })
      continue
    }
    findings.push({
      code: 'tmp-residue',
      severity: 'warning',
      path,
      detail: `属主进程 ${pid} 已退出；这个临时文件从未成为目标内容，可以删掉。`,
      fixable: true,
    })
  }
  return findings
}

/** 身份与索引：有工件就查索引，不管 `work.json` 是否可读。 */
function contentFindings(hasWork: boolean, workValid: boolean, files: ReadonlyArray<string>): Finding[] {
  const findings: Finding[] = []
  if (files.length === 0) {
    if (hasWork && workValid) {
      findings.push({
        code: 'foundation-empty',
        severity: 'info',
        path: null,
        detail: '已立项，但 source/story/ 下还没有任何文件；基础设定还没开始写。',
        fixable: false,
      })
    }
    return findings
  }
  for (const name of INDEX_FILES) {
    if (!files.includes(`${STATE_DIR}/${name}`)) {
      findings.push({
        code: 'state-missing',
        severity: 'warning',
        path: `${STATE_DIR}/${name}`,
        detail: `状态索引 ${name} 缺失；可以按 foundation 的默认内容重建。`,
        fixable: true,
      })
    }
  }
  if (!files.includes(`${STATE_DIR}/hooks.json`)) {
    findings.push({
      code: 'hooks-missing',
      severity: 'warning',
      path: `${STATE_DIR}/hooks.json`,
      detail: '伏笔池缺失；它是创作事实，不能补空，等作者或重跑 details 段。',
      fixable: false,
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
  const workExists = await pathExists(join(base, 'work.json'))
  const workDirExists = await pathExists(join(base, WORK_DIR))
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

  if (!workExists && artifacts.files.length === 0) {
    findings.push({
      code: 'unbound',
      severity: 'info',
      path: null,
      detail: workDirExists
        ? '没有 work.json，source/story/ 也是空的；还没立项。'
        : '还没有立项，也没有作品内容。',
      fixable: false,
    })
  } else if (!workExists) {
    findings.push({
      code: 'work-missing',
      severity: 'warning',
      path: 'work.json',
      detail: '有作品内容但没有 work.json；身份要作者给标题，工具不猜。',
      fixable: false,
    })
  }

  findings.push(...contentFindings(workExists, workValid, artifacts.files))
  findings.push(...await stagingFindings(base))
  findings.push(...await tmpFindings(base, artifacts.files))
  return { root: base, findings, digest: artifacts.digest, files: artifacts.files.length }
}

/** 把日志里的相对路径收回作品根内；越界的一律拒绝。 */
function contained(root: string, relativePath: string): string | undefined {
  const target = resolve(root, relativePath)
  const inside = target === resolve(root) || target.startsWith(`${resolve(root)}${sep}`)
  return inside ? target : undefined
}

/** 用备份还原一份 `prepared` 提交；越界路径跳过，整目录最后删掉。 */
async function rollback(root: string, staging: string, journal: CommitJournal): Promise<void> {
  const backupDir = join(staging, 'backup')
  for (const relativePath of [...journal.writes, ...journal.deletes]) {
    const target = contained(root, relativePath)
    if (target === undefined) continue
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
    if (finding.code === 'staging-cleanup') {
      await rm(join(base, finding.path), { recursive: true, force: true })
      applied.push(finding.path)
      continue
    }
    if (finding.code === 'staging-rollback') {
      const staging = join(base, finding.path)
      let raw: string
      try {
        raw = await readFile(join(staging, JOURNAL_FILE), 'utf8')
      } catch {
        continue
      }
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
