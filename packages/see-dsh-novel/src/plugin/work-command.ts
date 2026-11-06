/**
 * `/story-init`：立项的命令行入口。
 *
 * 命令的输入是一整行文本、没有 schema，所以解析单独做成纯函数：语法错误在这里
 * 点名参数，语言枚举、正整数、已存在与坏文件这些语义错误仍由 `writeWork` 报
 * （消息里带文件与字段），命令层不复制同一套规则。
 * 建书写入与提案批准共用 `initWork`：身份、`story/brief.md` 与方向文档一次提交。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { safeRelativePath } from '../core/commit.js'
import type { CommandInvocationLike, CommandResultLike, Disposer, PluginContext } from '../core/types.js'
import { initWork } from '../core/init-work.js'
import { describeWork } from '../core/work.js'

/** 命令名；注册与测试共用。 */
export const COMMAND_INIT = 'story-init'

/** 解析后的立项参数；与 `writeWork` 的入参同形，但这里已经是 string／number。 */
export interface WorkCreateArgs {
  title: string
  language?: string
  targetChapters?: number
  chapterWordCount?: number
  genre?: string
  platform?: string
  /** 创作简报文件，相对工作区根；缺省时用 `Create <title>`。 */
  brief?: string
}

/** 一个选项的写法：取值校验与落点都在这里，新增选项只改这张表。 */
interface OptionSpec {
  /** 把取值写进解析结果；不合法时抛错，消息点名选项。 */
  apply(input: WorkCreateArgs, value: string, flag: string): void
}

/** 整数字面量转数字；非法时点名选项。 */
function integerOf(flag: string, value: string): number {
  if (!/^-?\d+$/.test(value)) throw new Error(`${flag} 必须是整数，实际是 ${value}`)
  return Number(value)
}

const OPTIONS: Record<string, OptionSpec> = {
  '--lang': { apply: (input, value) => { input.language = value } },
  '--chapters': { apply: (input, value, flag) => { input.targetChapters = integerOf(flag, value) } },
  '--words': { apply: (input, value, flag) => { input.chapterWordCount = integerOf(flag, value) } },
  '--genre': { apply: (input, value) => { input.genre = value } },
  '--platform': { apply: (input, value) => { input.platform = value } },
  '--brief': { apply: (input, value) => { input.brief = value } },
}

interface Token {
  text: string
  start: number
  end: number
}

/** 按空白切词，同时记住每个词在原文里的位置——标题要按原样取回。 */
function tokenize(rawInput: string): Token[] {
  const tokens: Token[] = []
  for (const match of rawInput.matchAll(/\S+/g)) {
    tokens.push({ text: match[0], start: match.index ?? 0, end: (match.index ?? 0) + match[0].length })
  }
  return tokens
}

/** 标题词在原文里连续时按原样取回，保留词与词之间的空白；不连续时退回单空格连接。 */
function titleOf(rawInput: string, indices: ReadonlyArray<number>, tokens: ReadonlyArray<Token>): string {
  const first = indices[0]
  const last = indices[indices.length - 1]
  if (first === undefined || last === undefined) return ''
  const contiguous = indices.every((index, offset) => offset === 0 || index === (indices[offset - 1] as number) + 1)
  if (contiguous) {
    return rawInput.slice((tokens[first] as Token).start, (tokens[last] as Token).end).trim()
  }
  return indices.map((index) => (tokens[index] as Token).text).join(' ')
}

/**
 * 把一行命令文本解析成立项参数。
 * @param rawInput 命令名之后的原始文本
 * @returns 校验过语法的参数
 */
export function parseWorkCreate(rawInput: string): WorkCreateArgs {
  const tokens = tokenize(rawInput)
  const input: WorkCreateArgs = { title: '' }
  const seen = new Set<string>()
  const titleIndices: number[] = []
  let terminated = false

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] as Token
    if (terminated || !token.text.startsWith('--')) {
      titleIndices.push(index)
      continue
    }
    if (token.text === '--') {
      terminated = true
      continue
    }
    const spec = OPTIONS[token.text]
    if (spec === undefined) throw new Error(`未知选项 ${token.text}`)
    if (seen.has(token.text)) throw new Error(`选项 ${token.text} 重复`)
    seen.add(token.text)
    const value = tokens[index + 1]
    if (value === undefined || value.text.startsWith('--')) throw new Error(`${token.text} 缺少取值`)
    index += 1
    spec.apply(input, value.text, token.text)
  }

  const title = titleOf(rawInput, titleIndices, tokens)
  if (title === '') throw new Error('缺少标题：用法 /story-init <标题> [--lang zh|en] [--chapters N] [--words N] [--genre 题材] [--platform 平台]')
  input.title = title
  // CLI `book create` 的默认规模：不带参数时 200 章 × 3000 字。
  input.targetChapters ??= 200
  input.chapterWordCount ??= 3000
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
    description: '在当前工作区立项：写下 work.json（标题、语言、目标章数、单章字数、题材与平台）。',
    // 不声明 input 时，命令在候选菜单里一选中就派发，作者来不及补参数。
    input: { hint: '《标题》 [--lang zh|en] [--chapters N] [--words N] [--genre 题材] [--platform 平台] [--brief 简报文件]' },
    async handler(invocation: CommandInvocationLike): Promise<CommandResultLike> {
      try {
        const root = await ctx.workingDirectory.ensure(invocation.agent)
        if (!root) throw new Error('无法解析当前工作区目录')
        const args = parseWorkCreate(invocation.rawInput)
        const instruction = args.brief === undefined
          ? `Create ${args.title}`
          : (await readFile(join(root, safeRelativePath(args.brief)), 'utf8')).trim() || `Create ${args.title}`
        const work = await initWork(root, {
          title: args.title,
          language: args.language,
          targetChapters: args.targetChapters,
          chapterWordCount: args.chapterWordCount,
          genre: args.genre,
          platform: args.platform,
        }, instruction)
        return {
          kind: 'success',
          text: `已立项${describeWork(work)}\n`
            + '下一步：让主编按 story_next 的指示写基础设定，或在「作品」面板点「开始基础设定」。',
        }
      } catch (error) {
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
      }
    },
  })
}
