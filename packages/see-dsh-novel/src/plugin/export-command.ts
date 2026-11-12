/**
 * `/story-export [txt|md|epub]`：把整本作品导出到工作区根。
 *
 * 宿主命令，不经过模型；面板页头的导出控件也走同一条命令。
 */
import type { CommandInvocationLike, CommandResultLike, Disposer, PluginContext } from '../core/types.js'
import { EXPORT_FORMATS, writeWorkExport } from '../core/export.js'
import type { ExportFormat } from '../core/export.js'
import { withWorkAction } from '../core/work-mutation.js'

export const COMMAND_EXPORT = 'story-export'

export function installExportCommand(ctx: PluginContext): Disposer {
  return ctx.commands.register({
    name: COMMAND_EXPORT,
    description: 'Export the whole work as txt, md or epub into the workspace root. No arguments means txt.',
    input: { hint: '[txt|md|epub]' },
    handler: async (invocation: CommandInvocationLike): Promise<CommandResultLike> => {
      try {
        const raw = (invocation.rawInput ?? '').trim().toLowerCase()
        const format = (raw === '' ? 'txt' : raw) as ExportFormat
        if (!EXPORT_FORMATS.includes(format)) {
          return { kind: 'error', text: `导出格式必须是 ${EXPORT_FORMATS.join('／')}；收到「${raw}」。` }
        }
        const root = await ctx.workingDirectory.ensure(invocation.agent)
        if (!root) throw new Error('无法解析当前工作区目录')
        const result = await withWorkAction(root, async () => writeWorkExport(root, format))
        return {
          kind: 'success',
          text: `已导出 ${result.chaptersExported} 章（${result.totalWords} 字）到 ${result.outputPath}（${result.byteLength} 字节，${result.format}）。`,
        }
      } catch (error) {
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
      }
    },
  })
}
