/**
 * `story_commit_revision`：修订提案的结算提案（C1）与一次提交（C2）。
 *
 * C1 只写 `.drafts/revision-NNNN.settlement.json`；C2 用 N-1 基线重跑结算，
 * 一次提交章节、索引、artifact、状态与快照。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

import { chapterArtifactWrite } from '../../core/artifact-store.js'
import { chapterBodyForChapter, loadChapterDocument, renderChapterDocument } from '../../core/chapter-document.js'
import { CHAPTER_INDEX_PATH, buildLengthTelemetry, readChapterIndexStrict, revisedChapterIndex } from '../../core/chapter-index.js'
import { loadChapterReview, chapterReviewPath } from '../../core/chapter-review.js'
import { commitFoundation } from '../../core/commit.js'
import { countChapterLengthByMode } from '../../core/length.js'
import {
  readRevisionProposal,
  readRevisionSettlement,
  renderRevisionSettlement,
  revisionDigest,
  revisionProposalPath,
  revisionSettlementPath,
} from '../../core/revision.js'
import { buildSettlementProposal, settlementObservations } from '../../core/settlement.js'
import { verifySettlementProposal } from '../../core/settlement-proposal.js'
import { inspectState, readStateSnapshot, snapshotWrites, stateJsonWrites, stateProjectionWrites } from '../../core/state.js'
import { readWork } from '../../core/work.js'
import { withWorkAction } from '../../core/work-mutation.js'
import type { Disposer, ExecuteContext, JsonSchema, PluginContext, ToolDefinition } from '../../core/types.js'
import { settlementDeltaOf, settlementToolParameters } from './settle-delta.js'
import type { ProposalArgs, SettlementToolArgs } from './settle-delta.js'

export const COMMIT_REVISION_NAME = 'story_commit_revision'

const parameters: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ...(settlementToolParameters.properties as Record<string, JsonSchema>),
    revisionDigest: { type: 'string', description: '修订提案的 contentDigest' },
    proposalDigest: { type: 'string', description: 'C1 返回的结算提案摘要；C2 必填' },
  },
  required: ['chapter', 'revisionDigest'],
}

const output: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['proposal', 'published'] },
    chapter: { type: 'integer' },
    proposalPath: { type: 'string' },
    proposalDigest: { type: 'string' },
    path: { type: 'string' },
    revisionId: { type: 'string' },
    observations: { type: 'integer' },
    message: { type: 'string' },
  },
  required: ['status', 'chapter', 'message'],
}

interface CommitRevisionArgs extends SettlementToolArgs {
  revisionDigest?: string
  proposalDigest?: string
}

interface CommitRevisionResult {
  status: 'proposal' | 'published'
  chapter: number
  proposalPath: string
  proposalDigest: string
  path: string
  revisionId: string
  observations: number
  message: string
}

async function assertBaseDocument(root: string, chapter: number, baseDigest: string): Promise<void> {
  const document = await loadChapterDocument(root, chapter)
  if (document === null) throw new Error(`第 ${chapter} 章没有正文`)
  if (revisionDigest(document.content) !== baseDigest) {
    throw new Error(`第 ${chapter} 章的正文在提案生成后已变化；重新生成修订提案`)
  }
}

async function latestAndState(root: string, chapter: number): Promise<void> {  const entries = await readChapterIndexStrict(root)
  const max = entries.reduce((value, entry) => Math.max(value, entry.number), 0)
  if (max !== chapter) throw new Error(`第 ${chapter} 章不是最新已发布章（当前最新 ${max}）；修订提交只支持最新章`)
  const work = await readWork(root)
  const state = await inspectState(root, [], work?.language ?? 'zh')
  if (state.missing.length > 0 || state.invalid.length > 0) throw new Error('状态不可读；先运行 story_recover')
  const last = state.snapshot.manifest.lastAppliedChapter
  if (last !== chapter - 1 && last !== chapter) {
    throw new Error(`当前状态已结算到第 ${last} 章，不能按第 ${chapter - 1} 章基线提交修订；先处理更晚章`)
  }
}

async function proposalPhase(root: string, args: CommitRevisionArgs): Promise<CommitRevisionResult> {
  const chapter = args.chapter
  const revision = await readRevisionProposal(root, chapter)
  if (revision === null) throw new Error(`第 ${chapter} 章没有修订提案；先生成修订提案`)
  if (revision.contentDigest !== args.revisionDigest) throw new Error('revisionDigest 与修订提案不一致')
  await assertBaseDocument(root, chapter, revision.baseDigest)
  const review = await loadChapterReview(root, chapter)
  if (review === null || review.reviewedRevisionDigest !== revision.contentDigest) {
    throw new Error(`第 ${chapter} 章的修订提案还没有对应审稿；先审稿`)
  }
  await latestAndState(root, chapter)
  const baseline = await readStateSnapshot(root, chapter - 1)
  const work = await readWork(root)
  const existing = await readRevisionSettlement(root, chapter)
  const attempt: 1 | 2 = existing?.payload.attempt === 2 || existing?.status === 'reconciliation-required' ? 2 : 1
  const delta = settlementDeltaOf(args as ProposalArgs)
  const proposal = buildSettlementProposal({
    kind: 'resettle',
    chapter,
    attempt,
    baseline,
    delta,
    documentText: revision.content,
    language: work?.language ?? 'zh',
  })
  const file = {
    version: 1 as const,
    kind: 'resettle' as const,
    chapter,
    baselineChapter: proposal.payload.baselineChapter,
    status: 'proposed' as const,
    payload: proposal.payload,
    digest: proposal.digest,
  }
  await commitFoundation(root, {
    writes: [{ relativePath: revisionSettlementPath(chapter), content: renderRevisionSettlement(file) }],
  })
  return {
    status: 'proposal',
    chapter,
    proposalPath: revisionSettlementPath(chapter),
    proposalDigest: proposal.digest,
    path: '',
    revisionId: '',
    observations: 0,
    message: `第 ${chapter} 章修订结算提案已生成（attempt ${attempt}）：${revisionSettlementPath(chapter)}；对账后带 validation 提交。`,
  }
}

async function commitPhase(root: string, args: CommitRevisionArgs): Promise<CommitRevisionResult> {
  const chapter = args.chapter
  const revision = await readRevisionProposal(root, chapter)
  if (revision === null) throw new Error(`第 ${chapter} 章没有修订提案`)
  if (revision.contentDigest !== args.revisionDigest) throw new Error('revisionDigest 与修订提案不一致')
  await assertBaseDocument(root, chapter, revision.baseDigest)
  const proposal = await readRevisionSettlement(root, chapter)
  if (proposal === null) throw new Error(`第 ${chapter} 章没有修订结算提案；先生成 C1 提案`)
  if (args.proposalDigest === undefined || args.proposalDigest !== proposal.digest) throw new Error('proposalDigest 与服务端提案不一致')
  const validation = args.validation
  if (validation === undefined) throw new Error('C2 需要 validation 收据')
  if (typeof validation.proposalDigest !== 'string' || typeof validation.outcome !== 'string' || typeof validation.reportMarkdown !== 'string') {
    throw new Error('validation 必须带 proposalDigest、outcome 与 reportMarkdown')
  }
  if (validation.proposalDigest !== proposal.digest) throw new Error('validation.proposalDigest 与结算提案不一致')
  const receipt = validation as { proposalDigest: string, outcome: 'consistent' | 'reconciliation-required' | 'unavailable', reportMarkdown: string }
  const review = await loadChapterReview(root, chapter)
  if (review === null || review.reviewedRevisionDigest !== revision.contentDigest) {
    throw new Error(`第 ${chapter} 章的修订提案还没有对应审稿；先审稿`)
  }
  await latestAndState(root, chapter)
  const baseline = await readStateSnapshot(root, chapter - 1)
  const work = await readWork(root)
  const language = work?.language ?? 'zh'
  const settled = verifySettlementProposal({
    proposal,
    baseline,
    documentText: revision.content,
    language,
    receipt,
  })
  const attempt = proposal.payload.attempt
  if (receipt.outcome !== 'consistent' && attempt === 1) {
    await commitFoundation(root, { writes: [{ relativePath: revisionSettlementPath(chapter), content: renderRevisionSettlement({ ...proposal, status: 'reconciliation-required', failureReport: receipt.reportMarkdown.trim() }) }] })
    throw new Error('SETTLEMENT_RECONCILIATION_REQUIRED: 第一次对账未通过；用反馈重派 settler 后重新生成 C1 提案')
  }
  const stateObservations = settlementObservations(receipt, attempt).filter((observation) => observation.summary.trim() !== '')
  const entries = await readChapterIndexStrict(root)
  const current = entries.find((entry) => entry.number === chapter)
  if (current === undefined) throw new Error(`第 ${chapter} 章没有索引条目`)
  const chapterDocument = await loadChapterDocument(root, chapter)
  if (chapterDocument === null) throw new Error(`第 ${chapter} 章没有正文`)
  const countingMode = current.lengthTelemetry?.countingMode === 'en_words' ? 'en_words' : (language === 'en' ? 'en_words' : 'zh_chars')
  const target = current.lengthTelemetry?.target ?? work?.metadata.chapterWordCount ?? (language === 'en' ? 2000 : 3000)
  const writerCount = countChapterLengthByMode(chapterDocument.content, countingMode)
  const finalCount = countChapterLengthByMode(revision.content, countingMode)
  const lengthTelemetry = buildLengthTelemetry({
    target,
    countingMode,
    writerCount,
    postReviseCount: finalCount,
    finalCount,
    repairApplied: revision.changed,
  })
  const now = new Date().toISOString()
  const nextEntries = revisedChapterIndex(entries, {
    chapter,
    title: revision.title,
    wordCount: finalCount,
    language,
    now,
    lengthTelemetry,
  }).map((entry) => entry.number === chapter
    ? { ...entry, observations: [...review.observations, ...stateObservations] }
    : entry)
  const document = renderChapterDocument({ chapter, title: revision.title, content: revision.content, language })
  const archivePath = `source/chapters/.versions/${String(chapter).padStart(4, '0')}/${Date.now()}_revision_${randomUUID()}.md`
  const currentDocument = await readFile(join(root, chapterDocument.path), 'utf8')
  const artifact = await chapterArtifactWrite(root, {
    chapter,
    chapterPath: chapterDocument.path,
    content: document,
    previousContent: currentDocument,
  })
  const writes = [
    { relativePath: CHAPTER_INDEX_PATH, content: `${JSON.stringify(nextEntries, null, 2)}\n` },
    { relativePath: chapterDocument.path, content: document },
    { relativePath: artifact.relativePath, content: artifact.content },
    artifact.snapshot,
    ...(artifact.backfill === undefined ? [] : [artifact.backfill]),
    ...stateJsonWrites(settled),
    ...stateProjectionWrites(settled),
    ...snapshotWrites(settled, chapter),
  ]
  if (revision.changed) writes.push({ relativePath: archivePath, content: currentDocument })
  await commitFoundation(root, {
    writes,
    deletes: [
      revisionProposalPath(chapter),
      revisionSettlementPath(chapter),
      chapterReviewPath(chapter),
    ],
  })
  return {
    status: 'published',
    chapter,
    proposalPath: revisionSettlementPath(chapter),
    proposalDigest: proposal.digest,
    path: chapterDocument.path,
    revisionId: artifact.artifact.currentRevisionId ?? '',
    observations: review.observations.length + stateObservations.length,
    message: `第 ${chapter} 章修订已一次提交（正文/索引/artifact/状态/快照）；提案与审稿记录已删除。`,
  }
}

export function installCommitRevisionTool(ctx: PluginContext): Disposer {
  return ctx.tools.register({
    name: COMMIT_REVISION_NAME,
    description: 'Commit a two-phase revision of the latest published chapter. Call without validation to write a revision settlement proposal from the reviser delta and the revision proposal; hand it to state-check, then call with validation {proposalDigest, outcome, reportMarkdown} and proposalDigest to commit the chapter, index, artifact, state and snapshots in one transaction. First-attempt reconciliation-required is rejected; the second attempt commits unresolved with observations, matching the revision path.',
    parameters,
    output: {
      schema: output,
      render: (_args: unknown, value: CommitRevisionResult) => [{
        type: 'text' as const,
        text: value.status === 'proposal'
          ? `第 ${value.chapter} 章修订结算提案已生成：${value.proposalPath}；对账后带 validation 提交。`
          : `第 ${value.chapter} 章修订已提交：${value.path}（${value.observations} 条观察）${value.revisionId === '' ? '' : `，revision ${value.revisionId}`}`,
      }],
    },
    async execute(args: CommitRevisionArgs, exec: ExecuteContext): Promise<CommitRevisionResult> {
      if (!exec?.agent) throw new Error('story_commit_revision 需要所属 agent 会话')
      const root = await ctx.workingDirectory.ensure(exec.agent)
      if (!Number.isInteger(args.chapter) || args.chapter < 1) throw new Error('chapter 必须是 ≥1 的整数')
      if (typeof args.revisionDigest !== 'string' || args.revisionDigest === '') throw new Error('revisionDigest 不能为空')
      return withWorkAction(root, async () => args.validation === undefined
        ? proposalPhase(root, args)
        : commitPhase(root, args))
    },
  } as ToolDefinition<CommitRevisionArgs, CommitRevisionResult>)
}
