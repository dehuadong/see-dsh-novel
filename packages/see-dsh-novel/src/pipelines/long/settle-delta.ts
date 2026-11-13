/**
 * 结算增量的共享参数表：`story_settle_chapter` 与 `story_resettle_chapter` 用同一份 delta 形状。
 */
import type { JsonSchema } from '../../core/types.js'
import type { HookRecord } from '../../core/hooks.js'
import type { FactInput, FactSelector, HookCandidateInput, SettlementDelta } from '../../core/settle.js'

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

/** 两个结算工具共用的参数 schema。 */
export const settleDeltaParameters: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    chapter: { type: 'integer', description: '要结算／重算的章号；必须已有正文' },
    postSettlement: { type: 'string', description: '本章状态变化的简要说明' },
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
  },
  required: ['chapter', 'postSettlement', 'factOps', 'hookOps', 'newHookCandidates', 'chapterSummary'],
}

/** 结算工具的入参。 */
export interface SettleArgs {
  chapter: number
  postSettlement: string
  factOps: { upsert: FactInput[], expire: FactSelector[] }
  hookOps: { upsert: HookRecord[], mention: string[], resolve: string[], defer: string[] }
  newHookCandidates: HookCandidateInput[]
  chapterSummary: SettlementDelta['chapterSummary']
}

/** 把工具入参折成 core 的结算增量。 */
export function settlementDeltaOf(args: SettleArgs): SettlementDelta {
  return {
    chapter: args.chapter,
    postSettlement: args.postSettlement,
    factOps: args.factOps,
    hookOps: args.hookOps,
    newHookCandidates: args.newHookCandidates,
    chapterSummary: args.chapterSummary,
  }
}
