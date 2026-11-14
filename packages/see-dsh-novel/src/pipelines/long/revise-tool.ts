/**
 * `story_revise_chapter`：把 reviser 子代理返回的修订落成新的章节版本。
 *
 * spot-fix 用 `ranges`＋`replacements` 逐段构造正文，范围外不变；
 * 其余模式交整段 `content`，都可选用唯一 `targetText` 绑定局部改动。
 */
import type { Disposer, ExecuteContext, JsonSchema, PluginContext, ToolDefinition } from '../../core/types.js'
import { chapterBodyForChapter, loadChapterDocument, renderChapterDocument, reviseChapterDocument } from '../../core/chapter-document.js'
import { draftPath, loadChapterDraft } from '../../core/chapter-draft.js'
import { commitFoundation } from '../../core/commit.js'
import { chapterReviewPath, loadChapterReview } from '../../core/chapter-review.js'
import { chapterTitleOf, readChapterIndex } from '../../core/chapter-index.js'
import { readStateSnapshot } from '../../core/state.js'
import { renderRevisionProposal, revisionDigest, revisionProposalPath, revisionSettlementPath } from '../../core/revision.js'
import { loadChapterPlan } from '../../core/chapter-plan.js'
import { assertChapterLength, chapterLengthDelivery, chapterLengthSpecOf, countChapterLengthByMode, replacementBudgetOf } from '../../core/length.js'
import type { LengthSpec } from '../../core/length.js'
import {
  DEFAULT_REVISE_MODE,
  REVISE_MODES,
  applyRangeEdits,
  assertTargetText,
  changedRegion,
  normalizeRangeEdits,
  rangeEditError,
  splitBodyLines,
} from '../../core/revise.js'
import type { ReviseMode, ReviseRange, ChangedRegion } from '../../core/revise.js'
import { withWorkAction } from '../../core/work-mutation.js'
import { reviewStartWrites } from '../../core/workflow-start.js'
import { readWork } from '../../core/work.js'

export const REVISE_NAME = 'story_revise_chapter'

const parameters: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    chapter: { type: 'integer', description: '章号；必须已有正文与章纲' },
    mode: {
      type: 'string',
      enum: [...REVISE_MODES],
      description: '修订模式；默认 rewrite。spot-fix 用 ranges／replacements 或 targetText 做局部替换，保留范围外正文',
    },
    content: { type: 'string', description: '修订后的正文（不含标题行）' },
    targetText: {
      type: 'string',
      description: '局部修订的原文片段；任意模式可用，要求唯一且片段外正文不变',
    },
    ranges: {
      type: 'array',
      description: 'spot-fix 的原文行范围（1 基、含端点、不重叠，可乱序）',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          startLine: { type: 'integer', minimum: 1 },
          endLine: { type: 'integer', minimum: 1 },
        },
        required: ['startLine', 'endLine'],
      },
    },
    replacements: {
      type: 'array',
      description: '与 ranges 一一对应的替换文本；空串删除该段，非空按换行分行',
      items: { type: 'string' },
    },
  },
  required: ['chapter', 'content'],
}

const regionSide: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    startLine: { type: 'integer' },
    lineCount: { type: 'integer' },
    content: { type: 'string' },
    truncated: { type: 'boolean' },
  },
  required: ['startLine', 'lineCount', 'content', 'truncated'],
}

const changedRegionSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    scope: { type: 'string', enum: ['contiguous_changed_region'] },
    before: regionSide,
    after: regionSide,
  },
  required: ['scope', 'before', 'after'],
}

const output: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    chapter: { type: 'integer' },
    path: { type: 'string' },
    mode: { type: 'string' },
    changed: { type: 'boolean' },
    charCount: { type: 'integer' },
    target: { type: 'integer' },
    revisionId: { type: 'string' },
    reviewInvalidated: { type: 'boolean' },
    replacedStartChapter: { type: 'integer', description: '被本章 start 替换掉的未消费 start 章号' },
    changedRegion: changedRegionSchema,
    proposalPath: { type: 'string' },
    proposalDigest: { type: 'string' },
    settleRequired: { type: 'boolean' },
    wordCount: { type: 'integer' },
    delivery: { type: 'object' },
  },
  required: ['chapter', 'path', 'mode', 'changed', 'charCount', 'target', 'revisionId', 'reviewInvalidated', 'changedRegion'],
}

export interface ReviseResult {
  chapter: number
  path: string
  mode: ReviseMode
  changed: boolean
  charCount: number
  target: number
  revisionId: string
  reviewInvalidated: boolean
  replacedStartChapter?: number
  changedRegion: ChangedRegion
  wordCount?: number
  delivery?: ReturnType<typeof chapterLengthDelivery>
  proposalPath?: string
  proposalDigest?: string
  settleRequired?: boolean
}

interface ReviseArgs {
  chapter: number
  content: string
  mode?: string
  targetText?: string
  ranges?: ReviseRange[]
  replacements?: string[]
}

