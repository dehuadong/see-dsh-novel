/**
 * foundation 的四个工具。
 *
 * 四段分四次调用：outline → details → cast_index → cast_documents。
 * cast_index 不落盘，它的产出用来重建 cast_documents 的动态 schema：
 * 每个角色一个具名字段，让「每人一张卡」成为 schema 约束。
 */
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

import type { Disposer, ExecuteContext, PluginContext, ToolDefinition } from '../../core/types.js'
import {
  CAST_INDEX_PARAMETERS,
  COMMIT_OUTPUT,
  DETAILS_PARAMETERS,
  OUTLINE_PARAMETERS,
  ROLE_DIRS,
  castDocumentsParameters,
  roleCardPath,
} from './contract.js'
import type { BookRulesData, IndexedRole, PendingHook, RoleTier } from './contract.js'
import { commitFoundation } from '../../core/commit.js'
import type { CommitResult } from '../../core/commit.js'
import { stateLanguage, stateWritesIfMissing } from '../../core/state.js'
import { BOOK_RULES_JSON, BOOK_RULES_MD, withVersion } from './book-rules.js'

/** 两个档位；读取与删除都按这个顺序走。 */
const TIER_ORDER: ReadonlyArray<RoleTier> = ['major', 'minor']
const OTHER_TIER: Record<RoleTier, RoleTier> = { major: 'minor', minor: 'major' }

interface OutlineArgs {
  storyFrame: string
  volumeMap: string
}

interface DetailsArgs {
  bookRules: string
  bookRulesData: BookRulesData
  pendingHooks: PendingHook[]
}

interface CastIndexArgs {
  roles: IndexedRole[]
}

interface CastDocumentsArgs {
  mode?: 'init' | 'revise'
  [key: `role_${number}_content`]: string
}

/** 把提交结果渲染成工具卡片文本。 */
function renderCommit(_args: unknown, value: CommitResult): Array<{ type: 'text', text: string }> {
  const written = value.written.length
  const deleted = value.deleted.length
  return [{
    type: 'text',
    text: deleted > 0 ? `写入 ${written} 个文件，删除 ${deleted} 个旧角色卡` : `写入 ${written} 个文件`,
  }]
}

