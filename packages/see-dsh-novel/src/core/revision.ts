/**
 * 修订提案与修订结算提案：最新已发布章的两阶段修订事务。
 *
 * 阶段 A 只写提案与复审 start；审稿读提案正文；C1 写结算提案；C2 一次提交作品文件。
 */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { ReviseMode, ReviseRange } from './revise.js'
import type { SettlementProposalFile } from './settlement-proposal.js'

const pad = (chapter: number): string => String(chapter).padStart(4, '0')

export interface RevisionProposal {
  version: 1
  chapter: number
  title: string
  content: string
  contentDigest: string
  baseDigest: string
  changed: boolean
  mode: ReviseMode
  ranges?: ReviseRange[]
  replacements?: string[]
  targetText?: string
  createdAt: string
}

export function revisionProposalPath(chapter: number): string {
  return `.drafts/revision-${pad(chapter)}.json`
}

export function revisionSettlementPath(chapter: number): string {
  return `.drafts/revision-${pad(chapter)}.settlement.json`
}

/** 正文摘要；既作 revisionDigest，也用于 proposal/base 比对。 */
export function revisionDigest(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

export function renderRevisionProposal(proposal: RevisionProposal): string {
  return `${JSON.stringify(proposal, null, 2)}\n`
}

export async function readRevisionProposal(root: string, chapter: number): Promise<RevisionProposal | null> {
  let raw: string
  try {
    raw = await readFile(join(root, revisionProposalPath(chapter)), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  const value = JSON.parse(raw) as Partial<RevisionProposal>
  if (value.version !== 1 || value.chapter !== chapter || typeof value.content !== 'string'
    || typeof value.contentDigest !== 'string' || typeof value.baseDigest !== 'string'
    || typeof value.title !== 'string' || typeof value.changed !== 'boolean' || typeof value.createdAt !== 'string') {
    throw new Error(`第 ${chapter} 章的修订提案不合法；重新生成修订提案`)
  }
  if (revisionDigest(value.content) !== value.contentDigest) {
    throw new Error(`第 ${chapter} 章的修订提案正文与摘要不一致；重新生成修订提案`)
  }
  return value as RevisionProposal
}

export async function readRevisionSettlement(root: string, chapter: number): Promise<SettlementProposalFile | null> {
  try {
    return JSON.parse(await readFile(join(root, revisionSettlementPath(chapter)), 'utf8')) as SettlementProposalFile
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export function renderRevisionSettlement(proposal: SettlementProposalFile): string {
  return `${JSON.stringify(proposal, null, 2)}\n`
}
