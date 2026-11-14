/**
 * `story_settle_chapter`：结算即发布，但对账先于提交。
 *
 * 不带 `validation` 的调用只生成提案 `.drafts/settlement-NNNN.json`（旧/新投影卡片），
 * 由主编派 state-check 子代理读它；带收据的调用重读正文与基线、逐字段重算，再一次
 * 提交发布章节、状态、快照、索引、artifact 与 active。第二次对账仍不通过时发布章节
 * 但状态不推进（源 `runtimeStateApplied: false`），由重算修复。
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { commitFoundation } from '../../core/commit.js'
import { chapterArtifactWrite } from '../../core/artifact-store.js'
import {
  chapterPrefix,
  countChapterLengthByMode,
  loadChapterDocument,
  renderChapterDocument,
  safeChapterTitle,
} from '../../core/chapter-document.js'
import { buildLengthTelemetry } from '../../core/chapter-index.js'
import { countingModeOf, lengthTargetOf } from '../../core/length.js'
import { draftPath, loadChapterDraft } from '../../core/chapter-draft.js'
import { chapterReviewPath, loadChapterReview } from '../../core/chapter-review.js'
import { CHAPTER_INDEX_PATH, readChapterIndexStrict } from '../../core/chapter-index.js'
import type { ChapterIndexEntry } from '../../core/chapter-index.js'
import { inspectState, snapshotWrites, stateJsonWrites, stateProjectionWrites } from '../../core/state.js'
import type { StateSnapshot } from '../../core/state.js'
import {
  assertStateConsistent,
  baselineDigest,
  buildSettlementProposal,
  documentDigest,
  renderSettlementFeedback,
  settlementError,
  settlementObservations,
} from '../../core/settlement.js'
import {
  nextAttempt,
  readProposalForRegeneration,
  readSettlementProposal,
  recordSettlementFailure,
  settlementProposalPath,
  verifySettlementProposal,
  writeSettlementProposal,
} from '../../core/settlement-proposal.js'
import { readWork } from '../../core/work.js'
import type { Work } from '../../core/work.js'
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

export const SETTLE_NAME = 'story_settle_chapter'

const output: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['proposal', 'published', 'held'] },
    chapter: { type: 'integer' },
    baselineChapter: { type: 'integer' },
    stateApplied: { type: 'boolean' },
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
    'status', 'chapter', 'baselineChapter', 'stateApplied', 'facts', 'hooks',
    'summaryTitle', 'postSettlement', 'proposalPath', 'proposalDigest', 'observations', 'message',
  ],
}

interface SettleOutput {
  status: 'proposal' | 'published' | 'held'
  chapter: number
  baselineChapter: number
  stateApplied: boolean
  facts: number
  hooks: number
  summaryTitle: string
  postSettlement: string
  proposalPath: string
  proposalDigest: string
  observations: Array<{ code: string, summary: string }>
  message: string
}

function summaryTitleOf(snapshot: StateSnapshot, chapter: number): string {
  return snapshot.chapterSummaries.rows.find((row) => row.chapter === chapter)?.title ?? ''
}

function countOf(snapshot: StateSnapshot): { facts: number, hooks: number } {
  return { facts: snapshot.currentState.facts.length, hooks: snapshot.hooks.hooks.length }
}

/**
 * 结算目标的前置：只允许未发布、未结算、无快照的章。
 * 扣下态（章与快照都在）指向重算；遗留「已发布未结算」（章在、快照缺）指向恢复。
 * @param root 作品根
 * @param snapshot 当前状态
 * @param chapter 目标章
 */
async function assertSettleTarget(root: string, snapshot: StateSnapshot, chapter: number): Promise<void> {
  const last = snapshot.manifest.lastAppliedChapter
  const published = await loadChapterDocument(root, chapter) !== null
  const snapshotExists = existsSync(join(root, 'source/story/snapshots', String(chapter)))
  if (published) {
    if (snapshotExists) throw new Error(`第 ${chapter} 章已发布；重算请用 story_resettle_chapter`)
    if (last < chapter) throw new Error(`第 ${chapter} 章已发布但状态未推进且缺快照；先运行 story_recover 处理`)
    throw new Error(`第 ${chapter} 章已发布；重算请用 story_resettle_chapter`)
  }
  if (snapshotExists) throw new Error(`第 ${chapter} 章已有状态快照；重算请用 story_resettle_chapter`)
  if (chapter === last) throw new Error(`第 ${chapter} 章已结算；重算请用 story_resettle_chapter`)
  if (chapter < last) throw new Error(`第 ${chapter} 章早于已结算的第 ${last} 章；不支持更早章节重算`)
}

