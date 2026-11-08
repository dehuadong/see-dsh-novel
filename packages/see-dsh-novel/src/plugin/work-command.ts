/**
 * `/story-init`：立项的命令行入口。
 *
 * 命令的输入是一整行文本、没有 schema，所以解析单独做成纯函数：语法错误在这里
 * 点名参数；语言归一也在这里完成，语言枚举、正整数、已存在与坏文件这些语义错误
 * 仍由 `prepareWork` 报（消息里带文件与字段），命令层不复制同一套规则。
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

/** 命令的缺省分类：作者没写时落这两个值。 */
const DEFAULT_GENRE = 'xuanhuan'
const DEFAULT_PLATFORM = 'tomato'
/** 缺省规模：200 章 × 3000 字。 */
const DEFAULT_CHAPTERS = 200
const DEFAULT_WORDS = 3000

/** 选项说明；用法与输入提示共用，避免两处文案漂移。 */
const OPTION_HELP = '[--lang zh|en] [--target-chapters N] [--chapter-words N] [--genre 题材] [--platform 平台] [--brief 简报文件]（--chapters／--words 为规模别名）'
const USAGE = `/story-init <标题> ${OPTION_HELP}`
const INPUT_HINT = `《标题》 ${OPTION_HELP}`

/** 解析后的立项参数；标题与五个选项名和 `WorkCreateInput` 同名，但这里已经是 string／number，另带 `brief`。 */
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

/** 按前导整数解析；取不出数字才算语法错误。 */
function leadingIntegerOf(flag: string, value: string): number {
  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed)) throw new Error(`${flag} 取不出整数，实际是 ${value}`)
  return parsed
}

/** 按语言标签的前缀归一；不认识的写法留给缺省值处理。 */
function normalizeLanguage(value: string): 'zh' | 'en' | undefined {
  const normalized = value.trim().toLowerCase()
  if (normalized.startsWith('en')) return 'en'
  if (normalized.startsWith('zh')) return 'zh'
  return undefined
}

const TARGET_CHAPTERS_OPTION: OptionSpec = {
  apply: (input, value, flag) => { input.targetChapters = leadingIntegerOf(flag, value) },
}
const CHAPTER_WORDS_OPTION: OptionSpec = {
  apply: (input, value, flag) => { input.chapterWordCount = leadingIntegerOf(flag, value) },
}

const OPTIONS: Record<string, OptionSpec> = {
  '--lang': {
    apply: (input, value) => {
      const language = normalizeLanguage(value)
      // 不认识的写法回退到缺省 zh；删掉键，让 `prepareWork` 用自己的默认值。
      if (language === undefined) delete input.language
      else input.language = language
    },
  },
  '--target-chapters': TARGET_CHAPTERS_OPTION,
  '--chapters': TARGET_CHAPTERS_OPTION,
  '--chapter-words': CHAPTER_WORDS_OPTION,
  '--words': CHAPTER_WORDS_OPTION,
  '--genre': { apply: (input, value) => { input.genre = value } },
  '--platform': { apply: (input, value) => { input.platform = value } },
  '--brief': {
    apply: (input, value) => {
      // 空串等于没给简报；删掉键，让处理器回退到 `Create <标题>`。
      if (value === '') delete input.brief
      else input.brief = value
    },
  },
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

/** `--flag=value` 拆成选项名与内联取值；没有 `=` 时只返回选项名。 */
function splitFlag(text: string): { flag: string; inline?: string } {
  const equals = text.indexOf('=')
  if (equals === -1) return { flag: text }
  return { flag: text.slice(0, equals), inline: text.slice(equals + 1) }
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
    const { flag, inline } = splitFlag(token.text)
    const spec = OPTIONS[flag]
    if (spec === undefined) throw new Error(`未知选项 ${flag}`)
    let value: string
    if (inline !== undefined) {
      value = inline
    } else {
      const next = tokens[index + 1]
      if (next === undefined || next.text.startsWith('--')) throw new Error(`${flag} 缺少取值`)
      value = next.text
      index += 1
    }
    spec.apply(input, value, flag)
  }

  const title = titleOf(rawInput, titleIndices, tokens)
  if (title === '') throw new Error(`缺少标题：用法 ${USAGE}`)
  input.title = title
  // 空串保持原样，交给 prepareWork 拒绝；?? 只补没写的字段。
  input.genre ??= DEFAULT_GENRE
  input.platform ??= DEFAULT_PLATFORM
  input.targetChapters ??= DEFAULT_CHAPTERS
  input.chapterWordCount ??= DEFAULT_WORDS
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
    input: { hint: INPUT_HINT },
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
