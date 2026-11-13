/**
 * `story_settle_chapter`：一次结算写入 facts／hooks／摘要并推进状态章号。
 */
import type { Disposer, ExecuteContext, JsonSchema, PluginContext, ToolDefinition } from '../../core/types.js'
import type { HookRecord } from '../../core/hooks.js'
import { applySettlement } from '../../core/settle.js'
import type { FactInput, FactSelector, HookCandidateInput, SettlementDelta } from '../../core/settle.js'
import { validateChapterSummaries, inspectState, stateJsonWrites, stateProjectionWrites } from '../../core/state.js'
import type { StateSnapshot } from '../../core/state.js'
import { commitFoundation } from '../../core/commit.js'
import { loadChapterDocument } from '../../core/chapter-document.js'
import { loadChapterReview } from '../../core/chapter-review.js'
import { readWork } from '../../core/work.js'
import { withWorkAction } from '../../core/work-mutation.js'

export const SETTLE_NAME = 'story_settle_chapter'

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

const parameters: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    chapter: { type: 'integer', description: '要结算的章号；必须已有正文与审稿记录' },
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

const output: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    chapter: { type: 'integer' },
    facts: { type: 'integer' },
    hooks: { type: 'integer' },
    summaryTitle: { type: 'string' },
    postSettlement: { type: 'string' },
  },
  required: ['chapter', 'facts', 'hooks', 'summaryTitle', 'postSettlement'],
}

interface SettleArgs {
  chapter: number
  postSettlement: string
  factOps: { upsert: FactInput[], expire: FactSelector[] }
  hookOps: { upsert: HookRecord[], mention: string[], resolve: string[], defer: string[] }
  newHookCandidates: HookCandidateInput[]
  chapterSummary: SettlementDelta['chapterSummary']
}

interface SettleOutput {
  chapter: number
  facts: number
  hooks: number
  summaryTitle: string
  postSettlement: string
}

export function installSettleTool(ctx: PluginContext): Disposer {
  return ctx.tools.register({
    name: SETTLE_NAME,
    description: 'Settle one reviewed chapter: apply fact and hook deltas plus the chapter summary to runtime state, advance manifest.lastAppliedChapter, and write the JSON state and Markdown projections in one commit. Re-settling the same chapter applies the delta incrementally.',
    parameters,
    output: {
      schema: output,
      render: (_args: unknown, value: SettleOutput) => [{
        type: 'text' as const,
        text: `第 ${value.chapter} 章已结算：${value.summaryTitle}（事实 ${value.facts} 条，伏笔 ${value.hooks} 条）`,
      }],
    },
    async execute(args: SettleArgs, exec: ExecuteContext): Promise<SettleOutput> {
      if (!exec?.agent) throw new Error('story_settle_chapter 需要所属 agent 会话')
      const root = await ctx.workingDirectory.ensure(exec.agent)
      const delta: SettlementDelta = {
        chapter: args.chapter,
        postSettlement: args.postSettlement,
        factOps: args.factOps,
        hookOps: args.hookOps,
        newHookCandidates: args.newHookCandidates,
        chapterSummary: args.chapterSummary,
      }
      const next: StateSnapshot = await withWorkAction(root, async () => {
        if (await loadChapterDocument(root, args.chapter) === null) {
          throw new Error(`第 ${args.chapter} 章还没有正文，先写再结算`)
        }
        if (await loadChapterReview(root, args.chapter) === null) {
          throw new Error(`第 ${args.chapter} 章还没有审稿记录，先审再结算`)
        }
        const work = await readWork(root)
        const read = await inspectState(root, [], work?.language ?? 'zh')
        if (read.missing.length > 0) {
          throw new Error(`状态文件缺失，先修复或重建再结算：${read.missing.join('、')}`)
        }
        if (read.invalid.length > 0) {
          throw new Error(`状态文件损坏，先修复再结算：${read.invalid.join('、')}`)
        }
        const snapshot = read.snapshot
        const settled = applySettlement(snapshot, delta, { allowReapply: args.chapter === snapshot.manifest.lastAppliedChapter }).snapshot
        validateChapterSummaries(settled.chapterSummaries)
        await commitFoundation(root, {
          writes: [...stateJsonWrites(settled), ...stateProjectionWrites(settled)],
        })
        return settled
      })
      return {
        chapter: args.chapter,
        facts: next.currentState.facts.length,
        hooks: next.hooks.hooks.length,
        summaryTitle: next.chapterSummaries.rows.find((row) => row.chapter === args.chapter)?.title ?? '',
        postSettlement: args.postSettlement,
      }
    },
  } as ToolDefinition<SettleArgs, SettleOutput>)
}