/** 尚未被本次重写的角色卡。 */
async function staleRoleCards(root: string, written: ReadonlyArray<string>): Promise<string[]> {
  const stale: string[] = []
  for (const tier of TIER_ORDER) {
    const dir = ROLE_DIRS[tier]
    let entries
    try {
      entries = await readdir(join(root, 'source/story/roles', dir), { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue
      const relativePath = `source/story/roles/${dir}/${entry.name}`
      if (!written.includes(relativePath)) stale.push(relativePath)
    }
  }
  return stale
}

/** 换档写入要删掉的旧卡：同名角色在另一档位已经有一张。 */
async function movedRoleCards(root: string, roles: ReadonlyArray<IndexedRole>): Promise<string[]> {
  const moved: string[] = []
  for (const role of roles) {
    const previous = roleCardPath(OTHER_TIER[role.tier], role.name)
    try {
      await stat(join(root, previous))
      moved.push(previous)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return moved
}

/**
 * 索引里的名字就是身份：空名、重复名、安全化后同文件名的角色都拒绝，
 * 否则两张卡会写进同一个文件或同一个角色被登记两次。
 */
function normalizeCastIndex(roles: ReadonlyArray<IndexedRole>): IndexedRole[] {
  const names = new Set<string>()
  const files = new Set<string>()
  const normalized: IndexedRole[] = []
  for (const role of roles) {
    const name = String(role.name ?? '').trim()
    if (name === '') throw new Error('角色名不能为空')
    if (names.has(name)) throw new Error(`角色重复：${name}`)
    const file = roleCardPath(role.tier, name)
    if (files.has(file)) throw new Error(`两个角色会写进同一个文件：${file}`)
    names.add(name)
    files.add(file)
    normalized.push({ tier: role.tier, name })
  }
  return normalized
}

/** 注册四个 foundation 工具；cast_documents 会随索引结果重新注册。 */
export function installFoundationTools(ctx: PluginContext): Disposer {
  const disposers: Disposer[] = []
  let cardsDisposer: Disposer | undefined
  let indexedRoles: ReadonlyArray<IndexedRole> = []

  async function workRoot(exec: ExecuteContext): Promise<string> {
    if (!exec?.agent) throw new Error('foundation 工具需要所属 agent 会话；无归属时拒绝写入')
    const dir = await ctx.workingDirectory.ensure(exec.agent)
    if (!dir) throw new Error('无法解析当前工作区目录')
    return dir
  }

  function registerCards(roles: ReadonlyArray<IndexedRole>): void {
    indexedRoles = roles
    cardsDisposer?.()
    cardsDisposer = ctx.tools.register({
      name: 'story_foundation_cast_documents',
      description:
        'Write one character card per indexed role under source/story/roles/. In revise mode, cards not resubmitted are deleted.',
      parameters: castDocumentsParameters(roles),
      output: { schema: COMMIT_OUTPUT, render: renderCommit },
      async execute(args: CastDocumentsArgs, exec: ExecuteContext): Promise<CommitResult> {
        const root = await workRoot(exec)
        const writes = indexedRoles.map((role, index) => {
          const content = String(args[`role_${index + 1}_content`] ?? '').trim()
          if (content === '') throw new Error(`角色卡内容不能为空：${role.name}`)
          return { relativePath: roleCardPath(role.tier, role.name), content: `${content}\n` }
        })
        const written = writes.map((write) => write.relativePath)
        // revise 删掉本次没重写的卡；换档写入再删掉另一档位里的同名旧卡。两者可能重叠，去重。
        const deleted = args.mode === 'revise' ? await staleRoleCards(root, written) : []
        const moved = await movedRoleCards(root, indexedRoles)
        return commitFoundation(root, { writes, deletes: [...new Set([...deleted, ...moved])] })
      },
    })
  }

  registerCards([])

  disposers.push(ctx.tools.register({
    name: 'story_foundation_outline',
    description:
      'Write the work outline: a readable story frame and a volume/chapter direction map, into source/story/outline/*.md.',
    parameters: OUTLINE_PARAMETERS,
    output: { schema: COMMIT_OUTPUT, render: renderCommit },
    execute(args: OutlineArgs, exec): Promise<CommitResult> {
      return workRoot(exec).then((root) => commitFoundation(root, {
        writes: [
          { relativePath: 'source/story/outline/story_frame.md', content: `${String(args.storyFrame).trim()}\n` },
          { relativePath: 'source/story/outline/volume_map.md', content: `${String(args.volumeMap).trim()}\n` },
        ],
      }))
    },
  } as ToolDefinition<OutlineArgs, CommitResult>))

  disposers.push(ctx.tools.register({
    name: 'story_foundation_details',
    description:
      'Write the book rules (readable Markdown plus structured JSON) and seed the initial unresolved hooks into source/story/state/.',
    parameters: DETAILS_PARAMETERS,
    output: { schema: COMMIT_OUTPUT, render: renderCommit },
    async execute(args: DetailsArgs, exec: ExecuteContext): Promise<CommitResult> {
      const root = await workRoot(exec)
      // 先补版本、再严格校验：写坏的文件不能落到盘上。
      const rules = withVersion(args.bookRulesData)
      const stateWrites = await stateWritesIfMissing(root, args.pendingHooks, await stateLanguage(root))
      return commitFoundation(root, {
        writes: [
          { relativePath: BOOK_RULES_MD, content: `${String(args.bookRules).trim()}\n` },
          { relativePath: BOOK_RULES_JSON, content: `${JSON.stringify(rules, null, 2)}\n` },
          ...stateWrites,
        ],
      })
    },
  } as ToolDefinition<DetailsArgs, CommitResult>))

  disposers.push(ctx.tools.register({
    name: 'story_foundation_cast_index',
    description:
      'List the named people who shape the opening conflict with their major/minor tier. Nothing is written; the result rebuilds the character-card schema.',
    parameters: CAST_INDEX_PARAMETERS,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          roles: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                tier: { type: 'string', enum: ['major', 'minor'] },
                name: { type: 'string' },
              },
              required: ['tier', 'name'],
            },
          },
        },
        required: ['roles'],
      },
      render: (_args: unknown, value: { roles: IndexedRole[] }) => [{
        type: 'text' as const,
        text: `开篇人物 ${value.roles.length} 位：` +
          value.roles.map((role) => `${role.name}（${role.tier === 'major' ? '主要' : '次要'}）`).join('、'),
      }],
    },
    async execute(args: CastIndexArgs): Promise<{ roles: IndexedRole[] }> {
      const roles = normalizeCastIndex(args.roles)
      registerCards(roles)
      return { roles }
    },
  } as ToolDefinition<CastIndexArgs, { roles: IndexedRole[] }>))

  return (): void => {
    cardsDisposer?.()
    for (const dispose of disposers) dispose()
  }
}