/** 提案形态：校验前置、渲染提案并写 `.drafts/settlement-NNNN.json`，不写 `source/`。 */
async function proposeSettlement(root: string, work: Work, args: ProposalArgs): Promise<SettleOutput> {
  const read = await inspectState(root, [], work.language)
  if (read.missing.length > 0) throw new Error(`状态文件缺失，先修复或重建再结算：${read.missing.join('、')}`)
  if (read.invalid.length > 0) throw new Error(`状态文件损坏，先修复再结算：${read.invalid.join('、')}`)
  assertStateConsistent(read.snapshot)
  const chapter = args.chapter
  await assertSettleTarget(root, read.snapshot, chapter)
  const draft = await loadChapterDraft(root, chapter, work.language)
  if (draft === null) throw new Error(`第 ${chapter} 章还没有草稿，先写再结算`)
  if (await loadChapterReview(root, chapter) === null) throw new Error(`第 ${chapter} 章还没有审稿记录，先审再结算`)
  const delta = settlementDeltaOf(args)
  const documentText = await readFile(join(root, draftPath(chapter)), 'utf8')
  const attempt = nextAttempt(
    await readProposalForRegeneration(root, chapter),
    'settle',
    documentDigest(documentText),
    baselineDigest(read.snapshot),
  )
  const proposal = buildSettlementProposal({
    kind: 'settle',
    chapter,
    attempt,
    baseline: read.snapshot,
    delta,
    documentText,
    language: work.language,
  })
  await writeSettlementProposal(root, {
    version: 1,
    kind: 'settle',
    chapter,
    baselineChapter: proposal.payload.baselineChapter,
    status: 'proposed',
    payload: proposal.payload,
    digest: proposal.digest,
  })
  const counts = countOf(proposal.settled)
  return {
    status: 'proposal',
    chapter,
    baselineChapter: proposal.payload.baselineChapter,
    stateApplied: false,
    facts: counts.facts,
    hooks: counts.hooks,
    summaryTitle: summaryTitleOf(proposal.settled, chapter),
    postSettlement: delta.postSettlement,
    proposalPath: settlementProposalPath(chapter),
    proposalDigest: proposal.digest,
    observations: [],
    message: '提案已生成；把它交给 state-check 子代理对账，再带 validation 提交。',
  }
}

/** 提交形态：重读正文与基线、逐字段重算，再按收据决定发布、拒绝或扣下。 */
async function commitSettlement(root: string, work: Work, commit: CommitArgs): Promise<SettleOutput> {
  const chapter = commit.chapter
  const read = await inspectState(root, [], work.language)
  if (read.missing.length > 0) throw new Error(`状态文件缺失，先修复或重建再结算：${read.missing.join('、')}`)
  if (read.invalid.length > 0) throw new Error(`状态文件损坏，先修复再结算：${read.invalid.join('、')}`)
  assertStateConsistent(read.snapshot)
  await assertSettleTarget(root, read.snapshot, chapter)
  const draft = await loadChapterDraft(root, chapter, work.language)
  if (draft === null) throw new Error(`第 ${chapter} 章还没有草稿，先写再结算`)
  const review = await loadChapterReview(root, chapter)
  if (review === null) throw new Error(`第 ${chapter} 章还没有审稿记录，先审再结算`)
  const proposal = await readSettlementProposal(root, chapter)
  if (proposal === null) throw settlementError('SETTLEMENT_PROPOSAL_UNAVAILABLE', `第 ${chapter} 章没有结算提案；先生成提案`)
  if (proposal.kind !== 'settle') throw settlementError('SETTLEMENT_PROPOSAL_UNAVAILABLE', `第 ${chapter} 章的提案不是结算提案`)
  if (proposal.status === 'reconciliation-required') {
    throw settlementError('SETTLEMENT_PROPOSAL_FAILED', `第 ${chapter} 章的提案已判为需要重算；用反馈重派 settler 并重新生成提案`)
  }
  const documentText = await readFile(join(root, draftPath(chapter)), 'utf8')
  const settled = verifySettlementProposal({
    proposal,
    baseline: read.snapshot,
    documentText,
    language: work.language,
    receipt: commit.receipt,
  })
  const observations = settlementObservations(commit.receipt, proposal.payload.attempt)
  if (commit.receipt.outcome === 'reconciliation-required' && proposal.payload.attempt === 1) {
    await recordSettlementFailure(root, proposal, commit.receipt.reportMarkdown.trim())
    throw settlementError('SETTLEMENT_RECONCILIATION_REQUIRED', renderSettlementFeedback(observations, work.language))
  }
  const held = commit.receipt.outcome !== 'consistent'
  const written = held ? read.snapshot : settled
  const counts = countOf(written)
  const title = draft.title
  const relativePath = `source/chapters/${chapterPrefix(chapter)}${safeChapterTitle(title)}.md`
  const content = renderChapterDocument({ chapter, title, content: draft.content, language: work.language })
  const entries = await readChapterIndexStrict(root)
  const now = new Date().toISOString()
  const existingIndex = entries.findIndex((entry) => entry.number === chapter)
  const countingMode = countingModeOf(work.language)
  const finalCount = countChapterLengthByMode(draft.content, countingMode)
  const entry: ChapterIndexEntry = {
    number: chapter,
    title,
    wordCount: finalCount,
    createdAt: existingIndex >= 0 ? entries[existingIndex]!.createdAt : now,
    updatedAt: now,
    observations: held ? [...review.observations, ...observations] : [...review.observations],
    provenance: 'generated',
    lengthTelemetry: buildLengthTelemetry({
      target: lengthTargetOf(work),
      countingMode,
      writerCount: finalCount,
      postReviseCount: 0,
      finalCount,
      repairApplied: false,
    }),
  }
  const nextEntries = existingIndex >= 0
    ? entries.map((current, index) => index === existingIndex ? entry : current)
    : [...entries, entry]
  const artifact = await chapterArtifactWrite(root, { chapter, chapterPath: relativePath, content })
  const status: Work['status'] = work.status === 'draft' ? 'active' : work.status
  const nextWork: Work = { ...work, status, updatedAt: status === work.status ? work.updatedAt : now }
  const updatedReview = {
    ...review,
    reviewedArtifact: {
      workId: work.id,
      artifactId: artifact.artifact.id,
      revisionId: artifact.artifact.currentRevisionId ?? '',
    },
  }
  await commitFoundation(root, {
    writes: [
      { relativePath, content },
      ...stateJsonWrites(written),
      ...stateProjectionWrites(written),
      ...snapshotWrites(written, chapter),
      { relativePath: CHAPTER_INDEX_PATH, content: `${JSON.stringify(nextEntries, null, 2)}\n` },
      { relativePath: 'work.json', content: `${JSON.stringify(nextWork, null, 2)}\n` },
      { relativePath: artifact.relativePath, content: artifact.content },
      artifact.snapshot,
      { relativePath: chapterReviewPath(chapter), content: `${JSON.stringify(updatedReview, null, 2)}\n` },
    ],
    deletes: [draftPath(chapter), settlementProposalPath(chapter)],
  })
  return {
    status: held ? 'held' : 'published',
    chapter,
    baselineChapter: proposal.payload.baselineChapter,
    stateApplied: !held,
    facts: counts.facts,
    hooks: counts.hooks,
    summaryTitle: summaryTitleOf(written, chapter),
    postSettlement: proposal.payload.delta.postSettlement,
    proposalPath: settlementProposalPath(chapter),
    proposalDigest: proposal.digest,
    observations: observations.map((observation) => ({ code: observation.code, summary: observation.summary })),
    message: held
      ? `第 ${chapter} 章已发布但状态未推进；用 story_resettle_chapter 按第 ${chapter - 1} 章快照重建。`
      : `第 ${chapter} 章已结算并发布。`,
  }
}

