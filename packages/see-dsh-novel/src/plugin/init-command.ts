/**
 * `/story-init`：立项的命令行入口。
 *
 * 命令的输入是一整行文本、没有 schema，所以解析单独做成纯函数：语法错误在这里
 * 点名参数，语言枚举、正整数、已存在与坏文件这些语义错误仍由 `writeWork` 报
 * （消息里带文件与字段），命令层不复制同一套规则。
 */
import type { CommandInvocationLike, CommandResultLike, Disposer, PluginContext } from '../core/types.js'
import { writeWork } from '../core/work.js'
import { describeWork } from './work-tools.js'

/** 命令名；注册与测试共用。 */
export const COMMAND_INIT = 'story-init'

/** 解析后的立项参数；与 `writeWork` 的入参同形，但这里已经是 string／number。 */
export interface InitInput {
  title: string
  language?: string
  targetChapters?: number
  chapterWordCount?: number
}

/** 认得的选项及其在 `InitInput` 上的落点。 */
const OPTIONS: Record<string, 'language' | 'targetChapters' | 'chapterWordCount'> = {
  '--lang': 'language',
  '--chapters': 'targetChapters',
  '--words': 'chapterWordCount',
}

/**
 * 把一行命令文本解析成立项参数。
 * @param rawInput 命令名之后的原始文本
 * @returns 校验过语法的参数
 */
export function parseInitInput(rawInput: string): InitInput {
  const tokens = rawInput.split(/\s+/).filter((token) => token !== '')
  const input: InitInput = { title: '' }
  const seen = new Set<string>()
  const titleWords: string[] = []
  let terminated = false

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] as string
    if (terminated) {
      titleWords.push(token)
      continue
    }
    if (token === '--') {
      terminated = true
      continue
    }
    if (!token.startsWith('--')) {
      titleWords.push(token)
      continue
    }
    const key = OPTIONS[token]
    if (key === undefined) throw new Error(`未知选项 ${token}`)
    if (seen.has(token)) throw new Error(`选项 ${token} 重复`)
    seen.add(token)
    const value = tokens[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`${token} 缺少取值`)
    index += 1
    if (key === 'language') {
      input.language = value
      continue
    }
    if (!/^-?\d+$/.test(value)) throw new Error(`${token} 必须是整数，实际是 ${value}`)
    input[key] = Number(value)
  }

  const title = titleWords.join(' ').trim()
  if (title === '') throw new Error('缺少标题：用法 /story-init <标题> [--lang zh|en] [--chapters N] [--words N]')
  input.title = title
  return input
}

/**
 * 注册立项命令。
 * @param ctx 插件上下文：命令注册面与工作目录服务
 * @returns 注销函数
 */
export function installInitCommand(ctx: PluginContext): Disposer {
  return ctx.commands.register({
    name: COMMAND_INIT,
    description: '在当前工作区立项：写下 work.json（标题、语言、目标章数与单章字数）。',
    async handler(invocation: CommandInvocationLike): Promise<CommandResultLike> {
      try {
        const root = await ctx.workingDirectory.ensure(invocation.agent)
        const work = await writeWork(root, parseInitInput(invocation.rawInput))
        return {
          kind: 'success',
          text: `已立项${describeWork(work)}\n`
            + '下一步：让主编按 story_next 的指示写基础设定，或在「作品」面板点「开始基础设定」。',
        }
      } catch (error) {
        return { kind: 'error', text: (error as Error).message }
      }
    },
  })
}
