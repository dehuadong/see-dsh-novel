/**
 * `story-write`：作者确认开始一章的 workflow start。
 *
 * 命令层负责 stage/review/chapter 校验并把写入交给 `writeWorkflowStart`；不能在
 * core 里做这些检查，否则 `workflow-start.ts` 会 import stages 形成环。
 */
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { chapterReviewPath } from '../core/chapter-review.js'
import { detectStage } from '../pipelines/long/stages/index.js'
import { writeWorkflowStart, workflowStarted } from '../core/workflow-start.js'
import { withWorkAction } from '../core/work-mutation.js'
import type { CommandInvocationLike, CommandResultLike, Disposer, PluginContext, UserMessageLike } from '../core/types.js'

export const COMMAND_WRITE = 'story-write'

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/**
 * 在作品锁内确认下一章：foundation-ready、无 review、无 start 才写。
 * @param root 工作区根
 * @param instruction 可选的作者说明；缺省用 `开始第 N 章`
 */
export async function startChapter(root: string, instruction?: string): Promise<{ chapter: number }> {
  return withWorkAction(root, async () => {
    const stage = detectStage(root)
    if (stage.stage !== 'foundation-ready') {
      throw new Error(`当前阶段是 ${stage.stage}，只有 foundation-ready 可以开始下一章`)
    }
    let current = 0
    try {
      current = (JSON.parse(await readFile(join(root, 'source/story/state/current_state.json'), 'utf8')) as { chapter?: number }).chapter ?? 0
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const chapter = current + 1
    if (await exists(join(root, chapterReviewPath(chapter)))) throw new Error(`第 ${chapter} 章已经有审稿记录，不再开始`)
    if (await workflowStarted(root, chapter)) throw new Error(`第 ${chapter} 章已经开始了`)
    await writeWorkflowStart(root, { chapter, instruction: instruction ?? `开始第 ${chapter} 章` })
    return { chapter }
  })
}

/**
 * 注册 `/story-write`。
 * @param ctx 插件上下文：命令注册面与工作目录服务
 * @returns 注销函数
 */
export function installWriteCommand(ctx: PluginContext): Disposer {
  return ctx.commands.register({
    name: COMMAND_WRITE,
    description: 'Author-confirm the next chapter workflow start after foundation is ready. No arguments.',
    handler: async (invocation: CommandInvocationLike): Promise<CommandResultLike> => {
      try {
        const root = await ctx.workingDirectory.ensure(invocation.agent)
        if (!root) throw new Error('无法解析当前工作区目录')
        const { chapter } = await startChapter(root)
        const message: UserMessageLike = {
          role: 'user',
          content: [{ type: 'text', text: `作者已确认开始第 ${chapter} 章；按 story_next 进入 plan，不跳过审阅。` }],
          source: { kind: 'story-command', command: COMMAND_WRITE },
        }
        try {
          if (invocation.agent.followup === undefined) throw new Error('当前会话不支持 followup')
          invocation.agent.followup(message)
        } catch (error) {
          return {
            kind: 'error',
            text: `已确认第 ${chapter} 章并写入 workflow start，但没能启动下一轮：${error instanceof Error ? error.message : String(error)}。请按 story_next 继续。`,
          }
        }
        return {
          kind: 'success',
          text: `已确认开始第 ${chapter} 章：workflow start 已写入。下一轮按 story_next 进入 plan，不跳过审阅。`,
        }
      } catch (error) {
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
      }
    },
  })
}
