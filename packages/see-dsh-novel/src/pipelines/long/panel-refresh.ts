/**
 * 确认类动作后的面板索引刷新。
 *
 * 确认、退回、定稿改的正是面板要显示的事实。写索引可能因为文件被占用而失败，
 * 失败时作者必须知道显示可能是旧的，所以这里把技术错误折成一句可执行的话，
 * 由命令回执或工具输出带给作者；确认本身不回滚。
 */
import { rebuildPanelIndexWithRetry } from '../../core/panel-index.js'

/** 面板索引没能刷新时给作者的说明；成功后为空串。 */
export const PANEL_REFRESH_FAILED_HINT = '重新打开作品页或运行 /story-index 可恢复显示。'

/**
 * 重建面板索引；成功返回空串，失败返回一句说明。
 * @param root 作品根目录
 */
export async function refreshPanel(root: string): Promise<string> {
  try {
    await rebuildPanelIndexWithRetry(root)
    return ''
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return `面板索引没能刷新（${reason}）；${PANEL_REFRESH_FAILED_HINT}`
  }
}
