/**
 * `source/chapters/index.json`：章节元数据的索引。
 *
 * 章节文件是正文权威；索引记录标题、字数、审稿观察与来源。读取按严格 schema，
 * 写入由建书、修订、定稿与删除各自完成，不存在统一的「重建入口」。
 */
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

import type { Observation } from './observation.js'

export const CHAPTER_INDEX_PATH = 'source/chapters/index.json'

export interface ChapterIndexEntry {
  number: number
  title: string
  wordCount: number
  createdAt: string
  updatedAt: string
  observations: IndexObservation[]
  provenance: 'generated' | 'imported' | 'edited'
}

/** 索引观察：源只保证 code/summary/evidence，其余字段可缺。 */
export type IndexObservation = Pick<Observation, 'code' | 'summary' | 'evidence'>
  & Partial<Pick<Observation, 'assessment' | 'category' | 'scope' | 'targetHash' | 'target' | 'sourceRefs'>>

const SOURCE_CHAPTER_FILE = /^(\d+)_.*\.md$/u
const HEADING = /^#\s*(?:第\s*(\d+)\s*章|Chapter\s+(\d+)\b)[:：]?\s*(.*)$/u
const DAY = '(?:0[1-9]|[12]\\d|3[01])'
const DATE = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-${DAY}|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|02-(?:0[1-9]|1\\d|2[0-8])))`
const ISO_DATETIME = new RegExp(`^${DATE}T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?Z$`, 'u')
const PROVENANCE = new Set(['generated', 'imported', 'edited'])
const ASSESSMENTS = new Set(['issue', 'resolved', 'unavailable', 'observation'])
const CATEGORIES = new Set(['execution', 'quality', 'scope'])
const OBSERVATION_KEYS = new Set(['code', 'summary', 'evidence', 'category', 'assessment', 'scope', 'targetHash', 'target', 'sourceRefs'])
const CHAPTER_KEYS = new Set(['number', 'title', 'wordCount', 'createdAt', 'updatedAt', 'observations', 'provenance', 'lengthTelemetry', 'tokenUsage'])

function fail(message: string): never {
  throw new Error(`${CHAPTER_INDEX_PATH} ${message}；未改动任何文件`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function unknownKeys(value: Record<string, unknown>, allowed: Set<string>, where: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${where} 含未知字段 ${key}`)
  }
}

function requireString(value: unknown, where: string): string {
  if (typeof value !== 'string') fail(`${where} 必须是字符串`)
  return value
}

function optionalString(value: unknown, where: string): void {
  if (value !== undefined) requireString(value, where)
}

function requireInteger(value: unknown, where: string, minimum?: number): number {
  if (!Number.isInteger(value) || (minimum !== undefined && (value as number) < minimum)) fail(`${where} 必须是整数`)
  return value as number
}

function validateObservation(value: unknown, where: string): void {
  if (!isRecord(value)) fail(`${where} 必须是对象`)
  unknownKeys(value, OBSERVATION_KEYS, where)
  requireString(value.code, `${where}.code`)
  if ((value.code as string) === '') fail(`${where}.code 不能为空`)
  requireString(value.summary, `${where}.summary`)
  if ((value.summary as string) === '') fail(`${where}.summary 不能为空`)
  if (value.evidence !== undefined) {
    if (!Array.isArray(value.evidence) || value.evidence.some((item) => typeof item !== 'string')) {
      fail(`${where}.evidence 必须是字符串数组`)
    }
  } else {
    value.evidence = []
  }
  if (value.category !== undefined && !CATEGORIES.has(value.category as string)) fail(`${where}.category 不合法`)
  if (value.assessment !== undefined && !ASSESSMENTS.has(value.assessment as string)) fail(`${where}.assessment 不合法`)
  optionalString(value.scope, `${where}.scope`)
  optionalString(value.targetHash, `${where}.targetHash`)
  if (value.target !== undefined) {
    if (!isRecord(value.target)) fail(`${where}.target 必须是对象`)
    unknownKeys(value.target, new Set(['workId', 'artifactId', 'revisionId']), `${where}.target`)
    requireString(value.target.workId, `${where}.target.workId`)
    requireString(value.target.artifactId, `${where}.target.artifactId`)
    requireString(value.target.revisionId, `${where}.target.revisionId`)
  }
  if (value.sourceRefs !== undefined) {
    if (!Array.isArray(value.sourceRefs)) fail(`${where}.sourceRefs 必须是数组`)
    value.sourceRefs.forEach((reference, index) => {
      const at = `${where}.sourceRefs[${index}]`
      if (!isRecord(reference)) fail(`${at} 必须是对象`)
      unknownKeys(reference, new Set(['sourceId', 'quote']), at)
      requireString(reference.sourceId, `${at}.sourceId`)
      if ((reference.sourceId as string) === '') fail(`${at}.sourceId 不能为空`)
      requireString(reference.quote, `${at}.quote`)
      if ((reference.quote as string) === '') fail(`${at}.quote 不能为空`)
    })
  }
}

