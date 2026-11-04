/**
 * 作者确认闸门。
 *
 * 取确认的顺序是确定性的，不问完再猜：
 * 先看最近一次作者决定是不是一条仍然对得上当前摘要的确认，再决定要不要弹
 * 原生确认条；退回是同等重要的一条决定，它会把更早的确认作废。
 * 原生确认被拒或被取消就停在这里，不会自动改走面板——那是把作者刚说过的
 * 「不」当成「没听见」。
 */
import { readArtifacts, shortDigest } from '../../core/artifacts.js'
import type { ArtifactSet } from '../../core/artifacts.js'
import { approvalMarkerLine, latestDecision } from '../../core/receipts.js'
import type { ApprovalChannel, ApprovalDecision, DecisionSources } from '../../core/receipts.js'
import type {
  AgentLike, ApprovalOutcome, ApprovalService, Disposer, ExecuteContext, PluginContext, ToolDefinition,
} from '../../core/types.js'
import {
  COMMAND_APPROVE,
  COMMAND_REJECT,
  FOUNDATION_STAGE,
  GATE_OUTPUT,
  GATE_TOOL,
  NO_PARAMETERS,
  SIGNOFF_OUTPUT,
  SIGNOFF_TOOL,
} from './contract.js'

/** 会话当前的确认策略；服务缺席时未知。 */
export type ConfirmationPolicy = 'ask' | 'never' | 'unknown'

/** 拒绝签核的原因。 */
export type DenialReason =
  | 'no-artifacts'
  | 'policy-never'
  | 'no-approval-service'
  | 'rejected'
  | 'cancelled'
  | 'unavailable'
  | 'changed'

export type SignoffResult =
  | { kind: 'signed', channel: ApprovalChannel, artifacts: ArtifactSet }
  | { kind: 'denied', reason: DenialReason, message: string }

/** 面板命令的提示语；会改道面板的拒绝原因共用，避免措辞漂移。 */
const PANEL_HINT = '请作者在「作品」面板点「认可」（等同执行 /story-approve）。'

/** 原生确认条里能容纳的工件条数；再多就只报总数。 */
const REASON_FILE_LIMIT = 8

/** 回执来源：同一阶段面板命令、退回命令与签核工具。 */
export const DECISION_SOURCES: DecisionSources = {
  stage: FOUNDATION_STAGE,
  approveCommand: COMMAND_APPROVE,
  rejectCommand: COMMAND_REJECT,
  signoffTool: SIGNOFF_TOOL,
}

/** 非授权的原生确认结果各自对应一条拒绝。 */
const DENIAL_BY_OUTCOME: Record<Exclude<ApprovalOutcome, 'allowed-once'>, { reason: DenialReason, message: string }> = {
  rejected: {
    reason: 'rejected',
    message: '作者退回了这一版基础设定，未定稿。等作者给出修改意见后重写，不要自行重试确认。',
  },
  cancelled: {
    reason: 'cancelled',
    message: '确认被取消，未定稿。',
  },
  unavailable: {
    reason: 'unavailable',
    message: `没有可用的确认端（没有已连接的客户端接管这次确认），未定稿。${PANEL_HINT}或恢复客户端后重试。`,
  },
}

function denied(reason: DenialReason, message: string): SignoffResult {
  return { kind: 'denied', reason, message }
}

/** 按名取可选的 approval 服务；缺席时签核仍可走面板命令。 */
export function approvalServiceOf(ctx: PluginContext): ApprovalService | undefined {
  return ctx.get('approval') as ApprovalService | undefined
}

/**
 * 会话当前的确认策略，与 approval 服务自己的生效规则一致：
 * 会话覆盖优先，其次组合层默认，最后是 `ask`。
 */
export function confirmationPolicy(approval: ApprovalService | undefined, agent: AgentLike): ConfirmationPolicy {
  if (approval === undefined) return 'unknown'
  return approval.overrideOf(agent.session) ?? approval.config?.policy ?? 'ask'
}

