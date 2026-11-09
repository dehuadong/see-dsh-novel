/**
 * 审稿观察：证据行校验与行号解析。
 */
export type Assessment = 'issue' | 'resolved' | 'observation' | 'unavailable'

export interface ObservationSourceRef {
  sourceId: string
  quote: string
}

export interface ObservationInput {
  code: string
  summary: string
  assessment: Assessment
  category?: 'quality' | 'execution' | 'scope'
  scope?: string
  targetHash?: string
  target?: { workId: string, artifactId: string, revisionId: string }
  evidence?: string[]
  sourceRefs?: Array<{ sourceId: string, quote?: string, startLine?: number, endLine?: number }>
}

export interface Observation {
  code: string
  summary: string
  assessment: Assessment
  category?: 'quality' | 'execution' | 'scope'
  scope?: string
  targetHash?: string
  target?: { workId: string, artifactId: string, revisionId: string }
  evidence: string[]
  sourceRefs: ObservationSourceRef[]
}

/** 给原文加行号；审稿子代理看到的版本。 */
export function numberSourceLines(source: string): string {
  return source
    .replace(/\r\n/gu, '\n')
    .split('\n')
    .map((line, index) => `${index + 1} | ${line}`)
    .join('\n')
}

function fail(code: string, details: Record<string, unknown>): never {
  throw Object.assign(new Error(JSON.stringify({ code, ...details })), { code, ...details })
}

/**
 * 把行号或引文解析成逐字 quote；任何无证据、越界、空行、不匹配都按源工程的错误码拒绝。
 */
export function resolveObservationSources(
  observations: ReadonlyArray<ObservationInput>,
  sources: ReadonlyMap<string, string>,
): Observation[] {
  return observations.map((observation, index) => {
    const refs = observation.sourceRefs ?? []
    if (refs.length === 0 && observation.assessment !== 'unavailable') {
      fail('REVIEW_SOURCE_REQUIRED', { path: `/observations/${index}/sourceRefs`, observationCode: observation.code })
    }
    return {
      code: observation.code,
      summary: observation.summary,
      assessment: observation.assessment,
      ...(observation.category === undefined ? {} : { category: observation.category }),
      evidence: [...(observation.evidence ?? [])],
      sourceRefs: refs.map((reference, referenceIndex) => {
        const source = sources.get(reference.sourceId)
        if (source === undefined) {
          fail('REVIEW_SOURCE_UNKNOWN', { path: `/observations/${index}/sourceRefs/${referenceIndex}`, sourceId: reference.sourceId })
        }
        const lines = source.replace(/\r\n/gu, '\n').split('\n')
        let quote = reference.quote
        if (quote === undefined) {
          const start = reference.startLine
          const end = reference.endLine
          if (!Number.isInteger(start) || !Number.isInteger(end) || (start ?? 0) < 1 || (end ?? 0) < (start ?? 0) || (end ?? 0) > lines.length) {
            fail('REVIEW_SOURCE_RANGE_INVALID', {
              path: `/observations/${index}/sourceRefs/${referenceIndex}`,
              sourceId: reference.sourceId,
              startLine: reference.startLine,
              endLine: reference.endLine,
              lineCount: lines.length,
            })
          }
          quote = lines.slice((start as number) - 1, end as number).join('\n')
          if (quote.trim() === '') {
            fail('REVIEW_SOURCE_REQUIRED', {
              path: `/observations/${index}/sourceRefs/${referenceIndex}`,
              sourceId: reference.sourceId,
              startLine: start,
              endLine: end,
              instruction: '选择真正支撑这条观察的非空行，或撤回它。',
            })
          }
        }
        if (!source.includes(quote)) {
          fail('REVIEW_SOURCE_MISMATCH', {
            path: `/observations/${index}/sourceRefs/${referenceIndex}`,
            observationCode: observation.code,
            sourceId: reference.sourceId,
            quote: quote.slice(0, 1000),
          })
        }
        return { sourceId: reference.sourceId, quote }
      }),
    }
  })
}

export interface ObservationCounts {
  issue: number
  resolved: number
  observation: number
  unavailable: number
}

export function countObservations(observations: ReadonlyArray<Observation>): ObservationCounts {
  const counts: ObservationCounts = { issue: 0, resolved: 0, observation: 0, unavailable: 0 }
  for (const observation of observations) counts[observation.assessment] += 1
  return counts
}
