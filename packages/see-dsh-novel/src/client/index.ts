/**
 * 浏览器半边：向 `conversation.view` 注册「作品」视图。
 *
 * 只在预设匹配的会话里注册：头部的哨兵上报「当前会话用的是不是 see-dsh-novel」，
 * 槽位声明由 `slots.inject` 上报；两者都成立才注册视图，失败即注销。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'

import { EligibilitySentinel } from './EligibilitySentinel.js'
import { outcomeOf } from './outcome.js'
import { PRESET_ID, SENTINEL_SLOT, VIEW_SLOT } from './preset.js'
import { StoryView } from './StoryView.js'
import { installStyles } from './styles.js'
import type { CommandOutcome, CommandReceipt, CommandRemote, FileRemote, PromptOutcome, SentinelInjected, SessionId, ViewInjected } from './types.js'

export const inject = ['slots', 'sessions', 'remote'] as const

/** 一页的行数上限；与宿主 `workspaceFiles` 的默认 `maxLines` 一致。 */
const READ_PAGE_LINES = 5000

/**
 * 分页读完一个文件：宿主按行分页，`offset` 从 1 开始，页尾的 `eof` 表示读完。
 * @param files workspaceFiles 读面
 * @param sessionId 会话
 * @param path 工作区相对路径
 * @returns 文件的完整文本
 */
async function readWholeFile(
  files: FileRemote['workspaceFiles'],
  sessionId: SessionId,
  path: string,
): Promise<string> {
  const signal = new AbortController().signal
  const chunks: string[] = []
  let offset = 1
  for (;;) {
    const page = await files.read(sessionId, path, { offset, limit: READ_PAGE_LINES }, signal)
    if (!page.ok) throw new Error(`读取 ${path} 失败：${page.error.message}`)
    if (page.value.text !== '') chunks.push(page.value.text)
    if (page.value.eof || page.value.lines === 0) break
    offset += page.value.lines
  }
  return chunks.join('\n')
}

/**
 * 认可之后投回会话的那条消息。
 *
 * 不带摘要：面板拿不到摘要，门禁自己核对；消息只负责把会话叫醒。
 * 带时效声明：`queue` 在当前轮结束后才会跑，这期间基础设定若有改动，
 * agent 必须按门禁结论走，而不是相信这句话。
 */
export const RESUME_TEXT = '作者刚在面板确认了 foundation（若那之后基础设定有改动，以回执与摘要为准）。'
  + '请调用 story_gate 复核这一版是否已确认：确认成立就调用 story_foundation_signoff 定稿并继续下一步；'
  + '不成立就把原因告诉作者。不要再次请作者确认。'

/**
 * 立项之后投回会话的开工指令。
 *
 * 先核对目录与阶段再动笔：面板按会话记录目录探针，工具按当前工作目录解析，
 * 两者可能不是同一部作品；重挂面板后按钮会回来，阶段检查是重复投递的缓解。
 * @param cwd 面板看到的工作区路径；拿不到时会明说拿不到，而不是跳过核对
 */
export function START_TEXT(cwd: string | undefined): string {
  const where = cwd === undefined
    ? '面板没有拿到这个会话的工作区路径。'
    : `面板看到的工作区是 ${cwd}。`
  const check = cwd === undefined
    ? '请先调用 story_work_show 读身份：读不到就停下并告诉作者。'
    : '请先调用 story_work_show 读身份，并核对你当前的工作目录是不是这个目录：读不到或不是同一个目录就停下并告诉作者。'
  return `作者在面板上点了「开始基础设定」。${where}${check}`
    + '再用 story_next 核对阶段：阶段不是 foundation 就停手并报告，不要重复写。'
    + '阶段是 foundation 时按顺序写：story_foundation_outline → story_foundation_details → '
    + 'story_foundation_cast_index → story_foundation_cast_documents。'
    + '写完停在作者确认闸门前，不要自行签核。'
}

/**
 * 注册面板：哨兵 + 条件注册的作品视图 + 样式。
 * @param ctx 客户端插件上下文
 */
