/**
 * `story_settle_chapter`：结算即发布。
 *
 * 从草稿读正文，应用 delta，一次提交写章节、四份状态 JSON、三份投影、逐章快照、
 * 章节索引、artifact 与 active；草稿在同批删除。
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { applySettlement } from '../../core/settle.js'
import {
  inspectState,
  snapshotWrites,
  stateJsonWrites,
  stateProjectionWrites,
  validateChapterSummaries,
} from '../../core/state.js'
import type { StateSnapshot } from '../../core/state.js'
import { commitFoundation } from '../../core/commit.js'
import { chapterArtifactWrite } from '../../core/artifact-store.js'
import {
  chapterPrefix,
  countChapterLength,
  loadChapterDocument,
  renderChapterDocument,
  safeChapterTitle,
} from '../../core/chapter-document.js'
import { draftPath, loadChapterDraft } from '../../core/chapter-draft.js'
import { chapterReviewPath, loadChapterReview } from '../../core/chapter-review.js'
import { CHAPTER_INDEX_PATH, readChapterIndexStrict } from '../../core/chapter-index.js'
import type { ChapterIndexEntry } from '../../core/chapter-index.js'
import { readWork } from '../../core/work.js'
import type { Work } from '../../core/work.js'
import { withWorkAction } from '../../core/work-mutation.js'
import type { Disposer, ExecuteContext, JsonSchema, PluginContext, ToolDefinition } from '../../core/types.js'
import { settleDeltaParameters, settlementDeltaOf } from './settle-delta.js'
import type { SettleArgs } from './settle-delta.js'

export const SETTLE_NAME = 'story_settle_chapter'

const output: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    chapter: { type: 'integer' },
    facts: { type: 'integer' },
    hooks: { type: 'integer' },
    summaryTitle: { type: 'string' },
    postSettlement: { type: 'string' },
  },
  required: ['chapter', 'facts', 'hooks', 'summaryTitle', 'postSettlement'],
}

interface SettleOutput {
  chapter: number
  facts: number
  hooks: number
  summaryTitle: string
  postSettlement: string
}

export function installSettleTool(ctx: PluginContext): Disposer {
  return ctx.tools.register({
    name: SETTLE_NAME,
    description: 'Settle one reviewed draft and publish it in one commit: write the chapter document, four state JSON files, three projections, the per-chapter snapshot, the chapter index, the chapter artifact and the active status; delete the draft and advance lastAppliedChapter. To re-settle an already published chapter use story_resettle_chapter.',
    parameters: settleDeltaParameters,
    output: {
      schema: output,
      render: (_args: unknown, value: SettleOutput) => [{
        type: 'text' as const,
        text: `第 ${value.chapter} 章已结算并发布：${value.summaryTitle}（事实 ${value.facts} 条，伏笔 ${value.hooks} 条）`,
      }],
    },
    async execute(args: SettleArgs, exec: ExecuteContext): Promise<SettleOutput> {
      if (!exec?.agent) throw new Error('story_settle_chapter 需要所属 agent 会话')
      const root = await ctx.workingDirectory.ensure(exec.agent)
      const delta = settlementDeltaOf(args)
      const next: StateSnapshot = await withWorkAction(root, async () => {
        const work = await readWork(root)
        if (work === null) throw new Error('工作区没有 work.json')
        const read = await inspectState(root, [], work.language)
        if (read.missing.length > 0) throw new Error(`状态文件缺失，先修复或重建再结算：${read.missing.join('、')}`)
        if (read.invalid.length > 0) throw new Error(`状态文件损坏，先修复再结算：${read.invalid.join('、')}`)
        const last = read.snapshot.manifest.lastAppliedChapter
        const snapshotExists = existsSync(join(root, 'source/story/snapshots', String(args.chapter)))
        const document = await loadChapterDocument(root, args.chapter)
        if (document !== null) {
          if (snapshotExists) throw new Error(`第 ${args.chapter} 章已发布；重算请用 story_resettle_chapter`)
          if (args.chapter > last) throw new Error(`第 ${args.chapter} 章已发布但状态未推进；先运行 story_recover 处理`)
          throw new Error(`第 ${args.chapter} 章已发布但快照缺失；先运行 story_recover 处理`)
        }
        if (snapshotExists) throw new Error(`第 ${args.chapter} 章已有状态快照；重算请用 story_resettle_chapter`)
        if (args.chapter === last) throw new Error(`第 ${args.chapter} 章已结算；重算请用 story_resettle_chapter`)
        if (args.chapter < last) throw new Error(`第 ${args.chapter} 章早于已结算的第 ${last} 章；不支持更早章节重算`)
        const draft = await loadChapterDraft(root, args.chapter, work.language)
        if (draft === null) throw new Error(`第 ${args.chapter} 章还没有草稿，先写再结算`)
        const review = await loadChapterReview(root, args.chapter)
        if (review === null) throw new Error(`第 ${args.chapter} 章还没有审稿记录，先审再结算`)
        const settled = applySettlement(read.snapshot, delta).snapshot
        validateChapterSummaries(settled.chapterSummaries)
        const title = draft.title
        const relativePath = `source/chapters/${chapterPrefix(args.chapter)}${safeChapterTitle(title)}.md`
        const content = renderChapterDocument({ chapter: args.chapter, title, content: draft.content, language: work.language })
        const entries = await readChapterIndexStrict(root)
        const now = new Date().toISOString()
        const existingIndex = entries.findIndex((entry) => entry.number === args.chapter)
        const entry: ChapterIndexEntry = {
          number: args.chapter,
          title,
          wordCount: countChapterLength(draft.content, work.language),
          createdAt: existingIndex >= 0 ? entries[existingIndex]!.createdAt : now,
          updatedAt: now,
          observations: [...review.observations],
          provenance: 'generated',
        }
        const nextEntries = existingIndex >= 0
          ? entries.map((current, index) => index === existingIndex ? entry : current)
          : [...entries, entry]
        const artifact = await chapterArtifactWrite(root, { chapter: args.chapter, chapterPath: relativePath, content })
        const status: Work['status'] = work.status === 'draft' ? 'active' : work.status
        const nextWork: Work = { ...work, status, updatedAt: status === work.status ? work.updatedAt : now }
        const updatedReview = {
          ...review,
          reviewedArtifact: {
            workId: work.id,
            artifactId: artifact.artifact.id,
            revisionId: artifact.artifact.currentRevisionId ?? '',
          },
        }
        await commitFoundation(root, {
          writes: [
            { relativePath, content },
            ...stateJsonWrites(settled),
            ...stateProjectionWrites(settled),
            ...snapshotWrites(settled, args.chapter),
            { relativePath: CHAPTER_INDEX_PATH, content: `${JSON.stringify(nextEntries, null, 2)}\n` },
            { relativePath: 'work.json', content: `${JSON.stringify(nextWork, null, 2)}\n` },
            { relativePath: artifact.relativePath, content: artifact.content },
            artifact.snapshot,
            { relativePath: chapterReviewPath(args.chapter), content: `${JSON.stringify(updatedReview, null, 2)}\n` },
          ],
          deletes: [draftPath(args.chapter)],
        })
        return settled
      })
      return {
        chapter: args.chapter,
        facts: next.currentState.facts.length,
        hooks: next.hooks.hooks.length,
        summaryTitle: next.chapterSummaries.rows.find((row) => row.chapter === args.chapter)?.title ?? '',
        postSettlement: args.postSettlement,
      }
    },
  } as ToolDefinition<SettleArgs, SettleOutput>)
}
