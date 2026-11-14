/**
 * 结算提案文件：`.drafts/settlement-NNNN.json`。
 *
 * 它是发布前的校验物，不是作品内容：不进 `source/`、不建 artifact、不进备份；
 * 提交成功或扣下后随同一次提交删除。
 */
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { DRAFT_DIR } from './chapter-draft.js'
import { commitFile } from './commit.js'
import {
  baselineDigest as digestOfBaseline,
  buildSettlementProposal,
  documentDigest as digestOfDocument,
  settlementDigest,
  settlementError,
} from './settlement.js'
import type { SettlementKind, SettlementPayload, SettlementReceipt } from './settlement.js'
import type { StateSnapshot } from './state.js'
import type { ProjectionLanguage } from './state-projections.js'

export interface SettlementProposalFile {
  version: 1
  kind: SettlementKind
  chapter: number
  baselineChapter: number
  status: 'proposed' | 'reconciliation-required'
  payload: SettlementPayload
  digest: string
  failureReport?: string
}

const pad = (chapter: number): string => String(chapter).padStart(4, '0')

export function settlementProposalPath(chapter: number): string {
  return `${DRAFT_DIR}/settlement-${pad(chapter)}.json`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function unavailable(message: string): never {
  throw settlementError('SETTLEMENT_PROPOSAL_UNAVAILABLE', message)
}

function assertPayload(payload: unknown, chapter: number): SettlementPayload {
  if (!isRecord(payload)) unavailable('提案载荷必须是对象')
  if (payload.version !== 1) unavailable('提案载荷版本不合法')
  if (payload.kind !== 'settle' && payload.kind !== 'resettle') unavailable('提案 kind 不合法')
  if (payload.chapter !== chapter) unavailable(`提案章号与文件不一致：载荷 ${String(payload.chapter)}，文件 ${chapter}`)
  if (!Number.isInteger(payload.baselineChapter) || (payload.baselineChapter as number) < 0) unavailable('提案基线章号不合法')
  if (payload.attempt !== 1 && payload.attempt !== 2) unavailable('提案 attempt 不合法')
  for (const key of ['baselineDigest', 'documentDigest', 'previousState', 'proposedState', 'previousHooks', 'proposedHooks', 'previousChapterSummaries']) {
    if (typeof payload[key] !== 'string') unavailable(`提案 ${key} 必须是字符串`)
  }
  if (!isRecord(payload.delta) || !Number.isInteger(payload.delta.chapter) || typeof payload.delta.postSettlement !== 'string') {
    unavailable('提案增量形状不合法')
  }
  return payload as unknown as SettlementPayload
}

/**
 * 读提案文件并校验自洽性；不存在返回 null。
 * @param root 作品根
 * @param chapter 章号
 */
export async function readSettlementProposal(root: string, chapter: number): Promise<SettlementProposalFile | null> {
  let raw: string
  try {
    raw = await readFile(join(root, settlementProposalPath(chapter)), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    unavailable(`第 ${chapter} 章结算提案不是合法 JSON；重新生成提案`)
  }
  if (!isRecord(parsed)) unavailable(`第 ${chapter} 章结算提案必须是对象`)
  if (parsed.version !== 1) unavailable('提案版本不合法')
  if (parsed.kind !== 'settle' && parsed.kind !== 'resettle') unavailable('提案 kind 不合法')
  if (parsed.chapter !== chapter) unavailable(`提案章号与文件不一致：${String(parsed.chapter)} / ${chapter}`)
  if (parsed.baselineChapter !== (isRecord(parsed.payload) ? parsed.payload.baselineChapter : undefined)) {
    unavailable('提案基线与载荷不一致')
  }
  if (parsed.status !== 'proposed' && parsed.status !== 'reconciliation-required') unavailable('提案状态不合法')
  if (typeof parsed.digest !== 'string' || parsed.digest === '') unavailable('提案缺少摘要')
  const failure = parsed.failureReport
  if (parsed.status === 'reconciliation-required') {
    if (typeof failure !== 'string' || failure.trim() === '') unavailable('失败提案缺少失败报告')
  } else if (failure !== undefined) {
    unavailable('未失败的提案不能带失败报告')
  }
  const payload = assertPayload(parsed.payload, chapter)
  if (payload.kind !== parsed.kind) unavailable('提案 kind 与载荷不一致')
  if (settlementDigest(payload) !== parsed.digest) unavailable('提案摘要与载荷不一致；重新生成提案')
  return {
    version: 1,
    kind: payload.kind,
    chapter,
    baselineChapter: payload.baselineChapter,
    status: parsed.status,
    payload,
    digest: parsed.digest,
    ...(parsed.status === 'reconciliation-required' ? { failureReport: failure as string } : {}),
  }
}

/** 原子写提案文件。 */
export async function writeSettlementProposal(root: string, file: SettlementProposalFile): Promise<void> {
  await commitFile(root, settlementProposalPath(file.chapter), `${JSON.stringify(file, null, 2)}\n`)
}

/**
 * 提案阶段读既有提案：坏提案点名删除路径后重建，不静默重置预算。
 * @param root 作品根
 * @param chapter 章号
 */
export async function readProposalForRegeneration(root: string, chapter: number): Promise<SettlementProposalFile | null> {
  try {
    return await readSettlementProposal(root, chapter)
  } catch (error) {
    if ((error as { code?: string }).code !== 'SETTLEMENT_PROPOSAL_UNAVAILABLE') throw error
    throw settlementError(
      'SETTLEMENT_PROPOSAL_UNAVAILABLE',
      `第 ${chapter} 章的结算提案不可用（${(error as Error).message}）；先删除 ${settlementProposalPath(chapter)} 再重新生成`,
    )
  }
}

/** 删除提案文件；不存在时静默。 */
export async function clearSettlementProposal(root: string, chapter: number): Promise<void> {
  await rm(join(root, settlementProposalPath(chapter)), { force: true })
}

/**
 * 同键判定：kind、正文摘要与基线摘要都相同才算同一次结算的重试。
 * @param file 既有提案
 * @param kind 本次结算来源
 * @param documentDigest 本次正文摘要
 * @param baselineDigest 本次基线摘要
 */
export function sameProposalKey(
  file: SettlementProposalFile,
  kind: SettlementKind,
  documentDigest: string,
  baselineDigest: string,
): boolean {
  return file.kind === kind
    && file.payload.documentDigest === documentDigest
    && file.payload.baselineDigest === baselineDigest
}

/**
 * 下一次提案的 attempt：同键已有 attempt 1 才升到 2，同键已是 2 时拒绝。
 * 正文或基线变了就是新一次结算，回到 attempt 1。
 * @param file 既有提案；没有时为 null
 * @param kind 本次结算来源
 * @param documentDigest 本次正文摘要
 * @param baselineDigest 本次基线摘要
 */
export function nextAttempt(
  file: SettlementProposalFile | null,
  kind: SettlementKind,
  documentDigest: string,
  baselineDigest: string,
): 1 | 2 {
  if (file === null || !sameProposalKey(file, kind, documentDigest, baselineDigest)) return 1
  if (file.payload.attempt === 2) {
    throw settlementError(
      'SETTLEMENT_PROPOSAL_BUDGET_EXHAUSTED',
      `第 ${file.chapter} 章的同一次结算已经用过一次重试；先提交现有提案，或改正文/基线后重新生成`,
    )
  }
  return 2
}

/** 把第一次对账失败写回提案：保留载荷与摘要，只加失败状态与完整报告。 */
export async function recordSettlementFailure(
  root: string,
  file: SettlementProposalFile,
  report: string,
): Promise<void> {
  await writeSettlementProposal(root, {
    ...file,
    status: 'reconciliation-required',
    failureReport: report,
  })
}

/**
 * 提交前重读正文与基线、逐字段重算，并核对提案与收据摘要。
 * @param input 提案、当前基线、当前正文、作品语言与收据
 * @returns 重算得到的结算后快照
 */
export function verifySettlementProposal(input: {
  proposal: SettlementProposalFile
  baseline: StateSnapshot
  documentText: string
  language: ProjectionLanguage
  receipt: SettlementReceipt
}): StateSnapshot {
  const { proposal, baseline, documentText, language, receipt } = input
  if (digestOfDocument(documentText) !== proposal.payload.documentDigest) {
    throw settlementError('SETTLEMENT_PROPOSAL_STALE', `第 ${proposal.chapter} 章的正文在生成提案后已变化；重新生成提案`)
  }
  if (digestOfBaseline(baseline) !== proposal.payload.baselineDigest) {
    throw settlementError('SETTLEMENT_PROPOSAL_STALE', `第 ${proposal.chapter} 章的基线在生成提案后已变化；重新生成提案`)
  }
  const recomputed = buildSettlementProposal({
    kind: proposal.kind,
    chapter: proposal.chapter,
    attempt: proposal.payload.attempt,
    baseline,
    delta: proposal.payload.delta,
    documentText,
    language,
  })
  if (recomputed.digest !== proposal.digest || recomputed.digest !== receipt.proposalDigest) {
    throw settlementError('SETTLEMENT_PROPOSAL_STALE', `第 ${proposal.chapter} 章的提案与重算或收据不一致；重新生成提案`)
  }
  return recomputed.settled
}