/** 给作者看的确认说明：这一版包含哪些文件、摘要是哪一版。 */
function describeArtifacts(artifacts: ArtifactSet): string {
  const listed = artifacts.files.slice(0, REASON_FILE_LIMIT).join('、')
  const more = artifacts.files.length > REASON_FILE_LIMIT ? ` 等 ${artifacts.files.length} 个` : ''
  return `确认 ${FOUNDATION_STAGE} 定稿？这一版共 ${artifacts.files.length} 个文件`
    + `（摘要 ${shortDigest(artifacts.digest)}）：${listed}${more}`
}

/**
 * 这一版是否已被作者确认：有工件、最近一次决定是确认，且摘要命中当前工件。
 * 闸门、只读报告与 `/story-review` 共用同一判据，避免三处各写一套。
 */
export function confirmedBy(
  artifacts: ArtifactSet,
  decision: ApprovalDecision | undefined,
): Extract<ApprovalDecision, { kind: 'approve' }> | undefined {
  if (artifacts.files.length === 0) return undefined
  if (decision?.kind !== 'approve') return undefined
  return decision.digest === artifacts.digest ? decision : undefined
}

function hintFor(artifacts: ArtifactSet, decision: ApprovalDecision | undefined, policy: ConfirmationPolicy): string {
  if (artifacts.files.length === 0) return '先写基础设定：outline、details 与角色卡。'
  if (confirmedBy(artifacts, decision) !== undefined) return '这一版已被作者确认，可以签核定稿。'
  if (decision?.kind === 'reject') return '作者退回了这一版；等作者给出修改意见后重写，再请作者确认。'
  if (policy === 'ask') return '这一版还没有确认；调用 story_foundation_signoff 会请作者确认。'
  return '这一版还没有确认，且本会话弹不出原生确认条：请作者在「作品」面板执行 /story-approve。'
}

export interface SignoffInput {
  root: string
  agent: AgentLike
  approval: ApprovalService | undefined
  callId?: string
  signal?: AbortSignal
}

/**
 * 取一条确认并给出结论。不写任何文件；`signed` 只表示确认成立。
 * @param input 作品根、所属 agent、approval 服务面与调用身份
 */
export async function evaluateSignoff(input: SignoffInput): Promise<SignoffResult> {
  const before = await readArtifacts(input.root)
  if (before.files.length === 0) {
    return denied('no-artifacts', '还没有基础设定可以定稿：source/story/ 下没有任何文件。先写 outline、details 与角色卡。')
  }

  const decision = latestDecision(input.agent.session.snapshotEvents(), DECISION_SOURCES)
  const approved = confirmedBy(before, decision)
  if (approved !== undefined) return { kind: 'signed', channel: approved.channel, artifacts: before }

  if (input.approval === undefined) {
    return denied('no-approval-service', `当前组合没有 approval 服务，无法发起原生确认，未定稿。${PANEL_HINT}`)
  }
  if (confirmationPolicy(input.approval, input.agent) === 'never') {
    return denied(
      'policy-never',
      `本会话的确认策略是 never，原生确认条不会出现，未定稿。${PANEL_HINT}或把权限预设切到 workspace-write 后重试。`,
    )
  }

  const outcome = await input.approval.request({
    agent: input.agent,
    toolName: SIGNOFF_TOOL,
    reason: describeArtifacts(before),
    ...input.callId === undefined ? {} : { callId: input.callId },
    ...input.signal === undefined ? {} : { signal: input.signal },
  })
  if (outcome !== 'allowed-once') {
    const denial = DENIAL_BY_OUTCOME[outcome]
    return denied(denial.reason, denial.message)
  }

  const after = await readArtifacts(input.root)
  if (after.digest !== before.digest) {
    return denied('changed', '确认期间工件发生了变化，这次确认作废，未定稿。请重新确认。')
  }
  return { kind: 'signed', channel: 'approval', artifacts: after }
}

