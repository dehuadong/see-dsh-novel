/**
 * Agent half: registers the story tools for every agent that selects the
 * `see-dsh-novel` preset. Mounted by the preset's `plugins` list, never by a
 * composition-root row — a root row would register the tools globally.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { countHooks, validateHooks } from '../core/hooks.js'
import type { HooksState } from '../core/hooks.js'
import type { Disposer, ExecuteContext, PluginContext, ToolDefinition } from '../core/types.js'
import { renderHooksProjection } from '../pipelines/long/hooks.js'
import { installFoundationTools } from '../pipelines/long/tools.js'
import { STORY_NEXT_NAME, storyNext, storyNextOutput, storyNextParameters } from './story-next.js'
import type { StoryNext } from './story-next.js'

export const name = 'see-dsh-novel-agent'

/** The tool registry plus the Session directory the foundation tools write into. */
export const inject = ['tools', 'workingDirectory'] as const

interface HooksResult {
  counts: Record<string, number>
  projection: string
}

/** Read-only view of the seeded hooks, rendered as the author-facing table. */
async function readHooks(ctx: PluginContext, exec: ExecuteContext): Promise<HooksResult> {
  if (!exec?.agent) throw new Error('story_hooks 需要所属 agent 会话')
  const root = await ctx.workingDirectory.ensure(exec.agent)
  const raw = await readFile(join(root, 'source/story/state/hooks.json'), 'utf8')
  const state = validateHooks(JSON.parse(raw) as HooksState)
  return { counts: countHooks(state), projection: renderHooksProjection(state) }
}

/** Register the story tools and hand back one disposer. */
export function apply(ctx: PluginContext): Disposer {
  const disposeStoryNext = ctx.tools.register({
    name: STORY_NEXT_NAME,
    description:
      'Return the current story work and which phase comes next. Reports the unbound phase until a work is selected.',
    parameters: storyNextParameters,
    output: {
      schema: storyNextOutput,
      // The runtime renders this array as the tool card's content and calls
      // `.some` on it, so it must be an array of content blocks — not the
      // result object, and not undefined.
      render: (_args: unknown, value: StoryNext) => [{
        type: 'text' as const,
        text: value.work === null
          ? `阶段 ${value.phase}（未绑定作品）`
          : `阶段 ${value.phase} · ${value.work}`,
      }],
    },
    execute: (): Promise<StoryNext> => Promise.resolve(storyNext()),
  } as ToolDefinition<Record<string, never>, StoryNext>)

  const disposeHooks = ctx.tools.register({
    name: 'story_hooks',
    description: 'List the pending hooks as a readable table with per-status counts. Read-only.',
    parameters: { type: 'object', additionalProperties: false, properties: {}, required: [] },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          counts: { type: 'object' },
          projection: { type: 'string' },
        },
        required: ['counts', 'projection'],
      },
      render: (_args: unknown, value: HooksResult) => [{ type: 'text' as const, text: value.projection }],
    },
    execute: (args: Record<string, never>, exec: ExecuteContext): Promise<HooksResult> => readHooks(ctx, exec),
  } as ToolDefinition<Record<string, never>, HooksResult>)

  const disposeFoundation = installFoundationTools(ctx)

  return (): void => {
    disposeFoundation()
    disposeHooks()
    disposeStoryNext()
  }
}
