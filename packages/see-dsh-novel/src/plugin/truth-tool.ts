/**
 * `story_truth_file`：替换一份白名单内的真值文件。
 *
 * 与源实现的差别只在名字与注册形态：白名单、规范化、book rules 的版本注入、
 * 写前补齐方向文档、内容原样落盘都照源行为。
 */
import type { Disposer, ExecuteContext, JsonSchema, PluginContext, ToolDefinition } from '../core/types.js'
import { commitFoundation } from '../core/commit.js'
import { controlDocumentWrites } from '../core/control-docs.js'
import { normalizeTruthFileName, truthFileRelativePath } from '../core/truth-files.js'
import { bookRulesDataSchema, withVersion } from '../pipelines/long/book-rules.js'
import type { BookRulesInput } from '../pipelines/long/book-rules.js'
import { projectionLanguage } from '../pipelines/long/language.js'

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
      render: (_args: unknown, value: TruthFileResult) => [{
        type: 'text' as const,
        text: `Updated "${value.fileName}"\n${value.written.join('\n')}`,
      }],
    },
    async execute(args: TruthFileArgs, exec: ExecuteContext): Promise<TruthFileResult> {
      if (!exec?.agent) throw new Error('story_truth_file 需要所属 agent 会话')
      const root = await ctx.workingDirectory.ensure(exec.agent)
      const fileName = normalizeTruthFileName(args.fileName)
      const content = String(args.content ?? '')
      const writes: Array<{ relativePath: string, content: string }> = []

      if (fileName === 'book_rules.md') {
        if (args.bookRulesData === undefined) {
          throw new Error('写 book_rules.md 必须同时提供 bookRulesData')
        }
        const rules = withVersion(args.bookRulesData)
        writes.push(
          { relativePath: truthFileRelativePath(fileName), content },
          { relativePath: truthFileRelativePath('book_rules.json'), content: `${JSON.stringify(rules, null, 2)}\n` },
        )
      } else {
        writes.push({ relativePath: truthFileRelativePath(fileName), content })
      }

      const language = await projectionLanguage(root)
      // 目标文件自身不再由补齐逻辑写一次，否则同一次提交里会出现两条同路径写入。
      const controlWrites = (await controlDocumentWrites(root, language))
        .filter((write) => !writes.some((own) => own.relativePath === write.relativePath))

      await commitFoundation(root, { writes: [...writes, ...controlWrites] })
      return { fileName, written: writes.map((write) => write.relativePath) }
    },
  } as ToolDefinition<TruthFileArgs, TruthFileResult>)
}
