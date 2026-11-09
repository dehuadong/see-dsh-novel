/**
 * 建书：身份、外部上下文（`story/brief.md`）与方向文档兜底同一次提交写入。
 *
 * 提案批准与 `/story-init` 共用这一条路径，避免两个入口各写一份、各自漏文件。
 */
import type { Work, WorkCreateInput } from './work.js'
import { createWork, prepareWork } from './work.js'
import { withWorkAction } from './work-mutation.js'
import { controlDocumentWrites } from './control-docs.js'
import { STORY_EXTERNAL_BRIEF } from './story-paths.js'
import type { WorkLanguage } from './work.js'

/**
 * 建书并在同一次提交里写 brief 与方向文档。
 * @param root 作品根
 * @param input 作者确认过的身份字段（规模已在调用方补默认）
 * @param instruction 作者确认后要执行的那句话；原文写入 brief
 * @returns 落盘的身份对象
 */
export async function initWork(root: string, input: WorkCreateInput, instruction: string): Promise<Work> {
  return withWorkAction(root, async () => {
    // 先校验身份（含已存在与字段），失败时一个文件都不写。
    const prepared = await prepareWork(root, input)
    const language: WorkLanguage = prepared.language
    const controlWrites = await controlDocumentWrites(root, language, instruction)
    return createWork(root, input, {
      prepared,
      extraWrites: [
        ...controlWrites,
        { relativePath: STORY_EXTERNAL_BRIEF, content: instruction },
      ],
    })
  })
}
