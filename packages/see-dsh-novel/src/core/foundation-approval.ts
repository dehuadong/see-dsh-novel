/**
 * 作品级基础设定确认：只覆盖基础设定文件，章节写入不使确认失效。
 */
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { commitFile } from './commit.js'
import {
  STORY_FRAME_FILE,
  STORY_RULES_JSON,
  STORY_RULES_MD,
  STORY_ROOT,
  STORY_VOLUME_MAP_FILE,
} from './story-paths.js'

export const FOUNDATION_APPROVAL_PATH = `${STORY_ROOT}/runtime/foundation-approval.json`

const BASE_FILES = [STORY_FRAME_FILE, STORY_VOLUME_MAP_FILE, STORY_RULES_MD, STORY_RULES_JSON] as const

export interface FoundationApproval {
  version: 1
  state: 'approved' | 'rejected'
  digest: string
  approvedAt: string
  files: number
}

function roleFiles(root: string): string[] {
  const base = join(root, STORY_ROOT, 'roles')
  if (!existsSync(base)) return []
  const found: string[] = []
  const walk = (dir: string, prefix: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const absolute = join(dir, name)
      const relative = `${prefix}/${name}`
      const info = statSync(absolute)
      if (info.isDirectory()) walk(absolute, relative)
      else if (name.endsWith('.md')) found.push(relative)
    }
  }
  walk(base, `${STORY_ROOT}/roles`)
  return found
}

/** 基础设定文件清单：大纲、本书规则、角色卡；不含 pending_hooks/state/章节运行时。 */
export function foundationApprovalFiles(root: string): string[] {
  return [
    ...BASE_FILES.filter((file) => existsSync(join(root, file))),
    ...roleFiles(root),
  ].sort()
}

/** 基础设定摘要；文件集合为空时为空串。 */
export function foundationApprovalDigest(root: string): string {
  const files = foundationApprovalFiles(root)
  if (files.length === 0) return ''
  const hash = createHash('sha256')
  for (const file of files) {
    const content = readFileSync(join(root, file))
    hash.update(file)
    hash.update('\u0000')
    hash.update(String(content.byteLength))
    hash.update('\u0000')
    hash.update(content)
    hash.update('\u0000')
  }
  return hash.digest('hex')
}

export function readFoundationApproval(root: string): FoundationApproval | null {
  const absolute = join(root, FOUNDATION_APPROVAL_PATH)
  if (!existsSync(absolute)) return null
  try {
    const parsed = JSON.parse(readFileSync(absolute, 'utf8')) as Partial<FoundationApproval>
    if (parsed.version !== 1 || typeof parsed.digest !== 'string' || parsed.digest === ''
      || typeof parsed.approvedAt !== 'string' || typeof parsed.files !== 'number') return null
    if (parsed.state !== undefined && parsed.state !== 'approved' && parsed.state !== 'rejected') return null
    return { ...parsed, state: parsed.state ?? 'approved' } as FoundationApproval
  } catch {
    return null
  }
}

/** 当前基础设定是否已被作者确认；摘要不匹配即失效。 */
export function isFoundationApproved(root: string): boolean {
  const record = readFoundationApproval(root)
  if (record === null || record.state === 'rejected') return false
  const digest = foundationApprovalDigest(root)
  return digest !== '' && record.digest === digest
}

export async function writeFoundationApproval(root: string, expectedDigest?: string): Promise<FoundationApproval> {
  const digest = foundationApprovalDigest(root)
  if (digest === '') throw new Error('还没有基础设定可以确认：source/story 下没有大纲、规则或角色卡。')
  if (expectedDigest !== undefined && digest !== expectedDigest) {
    throw new Error('基础设定在确认期间发生变化，确认未写入；请重新 /story-approve')
  }
  const record: FoundationApproval = {
    version: 1,
    state: 'approved',
    digest,
    approvedAt: new Date().toISOString(),
    files: foundationApprovalFiles(root).length,
  }
  await commitFile(root, FOUNDATION_APPROVAL_PATH, `${JSON.stringify(record, null, 2)}\n`)
  return record
}

/** 作品级退回标记：保留在 runtime 里，阻止旧会话回执把确认重建回来。 */
export async function rejectFoundationApproval(root: string): Promise<FoundationApproval> {
  const digest = foundationApprovalDigest(root)
  const record: FoundationApproval = {
    version: 1,
    state: 'rejected',
    digest,
    approvedAt: new Date().toISOString(),
    files: foundationApprovalFiles(root).length,
  }
  await commitFile(root, FOUNDATION_APPROVAL_PATH, `${JSON.stringify(record, null, 2)}\n`)
  return record
}

export function clearFoundationApproval(root: string): void {
  rmSync(join(root, FOUNDATION_APPROVAL_PATH), { force: true })
}
