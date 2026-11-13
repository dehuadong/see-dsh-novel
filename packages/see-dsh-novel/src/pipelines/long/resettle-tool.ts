/**
 * `story_resettle_chapter`：从第 N-1 章快照重算最新章，替换掉在旧结算结果上叠加的增量。
 *
 * 只支持最新章；正文、章节索引与 workflow start 都不动，重算会同时刷新第 N 章快照。
 */
import { applySettlement } from '../../core/settle.js'
import {
  inspectState,
  latestSnapshotChapter,
  readStateSnapshot,
  snapshotWrites,
  stateJsonWrites,
  stateProjectionWrites,
  validateChapterSummaries,
} from '../../core/state.js'
import type { StateSnapshot } from '../../core/state.js'
import { commitFoundation } from '../../core/commit.js'
import { loadChapterDocument } from '../../core/chapter-document.js'
import { readChapterIndex } from '../../core/chapter-index.js'
import { readWork } from '../../core/work.js'
import { withWorkAction } from '../../core/work-mutation.js'
import type { Disposer, ExecuteContext, JsonSchema, PluginContext, ToolDefinition } from '../../core/types.js'
import { settleDeltaParameters, settlementDeltaOf } from './settle-delta.js'
import type { SettleArgs } from './settle-delta.js'

export const RESETTLE_NAME = 'story_resettle_chapter'

const output: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    chapter: { type: 'integer' },
    baselineChapter: { type: 'integer' },
    facts: { type: 'integer' },
    hooks: { type: 'integer' },
    summaryTitle: { type: 'string' },
    postSettlement: { type: 'string' },
  },
  required: ['chapter', 'baselineChapter', 'facts', 'hooks', 'summaryTitle', 'postSettlement'],
}

interface ResettleOutput {
  chapter: number
  baselineChapter: number
  facts: number
  hooks: number
  summaryTitle: string
  postSettlement: string
}

/**
 * 计算可重算的最新章。
 * @param root 作品根
 * @param readable 当前状态是否可读
 * @param lastApplied 当前状态已结算到的章号
 * @returns 最新章号；没有可重算的章时为 0
 */
async function latestResettableChapter(root: string, readable: boolean, lastApplied: number): Promise<number> {
  let indexMax = 0
  try {
    for (const entry of await readChapterIndex(root)) indexMax = Math.max(indexMax, entry.number)
  } catch (error) {
    // 状态不可读时才允许索引也坏：此时用快照兜底；状态可读时索引坏应当报错。
    if (readable) throw error
    indexMax = 0
  }
  const snapshotMax = await latestSnapshotChapter(root)
  return readable ? Math.max(indexMax, lastApplied, snapshotMax) : Math.max(indexMax, snapshotMax)
}

export function installResettleTool(ctx: PluginContext): Disposer {
  return ctx.tools.register({
    name: RESETTLE_NAME,
    description: 'Re-settle the latest chapter from its baseline snapshot: apply the submitted delta to the runtime state at chapter N-1 instead of the current (already settled) state, then rewrite the state files and snapshots/<chapter> in one commit. The chapter body, chapter index and workflow start are unchanged. Only the latest chapter is supported; ordinary settlement only advances to the next chapter.',
    parameters: settleDeltaParameters,
    output: {
      schema: output,
      render: (_args: unknown, value: ResettleOutput) => [{
        type: 'text' as const,
        text: `第 ${value.chapter} 章已从第 ${value.baselineChapter} 章快照重算：${value.summaryTitle}（事实 ${value.facts} 条，伏笔 ${value.hooks} 条）`,
      }],
    },
    async execute(args: SettleArgs, exec: ExecuteContext): Promise<ResettleOutput> {
      if (!exec?.agent) throw new Error('story_resettle_chapter 需要所属 agent 会话')
      const root = await ctx.workingDirectory.ensure(exec.agent)
      const delta = settlementDeltaOf(args)
      const next: StateSnapshot = await withWorkAction(root, async () => {
        const work = await readWork(root)
        const read = await inspectState(root, [], work?.language ?? 'zh')
        const readable = read.missing.length === 0 && read.invalid.length === 0
        const last = read.snapshot.manifest.lastAppliedChapter
        const target = await latestResettableChapter(root, readable, last)
        if (target === 0) throw new Error('还没有可重算的章：章节索引与状态快照都为空')
        if (args.chapter !== target) {
          const mode = readable ? '只支持最新章重算' : '状态不可读，只支持最新章重算'
          throw new Error(`${mode}：当前最新是第 ${target} 章；若状态已回退，先重算第 ${target} 章，否则先重开回退到目标章再试`)
        }
        if (await loadChapterDocument(root, args.chapter) === null) {
          throw new Error(`第 ${args.chapter} 章还没有正文，无法重算`)
        }
        const baseline = await readStateSnapshot(root, args.chapter - 1)
        const settled = applySettlement(baseline, delta).snapshot
        validateChapterSummaries(settled.chapterSummaries)
        await commitFoundation(root, {
          writes: [
            ...stateJsonWrites(settled),
            ...stateProjectionWrites(settled),
            ...snapshotWrites(settled, args.chapter),
          ],
        })
        return settled
      })
      return {
        chapter: args.chapter,
        baselineChapter: args.chapter - 1,
        facts: next.currentState.facts.length,
        hooks: next.hooks.hooks.length,
        summaryTitle: next.chapterSummaries.rows.find((row) => row.chapter === args.chapter)?.title ?? '',
        postSettlement: args.postSettlement,
      }
    },
  } as ToolDefinition<SettleArgs, ResettleOutput>)
}
