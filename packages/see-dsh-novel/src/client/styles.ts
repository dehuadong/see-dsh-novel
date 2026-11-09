/**
 * 面板样式：一个 `<style>` 元素，挂在 `ctx.effect` 的清理里。
 *
 * 单文件客户端产物没有 CSS 通道，所以样式跟着代码走；类名前缀 `sdn-`
 * 避免与宿主界面撞名。
 */
const STYLE_TEXT = `
.sdn-view { display: flex; flex-direction: column; gap: 12px; padding: 16px; height: 100%; box-sizing: border-box; }
.sdn-title { margin: 0; font-size: 16px; font-weight: 600; }
.sdn-muted { margin: 0; opacity: 0.7; }
.sdn-row { display: flex; gap: 8px; }
.sdn-workbench { min-height: 0; }
.sdn-workbench-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.sdn-rail { display: flex; gap: 8px; overflow-x: auto; padding: 4px 0 8px; }
.sdn-node { min-width: 150px; border: 1px solid currentColor; border-radius: 8px; padding: 8px; display: flex; flex-direction: column; gap: 4px; }
.sdn-node-done { opacity: 0.65; }
.sdn-node-locked { opacity: 0.45; }
.sdn-node-current { border-width: 2px; }
.sdn-node-selected { outline: 2px solid currentColor; outline-offset: 1px; }
.sdn-node-title { text-align: left; font-weight: 600; }
.sdn-disabled { margin: 0; font-size: 12px; opacity: 0.7; }
.sdn-workbench-body { display: grid; grid-template-columns: minmax(160px, 220px) minmax(0, 1fr); gap: 16px; min-height: 0; flex: 1; }
.sdn-side { overflow: auto; border-right: 1px solid currentColor; padding-right: 12px; }
.sdn-side-list { list-style: none; padding: 0; margin: 0 0 12px; display: flex; flex-direction: column; gap: 4px; }
.sdn-side-list button { text-align: left; width: 100%; }
.sdn-side-active { font-weight: 600; }
.sdn-detail { overflow: auto; min-width: 0; }
.sdn-artifact { white-space: pre-wrap; overflow-wrap: anywhere; }
.sdn-form { display: flex; flex-direction: column; gap: 8px; max-width: 420px; }
.sdn-form label { display: flex; flex-direction: column; gap: 2px; }
`

/**
 * 安装面板样式。
 * @returns 移除样式元素的清理函数
 */
export function installStyles(): () => void {
  const element = document.createElement('style')
  element.textContent = STYLE_TEXT
  document.head.appendChild(element)
  return () => {
    element.remove()
  }
}
