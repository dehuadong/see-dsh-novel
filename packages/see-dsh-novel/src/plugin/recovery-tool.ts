/**
 * `story_recover`：工作区自检与可重建索引的入口。
 *
 * 只读扫描给出发现；`apply: true` 时只修无歧义的项（重建缺失索引、回收属主已死的
 * 提交残留与临时文件），并把修复前后的摘要与作者最近一次认可对比，告诉作者要不
 * 要重新确认。
 */
import type { Disposer, ExecuteContext, JsonSchema, PluginContext, ToolDefinition } from '../core/types.js'
import { shortDigest } from '../core/artifacts.js'
import { latestDecision } from '../core/receipts.js'
import type { Finding, RecoveryScan } from '../core/recovery.js'
import { withCommitQueue } from '../core/commit.js'
import { FINDING_CODES, repairWorkspace, scanWorkspace } from '../core/recovery.js'
import { DECISION_SOURCES } from '../pipelines/long/contract.js'

/** 工具名；注册与测试共用。 */
export const RECOVER_NAME = 'story_recover'

/** 一次自检的回执。 */
export interface RecoveryResult {
  root: string
  findings: Finding[]
  applied: string[]
  digestBefore: string
  digestAfter: string
  approvedDigest: string | null
  needsReconfirm: boolean
}

const nullableString: JsonSchema = { oneOf: [{ type: 'string' }, { type: 'null' }] }

/** 参数：默认只扫描。 */
export const recoverParameters: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    apply: { type: 'boolean', description: '修无歧义的项；默认 false，只扫描' },
  },
  required: [],
}

/** 返回值结构。 */
export const recoverOutput: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    root: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          code: { type: 'string', enum: [...FINDING_CODES] },
          severity: { type: 'string', enum: ['info', 'warning', 'error'] },
          path: nullableString,
          detail: { type: 'string' },
          fixable: { type: 'boolean' },
        },
        required: ['code', 'severity', 'path', 'detail', 'fixable'],
      },
    },
    applied: { type: 'array', items: { type: 'string' } },
    digestBefore: { type: 'string' },
    digestAfter: { type: 'string' },
    approvedDigest: nullableString,
    needsReconfirm: { type: 'boolean' },
  },
  required: ['root', 'findings', 'applied', 'digestBefore', 'digestAfter', 'approvedDigest', 'needsReconfirm'],
}

/**
 * 扫描（可选修复）一个工作区。
 * @param ctx 插件上下文：工作目录服务
 * @param exec 本次调用；需要所属 agent 才能解析作品根与读认可回执
 * @param args 是否修复
 * @returns 回执
 */
export async function recoverWorkspace(
  ctx: PluginContext,
  exec: ExecuteContext,
  args: { apply?: unknown },
): Promise<RecoveryResult> {
  if (!exec.agent) throw new Error('story_recover 需要所属 agent 会话')
  const root = await ctx.workingDirectory.ensure(exec.agent)
  if (!root) throw new Error('无法解析当前工作区目录')

  const { before, applied, after } = await withCommitQueue(root, async () => {
    const scanned: RecoveryScan = await scanWorkspace(root)
    let repaired: string[] = []
    let rescanned = scanned
    if (args.apply === true) {
      repaired = await repairWorkspace(root, scanned.findings)
      rescanned = await scanWorkspace(root)
    }
    return { before: scanned, applied: repaired, after: rescanned }
  })

  const decision = latestDecision(exec.agent.session.snapshotEvents(), DECISION_SOURCES)
  const approvedDigest = decision?.kind === 'approve' ? decision.digest : undefined
  return {
    root: after.root,
    // 报告修复前发现的问题：修完之后再看一遍会「什么都没发现」，丢掉了要讲的事。
    findings: before.findings,
    applied,
    digestBefore: before.digest,
    digestAfter: after.digest,
    approvedDigest: approvedDigest ?? null,
    needsReconfirm: approvedDigest !== undefined && approvedDigest !== after.digest,
  }
}

/** 回执的文字摘要。 */
function renderRecovery(_args: unknown, value: RecoveryResult): Array<{ type: 'text', text: string }> {
  const lines: string[] = []
  if (value.findings.length === 0) {
    lines.push('工作区自检通过：没有发现问题。')
  } else {
    lines.push(`工作区自检发现 ${value.findings.length} 项：`)
    for (const finding of value.findings) {
      const where = finding.path === null ? '' : ` ${finding.path}`
      lines.push(`- [${finding.severity}] ${finding.code}${where}：${finding.detail}`)
    }
  }
  if (value.applied.length > 0) {
    lines.push(`已修复 ${value.applied.length} 项：`)
    for (const path of value.applied) lines.push(`- ${path}`)
  }
  lines.push(`摘要：修复前 ${shortDigest(value.digestBefore)}，修复后 ${shortDigest(value.digestAfter)}`
    + (value.approvedDigest === null ? '；本会话没有可用的确认回执。' : `；作者认可过 ${shortDigest(value.approvedDigest)}。`))
  if (value.needsReconfirm) {
    lines.push('修复后的摘要与作者认可过的那一版不一致：需要重新确认基础设定。')
  }
  return [{ type: 'text', text: lines.join('\n') }]
}

/**
 * 注册自检工具。
 * @param ctx 插件上下文
 * @returns 注销函数
 */
export function installRecoveryTool(ctx: PluginContext): Disposer {
  return ctx.tools.register({
    name: RECOVER_NAME,
    description:
      'Check this workspace and report missing state indexes or crashed commit leftovers. '
      + 'With apply=true it rebuilds the safe ones (index files, dead-owner staging and temp files) and reports '
      + 'whether the author must re-confirm.',
    parameters: recoverParameters,
    output: { schema: recoverOutput, render: renderRecovery },
    execute: (args: { apply?: unknown }, exec: ExecuteContext): Promise<RecoveryResult> => recoverWorkspace(ctx, exec, args),
  } as ToolDefinition<{ apply?: unknown }, RecoveryResult>)
}
