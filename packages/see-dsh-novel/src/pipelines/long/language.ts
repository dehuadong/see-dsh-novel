/**
 * 投影语言：manifest 优先，其次作品身份，最后中文。
 *
 * 两条读取都可能失败（状态文件损坏、`work.json` 被手改），失败只让语言退回中文，
 * 不让调用方因此失败。
 */
import type { ProjectionLanguage } from '../../core/state-projections.js'
import { readManifestLanguage } from '../../core/state.js'
import { readWork } from '../../core/work.js'

export async function projectionLanguage(root: string): Promise<ProjectionLanguage> {
  const fromManifest = await readManifestLanguage(root)
  if (fromManifest !== undefined) return fromManifest
  try {
    const work = await readWork(root)
    if (work?.language === 'zh' || work?.language === 'en') return work.language
  } catch {
    // 身份文件坏了不该阻断状态读取。
  }
  return 'zh'
}
