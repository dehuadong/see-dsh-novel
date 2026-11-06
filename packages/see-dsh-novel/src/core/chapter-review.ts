/**
 * 章节审稿：校验观察、把审稿记录落盘。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { commitFoundation } from './commit.js'
import { loadChapterDocument } from './chapter-document.js'
import { loadChapterPlan } from './chapter-plan.js'
import { countObservations, resolveObservationSources } from './observation.js'
import type { Observation, ObservationCounts, ObservationInput } from './observation.js'
import { STORY_ROOT } from './story-paths.js'

const pad = (chapter: number): string => String(chapter).padStart(4, '0')

export function chapterReviewPath(chapter: number): string {
  return `${STORY_ROOT}/runtime/chapter-${pad(chapter)}.review.json`
}

export interface ReviewRecord {
  version: 1
  chapter: number
  summary: string
  observations: Observation[]
  counts: ObservationCounts
}

/** 读取章纲与正文，作为审稿可引用的来源。 */
export async function reviewSources(root: string, chapter: number): Promise<Map<string, string>> {
  const [document, plan] = await Promise.all([loadChapterDocument(root, chapter), loadChapterPlan(root, chapter)])
  if (document === null) throw new Error(`第 ${chapter} 章还没有正文，先写再审`)
  if (plan === null) throw new Error(`第 ${chapter} 章还没有章纲，先规划再审`)
  return new Map([
    [`chapter-${chapter}`, document.content],
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
  const record: ReviewRecord = { version: 1, chapter: input.chapter, summary: input.summary, observations, counts }
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
