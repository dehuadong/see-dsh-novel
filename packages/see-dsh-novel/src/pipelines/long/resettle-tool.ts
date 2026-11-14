/**
 * `story_resettle_chapter`：从第 N-1 章快照重算最新章，同样先对账再提交。
 *
 * 提案阶段只写 `.drafts/settlement-NNNN.json`；提交阶段重读正文与基线重算；第二次
 * 对账仍不通过或校验不可用时拒绝且不写任何作品文件（源 resync 抛错、不落盘）。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { commitFoundation } from '../../core/commit.js'
import { loadChapterDocument } from '../../core/chapter-document.js'
import { readChapterIndex } from '../../core/chapter-index.js'
import {
  inspectState,
  latestSnapshotChapter,
  readStateSnapshot,
  snapshotWrites,
  stateJsonWrites,
  stateProjectionWrites,
} from '../../core/state.js'
import type { StateSnapshot } from '../../core/state.js'
import {
  baselineDigest,
  buildSettlementProposal,
  documentDigest,
  renderSettlementFeedback,
  settlementError,
  settlementObservations,
} from '../../core/settlement.js'
import {
  clearSettlementProposal,
  nextAttempt,
  readProposalForRegeneration,
  readSettlementProposal,
  recordSettlementFailure,
  settlementProposalPath,
  verifySettlementProposal,
  writeSettlementProposal,
} from '../../core/settlement-proposal.js'
import { readWork } from '../../core/work.js'
import { withWorkAction } from '../../core/work-mutation.js'
import type { Disposer, ExecuteContext, JsonSchema, PluginContext, ToolDefinition } from '../../core/types.js'
import {
  commitArgsOf,
  hasAnyDelta,
  proposalArgsOf,
  settlementDeltaOf,
  settlementToolParameters,
} from './settle-delta.js'
import type { CommitArgs, ProposalArgs, SettlementToolArgs } from './settle-delta.js'

export const RESETTLE_NAME = 'story_resettle_chapter'

const output: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['proposal', 'published'] },
    chapter: { type: 'integer' },
    baselineChapter: { type: 'integer' },
    facts: { type: 'integer' },
    hooks: { type: 'integer' },
    summaryTitle: { type: 'string' },
    postSettlement: { type: 'string' },
    proposalPath: { type: 'string' },
    proposalDigest: { type: 'string' },
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
    message: { type: 'string' },
  },
  required: [
    'status', 'chapter', 'baselineChapter', 'facts', 'hooks', 'summaryTitle',
    'postSettlement', 'proposalPath', 'proposalDigest', 'observations', 'message',
  ],
}

interface ResettleOutput {
  status: 'proposal' | 'published'
  chapter: number
  baselineChapter: number
  facts: number
  hooks: number
  summaryTitle: string
  postSettlement: string
  proposalPath: string
  proposalDigest: string
  observations: Array<{ code: string, summary: string }>
  message: string
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

/** 校验目标章与基线；提案与提交两阶段共用。 */
async function resettleContext(
  root: string,
  chapter: number,
): Promise<{ baseline: StateSnapshot, documentText: string }> {
  const work = await readWork(root)
  const read = await inspectState(root, [], work?.language ?? 'zh')
  const readable = read.missing.length === 0 && read.invalid.length === 0
  const target = await latestResettableChapter(root, readable, read.snapshot.manifest.lastAppliedChapter)
  if (target === 0) throw new Error('还没有可重算的章：章节索引与状态快照都为空')
  if (chapter !== target) {
    const mode = readable ? '只支持最新章重算' : '状态不可读，只支持最新章重算'
    throw new Error(`${mode}：当前最新是第 ${target} 章；若状态已回退，先重算第 ${target} 章，否则先重开回退到目标章再试`)
  }
  const document = await loadChapterDocument(root, chapter)
  if (document === null) throw new Error(`第 ${chapter} 章还没有正文，无法重算`)
  const baseline = await readStateSnapshot(root, chapter - 1)
  return { baseline, documentText: await readFile(join(root, document.path), 'utf8') }
}

function summaryTitleOf(snapshot: StateSnapshot, chapter: number): string {
  return snapshot.chapterSummaries.rows.find((row) => row.chapter === chapter)?.title ?? ''
}

/** 提案形态：读基线、渲染提案并写入 `.drafts`，不改状态。 */
async function proposeResettlement(
  root: string,
  language: 'zh' | 'en',
  args: ProposalArgs,
): Promise<ResettleOutput> {
  const chapter = args.chapter
  const context = await resettleContext(root, chapter)
  const delta = settlementDeltaOf(args)
  const attempt = nextAttempt(
    await readProposalForRegeneration(root, chapter),
    'resettle',
    documentDigest(context.documentText),
    baselineDigest(context.baseline),
  )
  const proposal = buildSettlementProposal({
    kind: 'resettle',
    chapter,
    attempt,
    baseline: context.baseline,
    delta,
    documentText: context.documentText,
    language,
  })
  await writeSettlementProposal(root, {
    version: 1,
    kind: 'resettle',
    chapter,
    baselineChapter: proposal.payload.baselineChapter,
    status: 'proposed',
    payload: proposal.payload,
    digest: proposal.digest,
  })
  return {
    status: 'proposal',
    chapter,
    baselineChapter: proposal.payload.baselineChapter,
    facts: proposal.settled.currentState.facts.length,
    hooks: proposal.settled.hooks.hooks.length,
    summaryTitle: summaryTitleOf(proposal.settled, chapter),
    postSettlement: delta.postSettlement,
    proposalPath: settlementProposalPath(chapter),
    proposalDigest: proposal.digest,
    observations: [],
    message: '提案已生成；把它交给 state-check 子代理对账，再带 validation 提交。',
  }
}

