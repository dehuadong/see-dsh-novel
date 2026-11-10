/**
 * `story_revise_chapter`：把 reviser 子代理返回的修订正文落成新的章节版本。
 *
 * 工具只做落盘与范围校验；修订要求（instruction）由主编交给 reviser 子代理，
 * 不在这里重复解释。
 */
import type { Disposer, ExecuteContext, JsonSchema, PluginContext, ToolDefinition } from '../../core/types.js'
import { chapterBodyForChapter, loadChapterDocument, reviseChapterDocument } from '../../core/chapter-document.js'
import { chapterReviewPath, loadChapterReview } from '../../core/chapter-review.js'
import { loadChapterPlan } from '../../core/chapter-plan.js'
import { defaultChapterLength } from '../../core/length.js'
import { DEFAULT_REVISE_MODE, REVISE_MODES, assertSpotFix } from '../../core/revise.js'
import type { ReviseMode } from '../../core/revise.js'
import { withWorkAction } from '../../core/work-mutation.js'
import { readWorkflowStart, WORKFLOW_START_PATH } from '../../core/workflow-start.js'
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
      description: '修订模式；默认 rewrite。spot-fix 只允许一段连续改动，要求周围正文不变',
    },
    content: { type: 'string', description: '修订后的正文（不含标题行）' },
    targetText: { type: 'string', description: '局部修订的原文片段；spot-fix 时用于定位与范围校验' },
  },
  required: ['chapter', 'content'],
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
  },
  required: ['chapter', 'path', 'mode', 'changed', 'charCount', 'target', 'revisionId', 'reviewInvalidated'],
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
}

function normalizeMode(value: unknown): ReviseMode {
  if (value === undefined) return DEFAULT_REVISE_MODE
  if (typeof value === 'string' && (REVISE_MODES as ReadonlyArray<string>).includes(value)) return value as ReviseMode
  throw new Error(`未知的修订模式：${String(value)}`)
}

export function installReviseTool(ctx: PluginContext): Disposer {
  return ctx.tools.register({
    name: REVISE_NAME,
    description: 'Revise one persisted chapter from the reviser subagent output. Rewrites the same chapter file, archives the previous prose under source/chapters/.versions, appends an artifact revision, and invalidates the chapter review so it must be reviewed again. spot-fix accepts only one contiguous change and keeps surrounding prose unchanged.',
    parameters,
    output: {
      schema: output,
      render: (_args: unknown, value: ReviseResult) => [{
        type: 'text' as const,
        text: value.changed
          ? `第 ${value.chapter} 章已修订（${value.mode}）：${value.path}（${value.charCount} / 目标 ${value.target}；旧审稿已作废，本章已重新打开，等待重新审稿）`
          : `第 ${value.chapter} 章没有改动（${value.mode}）`,
      }],
    },
    async execute(
      args: { chapter: number, content: string, mode?: string, targetText?: string },
      exec: ExecuteContext,
    ): Promise<ReviseResult> {
      if (!exec?.agent) throw new Error('story_revise_chapter 需要所属 agent 会话')
      const root = await ctx.workingDirectory.ensure(exec.agent)
      return withWorkAction(root, async () => {
        const mode = normalizeMode(args.mode)
        const work = await readWork(root)
        if (work === null) throw new Error('工作区没有 work.json')
        const document = await loadChapterDocument(root, args.chapter)
        if (document === null) throw new Error(`第 ${args.chapter} 章还没有正文，先写再修订`)
        if (await loadChapterPlan(root, args.chapter) === null) {
          throw new Error(`第 ${args.chapter} 章还没有章纲，先规划再修订`)
        }
        const body = chapterBodyForChapter(args.content, args.chapter)
        if (body === '') throw new Error('content 不能为空')
        if (mode === 'spot-fix') assertSpotFix(document.content, body, args.targetText)

        const target = work.metadata.chapterWordCount ?? defaultChapterLength(work.language)
        if (body === document.content) {
          return {
            chapter: args.chapter,
            path: document.path,
            mode,
            changed: false,
            charCount: document.content.length,
            target,
            revisionId: '',
            reviewInvalidated: false,
          }
        }

        const review = await loadChapterReview(root, args.chapter)
        // 复审要过 workflow start 闸门：已有 start 就沿用，没有就随本次修订重开一章。
        const start = await readWorkflowStart(root)
        const startWrite = start === null
          ? [{
              relativePath: WORKFLOW_START_PATH,
              content: `${JSON.stringify({
                version: 1,
                action: 'write_next',
                chapter: args.chapter,
                instruction: `修订后重审第 ${args.chapter} 章`,
                createdAt: new Date().toISOString(),
              }, null, 2)}\n`,
            }]
          : []
        const revised = await reviseChapterDocument(root, {
          chapter: args.chapter,
          content: body,
          language: work.language,
          deletes: review === null ? [] : [chapterReviewPath(args.chapter)],
          extraWrites: startWrite,
        })
        return {
          chapter: args.chapter,
          path: revised.path,
          mode,
          changed: true,
          charCount: revised.charCount,
          target,
          revisionId: revised.revisionId,
          reviewInvalidated: review !== null,
        }
      })
    },
  } as ToolDefinition<{ chapter: number, content: string, mode?: string, targetText?: string }, ReviseResult>)
}
