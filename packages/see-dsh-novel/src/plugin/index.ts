/**
 * Surface half.
 *
 * The browser half is resolved from the manifest of the package a *root* Loader
 * row mounts, and only a package-root specifier resolves that way — a subpath
 * entry is skipped. So the root row mounts this entry: it does nothing on the
 * host side, and its only job is to make the panel discoverable.
 *
 * The agent-facing half (the story tools) lives in `./agent.ts` and is mounted
 * by the preset, so it reaches writing agents and nothing else.
 */
export const name = 'see-dsh-novel'

export function apply(): void {}
