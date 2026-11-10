/**
 * 章节版本与重开工具：列版本、恢复版本或把最后一章重开。
 */
import type { Disposer, ExecuteContext, JsonSchema, PluginContext, ToolDefinition } from '../../core/types.js'
import { listChapterVersions } from '../../core/chapter-versions.js'
import type { ChapterVersion } from '../../core/chapter-versions.js'
import { reopenChapter } from '../../core/reopen.js'
import { withWorkAction } from '../../core/work-mutation.js'

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
    chapter: { type: 'integer', description: '要重开的章号；必须是当前最后已结算的一章' },
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
    stage: { type: 'string', enum: ['plan'] },
  },
  required: ['chapter', 'removed', 'stage'],
}

interface ReopenOutput {
  chapter: number
  versionId?: string
  archived?: string
  removed: string[]
  stage: 'plan'
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
    description: 'Reopen the last settled chapter: delete its review and plan, keep its prose (or restore one archived version), reopen the chapter workflow, and roll the settled state pointer back one chapter. Earlier chapters need baselines that do not exist yet.',
    parameters: reopenParameters,
    output: {
      schema: reopenOutput,
      render: (_args: unknown, value: ReopenOutput) => [{
        type: 'text' as const,
        text: `第 ${value.chapter} 章已重开${value.versionId === null ? '' : `（恢复版本 ${value.versionId}）`}：删除了审稿与章纲，回到章前规划`,
      }],
    },
    async execute(args: { chapter: number, versionId?: string }, exec: ExecuteContext): Promise<ReopenOutput> {
      if (!exec?.agent) throw new Error('story_reopen_chapter 需要所属 agent 会话')
      const root = await ctx.workingDirectory.ensure(exec.agent)
      const result = await withWorkAction(root, async () => reopenChapter(root, args.chapter, args.versionId === undefined ? {} : { versionId: args.versionId }))
      return {
        chapter: result.chapter,
        removed: result.removed,
        stage: result.stage,
        ...(result.versionId === null ? {} : { versionId: result.versionId }),
        ...(result.archived === null ? {} : { archived: result.archived }),
      }
    },
  } as ToolDefinition<{ chapter: number, versionId?: string }, ReopenOutput>)

  return (): void => {
    disposeReopen()
    disposeVersions()
  }
}