function validateChapterEntry(value: unknown, index: number): ChapterIndexEntry {
  const where = `第 ${index + 1} 条记录`
  if (!isRecord(value)) fail(`${where} 必须是对象`)
  unknownKeys(value, CHAPTER_KEYS, where)
  requireInteger(value.number, `${where}.number`, 1)
  requireString(value.title, `${where}.title`)
  requireInteger(value.wordCount, `${where}.wordCount`)
  requireString(value.createdAt, `${where}.createdAt`)
  if (!ISO_DATETIME.test(value.createdAt as string)) fail(`${where}.createdAt 必须是 ISO 时间`)
  requireString(value.updatedAt, `${where}.updatedAt`)
  if (!ISO_DATETIME.test(value.updatedAt as string)) fail(`${where}.updatedAt 必须是 ISO 时间`)
  if (!PROVENANCE.has(value.provenance as string)) fail(`${where}.provenance 不合法`)
  if (!Array.isArray(value.observations)) fail(`${where}.observations 必须是数组`)
  value.observations.forEach((observation, observationIndex) => {
    validateObservation(observation, `${where}.observations[${observationIndex}]`)
  })
  if (value.lengthTelemetry !== undefined) {
    const at = `${where}.lengthTelemetry`
    if (!isRecord(value.lengthTelemetry)) fail(`${at} 必须是对象`)
    unknownKeys(value.lengthTelemetry, new Set(['target', 'countingMode', 'writerCount', 'postReviseCount', 'finalCount', 'repairApplied']), at)
    requireInteger(value.lengthTelemetry.target, `${at}.target`, 1)
    if (value.lengthTelemetry.countingMode !== 'zh_chars' && value.lengthTelemetry.countingMode !== 'en_words') fail(`${at}.countingMode 不合法`)
    requireInteger(value.lengthTelemetry.writerCount, `${at}.writerCount`, 0)
    requireInteger(value.lengthTelemetry.postReviseCount, `${at}.postReviseCount`, 0)
    requireInteger(value.lengthTelemetry.finalCount, `${at}.finalCount`, 0)
    if (typeof value.lengthTelemetry.repairApplied !== 'boolean') fail(`${at}.repairApplied 必须是布尔`)
  }
  if (value.tokenUsage !== undefined) {
    const at = `${where}.tokenUsage`
    if (!isRecord(value.tokenUsage)) fail(`${at} 必须是对象`)
    unknownKeys(value.tokenUsage, new Set(['promptTokens', 'completionTokens', 'totalTokens']), at)
    requireInteger(value.tokenUsage.promptTokens, `${at}.promptTokens`)
    requireInteger(value.tokenUsage.completionTokens, `${at}.completionTokens`)
    requireInteger(value.tokenUsage.totalTokens, `${at}.totalTokens`)
  }
  return value as unknown as ChapterIndexEntry
}

