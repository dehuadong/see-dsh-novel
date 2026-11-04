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
      // The runtime serializes whatever this returns into the tool card, so it
      // must be lossless JSON; returning the result keeps the card and the
      // model-visible payload identical.
      render: (result) => result,
    },
    execute: () => Promise.resolve(storyNext({})),
  })
}
