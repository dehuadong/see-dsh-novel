/**
 * `story_truth_file`：替换一份白名单内的真值文件。
 *
 * 白名单、规范化、book rules 的版本注入、写前补齐方向文档、内容原样落盘都按
 * 真值文件的既有契约执行。
 */
import type { Disposer, ExecuteContext, JsonSchema, PluginContext, ToolDefinition } from '../../core/types.js'
import { commitFoundation } from '../../core/commit.js'
import { controlDocumentWrites } from '../../core/control-docs.js'
import { normalizeTruthFileName, truthFileRelativePath } from '../../core/truth-files.js'
import { bookRulesDataSchema, bookRulesWrites, withVersion } from './book-rules.js'
import type { BookRulesInput } from './book-rules.js'
import { projectionLanguage } from './language.js'

/** 工具名。 */
export const TRUTH_FILE_NAME = 'story_truth_file'

/** 参数：文件名、内容与 book rules 的结构化数据。 */
export const truthFileParameters: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    fileName: {
      type: 'string',
      description: 'truth file under source/story/, e.g. author_intent.md, outline/story_frame.md, roles/主要角色/甲.md',
    },
    content: { type: 'string', description: 'Full replacement content, written verbatim' },
    bookRulesData: {
      ...bookRulesDataSchema(),
      description: 'Required only when fileName is book_rules.md',
    },
  },
  required: ['fileName', 'content'],
}

/** 返回值：写入了哪些路径。 */
export interface TruthFileResult {
  fileName: string
  written: string[]
}

export const truthFileOutput: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    fileName: { type: 'string' },
    written: { type: 'array', items: { type: 'string' } },
  },
  required: ['fileName', 'written'],
}

interface TruthFileArgs {
  fileName: string
  content: string
  bookRulesData?: BookRulesInput
}

/**
 * 注册真值文件写入工具。
 * @param ctx 插件上下文
 * @returns 注销函数
 */
export function installTruthFileTool(ctx: PluginContext): Disposer {
  return ctx.tools.register({
    name: TRUTH_FILE_NAME,
    description:
      'Replace one allowlisted truth file under source/story/ (direction docs, book rules, outline, role cards, state truth). '
      + 'book_rules.md also needs bookRulesData and rewrites book_rules.json with version "2".',
    parameters: truthFileParameters,
    output: {
      schema: truthFileOutput,
      render: (_args: unknown, value: TruthFileResult) => [{ type: 'text' as const, text: `Updated "${value.fileName}"` }],
    },
    async execute(args: TruthFileArgs, exec: ExecuteContext): Promise<TruthFileResult> {
      if (!exec?.agent) throw new Error('story_truth_file 需要所属 agent 会话')
      if (typeof args.content !== 'string') throw new Error('content 必须是字符串')
      const root = await ctx.workingDirectory.ensure(exec.agent)
      const fileName = normalizeTruthFileName(args.fileName)
      const language = await projectionLanguage(root)
      // 与源实现一样，先补齐方向文档；book rules 校验失败时这一步也不能跳过。
      const controlWrites = await controlDocumentWrites(root, language)
      let targetWrites: Array<{ relativePath: string, content: string }>
      if (fileName === 'book_rules.md') {
        try {
          targetWrites = bookRulesWrites(args.content, withVersion(requireBookRulesData(args.bookRulesData)))
        } catch (error) {
          if (controlWrites.length > 0) await commitFoundation(root, { writes: controlWrites })
          throw error
        }
      } else {
        targetWrites = [{ relativePath: truthFileRelativePath(fileName), content: args.content }]
      }
      const freshControlWrites = controlWrites.filter(
        (write) => !targetWrites.some((own) => own.relativePath === write.relativePath),
      )
      await commitFoundation(root, { writes: [...targetWrites, ...freshControlWrites] })
      // written 只列本次请求的真值文件；同批补齐的方向文档不算在内。
      return { fileName, written: targetWrites.map((write) => write.relativePath) }
    },
  } as ToolDefinition<TruthFileArgs, TruthFileResult>)
}

function requireBookRulesData(value: BookRulesInput | undefined): BookRulesInput {
  if (value === undefined) throw new Error('写 book_rules.md 必须同时提供 bookRulesData')
  return value
}
