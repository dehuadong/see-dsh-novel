/**
 * 随包发布的写作方法技能。
 *
 * 技能以文件形式随包发布（`skills/<name>/SKILL.md`），运行时从包目录读取，
 * 经宿主技能服务注册到调用方所在的层——预设挂载的插件注册的就是这个预设，
 * 因此只有选了这个预设的 agent 看得到。
 *
 * 包内文件缺失、frontmatter 非法或正文为空都直接抛错：那是安装损坏，
 * 不能带着「少一个方法技能」的会话继续跑。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Disposer, PluginContext, SkillRegistrationLike } from '../../core/types.js'

/** 技能根目录名与每个技能的文件名。 */
const SKILLS_DIRECTORY = 'skills'
const SKILL_FILE = 'SKILL.md'

/** 随包技能的提供方标签；与插件名一致。 */
const SKILL_PROVIDER = 'see-dsh-novel'

/** 一条待注册的技能：注册参数里由文件提供的那部分。 */
export type BundledSkill = Omit<SkillRegistrationLike, 'source'>

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** frontmatter 允许的键；写错键要报错，不能让一个开关静默失效。 */
const ALLOWED_FIELDS = new Set([
  'name',
  'description',
  'whenToUse',
  'disable-model-invocation',
  'user-invocable',
])

/**
 * 从产物位置向上找本包的根目录：源码与打包产物的深度不同，不能用固定相对路径。
 * @param moduleUrl 调用方的 `import.meta.url`
 * @param packageName 期望的包名；先到的 `package.json` 不是它就报错
 */
export function packageRootOf(moduleUrl: string, packageName: string): string {
  let current = dirname(fileURLToPath(moduleUrl))
  for (;;) {
    const manifest = join(current, 'package.json')
    if (existsSync(manifest)) {
      const found = (JSON.parse(readFileSync(manifest, 'utf8')) as { name?: unknown }).name
      if (found !== packageName) throw new Error(`包根不是 ${packageName}：${current}（${String(found)}）`)
      return current
    }
    const parent = dirname(current)
    if (parent === current) throw new Error(`找不到 ${packageName} 的包根：${moduleUrl}`)
    current = parent
  }
}

interface ParsedSkillFile {
  fields: Map<string, string>
  body: string
}

/**
 * 读一个技能文件：`---` 包起来的 frontmatter 加正文。
 *
 * 只认逐行 `key: value` 的标量，不做完整 YAML——本包的技能文件由本包维护，
 * 复杂结构一出现就该在评审里被挡下，而不是靠一个半吊子解析器兜着。
 */
function parseSkillFile(text: string, where: string): ParsedSkillFile {
  const normalized = text.replace(/^\uFEFF/u, '')
  if (!normalized.startsWith('---')) {
    throw new Error(`${where} 缺少 frontmatter：文件必须以 --- 开头`)
  }
  const lines = normalized.split(/\r?\n/u)
  const end = lines.indexOf('---', 1)
  if (end < 0) throw new Error(`${where} 的 frontmatter 没有收尾 ---`)
  const fields = new Map<string, string>()
  for (const line of lines.slice(1, end)) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const match = /^([A-Za-z][A-Za-z0-9-]*):\s*(.*)$/u.exec(trimmed)
    if (match === null) throw new Error(`${where} 的 frontmatter 行无法解析：${trimmed}`)
    const key = match[1] as string
    if (!ALLOWED_FIELDS.has(key)) throw new Error(`${where} 的 frontmatter 含未知键：${key}`)
    fields.set(key, (match[2] as string).trim())
  }
  const body = lines.slice(end + 1).join('\n').trim()
  return { fields, body }
}

/** 把布尔字段收敛成 true/false；只认这两个写法，别的一律报错。 */
function readFlag(raw: string | undefined, key: string, where: string, fallback: boolean): boolean {
  if (raw === undefined) return fallback
  const value = raw.toLowerCase()
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error(`${where} 的 ${key} 只能是 true 或 false：${raw}`)
}

/**
 * 从技能文件文本得到一条可注册的技能。
 * @param text 文件全文
 * @param where 报错时要指出的路径
 */
export function parseSkill(text: string, where: string): BundledSkill {
  const { fields, body } = parseSkillFile(text, where)
  const name = fields.get('name') ?? ''
  const description = fields.get('description') ?? ''
  const whenToUse = fields.get('whenToUse')
  if (!SKILL_NAME.test(name)) throw new Error(`${where} 的 name 不是 kebab-case：${name || '（空）'}`)
  if (description === '') throw new Error(`${where} 缺少 description`)
  if (body === '') throw new Error(`${where} 正文为空`)
  // 模型面默认开：方法是写作时的必需品；人面向默认开：作者可以点名强制。
  const disabled = readFlag(fields.get('disable-model-invocation'), 'disable-model-invocation', where, false)
  const userInvocable = readFlag(fields.get('user-invocable'), 'user-invocable', where, true)
  return {
    name,
    description,
    ...(whenToUse !== undefined ? { whenToUse } : {}),
    content: body,
    invocation: { modelInvocable: !disabled, userInvocable },
  }
}

/** 读包内全部技能；目录缺席就是安装损坏。 */
export function readBundledSkills(packageRoot: string): BundledSkill[] {
  const root = join(packageRoot, SKILLS_DIRECTORY)
  let entries: Dirent[]
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch (error) {
    throw new Error(`读不到技能目录 ${root}：${(error as Error).message}`)
  }
  const skills: BundledSkill[] = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory()) continue
    const file = join(root, entry.name, SKILL_FILE)
    if (!existsSync(file)) throw new Error(`技能目录 ${entry.name} 缺少 ${SKILL_FILE}`)
    skills.push(parseSkill(readFileSync(file, 'utf8'), file))
  }
  if (skills.length === 0) throw new Error(`技能目录 ${root} 里没有任何技能`)
  return skills
}

/**
 * 注册随包技能；作用域是调用方所在的层（预设）。
 * @param ctx 插件上下文
 * @param packageRoot 包根目录
 */
export function installStorySkills(ctx: PluginContext, packageRoot: string): Disposer {
  const disposers = readBundledSkills(packageRoot).map((skill) =>
    ctx.skills.register({
      ...skill,
      source: 'runtime',
      provider: SKILL_PROVIDER,
      // 模型面靠它解析技能正文里的相对参考路径（references/...）。
      resourceBase: { kind: 'directory', path: join(packageRoot, SKILLS_DIRECTORY, skill.name) },
    }),
  )
  return (): void => {
    for (const dispose of disposers.reverse()) dispose()
  }
}
