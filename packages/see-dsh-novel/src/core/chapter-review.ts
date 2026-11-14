/**
 * 章节审稿：校验观察、把审稿记录落盘。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { commitFoundation } from './commit.js'
import { loadChapterDocument } from './chapter-document.js'
import { loadChapterDraft } from './chapter-draft.js'
import { chapterBodyForChapter } from './chapter-document.js'
import { CHAPTER_INDEX_PATH, readChapterIndexStrict, reviewedChapterIndex } from './chapter-index.js'
import { loadChapterPlan, loadWriterContext } from './chapter-plan.js'
import { readWork } from './work.js'
import { chapterLengthDelivery, chapterLengthSpecOf, countChapterLengthByMode } from './length.js'
import type { LengthDelivery } from './length.js'
import { currentChapterArtifact, readArtifactRevision } from './artifact-store.js'
import { countObservations, resolveObservationSources } from './observation.js'
import type { Observation, ObservationCounts, ObservationInput } from './observation.js'
import { STORY_ROOT } from './story-paths.js'

const pad = (chapter: number): string => String(chapter).padStart(4, '0')

export function chapterReviewPath(chapter: number): string {
  return `${STORY_ROOT}/runtime/chapter-${pad(chapter)}.review.json`
}

export interface ReviewedArtifact {
  workId: string
  artifactId: string
  revisionId: string
}

export interface ReviewRecord {
  version: 1
  chapter: number
  summary: string
  observations: Observation[]
  counts: ObservationCounts
  reviewedArtifact?: ReviewedArtifact
  reviewedRevisionDigest?: string
}

function assertReviewedArtifact(value: ReviewedArtifact | undefined): ReviewedArtifact | undefined {
  if (value === undefined) return undefined
  for (const key of ['workId', 'artifactId', 'revisionId'] as const) {
    if (typeof value[key] !== 'string') throw new Error(`reviewedArtifact.${key} 必须是字符串`)
  }
  return value
}

/** 读取章纲与正文（已发布章优先、草稿兜底），作为审稿可引用的来源；`published` 决定是否写回索引。 */
export async function reviewSources(
  root: string,
  chapter: number,
  revisionContent?: string,
  beforeContent?: string,
  beforeLabel?: string,
): Promise<{ sources: Map<string, string>, published: boolean }> {
  const [document, draft, plan] = await Promise.all([
    loadChapterDocument(root, chapter),
    loadChapterDraft(root, chapter),
    loadChapterPlan(root, chapter).catch(() => null),
  ])
  const body = revisionContent ?? document?.content ?? draft?.content ?? null
  if (body === null) throw new Error(`第 ${chapter} 章还没有正文，先写再审`)
  if (plan === null) throw new Error(`第 ${chapter} 章还没有章纲，先规划再审`)
  const sources = new Map([[`chapter-${chapter}`, body]])
  const context = await loadWriterContext(root, chapter)
  sources.set('governed-context', context === null
    ? plan.memo.body
    : context.selectedContext
      .map((entry) => [`## ${entry.source}`, entry.reason, entry.excerpt ?? ''].filter(Boolean).join('\n'))
      .join('\n\n'))
  if (revisionContent !== undefined && beforeContent !== undefined) {
    sources.set(`chapter-${chapter}@${beforeLabel ?? 'before'}`, beforeContent)
  }
  return { sources, published: revisionContent === undefined && document !== null }
}

export async function reviewChapter(
  root: string,
  input: {
    chapter: number
    summary: string
    observations: ReadonlyArray<ObservationInput>
    revision?: { digest: string, content: string, beforeContent?: string, beforeLabel?: string }
  },
): Promise<{ path: string, counts: ObservationCounts, observations: Observation[], wordCount?: number, delivery?: LengthDelivery }> {
  if (input.summary.trim() === '') throw new Error('summary 不能为空')
  const existing = await readFile(join(root, chapterReviewPath(input.chapter)), 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null
    throw error
  })
  const { sources, published } = await reviewSources(
    root,
    input.chapter,
    input.revision?.content,
    input.revision?.beforeContent,
    input.revision?.beforeLabel,
  )
  const observations = resolveObservationSources(input.observations, sources, {
    ...(input.revision?.beforeContent === undefined || input.revision.beforeContent === input.revision.content
      ? {}
      : {
          scopeComparison: {
            beforeId: `chapter-${input.chapter}@${input.revision.beforeLabel ?? 'before'}`,
            currentId: `chapter-${input.chapter}`,
            before: input.revision.beforeContent,
            current: input.revision.content,
          },
        }),
  }).map((observation) => ({ ...observation, evidence: [] }))
  const counts = countObservations(observations)
  let reviewedArtifact: ReviewedArtifact | undefined
  if (input.revision === undefined) {
    const artifact = await currentChapterArtifact(root, input.chapter)
    if (artifact !== null) {
      const current = await readArtifactRevision(root, { artifactId: artifact.artifact.id, revisionId: artifact.revision.id })
      const currentBody = chapterBodyForChapter(current.bytes.toString('utf8'), input.chapter)
      if (currentBody === sources.get(`chapter-${input.chapter}`)) {
        reviewedArtifact = assertReviewedArtifact({
          workId: artifact.workId,
          artifactId: artifact.artifact.id,
          revisionId: artifact.revision.id,
        })
      }
    }
  }
  const work = await readWork(root)
  const spec = work === null ? undefined : chapterLengthSpecOf(work)
  const body = sources.get(`chapter-${input.chapter}`) ?? ''
  const wordCount = spec === undefined ? undefined : countChapterLengthByMode(body, spec.countingMode)
  const delivery = spec === undefined || wordCount === undefined ? undefined : chapterLengthDelivery(wordCount, spec)
  const record: ReviewRecord = {
    version: 1,
    chapter: input.chapter,
    summary: input.summary,
    observations,
    counts,
    ...(reviewedArtifact === undefined ? {} : { reviewedArtifact }),
    ...(input.revision === undefined ? {} : { reviewedRevisionDigest: input.revision.digest }),
    ...(wordCount === undefined ? {} : { wordCount }),
    ...(delivery === undefined ? {} : { delivery }),
  }
  const path = chapterReviewPath(input.chapter)
  const writes: Array<{ relativePath: string, content: string }> = [
    { relativePath: path, content: `${JSON.stringify(record, null, 2)}\n` },
  ]
  if (published) {
    const index = await readChapterIndexStrict(root)
    const updated = reviewedChapterIndex(index, {
      chapter: input.chapter,
      observations,
      now: new Date().toISOString(),
    })
    if (updated !== null) {
      writes.push({ relativePath: CHAPTER_INDEX_PATH, content: `${JSON.stringify(updated, null, 2)}\n` })
    }
  }
  await commitFoundation(root, { writes })
  return { path, counts, observations, ...(wordCount === undefined ? {} : { wordCount }), ...(delivery === undefined ? {} : { delivery }) }
}

export async function loadChapterReview(root: string, chapter: number): Promise<ReviewRecord | null> {
  try {
    return JSON.parse(await readFile(join(root, chapterReviewPath(chapter)), 'utf8')) as ReviewRecord
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}
