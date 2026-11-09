/**
 * 一章的 workflow start 授权记录。
 *
 * 源工程的 Studio 只在作者确认 `write_next` 后启动一章的生产；这份记录是 DSH
 * 侧对应的授权凭证。它不描述阶段状态：阶段仍由文件判定，`readWorkflowStart`
 * 只回答“这一章是否已被作者允许开始”。
 */
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { commitFile, commitFoundation } from './commit.js'
import { withWorkAction } from './work-mutation.js'

export const WORKFLOW_START_PATH = 'source/story/runtime/workflow-start.json'

export interface WorkflowStart {
  version: 1
  action: 'write_next'
  chapter: number
  instruction: string
  createdAt: string
}

export async function readWorkflowStart(root: string): Promise<WorkflowStart | null> {
  try {
    const parsed = JSON.parse(await readFile(join(root, WORKFLOW_START_PATH), 'utf8')) as Partial<WorkflowStart>
    if (parsed.version !== 1 || parsed.action !== 'write_next' || !Number.isInteger(parsed.chapter) || (parsed.chapter as number) < 1) {
      throw new Error('workflow-start 记录无效')
    }
    if (typeof parsed.instruction !== 'string' || typeof parsed.createdAt !== 'string') throw new Error('workflow-start 记录无效')
    return {
      version: 1,
      action: 'write_next',
      chapter: parsed.chapter as number,
      instruction: parsed.instruction,
      createdAt: parsed.createdAt,
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

/** 写一章的 start；同一时间只允许一条记录。 */
export async function writeWorkflowStart(root: string, input: { chapter: number, instruction: string }): Promise<WorkflowStart> {
  return withWorkAction(root, async () => {
    const existing = await readWorkflowStart(root)
    if (existing !== null) throw new Error(`第 ${existing.chapter} 章的 workflow start 还没有消费；先完成或清除它`)
    const start: WorkflowStart = {
      version: 1,
      action: 'write_next',
      chapter: input.chapter,
      instruction: input.instruction,
      createdAt: new Date().toISOString(),
    }
    await commitFile(root, WORKFLOW_START_PATH, `${JSON.stringify(start, null, 2)}\n`)
    return start
  })
}

/** 清除当前 start；章节完成后由 review 或面板调用。 */
export async function clearWorkflowStart(root: string): Promise<void> {
  await withWorkAction(root, async () => {
    await commitFoundation(root, { writes: [], deletes: [WORKFLOW_START_PATH] })
  })
}

/** 这一章是否已被作者允许启动。 */
export async function workflowStarted(root: string, chapter: number): Promise<boolean> {
  const start = await readWorkflowStart(root)
  return start?.chapter === chapter
}

/** 同步版本，供 `detectStage` 的同步 stage 判定使用。 */
export function workflowStartedSync(root: string, chapter: number): boolean {
  try {
    const parsed = JSON.parse(readFileSync(join(root, WORKFLOW_START_PATH), 'utf8')) as Partial<WorkflowStart>
    return parsed.version === 1 && parsed.action === 'write_next' && parsed.chapter === chapter
  } catch {
    return false
  }
}