export function apply(ctx: Context): void {
  ctx.effect(() => installStyles(), 'see-dsh-novel: panel styles')

  /** 投一条排队消息；没有绑定时是确定失败，`prompt` 的抛错照常向上抛。 */
  const promptQueue = async (sessionId: SessionId, text: string): Promise<PromptOutcome> => {
    const binding = ctx.sessions.binding(sessionId)
    if (binding === undefined) return 'failed'
    const result = await binding.session.prompt([{ type: 'text', text }], 'queue')
    return result.ok === true ? 'ok' : 'failed'
  }

  const viewInject = (): ViewInjected => ({
    canCommand: (sessionId: SessionId): boolean => ctx.sessions.binding(sessionId) !== undefined,
    runCommand: async (sessionId: SessionId, line: string): Promise<CommandOutcome> => {
      const binding = ctx.sessions.binding(sessionId)
      if (binding === undefined) return 'unbound'
      return outcomeOf(await binding.session.command(line))
    },
    executeCommand: async (sessionId: SessionId, line: string): Promise<CommandReceipt> => {
      if (ctx.sessions.binding(sessionId) === undefined) return { outcome: 'unbound', text: '' }
      // 宿主把命令执行面注册成 `remote.commands`；它比 admitted 结果多带处理器文本。
      const commands = ctx.get('remote.commands') as CommandRemote['commands'] | undefined
      if (commands === undefined) return { outcome: 'error', text: '命令通道不可用' }
      let result: Awaited<ReturnType<CommandRemote['commands']['execute']>>
      try {
        result = await commands.execute(sessionId, line, [])
      } catch (error) {
        return { outcome: 'error', text: error instanceof Error ? error.message : String(error) }
      }
      if (!result.ok) return { outcome: 'error', text: result.error.message }
      if (result.value === undefined) return { outcome: 'unmatched', text: '' }
      const handler = result.value.result
      if (handler === undefined) return { outcome: 'error', text: '命令回执无法识别' }
      return handler.kind === 'success'
        ? { outcome: 'ok', text: handler.text ?? '' }
        : { outcome: 'error', text: handler.text }
    },
    resume: (sessionId: SessionId): Promise<PromptOutcome> => promptQueue(sessionId, RESUME_TEXT),
    start: (sessionId: SessionId, cwd: string | undefined): Promise<PromptOutcome> => promptQueue(sessionId, START_TEXT(cwd)),
    advance: (sessionId: SessionId, text: string): Promise<PromptOutcome> => promptQueue(sessionId, text),
    readArtifact: async (sessionId: SessionId, path: string): Promise<string> => {
      // 宿主把生成的文件命名空间注册成 `remote.workspaceFiles`；按名读取，
      // 不 import 网关的生成类型（它不是本包的依赖）。缺失时给作者一句可见原因。
      const files = ctx.get('remote.workspaceFiles') as FileRemote['workspaceFiles'] | undefined
      if (files === undefined) throw new Error('workspaceFiles 通道不可用')
      return readWholeFile(files, sessionId, path)
    },
  })

  let eligible = false
  let declared = false
  let viewDisposer: (() => void) | undefined

  /** 当前挂载的会话用的是这个预设、且槽位已声明时才注册「作品」页。 */
  function syncView(): void {
    if (eligible && declared && viewDisposer === undefined) {
      viewDisposer = ctx.slots.register(
        { name: VIEW_SLOT, id: PRESET_ID, order: 20, label: '作品', inject: viewInject },
        StoryView,
      )
      return
    }
    if ((!eligible || !declared) && viewDisposer !== undefined) {
      viewDisposer()
      viewDisposer = undefined
    }
  }

  const syncEligible = (value: boolean): void => {
    eligible = value
    syncView()
  }

  ctx.effect(() => () => {
    viewDisposer?.()
    viewDisposer = undefined
  }, 'see-dsh-novel: conditional work view')

  ctx.slots.inject(VIEW_SLOT, () => {
    declared = true
    syncView()
    return () => {
      declared = false
      syncView()
    }
  })

  const sentinelInject = (): SentinelInjected => ({ syncEligible })
  ctx.slots.inject(SENTINEL_SLOT, () => ctx.slots.register(
    { name: SENTINEL_SLOT, id: `${PRESET_ID}-eligibility`, order: 100, inject: sentinelInject },
    EligibilitySentinel,
  ))
}
