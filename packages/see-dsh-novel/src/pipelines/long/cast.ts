/**
 * 人物档案：唯一权威的读取与上下文渲染。
 *
 * 名字是身份，档位是属性。读取认四个角色目录（中文规范名 + 英文别名）：
 * 同一名字在两处各有一张卡时两张都读入，不替作者挑选；空卡与读失败记成问题。
 *
 * 读取用同步文件 API：`systemPrompt.context` 的文本提供函数是同步的，而且每次
 * 装配都要重新读盘才能反映作者刚改过的卡；几个小目录的同步读可以接受。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { ROLE_DIRS_BY_TIER, STORY_ROLES_DIR } from '../../core/story-paths.js'
import type { AgentPresetsLike, Disposer, PluginContext } from '../../core/types.js'
import { CAST_CONTEXT_NAME, CAST_CONTEXT_ORDER } from './contract.js'
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

/** 读一个档位：规范目录在前、英文别名在后；目录不存在按空处理，其它读失败记成问题。 */
function readTier(root: string, tier: RoleTier, problems: string[]): RoleCard[] {
  const cards: RoleCard[] = []
  for (const dirName of ROLE_DIRS_BY_TIER[tier]) {
    const dir = join(root, STORY_ROLES_DIR, dirName)
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      problems.push(`读不了角色目录 ${dirName}/：${(error as Error).message}`)
      continue
    }

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue
      const path = `${STORY_ROLES_DIR}/${dirName}/${entry.name}`
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
  }
  return cards
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
 * 四个角色目录都读（规范名 + 英文别名），同名双卡都返回、不去重；
 * 需要合并时由作者改文件。
 * @param root 作品根目录
 */
export function readCast(root: string): Cast {
  const problems: string[] = []
  const major = readTier(root, 'major', problems)
  const minor = readTier(root, 'minor', problems)
  return { major: major.sort(byName), minor: minor.sort(byName), problems }
}

/** 两个分组的标题：中英并列，与作品语言无关。 */
const TIER_HEADINGS: Readonly<Record<RoleTier, string>> = {
  major: '主要角色 / Major characters',
  minor: '次要角色 / Minor characters',
}

/**
 * 把人物档案渲染成一段 runtime context。
 *
 * 形态固定：每个非空档位一段 `## <标题>`，每卡 `### <名>` + 空行 + 卡内容（trim 后）；
 * 档位之间空行。问题段是不抛错策略的出口，追加在卡块之后（`[cast-problem]`）。
 * 没有卡也没有问题时返回空串，不贡献空块。
 * @param cast 已读取的人物档案
 */
export function renderCastContext(cast: Cast): string {
  const renderTier = (cards: ReadonlyArray<RoleCard>, heading: string): string =>
    cards.length === 0
      ? ''
      : `## ${heading}\n\n${cards.map((card) => `### ${card.name}\n\n${card.content.trim()}`).join('\n\n')}`

  const blocks = [
    renderTier(cast.major, TIER_HEADINGS.major),
    renderTier(cast.minor, TIER_HEADINGS.minor),
  ].filter((block) => block !== '')
  if (cast.problems.length > 0) blocks.push(`[cast-problem]\n${cast.problems.join('\n')}`)
  return blocks.join('\n\n')
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