export function installSettleTool(ctx: PluginContext): Disposer {
  return ctx.tools.register({
    name: SETTLE_NAME,
    description: 'Settle one reviewed draft. Call without validation to get a settlement proposal (.drafts/settlement-NNNN.json, nothing published); hand it to a state-check subagent, then call again with validation {proposalDigest, outcome, reportMarkdown} and no delta to commit. A consistent receipt publishes the chapter, four state JSON files, three projections, snapshots/<N>, the index entry, the artifact and active in one commit and advances lastAppliedChapter. reconciliation-required on the first attempt records the report and refuses so the settler can retry with the feedback; if the second attempt is still reconciliation-required, or validation is unavailable, the chapter is published but state stays at N-1 with the observation recorded. To re-settle an already published chapter use story_resettle_chapter.',
    parameters: settlementToolParameters,
    output: {
      schema: output,
      render: (_args: unknown, value: SettleOutput) => {
        if (value.status === 'proposal') {
          return [{
            type: 'text' as const,
            text: `第 ${value.chapter} 章结算提案已生成（未发布）：${value.proposalPath}；把它交给 state-check 子代理对账后，带 validation 重调本工具提交。`,
          }]
        }
        if (value.status === 'held') {
          const first = value.observations[0]?.summary.split('\n')[0] ?? ''
          return [{
            type: 'text' as const,
            text: `第 ${value.chapter} 章已发布，但状态未推进（对账未通过）：${first}；修复后用 story_resettle_chapter 按第 ${value.baselineChapter} 章快照重建。`,
          }]
        }
        return [{
          type: 'text' as const,
          text: `第 ${value.chapter} 章已结算并发布：${value.summaryTitle}（事实 ${value.facts} 条，伏笔 ${value.hooks} 条）`,
        }]
      },
    },
    async execute(args: SettlementToolArgs, exec: ExecuteContext): Promise<SettleOutput> {
      if (!exec?.agent) throw new Error('story_settle_chapter 需要所属 agent 会话')
      const root = await ctx.workingDirectory.ensure(exec.agent)
      if (!Number.isInteger(args.chapter) || args.chapter < 1) throw new Error('chapter 必须是 ≥1 的整数')
      if (args.validation !== undefined) {
        if (hasAnyDelta(args)) throw new Error('提交调用只带 validation 收据，不要再带结算增量')
        const commit = commitArgsOf(args)
        return withWorkAction(root, async () => {
          const work = await readWork(root)
          if (work === null) throw new Error('工作区没有 work.json')
          return commitSettlement(root, work, commit)
        })
      }
      const proposal = proposalArgsOf(args)
      return withWorkAction(root, async () => {
        const work = await readWork(root)
        if (work === null) throw new Error('工作区没有 work.json')
        return proposeSettlement(root, work, proposal)
      }, { project: false })
    },
  } as ToolDefinition<SettlementToolArgs, SettleOutput>)
}
