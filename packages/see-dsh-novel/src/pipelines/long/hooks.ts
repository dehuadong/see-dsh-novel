/**
 * 伏笔投影：把状态渲染成作者可读的 Markdown 表格。
 *
 * 同一份状态必须得到同一份文本——排序显式给出，不依赖对象插入顺序。
 */
/**
 * 伏笔投影：与落盘投影共用 core 的渲染，不再单独维护一份格式。
 */
export { renderHooksProjection } from '../../core/state-projections.js'
