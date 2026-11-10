/**
 * 面板索引的宿主投影。
 *
 * 索引是只读视图：作品写 action 成功后重建；会话发布时给缺索引的作品补建一次。
 * 投影失败只记录，不改变动作结果，也不阻塞会话打开。
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { PANEL_INDEX_VERSION, buildPanelIndex, writePanelIndex } from '../core/panel-index.js'
import { PANEL_INDEX_PATH } from '../core/story-paths.js'
import { withWorkAction } from '../core/work-mutation.js'

const WORK_FILE = 'work.json'

/** 正在补建的根，避免同一作品重复排队。 */
const warming = new Set<string>()

/** 会话头里投影需要的字段。 */
export interface SessionHeaderLike {
  readonly cwd?: string
  readonly delegationDepth?: number
}

/** 根插件用到的宿主面；只声明用到的成员。 */
export interface PanelHostContext {
  effect(execute: () => () => void, label?: string): void
  on(event: 'session/created', listener: (session: { readonly header: SessionHeaderLike }) => void): () => boolean
  logger: { warn(message: string): void }
}

/**
 * 从文件重建索引并原子写回。
 * @param root 作品根目录
 */
export async function projectPanelIndex(root: string): Promise<void> {
  const index = await buildPanelIndex(root)
  await writePanelIndex(root, index)
}

/** 索引缺失、读不通或格式版本过旧时都要补建。 */
async function indexStale(root: string): Promise<boolean> {
  try {
    const raw = await readFile(join(root, PANEL_INDEX_PATH), 'utf8')
    const parsed = JSON.parse(raw) as { version?: unknown }
    return parsed.version !== PANEL_INDEX_VERSION
  } catch {
    return true
  }
}

/**
 * 给缺索引（或索引格式过旧）的作品补建一次；同一根去重，失败不抛出。
 *
 * 判据只看工作区里有没有 `work.json`：会话头的 `agentPreset` 是创建时的组成，
 * 会话后来换过预设时它可能落后于界面上生效的预设；用文件判定更可靠。
 * @param header 会话头（取 cwd 与委派深度）
 * @param log 失败时的记录函数
 */
export async function prewarmPanelIndex(
  header: SessionHeaderLike,
  log: (message: string) => void = () => {},
): Promise<void> {
  if ((header.delegationDepth ?? 0) > 0) return
  const root = header.cwd
  if (root === undefined || root === '') return
  if (!existsSync(join(root, WORK_FILE))) return
  if (!await indexStale(root)) return
  if (warming.has(root)) return
  warming.add(root)
  try {
    await withWorkAction(root, async () => {
      // 拿到锁后再判一次：另一个进程可能已经补建完。
      if (!await indexStale(root)) return
      await projectPanelIndex(root)
    }, { project: false })
  } catch (error) {
    log(`面板索引补建失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    warming.delete(root)
  }
}

/**
 * 在根插件上装预热：会话发布时给缺索引的作品补建一次。
 *
 * 写 action 的投影在 `withWorkAction` 里就地完成（见 `core/work-mutation.ts`），
 * 不依赖跨进程观察者；这里只处理「打开旧作品但还没写过」的情形。
 * @param ctx 根插件的宿主上下文
 * @returns 注销函数
 */
export function installPanelWarmup(ctx: PanelHostContext): () => void {
  const stopPrewarm = ctx.on('session/created', (session) => {
    // 同步监听器抛错会回滚会话创建：只发起异步补建，失败只记日志。
    void prewarmPanelIndex(session.header, (message) => { ctx.logger.warn(message) })
      .catch((error: unknown) => { ctx.logger.warn(`面板索引补建失败：${error instanceof Error ? error.message : String(error)}`) })
  })

  return (): void => {
    stopPrewarm()
  }
}