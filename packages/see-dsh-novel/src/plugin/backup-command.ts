/**
 * `/story-backup [create|list|restore <id>]`：整本备份、列表与恢复。
 *
 * 宿主命令，不经过模型；备份/恢复在 `withWorkAction` 锁内执行。
 */
import type { CommandInvocationLike, CommandResultLike, Disposer, PluginContext } from '../core/types.js'
import { createBackup, listBackups, restoreBackup } from '../core/backup.js'
import { withWorkAction } from '../core/work-mutation.js'

export const COMMAND_BACKUP = 'story-backup'

export function installBackupCommand(ctx: PluginContext): Disposer {
  return ctx.commands.register({
    name: COMMAND_BACKUP,
    description: 'Back up or restore the whole work. No argument or "create" creates a backup, "list" lists backups newest first, "restore <id>" restores one.',
    input: { hint: '[create|list|restore <id>]' },
    handler: async (invocation: CommandInvocationLike): Promise<CommandResultLike> => {
      try {
        const root = await ctx.workingDirectory.ensure(invocation.agent)
        if (!root) throw new Error('无法解析当前工作区目录')
        const tokens = (invocation.rawInput ?? '').trim().split(/\s+/u).filter(Boolean)
        const action = (tokens[0] ?? 'create').toLowerCase()
        if (action === 'create') {
          if (tokens.length > 1) return { kind: 'error', text: '用法：/story-backup [create|list|restore <id>]' }
          const result = await withWorkAction(root, async () => createBackup(root))
          return { kind: 'success', text: `已创建备份 ${result.backupId}（${result.path}）。` }
        }
        if (action === 'list') {
          if (tokens.length > 1) return { kind: 'error', text: '用法：/story-backup list' }
          const backups = await listBackups(root)
          if (backups.length === 0) return { kind: 'success', text: '还没有备份。' }
          return {
            kind: 'success',
            text: ['备份（最新在前）：', ...backups.map((backup) => `- ${backup.id}（${backup.createdAt}）`)].join('\n'),
          }
        }
        if (action === 'restore') {
          if (tokens.length !== 2) return { kind: 'error', text: '用法：/story-backup restore <id>' }
          const id = tokens[1] as string
          const result = await withWorkAction(root, async () => restoreBackup(root, id))
          const lines = [`已从 ${result.restoredFrom} 恢复。`]
          lines.push(result.preRestoreBackupId === null
            ? '恢复前工作区没有作品内容，未创建 pre-restore 备份。'
            : `恢复前已备份为 ${result.preRestoreBackupId}。`)
          if (result.isolatedTransactions > 0) {
            lines.push(`已隔离不可回放的事务目录 ${result.isolatedTransactions} 个（.dead-txn-*）。`)
          }
          return { kind: 'success', text: lines.join('\n') }
        }
        return { kind: 'error', text: `未知子命令「${tokens[0] ?? ''}」；用法：/story-backup [create|list|restore <id>]` }
      } catch (error) {
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
      }
    },
  })
}
