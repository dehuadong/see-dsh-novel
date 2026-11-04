/**
 * 面板确认走的三条命令。
 *
 * 命令是作者能直接触发、且运行时会把它记进会话日志的唯一入口，
 * 所以「作者认可了哪一版」这条回执就用命令自己的生命周期承载：
 * `/story-approve` 成功执行即产生回执，`/story-reject` 记一条会作废旧确认的决定。
 */
import { readArtifacts, shortDigest } from '../../core/artifacts.js'
import { approvalMarkerLine, latestDecision } from '../../core/receipts.js'
import type { CommandInvocationLike, CommandResultLike, Disposer, PluginContext } from '../../core/types.js'
import {
  COMMAND_APPROVE,
  COMMAND_REJECT,
  COMMAND_REVIEW,
  FOUNDATION_STAGE,
} from './contract.js'
import {
  DECISION_SOURCES,
  approvalServiceOf,
  confirmationPolicy,
  confirmedBy,
} from './gate.js'

function noteOf(rawInput: string): string {
  const note = rawInput.trim()
  return note === '' ? '' : `\n作者备注：${note}`
}

/** 注册三条命令；返回一个注销函数。 */
export function installApprovalCommands(ctx: PluginContext): Disposer {
  async function review(invocation: CommandInvocationLike): Promise<CommandResultLike> {
    const root = await ctx.workingDirectory.ensure(invocation.agent)
    const artifacts = await readArtifacts(root)
    const decision = latestDecision(invocation.agent.session.snapshotEvents(), DECISION_SOURCES)
    const approval = approvalServiceOf(ctx)
    const policy = confirmationPolicy(approval, invocation.agent)
    const canPrompt = approval !== undefined && policy === 'ask'

    const lines: string[] = []
    lines.push(artifacts.files.length === 0
      ? `阶段 ${FOUNDATION_STAGE}：还没有工件。先写 outline、details 与角色卡。`
      : `阶段 ${FOUNDATION_STAGE}：${artifacts.files.length} 个文件，摘要 ${shortDigest(artifacts.digest)}`)
    for (const file of artifacts.files) lines.push(`- ${file}`)
    if (decision === undefined) {
      lines.push('最近决定：无')
    } else if (decision.kind === 'reject') {
      lines.push(`最近决定：退回（${new Date(decision.time).toISOString()}）`)
    } else {
      const valid = confirmedBy(artifacts, decision) !== undefined
      const via = decision.channel === 'receipt' ? '面板命令' : '原生确认条'
      lines.push(`最近决定：确认（${new Date(decision.time).toISOString()}，${via}，`
        + `${valid ? '有效' : '已失效：工件已变'}）`)
    }
    lines.push(`确认策略：${policy}`)
    lines.push(canPrompt
      ? '现在可以弹原生确认条：让模型调用 story_foundation_signoff，或在这里直接确认。'
      : '本会话弹不出原生确认条，请在这里确认。')
    return { kind: 'success', text: lines.join('\n') }
  }

  async function approve(invocation: CommandInvocationLike): Promise<CommandResultLike> {
    const root = await ctx.workingDirectory.ensure(invocation.agent)
    const artifacts = await readArtifacts(root)
    if (artifacts.files.length === 0) {
      return { kind: 'error', text: '还没有基础设定可以确认：source/story/ 下没有任何文件。' }
    }
    const head = `作者确认 ${FOUNDATION_STAGE}：${artifacts.files.length} 个文件，摘要 ${shortDigest(artifacts.digest)}`
    return {
      kind: 'success',
      text: `${head}${noteOf(invocation.rawInput)}\n`
        + approvalMarkerLine(FOUNDATION_STAGE, artifacts.digest, artifacts.files.length, 'receipt'),
    }
  }

  async function reject(invocation: CommandInvocationLike): Promise<CommandResultLike> {
    const root = await ctx.workingDirectory.ensure(invocation.agent)
    const artifacts = await readArtifacts(root)
    const head = artifacts.files.length === 0
      ? `作者退回 ${FOUNDATION_STAGE}（还没有工件）`
      : `作者退回 ${FOUNDATION_STAGE}：${artifacts.files.length} 个文件，摘要 ${shortDigest(artifacts.digest)}`
    return {
      kind: 'success',
      text: `${head}${noteOf(invocation.rawInput)}\n退回会作废之前的确认，改完需要重新确认。`,
    }
  }

  const reviewCommand = ctx.commands.register({
    name: COMMAND_REVIEW,
    description: '列出待确认的基础设定工件、摘要与最近一次作者决定。',
    handler: review,
  })
  const approveCommand = ctx.commands.register({
    name: COMMAND_APPROVE,
    description: '确认当前这一版基础设定，供 story_foundation_signoff 定稿。',
    handler: approve,
  })
  const rejectCommand = ctx.commands.register({
    name: COMMAND_REJECT,
    description: '退回当前这一版基础设定；会作废之前的确认。',
    handler: reject,
  })

  return (): void => {
    rejectCommand()
    approveCommand()
    reviewCommand()
  }
}
