/**
 * 章节审稿：校验观察、把审稿记录落盘。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { commitFoundation } from './commit.js'
import { loadChapterDocument } from './chapter-document.js'
import { loadChapterDraft } from './chapter-draft.js'
import { chapterBodyForChapter } from './chapter-document.js'
import { loadChapterPlan } from './chapter-plan.js'
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
}

function assertReviewedArtifact(value: ReviewedArtifact | undefined): ReviewedArtifact | undefined {
  if (value === undefined) return undefined
  for (const key of ['workId', 'artifactId', 'revisionId'] as const) {
    if (typeof value[key] !== 'string') throw new Error(`reviewedArtifact.${key} 必须是字符串`)
  }
  return value
}

/** 读取章纲与正文（已发布章优先、草稿兜底），作为审稿可引用的来源。 */
export async function reviewSources(root: string, chapter: number): Promise<Map<string, string>> {
  const [document, draft, plan] = await Promise.all([
    loadChapterDocument(root, chapter),
    loadChapterDraft(root, chapter),
    loadChapterPlan(root, chapter),
  ])
  const body = document?.content ?? draft?.content ?? null
  if (body === null) throw new Error(`第 ${chapter} 章还没有正文，先写再审`)
  if (plan === null) throw new Error(`第 ${chapter} 章还没有章纲，先规划再审`)
  return new Map([
    [`chapter-${chapter}`, body],
    ['governed-context', plan.memo.body],
  ])
}

export async function reviewChapter(
  root: string,
  input: { chapter: number, summary: string, observations: ReadonlyArray<ObservationInput> },
): Promise<{ path: string, counts: ObservationCounts, observations: Observation[] }> {
  if (input.summary.trim() === '') throw new Error('summary 不能为空')
  const existing = await readFile(join(root, chapterReviewPath(input.chapter)), 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null
    throw error
  })
  if (existing !== null) throw new Error(`第 ${input.chapter} 章已经有审稿记录，不覆盖`)
  const sources = await reviewSources(root, input.chapter)
  const observations = resolveObservationSources(input.observations, sources)
  const counts = countObservations(observations)
  let reviewedArtifact: ReviewedArtifact | undefined
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
  const record: ReviewRecord = {
    version: 1,
    chapter: input.chapter,
    summary: input.summary,
    observations,
    counts,
    ...(reviewedArtifact === undefined ? {} : { reviewedArtifact }),
  }
  const path = chapterReviewPath(input.chapter)
  await commitFoundation(root, { writes: [{ relativePath: path, content: `${JSON.stringify(record, null, 2)}\n` }] })
  return { path, counts, observations }
}

export async function loadChapterReview(root: string, chapter: number): Promise<ReviewRecord | null> {
  try {
    return JSON.parse(await readFile(join(root, chapterReviewPath(chapter)), 'utf8')) as ReviewRecord
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}