function normalizeMode(value: unknown): ReviseMode {
  if (value === undefined) return DEFAULT_REVISE_MODE
  if (typeof value === 'string' && (REVISE_MODES as ReadonlyArray<string>).includes(value)) return value as ReviseMode
  throw new Error(`未知的修订模式：${String(value)}`)
}

export function installReviseTool(ctx: PluginContext): Disposer {
  return ctx.tools.register({
    name: REVISE_NAME,
    description: 'Revise one persisted chapter from the reviser subagent output. Rewrites the same chapter file, archives the previous prose under source/chapters/.versions, appends an artifact revision, and invalidates the chapter review so it must be reviewed again. spot-fix replaces the declared non-overlapping line ranges with per-range replacements and keeps all other prose unchanged.',
    parameters,
    output: {
      schema: output,
      render: (_args: unknown, value: ReviseResult) => {
        const region = JSON.stringify(value.changedRegion)
        const replaced = value.replacedStartChapter === undefined ? '' : `；已替换第 ${value.replacedStartChapter} 章的未消费 start`
        return [{
          type: 'text' as const,
          text: value.changed
            ? `第 ${value.chapter} 章已修订（${value.mode}）：${value.path}（${value.charCount} / 目标 ${value.target}；改动区域：${region}；旧审稿已作废，本章已重新打开，等待重新审稿${replaced}）`
            : `第 ${value.chapter} 章没有改动（${value.mode}）；改动区域：${region}`,
        }]
      },
    },
    async execute(args: ReviseArgs, exec: ExecuteContext): Promise<ReviseResult> {
      if (!exec?.agent) throw new Error('story_revise_chapter 需要所属 agent 会话')
      const root = await ctx.workingDirectory.ensure(exec.agent)
      return withWorkAction(root, async () => {
        const work = await readWork(root)
        if (work === null) throw new Error('工作区没有 work.json')
        const document = await loadChapterDocument(root, args.chapter)
        const draft = document === null ? await loadChapterDraft(root, args.chapter) : null
        if (document === null && draft === null) throw new Error(`第 ${args.chapter} 章还没有正文，先写再修订`)
        const base = document?.content ?? draft!.content
        if (await loadChapterPlan(root, args.chapter) === null) {
          throw new Error(`第 ${args.chapter} 章还没有章纲，先规划再修订`)
        }

        const mode = normalizeMode(args.mode)
        const hasRanges = args.ranges !== undefined || args.replacements !== undefined
        if (hasRanges && mode !== 'spot-fix') {
          throw rangeEditError('ranges 与 replacements 只在 spot-fix 可用')
        }
        if (hasRanges && args.targetText !== undefined) {
          throw rangeEditError('ranges 与 replacements 不能与 targetText 同时使用')
        }
        if (mode === 'spot-fix' && !hasRanges && args.targetText === undefined) {
          throw rangeEditError('spot-fix 需要 ranges 与 replacements，或 targetText')
        }

        let body: string
        let edits: ReturnType<typeof normalizeRangeEdits> | undefined
        if (hasRanges) {
          edits = normalizeRangeEdits(args.ranges, args.replacements, splitBodyLines(base).length)
          const constructed = chapterBodyForChapter(applyRangeEdits(base, edits), args.chapter)
          if (constructed === '') throw new Error('content 不能为空')
          const normalized = chapterBodyForChapter(args.content, args.chapter)
          if (normalized !== constructed) {
            throw new Error('CHAPTER_EDIT_SCOPE_CONFLICT: content 与 ranges／replacements 构造结果不一致')
          }
          body = constructed
        } else {
          body = chapterBodyForChapter(args.content, args.chapter)
          if (body === '') throw new Error('content 不能为空')
        }

        if (args.targetText !== undefined) assertTargetText(base, body, args.targetText)

        const entries = document === null ? [] : await readChapterIndex(root)
        const entry = entries.find((item) => item.number === args.chapter)
        const spec = chapterLengthSpecOf(work, entry)
        let replacementBudget: ReturnType<typeof replacementBudgetOf> | undefined
        if (edits !== undefined) {
          const fixedContent = chapterBodyForChapter(applyRangeEdits(base, edits.map((edit) => ({ ...edit, replacement: '' }))), args.chapter)
          replacementBudget = replacementBudgetOf(countChapterLengthByMode(fixedContent, spec.countingMode), spec)
          if (replacementBudget.maximum !== undefined && replacementBudget.maximum < 0) {
            throw Object.assign(
              new Error('CHAPTER_EDIT_SCOPE_CONFLICT: the protected text alone exceeds the chapter maximum. These edit ranges cannot satisfy both scope and length constraints.'),
              { code: 'CHAPTER_EDIT_SCOPE_CONFLICT', replacementBudget },
            )
          }
        } else if (args.targetText !== undefined) {
          const fixedContent = base.replace(args.targetText, '')
          replacementBudget = replacementBudgetOf(countChapterLengthByMode(fixedContent, spec.countingMode), spec)
          if (replacementBudget.maximum !== undefined && replacementBudget.maximum < 0) {
            throw Object.assign(
              new Error('CHAPTER_EDIT_SCOPE_CONFLICT: the protected text alone exceeds the chapter maximum. The selected text cannot satisfy both scope and length constraints.'),
              { code: 'CHAPTER_EDIT_SCOPE_CONFLICT', replacementBudget },
            )
          }
        }

        assertChapterLength(body, spec, {
          ...(edits !== undefined || args.targetText !== undefined
            ? { scope: 'selected_ranges' as const, source: { length: countChapterLengthByMode(base, spec.countingMode), unchangedByThisAttempt: true }, candidateCommitted: false as const }
            : {}),
          ...(replacementBudget === undefined ? {} : { replacementBudget }),
          ...(edits !== undefined || args.targetText !== undefined
            ? { instruction: 'The rejected replacement has not changed the source chapter. Adjust only the selected replacement fields to their combined budget. Do not include or rewrite protected surrounding text.' }
            : {}),
        })

        const target = spec.target
        const changed = body !== base
        const finalCount = countChapterLengthByMode(body, spec.countingMode)
        const delivery = chapterLengthDelivery(finalCount, spec)
        const latest = entries.reduce((max, entry) => Math.max(max, entry.number), 0)
        const latestTwoPhase = document !== null && args.chapter === latest
        const review = changed || latestTwoPhase ? await loadChapterReview(root, args.chapter) : null
        // 复审要过 workflow start 闸门：同章沿用，没有或指向其它章时写本章 start。
        const start = changed || latestTwoPhase ? await reviewStartWrites(root, args.chapter, `修订后重审第 ${args.chapter} 章`) : null
        const startWrites = start?.writes ?? []
        const replacedStartChapter = start?.replacedStartChapter
        if (document !== null) await readStateSnapshot(root, args.chapter - 1)
        if (latestTwoPhase) {
          const digest = revisionDigest(body)
          const proposal = {
            version: 1 as const,
            chapter: args.chapter,
            title: chapterTitleOf(document!.heading, document!.path.split('/').pop() ?? ''),
            content: body,
            contentDigest: digest,
            baseDigest: revisionDigest(base),
            changed,
            mode,
            ...(args.ranges === undefined ? {} : { ranges: args.ranges }),
            ...(args.replacements === undefined ? {} : { replacements: args.replacements }),
            ...(args.targetText === undefined ? {} : { targetText: args.targetText }),
            createdAt: new Date().toISOString(),
          }
          await commitFoundation(root, {
            writes: [
              { relativePath: revisionProposalPath(args.chapter), content: renderRevisionProposal(proposal) },
              ...startWrites,
            ],
            deletes: [chapterReviewPath(args.chapter), revisionSettlementPath(args.chapter)],
          })
          return {
            chapter: args.chapter,
            path: revisionProposalPath(args.chapter),
            mode,
            changed,
            charCount: finalCount, wordCount: finalCount, ...(delivery === undefined ? {} : { delivery }),
            target,
            revisionId: '',
            reviewInvalidated: review !== null,
            ...(replacedStartChapter === undefined ? {} : { replacedStartChapter }),
            changedRegion: changedRegion(base, body),
            proposalPath: revisionProposalPath(args.chapter),
            proposalDigest: digest,
            settleRequired: true,
          }
        }
        if (document === null) {
          const draftDocument = renderChapterDocument({ chapter: args.chapter, title: draft!.title, content: body, language: work.language })
          await commitFoundation(root, {
            writes: [{ relativePath: draftPath(args.chapter), content: draftDocument }, ...startWrites],
            deletes: changed && review !== null ? [chapterReviewPath(args.chapter)] : [],
          })
          return {
            chapter: args.chapter,
            path: draftPath(args.chapter),
            mode,
            changed,
            charCount: finalCount, wordCount: finalCount, ...(delivery === undefined ? {} : { delivery }),
            target,
            revisionId: '',
            reviewInvalidated: changed && review !== null,
            ...(replacedStartChapter === undefined ? {} : { replacedStartChapter }),
            changedRegion: changedRegion(base, body),
          }
        }
        const revised = await reviseChapterDocument(root, {
          chapter: args.chapter,
          content: body,
          language: work.language,
          spec,
          target,
          countingMode: spec.countingMode,
          deletes: changed && review !== null ? [chapterReviewPath(args.chapter)] : [],
          extraWrites: startWrites,
        })
        return {
          chapter: args.chapter,
          path: revised.path,
          mode,
          changed: revised.changed,
          charCount: revised.charCount,
          wordCount: revised.charCount,
          ...(delivery === undefined ? {} : { delivery }),
          target: revised.lengthTelemetry.target,
          revisionId: revised.revisionId,
          reviewInvalidated: changed && review !== null,
          ...(replacedStartChapter === undefined ? {} : { replacedStartChapter }),
          changedRegion: revised.changedRegion,
        }
      })
    },
  } as ToolDefinition<ReviseArgs, ReviseResult>)
}
