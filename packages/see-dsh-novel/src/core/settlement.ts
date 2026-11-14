/**
 * 结算提案：把「施加增量后的真值投影」落成可校验、可绑定的提案载荷。
 *
 * 源工程把这份投影留在内存里交给状态校验 agent；DSH 工具跨调用无内存，所以由
 * 宿主渲染成提案文件、主编派 state-check 子代理读它，收据随提交调用回传。
 */
import { createHash } from 'node:crypto'
import type { IndexObservation } from './chapter-index.js'
import { applySettlement } from './settle.js'
import type { SettlementDelta } from './settle.js'
import { describeStateInconsistencies } from './state.js'
import type { StateSnapshot } from './state.js'
import {
  renderChapterSummariesProjection,
  renderCurrentStateProjection,
  renderHooksProjection,
} from './state-projections.js'
import type { ProjectionLanguage } from './state-projections.js'

/** 结算提案的两种来源：推进下一章、按 N-1 快照重算。 */
export type SettlementKind = 'settle' | 'resettle'

/** 状态校验的三种结论。 */
export const SETTLEMENT_OUTCOMES = ['consistent', 'reconciliation-required', 'unavailable'] as const
export type SettlementOutcome = typeof SETTLEMENT_OUTCOMES[number]

/** 结算工具的错误码；错误信息以 `码: 说明` 开头。 */
export type SettlementErrorCode =
  | 'SETTLEMENT_PROPOSAL_UNAVAILABLE'
  | 'SETTLEMENT_PROPOSAL_STALE'
  | 'SETTLEMENT_PROPOSAL_FAILED'
  | 'SETTLEMENT_PROPOSAL_BUDGET_EXHAUSTED'
  | 'SETTLEMENT_RECONCILIATION_REQUIRED'
  | 'SETTLEMENT_RECONCILIATION_UNRESOLVED'
  | 'STATE_RECONCILIATION_REASON_REQUIRED'

/** 带稳定错误码的结算错误。 */
export function settlementError(code: SettlementErrorCode, message: string): Error {
  return Object.assign(new Error(`${code}: ${message}`), { code })
}

/** 校验方提交的收据；与提案摘要绑定。 */
export interface SettlementReceipt {
  proposalDigest: string
  outcome: SettlementOutcome
  reportMarkdown: string
}

/** 提案载荷；校验方可见的字段与 `attempt` 全部在摘要覆盖范围内。 */
export interface SettlementPayload {
  version: 1
  kind: SettlementKind
  chapter: number
  baselineChapter: number
  attempt: 1 | 2
  baselineDigest: string
  documentDigest: string
  delta: SettlementDelta
  previousState: string
  proposedState: string
  previousHooks: string
  proposedHooks: string
  previousChapterSummaries: string
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`
}

/** 文本的 sha256（十六进制）。 */
export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** 正文文档原始字节的 sha256；含标题行，改标题也算漂移。 */
export function documentDigest(bytes: string | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** 基线四份状态 JSON 的规范化摘要。 */
export function baselineDigest(snapshot: StateSnapshot): string {
  return sha256(canonicalJson({
    manifest: snapshot.manifest,
    currentState: snapshot.currentState,
    hooks: snapshot.hooks,
    chapterSummaries: snapshot.chapterSummaries,
  }))
}

/** 提案载荷摘要。 */
export function settlementDigest(payload: SettlementPayload): string {
  return sha256(canonicalJson(payload))
}

/**
 * 校验基线快照的跨文件不变量；与源 `validateRuntimeState` 的三条对齐。
 * hook id 重复已由 `validateHooks` 在读取时拒绝。
 * @param snapshot 基线快照
 */
export function assertStateConsistent(snapshot: StateSnapshot): void {
  const problems = describeStateInconsistencies(snapshot)
  if (problems.length > 0) throw new Error(`状态不一致：${problems.join('；')}`)
}

/** 构造提案：渲染旧/新卡片，计算摘要。 */
export function buildSettlementProposal(input: {
  kind: SettlementKind
  chapter: number
  attempt: 1 | 2
  baseline: StateSnapshot
  delta: SettlementDelta
  documentText: string
  language: ProjectionLanguage
}): { payload: SettlementPayload; digest: string; settled: StateSnapshot } {
  const settled = applySettlement(input.baseline, input.delta).snapshot
  const payload: SettlementPayload = {
    version: 1,
    kind: input.kind,
    chapter: input.chapter,
    baselineChapter: input.baseline.manifest.lastAppliedChapter,
    attempt: input.attempt,
    baselineDigest: baselineDigest(input.baseline),
    documentDigest: documentDigest(input.documentText),
    delta: input.delta,
    previousState: renderCurrentStateProjection(input.baseline.currentState, input.language),
    proposedState: renderCurrentStateProjection(settled.currentState, input.language),
    previousHooks: renderHooksProjection(input.baseline.hooks, input.language),
    proposedHooks: renderHooksProjection(settled.hooks, input.language),
    previousChapterSummaries: renderChapterSummariesProjection(input.baseline.chapterSummaries, input.language),
  }
  return { payload, digest: settlementDigest(payload), settled }
}

/** 未解决观察：只有扣下与重算拒绝时进索引。 */
export function settlementObservations(
  receipt: SettlementReceipt,
  attempt: 1 | 2,
): IndexObservation[] {
  if (receipt.outcome === 'consistent') {
    const report = receipt.reportMarkdown.trim()
    return report === '' ? [] : [{ code: 'state-projection-review', summary: report, evidence: [] }]
  }
  if (receipt.outcome === 'reconciliation-required') {
    return [{ code: 'state-reconciliation', summary: receipt.reportMarkdown.trim(), evidence: [] }]
  }
  const reason = receipt.reportMarkdown.trim()
  const base = attempt === 1
    ? 'State validation was unavailable'
    : 'State reconciliation could not be verified'
  return [{
    code: 'state-validation-unavailable',
    summary: reason === '' ? base : `${base}: ${reason}`,
    evidence: [],
  }]
}

/** 源工程的重算反馈模板；主编把它原文交给 settler。 */
export function renderSettlementFeedback(
  observations: ReadonlyArray<IndexObservation>,
  language: ProjectionLanguage,
): string {
  if (observations.length === 0) {
    return language === 'en'
      ? 'The previous settlement contradicted the chapter text. Reconcile truth files strictly to the body.'
      : '上一次状态结算与正文矛盾。请严格以正文为准修正 truth files。'
  }
  const lines = observations.map((observation) => `- [${observation.code}] ${observation.summary}`)
  return language === 'en'
    ? ['The previous settlement needs reconciliation. Align these differences with the chapter body:', ...lines].join('\n')
    : ['上一次状态结算需要对账。请对照正文修正以下差异：', ...lines].join('\n')
}
