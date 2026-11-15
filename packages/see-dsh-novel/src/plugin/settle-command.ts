/**
 * `story-settle`：作者显式确认首版结算；只写 `.drafts` 标记，不改作品。
 */
import { chapterReviewPath, loadChapterReview } from '../core/chapter-review.js'
import { isFirstVersionSettle, writeSettleApproval } from '../core/settle-approval.js'
import { detectStage } from '../pipelines/long/stages/index.js'
import { withWorkAction } from '../core/work-mutation.js'
import type { CommandInvocationLike, CommandResultLike, Disposer, PluginContext, UserMessageLike } from '../core/types.js'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export const COMMAND_SETTLE = 'story-settle'

export async function approveSettlement(root: string): Promise<{ chapter: number }> {
  return withWorkAction(root, async () => {
    const facts = detectStage(root)
    if (facts.stage !== 'chapter-done') throw new Error(`当前阶段是 ${facts.stage}，只有 chapter-done 可以结算`)
    if (!isFirstVersionSettle(facts)) {
      throw new Error('本章修订已复审或已发布未结算，不走 story_settle_chapter；按阶段协议用修订提交或重算入口')
    }
    const chapter = facts.reviewTarget > 0 ? facts.reviewTarget : facts.currentChapter + 1
    if (!existsSync(join(root, chapterReviewPath(chapter))) || await loadChapterReview(root, chapter) === null) {
      throw new Error(`第 ${chapter} 章还没有审稿记录，先审再结算`)
    }
    await writeSettleApproval(root, chapter)
    return { chapter }
  })
}

export function installSettleCommand(ctx: PluginContext): Disposer {
  return ctx.commands.register({
    name: COMMAND_SETTLE,
    description: 'Author-confirm settlement of the first reviewed chapter. Writes a .drafts confirmation marker; it does not settle or publish.',
    input: { hint: '无需参数' },
    handler: async (invocation: CommandInvocationLike): Promise<CommandResultLike> => {
      try {
        const root = await ctx.workingDirectory.ensure(invocation.agent)
        if (!root) throw new Error('无法解析当前工作区目录')
        const { chapter } = await approveSettlement(root)
        const message: UserMessageLike = {
          role: 'user',
          content: [{ type: 'text', text: `作者已确认结算第 ${chapter} 章；按阶段协议先生成提案，再派 state-check，最后带 validation 提交。` }],
          source: { kind: 'story-command', command: COMMAND_SETTLE },
        }
        try {
          if (invocation.agent.followup === undefined) throw new Error('当前会话不支持 followup')
          invocation.agent.followup(message)
        } catch (error) {
          return {
            kind: 'error',
            text: `已确认结算第 ${chapter} 章并写入标记，但没能启动下一轮：${error instanceof Error ? error.message : String(error)}。请按阶段协议继续。`,
          }
        }
        return { kind: 'success', text: `已确认结算第 ${chapter} 章。下一轮按阶段协议先提案，再派 state-check，最后带 validation 提交。` }
      } catch (error) {
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
      }
    },
  })
}
