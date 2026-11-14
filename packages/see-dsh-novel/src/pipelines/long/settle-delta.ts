/**
 * 结算工具的共享参数表：`story_settle_chapter` 与 `story_resettle_chapter` 用同一份 delta 形状。
 *
 * 两个工具都是两阶段：不带 `validation` 的调用只生成提案；带 `validation` 的调用提交，
 * 且不再重发增量（增量从提案文件读取）。
 */
import type { JsonSchema } from '../../core/types.js'
import type { HookRecord } from '../../core/hooks.js'
import type { FactInput, FactSelector, HookCandidateInput, SettlementDelta } from '../../core/settle.js'
import {
  SETTLEMENT_OUTCOMES,
  settlementError,
} from '../../core/settlement.js'
import type { SettlementOutcome, SettlementReceipt } from '../../core/settlement.js'

const hookRecord: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    hookId: { type: 'string' },
    startChapter: { type: 'integer' },
    type: { type: 'string' },
    status: { type: 'string', enum: ['open', 'progressing', 'deferred', 'resolved', 'superseded'] },
    lastAdvancedChapter: { type: 'integer' },
    expectedPayoff: { type: 'string' },
    notes: { type: 'string' },
    dependsOn: { type: 'array', items: { type: 'string' } },
    paysOffInArc: { type: 'string' },
  },
  required: ['hookId', 'startChapter', 'type', 'status', 'lastAdvancedChapter', 'expectedPayoff', 'notes'],
}

/** 增量字段；提案形态要求五个全部给出，提交形态要求全部缺省。 */
export const DELTA_FIELDS = ['postSettlement', 'factOps', 'hookOps', 'newHookCandidates', 'chapterSummary'] as const

/** 两个结算工具共用的参数 schema。 */
export const settlementToolParameters: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    chapter: { type: 'integer', description: '要结算／重算的章号；必须已有正文' },
    postSettlement: { type: 'string', description: '本章状态变化的简要说明（提案形态必填）' },
    factOps: {
      type: 'object',
      additionalProperties: false,
      properties: {
        upsert: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              subject: { type: 'string' },
              predicate: { type: 'string' },
              object: { type: 'string' },
            },
            required: ['subject', 'predicate', 'object'],
          },
        },
        expire: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              subject: { type: 'string' },
              predicate: { type: 'string' },
              object: { type: 'string' },
            },
            required: ['subject', 'predicate'],
          },
        },
      },
      required: ['upsert', 'expire'],
    },
    hookOps: {
      type: 'object',
      additionalProperties: false,
      properties: {
        upsert: { type: 'array', items: hookRecord },
        mention: { type: 'array', items: { type: 'string' } },
        resolve: { type: 'array', items: { type: 'string' } },
        defer: { type: 'array', items: { type: 'string' } },
      },
      required: ['upsert', 'mention', 'resolve', 'defer'],
    },
    newHookCandidates: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          type: { type: 'string' },
          expectedPayoff: { type: 'string' },
          notes: { type: 'string' },
        },
        required: ['type', 'expectedPayoff', 'notes'],
      },
    },
    chapterSummary: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string' },
        characters: { type: 'string' },
        events: { type: 'string' },
        stateChanges: { type: 'string' },
        hookActivity: { type: 'string' },
        mood: { type: 'string' },
        chapterType: { type: 'string' },
      },
      required: ['title', 'characters', 'events', 'stateChanges', 'hookActivity', 'mood', 'chapterType'],
    },
    validation: {
      type: 'object',
      description: '结算提交的收据；由 state-check 子代理的结论生成。带它就不再带增量',
      additionalProperties: false,
      properties: {
        proposalDigest: { type: 'string', description: '提案调用返回的摘要' },
        outcome: {
          type: 'string',
          enum: ['consistent', 'reconciliation-required', 'unavailable'],
          description: '一致／需要重算／校验不可用',
        },
        reportMarkdown: { type: 'string', description: '证据报告；需要重算时不能为空' },
      },
      required: ['proposalDigest', 'outcome', 'reportMarkdown'],
    },
  },
  required: ['chapter'],
}

