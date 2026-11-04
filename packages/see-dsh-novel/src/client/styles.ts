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
