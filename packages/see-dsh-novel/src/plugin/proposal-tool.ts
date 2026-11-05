/**
 * `story_propose`：模型发起、作者确认的立项提案。
 *
 * 确认条就是确认卡：作者点允许才写 `work.json`，拒绝或取消什么都不落盘；确认条
 * 不可用时只给确定性入口，不静默创建。
 */
import type {
  ApprovalOutcome, Disposer, ExecuteContext, JsonSchema, PluginContext, ToolDefinition,
} from '../core/types.js'
import { APPROVAL_OUTCOMES } from '../core/types.js'
import { proposalCard, parseProposal } from '../core/proposal.js'
import { describeWork, readWork, writeWork, WORK_LANGUAGES } from '../core/work.js'
import { approvalServiceOf, confirmationPolicy } from '../pipelines/long/gate.js'

/** 工具名；注册与测试共用。 */
export const PROPOSE_NAME = 'story_propose'

/** 提案的四种结局；`unavailable` 包含服务缺席、策略 never 与确认条自身不可用。 */
export type ProposalOutcome = ApprovalOutcome
/** 结局的固定取值，schema 枚举从这里来。 */
export const PROPOSAL_OUTCOMES = APPROVAL_OUTCOMES

/** 提案工具的回执。 */
export interface ProposalResult {
  created: boolean
  outcome: ProposalOutcome
  card: string
  /** 立项成功后的一行身份描述；未立项时是 null。 */
  summary: string | null
}

/** 参数：标题与摘要必填，其余可选。 */
export const proposeParameters: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string', description: '作者确认过的书名' },
    summary: { type: 'string', description: '一到两句：确认之后会发生什么' },
    genre: { type: 'string', description: '题材，例如「都市悬疑」；可选' },
    platform: { type: 'string', description: '目标平台；可选' },
    language: { type: 'string', enum: [...WORK_LANGUAGES], description: '正文语言，默认 zh' },
    chapters: { type: 'integer', description: '目标章数；可选' },
    chapterWords: { type: 'integer', description: '单章目标字数；可选' },
  },
  required: ['title', 'summary'],
}

/** 返回值结构。 */
export const proposeOutput: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    created: { type: 'boolean' },
    outcome: { type: 'string', enum: [...PROPOSAL_OUTCOMES] },
    card: { type: 'string' },
    summary: { oneOf: [{ type: 'string' }, { type: 'null' }] },
  },
  required: ['created', 'outcome', 'card', 'summary'],
}

/**
 * 提案：校验、弹确认条、按结局决定是否落盘。
 * @param ctx 插件上下文：工作目录、approval 服务
 * @param exec 本次调用；确认需要 agent、callId 与 signal
 * @param args 提案参数
 * @returns 回执
 */
export async function proposeWork(
  ctx: PluginContext,
  exec: ExecuteContext,
  args: unknown,
): Promise<ProposalResult> {
  if (!exec.agent) throw new Error('story_propose 需要所属 agent 会话')
  const root = await ctx.workingDirectory.ensure(exec.agent)
  if (!root) throw new Error('无法解析当前工作区目录')
  // 先看身份：已经立项时先报「已立项」，而不是先挑提案字段的毛病。
  const existing = await readWork(root)
  if (existing !== null) throw new Error(`已经立项${describeWork(existing)}；不覆盖，改身份请手改 work.json`)

  const draft = parseProposal(args as Parameters<typeof parseProposal>[0])
  const card = proposalCard(draft)

  const approval = approvalServiceOf(ctx)
  if (approval === undefined || confirmationPolicy(approval, exec.agent) === 'never') {
    return { created: false, outcome: 'unavailable', card, summary: null }
  }
  const outcome = await approval.request({
    agent: exec.agent,
    toolName: PROPOSE_NAME,
    callId: exec.callId,
    reason: card,
    signal: exec.signal,
  })
  if (outcome !== 'allowed-once') {
    return { created: false, outcome, card, summary: null }
  }
  const work = await writeWork(root, {
    title: draft.title,
    language: draft.language,
    targetChapters: draft.targetChapters,
    chapterWordCount: draft.chapterWordCount,
    genre: draft.genre,
    platform: draft.platform,
  })
  return { created: true, outcome: 'allowed-once', card, summary: describeWork(work) }
}

/** 回执的文字摘要。 */
function renderProposal(_args: unknown, value: ProposalResult): Array<{ type: 'text', text: string }> {
  if (value.created && value.summary !== null) {
    return [{ type: 'text', text: `已立项${value.summary}` }]
  }
  const why = value.outcome === 'allowed-once' ? '' : OUTCOME_HINT[value.outcome]
  return [{ type: 'text', text: `未立项（${value.outcome}）。${why}\n提案：\n${value.card}` }]
}

/** 三种非允许结局各自的下一步；与确认结果的语义一一对应。 */
const OUTCOME_HINT: Record<Exclude<ProposalOutcome, 'allowed-once'>, string> = {
  rejected: '作者退回了这次提案，问清想改哪一处再提。',
  cancelled: '作者取消了这次提案，先不要重试；等作者重新开口，再问想改哪一处。',
  unavailable: '确认条不可用：可以用 /story-init，或在作者明确说要立项后调 story_work_create。',
}

/**
 * 注册提案工具。
 * @param ctx 插件上下文
 * @returns 注销函数
 */
export function installProposalTool(ctx: PluginContext): Disposer {
  return ctx.tools.register({
    name: PROPOSE_NAME,
    description:
      'Propose a work (title, genre, platform, language, target size) and open a confirmation card. '
      + 'Writes work.json only when the author allows it; refuses when a work already exists.',
    parameters: proposeParameters,
    output: { schema: proposeOutput, render: renderProposal },
    execute: (args: unknown, exec: ExecuteContext): Promise<ProposalResult> => proposeWork(ctx, exec, args),
  } as ToolDefinition<unknown, ProposalResult>)
}
