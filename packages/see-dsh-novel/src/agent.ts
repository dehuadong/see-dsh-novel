/**
 * Agent half: registers the story tools for every agent that selects the
 * `see-dsh-novel` preset. Mounted by the preset's `plugins` list, never by a
 * composition-root row — a root row would register the tools globally.
 */
import { installFoundationTools } from './foundation/tools.js'
import { STORY_NEXT_NAME, storyNext, storyNextOutput, storyNextParameters } from './story-next.js'
import type { StoryNext } from './story-next.js'
import type { Disposer, PluginContext, ToolDefinition } from './types.js'

export const name = 'see-dsh-novel-agent'

/** The tool registry plus the Session directory the foundation tools write into. */
export const inject = ['tools', 'workingDirectory'] as const

/** Register `story_next` and the four foundation tools; hand back one disposer. */
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

  const disposeFoundation = installFoundationTools(ctx)

  return (): void => {
    disposeFoundation()
    disposeStoryNext()
  }
}