/** 修订后的索引：当前章标 edited，后代替换 upstream-revision 提醒。 */
export function revisedChapterIndex(
  entries: ReadonlyArray<ChapterIndexEntry>,
  input: { chapter: number, title: string, wordCount: number, language: string, now: string },
): ChapterIndexEntry[] {
  const notice = input.language === 'en'
    ? `Chapter ${input.chapter} changed; re-review this downstream chapter for continuity.`
    : `第${input.chapter}章已重写，请重新检查本章与前文的连续性。`
  const current = entries.find((entry) => entry.number === input.chapter)
  const updated: ChapterIndexEntry = {
    ...(current ?? {
      number: input.chapter,
      title: input.title,
      createdAt: input.now,
    }),
    wordCount: input.wordCount,
    updatedAt: input.now,
    observations: [],
    provenance: 'edited',
  }
  const next = entries.map((entry): ChapterIndexEntry => {
    if (entry.number === input.chapter) return updated
    if (entry.number > input.chapter) {
      return {
        ...entry,
        updatedAt: input.now,
        observations: [
          ...entry.observations.filter((observation) => observation.code !== 'upstream-revision'),
          { code: 'upstream-revision', summary: notice, evidence: [] },
        ],
      }
    }
    return entry
  })
  if (current === undefined) next.push(updated)
  return next.sort((left, right) => left.number - right.number)
}

/** 审稿写回后的索引：只更新该章 `updatedAt` 与 `observations`；无该章条目时返回 null。 */
export function reviewedChapterIndex(
  entries: ReadonlyArray<ChapterIndexEntry>,
  input: { chapter: number, observations: ReadonlyArray<Observation>, now: string },
): ChapterIndexEntry[] | null {
  if (!entries.some((entry) => entry.number === input.chapter)) return null
  return entries.map((entry): ChapterIndexEntry => entry.number === input.chapter
    ? { ...entry, updatedAt: input.now, observations: [...input.observations] }
    : entry)
}

/** `chapters/` 下是否有任意位数前缀的章节正文文件；口径与严格读取一致。 */
export async function hasChapterFiles(root: string): Promise<boolean> {
  let entries: string[]
  try {
    entries = await readdir(join(root, 'source/chapters'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
  return entries.some((entry) => SOURCE_CHAPTER_FILE.test(entry))
}

/**
 * 严格读取章节索引。
 *
 * 索引缺失时：章节文件存在则拒绝，没有章节文件返回空数组。
 */
export async function readChapterIndexStrict(root: string): Promise<ChapterIndexEntry[]> {
  let raw: string
  try {
    raw = await readFile(join(root, CHAPTER_INDEX_PATH), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    if (await hasChapterFiles(root)) {
      throw new Error(`${CHAPTER_INDEX_PATH} 缺失，但章节文件仍存在；先修复索引再继续；未改动任何文件`)
    }
    return []
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`${CHAPTER_INDEX_PATH} 不是合法 JSON，先修复再继续；未改动任何文件`)
  }
  if (!Array.isArray(parsed)) throw new Error(`${CHAPTER_INDEX_PATH} 必须是数组；未改动任何文件`)
  return parsed.map((entry, index) => validateChapterEntry(entry, index))
}

/** 从章节文件头取标题；取不到就用文件名主体。 */
export function chapterTitleOf(raw: string, file: string): string {
  const first = raw.replace(/\r\n/gu, '\n').split('\n').find((line) => line.trim() !== '') ?? ''
  const match = HEADING.exec(first.trim())
  if (match !== null && (match[3] ?? '').trim() !== '') return (match[3] as string).trim()
  return file.replace(/^\d{4}_/u, '').replace(/\.md$/u, '')
}

/** 读既有索引；缺失按空数组，坏掉拒绝覆盖。 */
export async function readChapterIndex(root: string): Promise<ChapterIndexEntry[]> {
  let raw: string
  try {
    raw = await readFile(join(root, CHAPTER_INDEX_PATH), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`${CHAPTER_INDEX_PATH} 不是合法 JSON，先修复再继续`)
  }
  if (!Array.isArray(parsed)) throw new Error(`${CHAPTER_INDEX_PATH} 必须是数组`)
  for (const [index, entry] of parsed.entries()) {
    if (entry === null || typeof entry !== 'object'
      || !Number.isInteger((entry as { number?: unknown }).number)
      || typeof (entry as { title?: unknown }).title !== 'string') {
      throw new Error(`${CHAPTER_INDEX_PATH} 第 ${index + 1} 条记录不合法`)
    }
  }
  return parsed as ChapterIndexEntry[]
}
