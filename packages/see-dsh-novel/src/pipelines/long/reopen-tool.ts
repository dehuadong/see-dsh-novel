/**
 * 章节版本与重开工具：列版本、恢复版本或把最后一章重开。
 */
import type { Disposer, ExecuteContext, JsonSchema, PluginContext, ToolDefinition } from '../../core/types.js'
import { listChapterVersions } from '../../core/chapter-versions.js'
import type { ChapterVersion } from '../../core/chapter-versions.js'
import { reopenChapter, restoreChapter } from '../../core/reopen.js'
import { withWorkAction } from '../../core/work-mutation.js'
import { detectStage } from './stages/index.js'

export const VERSIONS_NAME = 'story_chapter_versions'
export const REOPEN_NAME = 'story_reopen_chapter'

const versionsOutput: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    chapter: { type: 'integer' },
    versions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          source: { type: 'string' },
          createdAt: { type: 'string' },
          characterCount: { type: 'integer' },
        },
        required: ['id', 'source', 'createdAt', 'characterCount'],
      },
    },
  },
  required: ['chapter', 'versions'],
}

const reopenParameters: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    chapter: { type: 'integer', description: '章号；重开限当前最后已结算的一章，带 versionId 的恢复对任意章可用' },
    versionId: { type: 'string', description: '要恢复的版本 id；省略时只重开、不改正文' },
  },
  required: ['chapter'],
}

const reopenOutput: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    chapter: { type: 'integer' },
    versionId: { type: 'string' },
    archived: { type: 'string' },
    removed: { type: 'array', items: { type: 'string' } },
    stage: { type: 'string', description: '提交后的当前阶段' },
  },
  required: ['chapter', 'removed', 'stage'],
}

interface ReopenOutput {
  chapter: number
  versionId?: string
  archived?: string
  removed: string[]
  stage: string
}

interface VersionsOutput {
  chapter: number
  versions: Array<Pick<ChapterVersion, 'id' | 'source' | 'createdAt' | 'characterCount'>>
}

export function installReopenTools(ctx: PluginContext): Disposer {
  const disposeVersions = ctx.tools.register({
    name: VERSIONS_NAME,
    description: 'List the archived versions of one chapter (source/chapters/.versions/NNNN), newest first. Use the returned id with story_reopen_chapter to restore a version.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { chapter: { type: 'integer', description: '章号' } },
      required: ['chapter'],
    },
    output: {
      schema: versionsOutput,
      render: (_args: unknown, value: VersionsOutput) => [{
        type: 'text' as const,
        text: value.versions.length === 0
          ? `第 ${value.chapter} 章没有归档版本`
          : `第 ${value.chapter} 章有 ${value.versions.length} 个版本：${value.versions.map((version) => `${version.id.slice(0, 13)}（${version.source}）`).join('、')}`,
      }],
    },
    async execute(args: { chapter: number }, exec: ExecuteContext): Promise<VersionsOutput> {
      if (!exec?.agent) throw new Error('story_chapter_versions 需要所属 agent 会话')
      const root = await ctx.workingDirectory.ensure(exec.agent)
      const versions = await listChapterVersions(root, args.chapter)
      return { chapter: args.chapter, versions }
    },
  } as ToolDefinition<{ chapter: number }, VersionsOutput>)

  const disposeReopen = ctx.tools.register({
    name: REOPEN_NAME,
    description: 'Restore one archived version of any chapter (replace prose, archive the current prose, clear that chapter\'s runtime files, keep runtime state), or reopen the last settled chapter (keep prose, clear runtime files, reopen the chapter workflow, roll the settled pointer back). Restore returns the resulting stage; reopen returns to planning.',
    parameters: reopenParameters,
    output: {
      schema: reopenOutput,
      render: (_args: unknown, value: ReopenOutput) => [{
        type: 'text' as const,
        text: value.versionId === undefined
          ? `第 ${value.chapter} 章已重开：清除了本章运行时文件，回到章前规划`
          : `第 ${value.chapter} 章已恢复版本 ${value.versionId}：正文已替换、运行时文件已清除，状态未回退（当前阶段 ${value.stage}）`,
      }],
    },
    async execute(args: { chapter: number, versionId?: string }, exec: ExecuteContext): Promise<ReopenOutput> {
      if (!exec?.agent) throw new Error('story_reopen_chapter 需要所属 agent 会话')
      const root = await ctx.workingDirectory.ensure(exec.agent)
      return withWorkAction(root, async () => {
        if (args.versionId !== undefined) {
          const restored = await restoreChapter(root, args.chapter, args.versionId)
          return { ...restored, stage: detectStage(root).stage }
        }
        const reopened = await reopenChapter(root, args.chapter)
        return { chapter: reopened.chapter, removed: reopened.removed, stage: detectStage(root).stage }
      })
    },
  } as ToolDefinition<{ chapter: number, versionId?: string }, ReopenOutput>)

  return (): void => {
    disposeReopen()
    disposeVersions()
  }
}