/** 注册闸门与签核两个工具，返回一个注销函数。 */
export function installGateTools(ctx: PluginContext): Disposer {
  const approvalService = (): ApprovalService | undefined => approvalServiceOf(ctx)

  async function signoff(args: Record<string, never>, exec: ExecuteContext): Promise<{
    signed: boolean, channel: ApprovalChannel, digest: string, files: string[]
  }> {
    const agent = exec.agent
    if (agent === undefined) throw new Error('签核需要所属 agent 会话；无归属时拒绝')
    const root = await ctx.workingDirectory.ensure(agent)
    const result = await evaluateSignoff({
      root,
      agent,
      approval: approvalService(),
      ...exec.callId === undefined ? {} : { callId: exec.callId },
      ...exec.signal === undefined ? {} : { signal: exec.signal },
    })
    if (result.kind === 'denied') throw new Error(result.message)
    return {
      signed: true,
      channel: result.channel,
      digest: result.artifacts.digest,
      files: result.artifacts.files,
    }
  }

  const gate = ctx.tools.register({
    name: GATE_TOOL,
    description:
      'Report the foundation artifacts waiting for the author, their digest, the latest author decision, and whether a native approval prompt is available. Read-only.',
    parameters: NO_PARAMETERS,
    output: {
      schema: GATE_OUTPUT,
      render: (_args: unknown, value: {
        files: string[], digest: string, confirmed: boolean, policy: string,
      }) => [{
        type: 'text' as const,
        text: value.files.length === 0
          ? `${FOUNDATION_STAGE}：还没有工件`
          : `${FOUNDATION_STAGE}：${value.files.length} 个文件，摘要 ${shortDigest(value.digest)}`
            + `${value.confirmed ? '，已被作者确认' : '，尚未确认'}（策略 ${value.policy}）`,
      }],
    },
    async execute(_args: Record<string, never>, exec: ExecuteContext) {
      const agent = exec.agent
      if (agent === undefined) throw new Error('story_gate 需要所属 agent 会话')
      const root = await ctx.workingDirectory.ensure(agent)
      const artifacts = await readArtifacts(root)
      const service = approvalService()
      const policy = confirmationPolicy(service, agent)
      const decision = latestDecision(agent.session.snapshotEvents(), DECISION_SOURCES)
      const approved = confirmedBy(artifacts, decision)
      const confirmed = approved !== undefined
      return {
        stage: FOUNDATION_STAGE,
        files: artifacts.files,
        digest: artifacts.digest,
        confirmed,
        decision: decision?.kind ?? 'none',
        channel: approved === undefined ? 'none' : approved.channel,
        receiptAt: decision === undefined ? '' : new Date(decision.time).toISOString(),
        policy,
        canPrompt: service !== undefined && policy === 'ask',
        hint: hintFor(artifacts, decision, policy),
      }
    },
  } as ToolDefinition<Record<string, never>, {
    stage: string, files: string[], digest: string, confirmed: boolean, decision: string,
    channel: string, receiptAt: string, policy: string, canPrompt: boolean, hint: string,
  }>)

  const signoffTool = ctx.tools.register({
    name: SIGNOFF_TOOL,
    description:
      'Mark this version of the foundation as final. Requires an author confirmation: the panel command /story-approve, or a native approval prompt when the session policy is ask. Refuses without a valid confirmation and writes nothing.',
    parameters: NO_PARAMETERS,
    output: {
      schema: SIGNOFF_OUTPUT,
      render: (_args: unknown, value: { channel: ApprovalChannel, files: string[], digest: string }) => [{
        // 标记行让「这一版已签核」成为可读回的事实；人读说明放在它前面。
        type: 'text' as const,
        text: `已定稿 ${FOUNDATION_STAGE}：${value.files.length} 个文件，摘要 ${shortDigest(value.digest)}`
          + `（${value.channel === 'receipt' ? '作者在面板确认' : '作者在确认条确认'}）`
          + `\n${approvalMarkerLine(FOUNDATION_STAGE, value.digest, value.files.length, value.channel)}`,
      }],
    },
    execute: signoff,
  } as ToolDefinition<Record<string, never>, {
    signed: boolean, channel: ApprovalChannel, digest: string, files: string[],
  }>)

  return (): void => {
    signoffTool()
    gate()
  }
}
