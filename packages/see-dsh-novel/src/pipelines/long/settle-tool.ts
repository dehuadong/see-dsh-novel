/**
 * `story_settle_chapter`：把章节增量应用到当前状态并推进章号。
 *
 * 只负责「推进到下一章」；已结算章的重来走 `story_resettle_chapter`（从第 N-1 章快照重算）。
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { applySettlement } from '../../core/settle.js'
import { validateChapterSummaries, inspectState, stateJsonWrites, stateProjectionWrites } from '../../core/state.js'
import type { StateSnapshot } from '../../core/state.js'
import { commitFoundation } from '../../core/commit.js'
import { loadChapterDocument } from '../../core/chapter-document.js'
import { loadChapterReview } from '../../core/chapter-review.js'
import { STORY_ROOT } from '../../core/story-paths.js'
import { readWork } from '../../core/work.js'
import { withWorkAction } from '../../core/work-mutation.js'
import type { Disposer, ExecuteContext, JsonSchema, PluginContext, ToolDefinition } from '../../core/types.js'
import { settleDeltaParameters, settlementDeltaOf } from './settle-delta.js'
import type { SettleArgs } from './settle-delta.js'

export const SETTLE_NAME = 'story_settle_chapter'

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
    description: 'Settle the next reviewed chapter: apply fact and hook deltas plus the chapter summary to runtime state, advance manifest.lastAppliedChapter, and write the JSON state and Markdown projections in one commit. Only advances forward; to re-settle an already settled chapter use story_resettle_chapter, which rebuilds from the previous chapter snapshot.',
    parameters: settleDeltaParameters,
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
      const delta = settlementDeltaOf(args)
      const next: StateSnapshot = await withWorkAction(root, async () => {
        if (await loadChapterDocument(root, args.chapter) === null) {
          throw new Error(`第 ${args.chapter} 章还没有正文，先写再结算`)
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
        const last = snapshot.manifest.lastAppliedChapter
        if (args.chapter === last) {
          throw new Error(`第 ${args.chapter} 章已结算；重算请用 story_resettle_chapter（以第 ${args.chapter - 1} 章快照为基线）`)
        }
        if (args.chapter < last) {
          throw new Error(`第 ${args.chapter} 章早于已结算的第 ${last} 章；不支持更早章节重算`)
        }
        if (existsSync(join(root, STORY_ROOT, 'snapshots', String(args.chapter)))) {
          throw new Error(`第 ${args.chapter} 章已有状态快照（重算或定稿写过）；重开回退后的重算请用 story_resettle_chapter`)
        }
        if (await loadChapterReview(root, args.chapter) === null) {
          throw new Error(`第 ${args.chapter} 章还没有审稿记录，先审再结算`)
        }
        const settled = applySettlement(snapshot, delta).snapshot
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
