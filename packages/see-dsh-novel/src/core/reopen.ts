/**
 * 章节重开与版本恢复。
 *
 * 恢复按源工程的做法只替换正文并清掉该章运行时文件；DSH 的阶段判定依赖
 * `current_state.chapter`，所以重开同时把状态指针退回上一章，facts/hooks 留待
 * 重结算（D33：没有逐章基线快照）。
 */
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { chapterPlanPath } from './chapter-plan.js'
import { chapterReviewPath } from './chapter-review.js'
import { chapterVersionsDir, readChapterVersion } from './chapter-versions.js'
import { commitFoundation } from './commit.js'
import { loadChapterDocument } from './chapter-document.js'
import { inspectState, stateJsonWrites, stateProjectionWrites } from './state.js'
import type { StateSnapshot } from './state.js'
import { readWork } from './work.js'
import { readWorkflowStart, WORKFLOW_START_PATH } from './workflow-start.js'

export interface ReopenResult {
  chapter: number
  versionId: string | null
  archived: string | null
  removed: string[]
  stage: 'plan'
}

/**
 * 重开最后已结算的一章；可选恢复到某个归档版本。
 * @param root 作品根目录
 * @param chapter 章号，必须是当前已结算的最后一章
 * @param options `versionId` 指定要恢复的版本
 */
export async function reopenChapter(
  root: string,
  chapter: number,
  options: { versionId?: string } = {},
): Promise<ReopenResult> {
  const work = await readWork(root)
  if (work === null) throw new Error('工作区没有 work.json')
  const document = await loadChapterDocument(root, chapter)
  if (document === null) throw new Error(`第 ${chapter} 章还没有正文，无法重开`)
  const read = await inspectState(root, [], work.language)
  if (read.invalid.length > 0) throw new Error(`状态文件损坏，先修复再重开：${read.invalid.join('、')}`)
  const snapshot: StateSnapshot = read.snapshot
  if (snapshot.manifest.lastAppliedChapter !== chapter) {
    throw new Error(`只能重开最后已结算的一章：当前已结算到第 ${snapshot.manifest.lastAppliedChapter} 章；更早章节的重开需要基线快照（D33）`)
  }

  const previous = await readFile(join(root, document.path), 'utf8')
  const writes: Array<{ relativePath: string, content: string }> = []
  const removed: string[] = [chapterReviewPath(chapter), chapterPlanPath(chapter)]
  let archived: string | null = null
  let versionId: string | null = null

  if (options.versionId !== undefined) {
    versionId = options.versionId
    const version = await readChapterVersion(root, chapter, versionId)
    const replacement = version.endsWith('\n') ? version : `${version}\n`
    if (replacement === previous) throw new Error('版本内容与当前正文相同，不需要恢复')
    archived = `${chapterVersionsDir(chapter)}/${Date.now()}_restore_${randomUUID()}.md`
    writes.push({ relativePath: archived, content: previous })
    writes.push({ relativePath: document.path, content: replacement })
  }

  if (await readWorkflowStart(root) === null) {
    writes.push({
      relativePath: WORKFLOW_START_PATH,
      content: `${JSON.stringify({
        version: 1,
        action: 'write_next',
        chapter,
        instruction: `重开第 ${chapter} 章`,
        createdAt: new Date().toISOString(),
      }, null, 2)}\n`,
    })
  }

  const next: StateSnapshot = {
    manifest: { ...snapshot.manifest, lastAppliedChapter: chapter - 1 },
    currentState: { ...snapshot.currentState, chapter: chapter - 1 },
    hooks: snapshot.hooks,
    chapterSummaries: { rows: snapshot.chapterSummaries.rows.filter((row) => row.chapter !== chapter) },
  }
  writes.push(...stateJsonWrites(next), ...stateProjectionWrites(next))

  await commitFoundation(root, { writes, deletes: removed })
  return { chapter, versionId, archived, removed, stage: 'plan' }
}
