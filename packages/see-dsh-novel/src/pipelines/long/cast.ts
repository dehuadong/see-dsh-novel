/**
 * 人物档案：唯一权威的读取与上下文渲染。
 *
 * 名字是身份，档位是属性：一个名字只能有一张卡。读取方把「同一名字出现在
 * 两个档位」「空卡」「读失败」当作问题报出来，而不是替作者挑一张。
 *
 * 读取用同步文件 API：`systemPrompt.context` 的文本提供函数是同步的，而且每次
 * 装配都要重新读盘才能反映作者刚改过的卡；六个小文件的同步读可以接受。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { AgentPresetsLike, Disposer, PluginContext } from '../../core/types.js'
import { CAST_CONTEXT_NAME, CAST_CONTEXT_ORDER, ROLE_DIRS } from './contract.js'
import type { RoleTier } from './contract.js'

/** 一张角色卡。 */
export interface RoleCard {
  name: string
  tier: RoleTier
  content: string
  /** 作品相对路径，`/` 分隔。 */
  path: string
}

/** 一次读取的结果：两个档位各自按名字升序，外加读不出可用卡的原因。 */
export interface Cast {
  major: RoleCard[]
  minor: RoleCard[]
  problems: string[]
}

const ROLES_DIR = 'source/story/roles'

/** 读一个档位目录；目录不存在按空处理，其它读失败记成问题。 */
function readTier(root: string, tier: RoleTier, problems: string[]): RoleCard[] {
  const dir = join(root, ROLES_DIR, ROLE_DIRS[tier])
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    problems.push(`读不了角色目录 ${ROLE_DIRS[tier]}/：${(error as Error).message}`)
    return []
  }

  const cards: RoleCard[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    const path = `${ROLES_DIR}/${ROLE_DIRS[tier]}/${entry.name}`
    let content: string
    try {
      content = readFileSync(join(dir, entry.name), 'utf8')
    } catch (error) {
      problems.push(`读不了 ${path}：${(error as Error).message}`)
      continue
    }
    if (content.trim() === '') {
      problems.push(`${path} 是空卡：补上内容或删掉它。`)
      continue
    }
    cards.push({ name: entry.name.slice(0, -'.md'.length), tier, content, path })
  }
  return cards
}

/** 只去掉卡末尾的换行；最后一行行尾空格保留——卡内容是逐字进入上下文的。 */
function withoutTrailingNewlines(content: string): string {
  return content.replace(/[\r\n]+$/u, '')
}

/** 按 Unicode 码位比较名字，避免代理对在 UTF-16 顺序里排错。 */
function compareCodePoints(left: string, right: string): number {
  const a = Array.from(left)
  const b = Array.from(right)
  const shared = Math.min(a.length, b.length)
  for (let index = 0; index < shared; index += 1) {
    const x = a[index]?.codePointAt(0) ?? 0
    const y = b[index]?.codePointAt(0) ?? 0
    if (x !== y) return x < y ? -1 : 1
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1
}

const byName = (left: RoleCard, right: RoleCard): number => compareCodePoints(left.name, right.name)

/**
 * 读取作品的人物档案。
 *
 * 同一名字出现在两个档位时，两张卡都不返回，并在 `problems` 里点名——
 * 唯一权威不允许「挑一张算数」。
 * @param root 作品根目录
 */
export function readCast(root: string): Cast {
  const problems: string[] = []
  let major = readTier(root, 'major', problems)
  let minor = readTier(root, 'minor', problems)

  const seen = new Set<string>()
  const conflicts = new Set<string>()
  for (const card of [...major, ...minor]) {
    if (seen.has(card.name)) conflicts.add(card.name)
    else seen.add(card.name)
  }
  if (conflicts.size > 0) {
    for (const name of conflicts) {
      problems.push(
        `${name} 在${ROLE_DIRS.major}与${ROLE_DIRS.minor}各有一张卡：合并成一张再继续；冲突的卡没有注入。`,
      )
    }
    major = major.filter((card) => !conflicts.has(card.name))
    minor = minor.filter((card) => !conflicts.has(card.name))
  }
  return { major: major.sort(byName), minor: minor.sort(byName), problems }
}

/**
 * 把人物档案渲染成一段 runtime context。
 *
 * 形态固定：`[roles:index]` 名册、每卡一个 `[role:<name>]` 块、必要时一条
 * `[cast-problem]`。没有任何卡也没有问题时返回空串，不贡献空块。
 * @param cast 已读取的人物档案
 */
export function renderCastContext(cast: Cast): string {
  const cards = [...cast.major, ...cast.minor]
  if (cards.length === 0 && cast.problems.length === 0) return ''

  const parts: string[] = ['## 人物档案（唯一来源：source/story/roles/）']
  if (cards.length > 0) {
    parts.push('', '[roles:index]')
    if (cast.major.length > 0) parts.push(`主要角色：${cast.major.map((card) => card.name).join('、')}`)
    if (cast.minor.length > 0) parts.push(`次要角色：${cast.minor.map((card) => card.name).join('、')}`)
  }
  for (const card of cards) {
    parts.push('', `[role:${card.name}]`, withoutTrailingNewlines(card.content))
  }
  if (cast.problems.length > 0) parts.push('', '[cast-problem]', ...cast.problems)
  parts.push('', '以上人物档案是唯一来源：已有角色不得改设定，新人物先建档再写。')
  return parts.join('\n')
}

/**
 * 注册人物档案的 runtime context。
 *
 * 注册本身是全局的，所以文本提供函数先确认这次装配的 agent 属于 `presetId`，
 * 否则返回空串——角色的权威不能串到别的预设。
 * @param ctx 插件上下文
 * @param presetId 本能力所属的预设 id
 */
export function installCastContext(ctx: PluginContext, presetId: string): Disposer {
  const presets = (): AgentPresetsLike | undefined => ctx.get('agentPresets') as AgentPresetsLike | undefined
  return ctx.systemPrompt.context({
    name: CAST_CONTEXT_NAME,
    order: CAST_CONTEXT_ORDER,
    interpolate: false,
    required: true,
    text: (assembly) => {
      const agent = assembly.agent
      if (agent === undefined || agent.ctx === undefined) return ''
      if (presets()?.composedPreset(agent.ctx) !== presetId) return ''
      return renderCastContext(readCast(ctx.workingDirectory.get(agent.session)))
    },
  })
}
