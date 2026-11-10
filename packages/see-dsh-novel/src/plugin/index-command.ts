/**
 * `/story-index`：重建面板只读投影。
 *
 * 这是读视图，不是作品写操作；索引写入走 commit，失败保留旧索引。
 */
import type { CommandInvocationLike, CommandResultLike, Disposer, PluginContext } from '../core/types.js'
import { buildPanelIndex, writePanelIndex } from '../core/panel-index.js'
import { withWorkAction } from '../core/work-mutation.js'

export const COMMAND_INDEX = 'story-index'

export function installIndexCommand(ctx: PluginContext): Disposer {
  return ctx.commands.register({
    name: COMMAND_INDEX,
    description: 'Rebuild the read-only panel index from the current work files.',
    handler: async (invocation: CommandInvocationLike): Promise<CommandResultLike> => {
      try {
        const root = await ctx.workingDirectory.ensure(invocation.agent)
        if (!root) throw new Error('无法解析当前工作区目录')
        const index = await withWorkAction(root, async () => {
          const built = await buildPanelIndex(root)
          await writePanelIndex(root, built)
          return built
        }, { project: false })
        return { kind: 'success', text: `面板索引已重建：${index.artifacts.length} 个产物，${index.stages.length} 个阶段。` }
      } catch (error) {
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
      }
    },
  })
}
