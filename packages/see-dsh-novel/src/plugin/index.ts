/**
 * Surface half.
 *
 * The browser half is resolved from the manifest of the package a *root* Loader
 * row mounts, and only a package-root specifier resolves that way — a subpath
 * entry is skipped. So the root row mounts this entry: it owns the host-side
 * panel projection (index rebuild after a work action and a one-shot rebuild
 * when a session is published), and its manifest is what makes the panel
 * discoverable.
 *
 * The agent-facing half (the story tools) lives in `./agent.ts` and is mounted
 * by the preset, so it reaches writing agents and nothing else.
 */
import { installPanelWarmup } from './panel-projection.js'
import type { PanelHostContext } from './panel-projection.js'

export const name = 'see-dsh-novel'

/**
 * 装面板预热：会话发布时给缺索引的作品补建一次。
 * 写 action 的投影在 `withWorkAction` 里就地完成，不依赖跨进程观察者。
 * @param ctx 根插件的宿主上下文
 */
export function apply(ctx: PanelHostContext): void {
  installPanelWarmup(ctx)
}
