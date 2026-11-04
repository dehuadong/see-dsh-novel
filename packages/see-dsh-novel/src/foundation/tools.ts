/**
 * foundation 的四个工具。
 *
 * 四段分四次调用：outline → details → cast_index → cast_documents。
 * cast_index 不落盘，它的产出用来重建 cast_documents 的动态 schema：
 * 每个角色一个具名字段，让「每人一张卡」成为 schema 约束。
 */
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

import type { Disposer, ExecuteContext, PluginContext, ToolDefinition } from '../types.js'
import {
  CAST_INDEX_PARAMETERS,
  COMMIT_OUTPUT,
  DETAILS_PARAMETERS,
  OUTLINE_PARAMETERS,
  castDocumentsParameters,
  roleCardPath,
} from './contract.js'
import type { BookRulesData, IndexedRole, PendingHook } from './contract.js'
import { commitFoundation } from './commit.js'
import type { CommitResult } from './commit.js'
import { stateWritesIfMissing } from './state.js'

const ROLE_DIRS = ['主要角色', '次要角色'] as const

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
  for (const dir of ROLE_DIRS) {
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
        const writes = indexedRoles.map((role, index) => ({
          relativePath: roleCardPath(role.tier, role.name),
          content: `${String(args[`role_${index + 1}_content`]).trim()}\n`,
        }))
        const deleted = args.mode === 'revise'
          ? await staleRoleCards(root, writes.map((write) => write.relativePath))
          : []
        return commitFoundation(root, { writes, deletes: deleted })
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
      const stateWrites = await stateWritesIfMissing(root, args.pendingHooks)
      return commitFoundation(root, {
        writes: [
          { relativePath: 'source/story/book_rules.md', content: `${String(args.bookRules).trim()}\n` },
          { relativePath: 'source/story/book_rules.json', content: `${JSON.stringify(args.bookRulesData, null, 2)}\n` },
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
    execute(args: CastIndexArgs): Promise<{ roles: IndexedRole[] }> {
      const roles = args.roles.map((role) => ({ tier: role.tier, name: String(role.name).trim() }))
      registerCards(roles)
      return Promise.resolve({ roles })
    },
  } as ToolDefinition<CastIndexArgs, { roles: IndexedRole[] }>))

  return (): void => {
    cardsDisposer?.()
    for (const dispose of disposers) dispose()
  }
}
