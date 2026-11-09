/**
 * `story_write_chapter`：把 writer 子代理返回的正文落成章节文档。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { Disposer, ExecuteContext, JsonSchema, PluginContext, ToolDefinition } from '../../core/types.js'
import { loadChapterPlan } from '../../core/chapter-plan.js'
import { writeChapterDocument } from '../../core/chapter-document.js'
import { withWorkAction } from '../../core/work-mutation.js'
import { workflowStarted } from '../../core/workflow-start.js'
import { defaultChapterLength } from '../../core/length.js'
import { readWork } from '../../core/work.js'

export const WRITE_NAME = 'story_write_chapter'

const parameters: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    chapter: { type: 'integer', description: '章号；必须已有章纲' },
    title: { type: 'string', description: '本章标题' },
    content: { type: 'string', description: 'writer 返回的正文（不含标题行）' },
  },
  required: ['chapter', 'title', 'content'],
}

const output: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    chapter: { type: 'integer' },
    path: { type: 'string' },
    charCount: { type: 'integer' },
    target: { type: 'integer' },
  },
  required: ['chapter', 'path', 'charCount', 'target'],
}

export interface WriteResult {
  chapter: number
  path: string
  charCount: number
  target: number
}

export function installWriteTool(ctx: PluginContext): Disposer {
  return ctx.tools.register({
    name: WRITE_NAME,
    description: 'Persist the first draft of one chapter as source/chapters/NNNN_<Title>.md with its heading, if a chapter plan exists. Reports the length against the work target but does not reject on deviation.',
    parameters,
    output: {
      schema: output,
      render: (_args: unknown, value: WriteResult) => [{
        type: 'text' as const,
        text: `第 ${value.chapter} 章已落盘：${value.path}（${value.charCount} / 目标 ${value.target}）`,
      }],
    },
    async execute(args: { chapter: number, title: string, content: string }, exec: ExecuteContext): Promise<WriteResult> {
      if (!exec?.agent) throw new Error('story_write_chapter 需要所属 agent 会话')
      const root = await ctx.workingDirectory.ensure(exec.agent)
      return withWorkAction(root, async () => {
        if (!await workflowStarted(root, args.chapter)) throw new Error('这一章还没有作者确认的 workflow start；先由作者开始本章')
        if (/^\s*(第\s*\d+\s*章|chapter\s*\d+)/iu.test(args.title)) {
          throw new Error('标题不要带章号前缀；章节文档头由宿主生成')
        }
        const plan = await loadChapterPlan(root, args.chapter)
        if (plan === null) throw new Error(`第 ${args.chapter} 章还没有章纲，先规划再写`)
        const work = await readWork(root)
        if (work === null) throw new Error('工作区没有 work.json')
        const target = work.metadata.chapterWordCount ?? defaultChapterLength(work.language)
        const result = await writeChapterDocument(root, {
          chapter: args.chapter,
          title: args.title,
          content: args.content,
          language: work.language,
        })
        return { chapter: args.chapter, path: result.path, charCount: result.charCount, target }
      })
    },
  } as ToolDefinition<{ chapter: number, title: string, content: string }, WriteResult>)
}

/** 读取章节文档；供后续审阅／修订使用。 */
export async function readChapterFile(root: string, path: string): Promise<string> {
  return readFile(join(root, path), 'utf8')
}
