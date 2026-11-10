/**
 * 本插件服务的预设 id。
 *
 * 与 `cordis.patch.yml` 的 `preset-see-dsh-novel` config.id 一致；宿主半边与
 * 预设的 agent 半边共用这一份，浏览器半边另有 `client/preset.ts`（client 不能
 * 引用宿主模块）。
 */
export const PRESET_ID = 'see-dsh-novel'