/** 提交形态：重读正文与基线重算；只有一致收据才写状态与快照。 */
async function commitResettlement(
  root: string,
  language: 'zh' | 'en',
  commit: CommitArgs,
): Promise<ResettleOutput> {
  const chapter = commit.chapter
  const context = await resettleContext(root, chapter)
  const proposal = await readSettlementProposal(root, chapter)
  if (proposal === null) throw settlementError('SETTLEMENT_PROPOSAL_UNAVAILABLE', `第 ${chapter} 章没有重算提案；先生成提案`)
  if (proposal.kind !== 'resettle') throw settlementError('SETTLEMENT_PROPOSAL_UNAVAILABLE', `第 ${chapter} 章的提案不是重算提案`)
  if (proposal.status === 'reconciliation-required') {
    throw settlementError('SETTLEMENT_PROPOSAL_FAILED', `第 ${chapter} 章的提案已判为需要重算；用反馈重派 settler 并重新生成提案`)
  }
  const observations = settlementObservations(commit.receipt, proposal.payload.attempt)
  if (commit.receipt.outcome === 'reconciliation-required' && proposal.payload.attempt === 1) {
    // 先重算校验：正文与基线漂移必须在记录失败之前被拒绝。
    verifySettlementProposal({
      proposal,
      baseline: context.baseline,
      documentText: context.documentText,
      language,
      receipt: commit.receipt,
    })
    await recordSettlementFailure(root, proposal, commit.receipt.reportMarkdown.trim())
    throw settlementError('SETTLEMENT_RECONCILIATION_REQUIRED', renderSettlementFeedback(observations, language))
  }
  const settled = verifySettlementProposal({
    proposal,
    baseline: context.baseline,
    documentText: context.documentText,
    language,
    receipt: commit.receipt,
  })
  if (commit.receipt.outcome !== 'consistent') {
    await clearSettlementProposal(root, chapter)
    const message = observations.map((observation) => `[${observation.code}] ${observation.summary}`).join('\n')
    throw settlementError('SETTLEMENT_RECONCILIATION_UNRESOLVED', `第 ${chapter} 章重算未通过对账，未写任何作品文件：\n${message}`)
  }
  await commitFoundation(root, {
    writes: [
      ...stateJsonWrites(settled),
      ...stateProjectionWrites(settled),
      ...snapshotWrites(settled, chapter),
    ],
    deletes: [settlementProposalPath(chapter)],
  })
  return {
    status: 'published',
    chapter,
    baselineChapter: proposal.payload.baselineChapter,
    facts: settled.currentState.facts.length,
    hooks: settled.hooks.hooks.length,
    summaryTitle: summaryTitleOf(settled, chapter),
    postSettlement: proposal.payload.delta.postSettlement,
    proposalPath: settlementProposalPath(chapter),
    proposalDigest: proposal.digest,
    observations: [],
    message: `第 ${chapter} 章已从第 ${chapter - 1} 章快照重算。`,
  }
}

export function installResettleTool(ctx: PluginContext): Disposer {
  return ctx.tools.register({
    name: RESETTLE_NAME,
    description: 'Re-settle the latest published chapter from its baseline snapshot, in two phases. Call without validation to get a settlement proposal (.drafts/settlement-NNNN.json) computed by applying the submitted delta to the runtime state at chapter N-1; hand it to a state-check subagent, then call again with validation {proposalDigest, outcome, reportMarkdown} and no delta to commit. A consistent receipt rewrites the state files and snapshots/<chapter> in one commit. If reconciliation is still required after one retry, or validation is unavailable, nothing is written and the call fails. The chapter body, chapter index and workflow start are unchanged. Only the latest chapter is supported.',
    parameters: settlementToolParameters,
    output: {
      schema: output,
      render: (_args: unknown, value: ResettleOutput) => [{
        type: 'text' as const,
        text: value.status === 'proposal'
          ? `第 ${value.chapter} 章重算提案已生成（未写状态）：${value.proposalPath}；对账后带 validation 重调本工具提交。`
          : `第 ${value.chapter} 章已从第 ${value.baselineChapter} 章快照重算：${value.summaryTitle}（事实 ${value.facts} 条，伏笔 ${value.hooks} 条）`,
      }],
    },
    async execute(args: SettlementToolArgs, exec: ExecuteContext): Promise<ResettleOutput> {
      if (!exec?.agent) throw new Error('story_resettle_chapter 需要所属 agent 会话')
      const root = await ctx.workingDirectory.ensure(exec.agent)
      if (!Number.isInteger(args.chapter) || args.chapter < 1) throw new Error('chapter 必须是 ≥1 的整数')
      if (args.validation !== undefined) {
        if (hasAnyDelta(args)) throw new Error('提交调用只带 validation 收据，不要再带结算增量')
        const commit = commitArgsOf(args)
        return withWorkAction(root, async () => {
          const work = await readWork(root)
          return commitResettlement(root, work?.language ?? 'zh', commit)
        })
      }
      const proposal = proposalArgsOf(args)
      return withWorkAction(root, async () => {
        const work = await readWork(root)
        return proposeResettlement(root, work?.language ?? 'zh', proposal)
      }, { project: false })
    },
  } as ToolDefinition<SettlementToolArgs, ResettleOutput>)
}
