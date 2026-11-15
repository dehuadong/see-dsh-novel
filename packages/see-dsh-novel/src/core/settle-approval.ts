/**
 * 首版结算的作品级作者确认标记；放在 `.drafts/`，不进签核摘要与备份。
 */
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { commitFile } from './commit.js'

export interface SettleApproval {
  version: 1
  chapter: number
  source: 'author'
  at: string
}

export function settleApprovalPath(chapter: number): string {
  return `.drafts/settle-approval-${String(chapter).padStart(4, '0')}.json`
}

/** 首版结算的适用态：不是修订复审、也不是已发布未结算。 */
export function isFirstVersionSettle(facts: { revisionReviewed?: boolean, chapterPublished?: boolean }): boolean {
  return facts.revisionReviewed !== true && facts.chapterPublished !== true
}

export function readSettleApproval(root: string, chapter: number): SettleApproval | null {
  const absolute = join(root, settleApprovalPath(chapter))
  if (!existsSync(absolute)) return null
  try {
    const parsed = JSON.parse(readFileSync(absolute, 'utf8')) as Partial<SettleApproval>
    if (parsed.version !== 1 || parsed.chapter !== chapter || parsed.source !== 'author' || typeof parsed.at !== 'string') return null
    return parsed as SettleApproval
  } catch {
    return null
  }
}

export async function writeSettleApproval(root: string, chapter: number): Promise<SettleApproval> {
  const record: SettleApproval = { version: 1, chapter, source: 'author', at: new Date().toISOString() }
  await commitFile(root, settleApprovalPath(chapter), `${JSON.stringify(record, null, 2)}\n`)
  return record
}

export function clearSettleApproval(root: string, chapter: number): void {
  rmSync(join(root, settleApprovalPath(chapter)), { force: true })
}
