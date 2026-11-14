/**
 * `story_state_check`：只读语义对账回执。
 *
 * 对账的模型部分由主编派子代理完成；宿主只校验“布尔 + 报告”的结构，不写作品。
 */
import type { Disposer, ExecuteContext, JsonSchema, PluginContext, ToolDefinition } from '../../core/types.js'
import { readChapterText } from '../../core/chapter-draft.js'
import { inspectState, readStateSnapshot } from '../../core/state.js'

export const STATE_CHECK_NAME = 'story_state_check'

/** 源工程的必填报告错误码。 */
export const RECONCILIATION_REASON_REQUIRED = 'STATE_RECONCILIATION_REASON_REQUIRED'

export interface StateCheckResult {
  chapter: number
  consistent: boolean
  reconciliationRequired: boolean
  observations: Array<{ code: string, summary: string }>
}

const parameters: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    chapter: { type: 'integer', description: '要核对的章号' },
    reconciliationRequired: {
      type: 'boolean',
      description: '仅当换一份真值投影（truth projection）能消解不一致时为 true；正文或权威之间的矛盾只作观察，不授权再次结算',
    },
    reportMarkdown: { type: 'string', description: '具体证据报告；需要重算时不能为空' },
  },
  required: ['chapter', 'reconciliationRequired', 'reportMarkdown'],
}

const output: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    chapter: { type: 'integer' },
    consistent: { type: 'boolean' },
    reconciliationRequired: { type: 'boolean' },
    observations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          code: { type: 'string' },
          summary: { type: 'string' },
        },
        required: ['code', 'summary'],
      },
    },
  },
  required: ['chapter', 'consistent', 'reconciliationRequired', 'observations'],
}

export function installStateCheckTool(ctx: PluginContext): Disposer {
  return ctx.tools.register({
    name: STATE_CHECK_NAME,
    description: 'Record the read-only outcome of a semantic state reconciliation for one settled chapter. The caller (a state-check subagent or the main agent) submits reconciliationRequired plus a Markdown evidence report; a required reconciliation without a report is rejected. Set reconciliationRequired true only when a different truth projection can resolve the mismatch; contradictions inside the chapter or between authorities remain reported observations and do not authorize another settlement pass. Nothing is written to the work.',
    parameters,
    output: {
      schema: output,
      render: (_args: unknown, value: StateCheckResult) => [{
        type: 'text' as const,
        text: value.observations.length === 0
          ? `第 ${value.chapter} 章状态对账：一致`
          : `第 ${value.chapter} 章状态对账：${value.reconciliationRequired ? '需要重算' : '有观察'}（${value.observations[0]?.summary.split('\n')[0] ?? ''}）`,
      }],
    },
    async execute(
      args: { chapter: number, reconciliationRequired: boolean, reportMarkdown: string },
      exec: ExecuteContext,
    ): Promise<StateCheckResult> {
      if (!exec?.agent) throw new Error('story_state_check 需要所属 agent 会话')
      const root = await ctx.workingDirectory.ensure(exec.agent)
      if (!Number.isInteger(args.chapter) || args.chapter < 1) throw new Error('chapter 必须是 ≥1 的整数')
      if (typeof args.reconciliationRequired !== 'boolean') throw new Error('reconciliationRequired 必须是布尔值')
      if (typeof args.reportMarkdown !== 'string') throw new Error('reportMarkdown 必须是字符串')
      if (await readChapterText(root, args.chapter) === null) {
        throw new Error(`第 ${args.chapter} 章还没有正文，无法对账`)
      }
      const read = await inspectState(root)
      if (read.invalid.length > 0) throw new Error(`状态文件损坏，先修复再对账：${read.invalid.join('、')}`)
      if (read.snapshot.manifest.lastAppliedChapter < args.chapter) {
        throw new Error(`第 ${args.chapter} 章还没有结算，先结算再对账`)
      }
      // 基线严格读四份 JSON 与跨文件不变量；缺失或损坏时由 readStateSnapshot 点名文件。
      await readStateSnapshot(root, args.chapter - 1)
      const report = args.reportMarkdown.trim()
      if (args.reconciliationRequired && report === '') {
        throw new Error(`${RECONCILIATION_REASON_REQUIRED}：需要重算时必须给出投影矛盾的证据报告`)
      }
      const observations = report === ''
        ? []
        : [{ code: args.reconciliationRequired ? 'state-reconciliation' : 'state-projection-review', summary: report }]
      return {
        chapter: args.chapter,
        consistent: !args.reconciliationRequired,
        reconciliationRequired: args.reconciliationRequired,
        observations,
      }
    },
  } as ToolDefinition<{ chapter: number, reconciliationRequired: boolean, reportMarkdown: string }, StateCheckResult>)
}