/** 结算工具的入参：两形态共用一份对象，由 `execute` 判定。 */
export interface SettlementToolArgs {
  chapter: number
  postSettlement?: string
  factOps?: { upsert: FactInput[], expire: FactSelector[] }
  hookOps?: { upsert: HookRecord[], mention: string[], resolve: string[], defer: string[] }
  newHookCandidates?: HookCandidateInput[]
  chapterSummary?: SettlementDelta['chapterSummary']
  validation?: {
    proposalDigest?: string
    outcome?: string
    reportMarkdown?: string
  }
}

/** 提案形态的完整增量。 */
export interface ProposalArgs {
  chapter: number
  postSettlement: string
  factOps: { upsert: FactInput[], expire: FactSelector[] }
  hookOps: { upsert: HookRecord[], mention: string[], resolve: string[], defer: string[] }
  newHookCandidates: HookCandidateInput[]
  chapterSummary: SettlementDelta['chapterSummary']
}

/** 提交形态的收据。 */
export interface CommitArgs {
  chapter: number
  receipt: SettlementReceipt
}

/** 提案形态是否带齐五个增量字段。 */
export function hasAnyDelta(args: SettlementToolArgs): boolean {
  return DELTA_FIELDS.some((field) => args[field] !== undefined)
}

/** 提案形态的增量是否齐全；缺字段时点名。 */
export function missingDeltaFields(args: SettlementToolArgs): string[] {
  return DELTA_FIELDS.filter((field) => args[field] === undefined)
}

function invalid(message: string): never {
  throw settlementError('SETTLEMENT_PROPOSAL_UNAVAILABLE', message)
}

function isOutcome(value: unknown): value is SettlementOutcome {
  return typeof value === 'string' && (SETTLEMENT_OUTCOMES as ReadonlyArray<string>).includes(value)
}

/** 校验收据并返回提交形态；字段缺失、类型不符或报告必填关系不满足时拒绝。 */
export function commitArgsOf(args: SettlementToolArgs): CommitArgs {
  const validation = args.validation
  if (validation === null || typeof validation !== 'object') invalid('提交调用缺少 validation 收据')
  const { proposalDigest, outcome, reportMarkdown } = validation
  if (typeof proposalDigest !== 'string' || proposalDigest === '') invalid('validation.proposalDigest 必须是字符串')
  if (!isOutcome(outcome)) invalid(`validation.outcome 不合法：${String(outcome)}`)
  if (typeof reportMarkdown !== 'string') invalid('validation.reportMarkdown 必须是字符串')
  if (outcome === 'reconciliation-required' && reportMarkdown.trim() === '') {
    throw settlementError('STATE_RECONCILIATION_REASON_REQUIRED', '需要重算时必须给出投影矛盾的证据报告')
  }
  return { chapter: args.chapter, receipt: { proposalDigest, outcome, reportMarkdown } }
}

/** 校验提案形态并返回完整增量；缺字段或类型不符时点名拒绝。 */
export function proposalArgsOf(args: SettlementToolArgs): ProposalArgs {
  const missing = missingDeltaFields(args)
  if (missing.length > 0) invalid(`结算增量缺字段：${missing.join('、')}`)
  const { postSettlement, factOps, hookOps, newHookCandidates, chapterSummary } = args
  if (typeof postSettlement !== 'string') invalid('结算增量缺字段：postSettlement')
  if (factOps === null || typeof factOps !== 'object' || !Array.isArray(factOps.upsert) || !Array.isArray(factOps.expire)) {
    invalid('factOps 形状不合法')
  }
  if (hookOps === null || typeof hookOps !== 'object'
    || !Array.isArray(hookOps.upsert) || !Array.isArray(hookOps.mention)
    || !Array.isArray(hookOps.resolve) || !Array.isArray(hookOps.defer)) {
    invalid('hookOps 形状不合法')
  }
  if (!Array.isArray(newHookCandidates)) invalid('newHookCandidates 形状不合法')
  if (chapterSummary === null || typeof chapterSummary !== 'object') invalid('chapterSummary 形状不合法')
  return {
    chapter: args.chapter,
    postSettlement,
    factOps,
    hookOps,
    newHookCandidates,
    chapterSummary,
  }
}

/** 把提案形态折成 core 的结算增量。 */
export function settlementDeltaOf(args: ProposalArgs): SettlementDelta {
  return {
    chapter: args.chapter,
    postSettlement: args.postSettlement,
    factOps: args.factOps,
    hookOps: args.hookOps,
    newHookCandidates: args.newHookCandidates,
    chapterSummary: args.chapterSummary,
  }
}
