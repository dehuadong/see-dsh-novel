/**
 * Agent half: registers the `story_next` tool for every agent that selects the
 * `see-dsh-novel` preset. Mounted by the preset's `plugins` list, never by a
 * composition-root row — a root row would register the tool globally.
 */
import { STORY_NEXT_NAME, storyNext, storyNextOutput, storyNextParameters } from './story-next.js'

export const name = 'see-dsh-novel-agent'

/** The tool registry is the only service this half depends on. */
export const inject = ['tools']

/**
 * Register `story_next` and hand the disposer back to the loader.
 * @param {{ tools: { register: (definition: unknown) => () => void } }} ctx
 * @returns {() => void} the exact disposer that unregisters the tool
 */
export function apply(ctx) {
  return ctx.tools.register({
    name: STORY_NEXT_NAME,
    description:
      'Return the current story work and which phase comes next. Reports the unbound phase until a work is selected.',
    parameters: storyNextParameters,
    output: {
      schema: storyNextOutput,
      // The runtime renders this array as the tool card's content and calls
      // `.some` on it, so it must be an array of content blocks — not the
      // result object, and not undefined.
      render: (_args, value) => [{
        type: 'text',
        text: value.work === null
          ? `阶段 ${value.phase}（未绑定作品）`
          : `阶段 ${value.phase} · ${value.work}`,
      }],
    },
    execute: () => Promise.resolve(storyNext()),
  })
}
