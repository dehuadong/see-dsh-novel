/**
 * `story-delete`：删除章节索引里的最新章，并回滚到上一章状态。
 *
 * 命令层只负责取最新章号与调用核心删除；中章校验、快照前置与回滚由核心保持。
 */
import { readChapterIndex } from '../core/chapter-index.js'
import { deleteLatestChapter } from '../core/delete-chapter.js'
import { withWorkAction } from '../core/work-mutation.js'
import type { CommandInvocationLike, CommandResultLike, Disposer, PluginContext } from '../core/types.js'

export const COMMAND_DELETE = 'story-delete'

/**
 * 删除最新章。
 * @param root 工作区根
 */
export async function deleteLatest(root: string): Promise<{ chapter: number, title: string, rolledBackTo: number }> {
  return withWorkAction(root, async () => {
    const entries = await readChapterIndex(root)
    const latest = entries.reduce((max, entry) => Math.max(max, entry.number), 0)
    if (latest < 1) throw new Error('还没有可删除的章节')
    const result = await deleteLatestChapter(root, latest)
    return { chapter: result.deletedChapter, title: result.title, rolledBackTo: result.rolledBackTo }
  })
}

/**
 * 注册 `/story-delete`。
 * @param ctx 插件上下文：命令注册面与工作目录服务
 * @returns 注销函数
 */
export function installDeleteCommand(ctx: PluginContext): Disposer {
  return ctx.commands.register({
    name: COMMAND_DELETE,
    description: 'Delete the latest chapter and roll the story state back to the previous chapter. No arguments.',
    handler: async (invocation: CommandInvocationLike): Promise<CommandResultLike> => {
      try {
        const root = await ctx.workingDirectory.ensure(invocation.agent)
        if (!root) throw new Error('无法解析当前工作区目录')
        const result = await deleteLatest(root)
        return {
          kind: 'success',
          text: `已删除第 ${result.chapter} 章（${result.title}）：原文在 source/chapters/.trash/，状态回滚到第 ${result.rolledBackTo} 章。`,
        }
      } catch (error) {
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
      }
    },
  })
}
