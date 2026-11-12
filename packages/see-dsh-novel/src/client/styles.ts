/**
 * 面板样式：一个 `<style>` 元素，挂在 `ctx.effect` 的清理里。
 *
 * 单文件客户端产物没有 CSS 通道，所以样式跟着代码走；类名前缀 `sdn-`
 * 避免与宿主界面撞名。
 */
const STYLE_TEXT = `
.sdn-view { display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; height: 100%; box-sizing: border-box; font-size: 13px; line-height: 1.45; }
.sdn-title { margin: 0; font-size: 16px; line-height: 22px; font-weight: 600; }
.sdn-muted { margin: 0; opacity: 0.7; font-size: 12px; }
.sdn-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.sdn-workbench { min-height: 0; }
.sdn-workbench-head { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.sdn-export { display: flex; gap: 6px; align-items: center; margin-top: 2px; }
.sdn-export select { padding: 2px 6px; border: 1px solid rgba(127, 127, 127, 0.3); border-radius: 8px; background: transparent; color: inherit; font: inherit; font-size: 12px; }
.sdn-columns { display: grid; grid-template-columns: 148px 216px minmax(0, 1fr); gap: 0; flex: 1; min-height: 0; border-top: 1px solid rgba(127, 127, 127, 0.25); }
.sdn-stages { display: flex; flex-direction: column; gap: 2px; padding: 8px 8px 8px 0; overflow: auto; border-right: 1px solid rgba(127, 127, 127, 0.25); }
.sdn-stage { appearance: none; display: flex; align-items: center; gap: 6px; width: 100%; padding: 6px 8px; border: 0; border-radius: 8px; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.sdn-stage:hover { background: rgba(127, 127, 127, 0.12); }
.sdn-stage[data-active] { background: rgba(127, 127, 127, 0.16); font-weight: 500; }
.sdn-stage[data-status="locked"] { opacity: 0.5; }
.sdn-stage-mark { width: 12px; flex: none; opacity: 0.8; }
.sdn-list { display: flex; flex-direction: column; min-height: 0; min-width: 0; border-right: 1px solid rgba(127, 127, 127, 0.25); }
.sdn-list-head { padding: 10px 10px 4px; font-size: 12px; opacity: 0.7; }
.sdn-list-body { flex: 1; min-height: 0; overflow: auto; padding: 2px 6px 12px; }
.sdn-list-row { appearance: none; display: flex; flex-direction: column; gap: 1px; width: 100%; padding: 6px 8px; border: 0; border-radius: 8px; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.sdn-list-row:hover { background: rgba(127, 127, 127, 0.12); }
.sdn-list-row[data-active] { background: rgba(127, 127, 127, 0.16); }
.sdn-detail { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.sdn-actionbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px 12px; border-bottom: 1px solid rgba(127, 127, 127, 0.25); }
.sdn-actionbar-stage { font-size: 12px; opacity: 0.7; margin-right: 4px; }
.sdn-primary { appearance: none; padding: 5px 12px; border: 0; border-radius: 8px; background: rgba(127, 127, 127, 0.22); color: inherit; font: inherit; cursor: pointer; }
.sdn-primary:hover:not(:disabled) { background: rgba(127, 127, 127, 0.3); }
.sdn-primary:disabled, .sdn-secondary:disabled { opacity: 0.45; cursor: default; }
.sdn-secondary { appearance: none; padding: 3px 8px; border: 1px solid rgba(127, 127, 127, 0.3); border-radius: 8px; background: transparent; color: inherit; font: inherit; font-size: 12px; cursor: pointer; }
.sdn-secondary:hover:not(:disabled) { background: rgba(127, 127, 127, 0.12); }
.sdn-disabled { font-size: 12px; opacity: 0.7; }
.sdn-detail-body { flex: 1; min-height: 0; overflow: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.sdn-detail-title { margin: 0; font-size: 14px; line-height: 20px; font-weight: 600; }
.sdn-artifact { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.sdn-diag { margin-top: 8px; border-top: 1px dashed rgba(127, 127, 127, 0.3); padding-top: 6px; }
.sdn-diag > summary { cursor: pointer; font-size: 12px; opacity: 0.7; padding: 2px 4px; }
.sdn-warning { margin: 0; padding: 8px 10px; border: 1px solid rgba(64, 128, 255, 0.35); border-radius: 8px; background: rgba(64, 128, 255, 0.1); font-size: 12px; }
.sdn-json { display: flex; flex-direction: column; gap: 4px; }
.sdn-json-node { margin-left: 2px; }
.sdn-json-node > summary { cursor: pointer; font-size: 12px; }
.sdn-json-row { display: flex; gap: 8px; align-items: baseline; padding: 1px 0 1px 10px; }
.sdn-json-key { flex: none; min-width: 96px; font-size: 12px; opacity: 0.7; }
.sdn-json-value { white-space: pre-wrap; overflow-wrap: anywhere; }
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
