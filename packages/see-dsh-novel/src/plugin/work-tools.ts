/**
 * 作品身份的两个工具：立项与查看。
 *
 * 作品身份是运行时级能力（`profile` 将来用来选择长篇／短篇／剧本管线），
 * 所以放在 `plugin/` 而不是 `pipelines/long/` 下面。
 */
import type { Disposer, ExecuteContext, JsonSchema, PluginContext, ToolDefinition } from '../core/types.js'
import { WORK_LANGUAGES, WORK_PROFILES, WORK_STATUSES } from '../core/work.js'
import type { Work } from '../core/work.js'
import { readWork, writeWork } from '../core/work.js'

/** 立项工具名。 */
export const WORK_CREATE_NAME = 'story_work_create'
/** 查看工具名。 */
export const WORK_SHOW_NAME = 'story_work_show'

const WORK_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    version: { type: 'integer' },
    id: { type: 'string' },
    title: { type: 'string' },
    profile: { type: 'string', enum: [...WORK_PROFILES] },
    language: { type: 'string', enum: [...WORK_LANGUAGES] },
    status: { type: 'string', enum: [...WORK_STATUSES] },
    metadata: {
      type: 'object',
      additionalProperties: false,
      properties: {
        targetChapters: { type: 'integer' },
        chapterWordCount: { type: 'integer' },
      },
      required: [],
    },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
  },
  required: ['version', 'id', 'title', 'profile', 'language', 'status', 'metadata', 'createdAt', 'updatedAt'],
}

/** 立项参数：标题必填，语言默认中文，规模放在 `metadata` 里。 */
export const workCreateParameters: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string', description: '作品标题，作者在对话里确认过的那个' },
    language: { type: 'string', enum: [...WORK_LANGUAGES], description: '正文语言，默认 zh' },
    metadata: {
      type: 'object',
      additionalProperties: false,
      properties: {
        targetChapters: { type: 'integer', description: '目标章数；可选' },
        chapterWordCount: { type: 'integer', description: '单章目标字数；可选' },
      },
      required: [],
    },
  },
  required: ['title'],
}

/** 无参查看。 */
export const workShowParameters: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {},
  required: [],
}

/** 立项的返回值。 */
export const workCreateOutput: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: { work: WORK_SCHEMA },
  required: ['work'],
}

/** 查看的返回值；没有身份文件时 `work` 是 null。 */
export const workShowOutput: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: { work: { oneOf: [WORK_SCHEMA, { type: 'null' }] } },
  required: ['work'],
}

interface CreateArgs {
  title: string
  language?: string
  metadata?: { targetChapters?: number, chapterWordCount?: number }
}

/** 身份一句话描述；工具卡片与命令回执共用。 */
export function describeWork(work: Work): string {
  const scope = [
    work.metadata.targetChapters === undefined ? '' : `目标 ${work.metadata.targetChapters} 章`,
    work.metadata.chapterWordCount === undefined ? '' : `单章 ${work.metadata.chapterWordCount} 字`,
  ].filter((part) => part !== '').join('，')
  // 标题本身可能带书名号（命令输入保留原样），别包第二层。
  const title = work.title.startsWith('《') && work.title.endsWith('》') ? work.title : `《${work.title}》`
  return `${title}：${work.profile}，${work.language}，${work.status}${scope === '' ? '' : `（${scope}）`}`
}

/**
 * 注册两个作品工具。
 * @param ctx 插件上下文：工具注册面与工作目录服务
 * @returns 注销函数
 */
export function installWorkTools(ctx: PluginContext): Disposer {
  async function workRoot(exec: ExecuteContext): Promise<string> {
    if (!exec?.agent) throw new Error('作品工具需要所属 agent 会话；无归属时拒绝读写')
    const dir = await ctx.workingDirectory.ensure(exec.agent)
    if (!dir) throw new Error('无法解析当前工作区目录')
    return dir
  }

  const disposeCreate = ctx.tools.register({
    name: WORK_CREATE_NAME,
    description:
      'Create this workspace\'s work identity (work.json) after the author confirmed the title, language and target size. '
      + 'Refuses to overwrite an existing work.json.',
    parameters: workCreateParameters,
    output: {
      schema: workCreateOutput,
      render: (_args: unknown, value: { work: Work }) => [{ type: 'text' as const, text: `已立项${describeWork(value.work)}` }],
    },
    async execute(args: CreateArgs, exec: ExecuteContext): Promise<{ work: Work }> {
      return {
        work: await writeWork(await workRoot(exec), {
          title: args.title,
          language: args.language,
          targetChapters: args.metadata?.targetChapters,
          chapterWordCount: args.metadata?.chapterWordCount,
        }),
      }
    },
  } as ToolDefinition<CreateArgs, { work: Work }>)

  const disposeShow = ctx.tools.register({
    name: WORK_SHOW_NAME,
    description: 'Read the work identity recorded in this workspace\'s work.json. Read-only; returns null before 立项.',
    parameters: workShowParameters,
    output: {
      schema: workShowOutput,
      render: (_args: unknown, value: { work: Work | null }) => [{
        type: 'text' as const,
        text: value.work === null ? '这个工作区还没有立项（没有 work.json）' : describeWork(value.work),
      }],
    },
    execute: async (_args: Record<string, never>, exec: ExecuteContext): Promise<{ work: Work | null }> => ({
      work: await readWork(await workRoot(exec)),
    }),
  } as ToolDefinition<Record<string, never>, { work: Work | null }>)

  return (): void => {
    disposeShow()
    disposeCreate()
  }
}
