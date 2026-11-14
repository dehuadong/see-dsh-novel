/**
 * 四份运行时状态 JSON 的 strict 形状校验。
 *
 * 与源 schema 对齐：未知字段、类型、整数边界与非空串都拒绝；校验返回 issues，
 * 不直接抛错，供 `inspectState`（invalid）与 `readStateSnapshot`（抛错）共用。
 */
import type { HooksState } from './hooks.js'
import { validateHooks } from './hooks.js'
import type { ChapterSummariesState, CurrentStateState } from './state-projections.js'
import type { StateManifest } from './state.js'

export interface StateIssue {
  path: string
  message: string
}

export type StateValidation<T> = { ok: true, value: T } | { ok: false, issues: StateIssue[] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isInt(value: unknown, min: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function exactKeys(value: Record<string, unknown>, keys: ReadonlyArray<string>, path: string, issues: StateIssue[]): boolean {
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) issues.push({ path: `${path}.${key}`, message: '缺少字段' })
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) issues.push({ path: `${path}.${key}`, message: '未知字段' })
  }
  return issues.length === 0
}

/** manifest.json；源 schemaVersion literal 2、language zh/en、lastAppliedChapter int≥0、projectionVersion int≥1。 */
export function validateManifest(value: unknown): StateValidation<StateManifest> {
  const issues: StateIssue[] = []
  if (!isRecord(value)) return { ok: false, issues: [{ path: 'manifest.json', message: '必须是对象' }] }
  exactKeys(value, ['schemaVersion', 'language', 'lastAppliedChapter', 'projectionVersion'], 'manifest.json', issues)
  if (value.schemaVersion !== 2) issues.push({ path: 'manifest.json.schemaVersion', message: '必须是 2' })
  if (value.language !== 'zh' && value.language !== 'en') issues.push({ path: 'manifest.json.language', message: '必须是 zh 或 en' })
  if (!isInt(value.lastAppliedChapter, 0)) issues.push({ path: 'manifest.json.lastAppliedChapter', message: '必须是 ≥0 的整数' })
  if (!isInt(value.projectionVersion, 1)) issues.push({ path: 'manifest.json.projectionVersion', message: '必须是 ≥1 的整数' })
  return issues.length === 0 ? { ok: true, value: value as unknown as StateManifest } : { ok: false, issues }
}

/** hooks.json；顶层只有 hooks，记录字段与源 HookRecordSchema 对齐。 */
export function validateHooksState(value: unknown): StateValidation<HooksState> {
  if (!isRecord(value)) return { ok: false, issues: [{ path: 'hooks.json', message: '必须是对象' }] }
  const issues: StateIssue[] = []
  for (const key of Object.keys(value)) {
    if (key !== 'hooks') issues.push({ path: `hooks.json.${key}`, message: '未知字段' })
  }
  if (!Array.isArray(value.hooks)) issues.push({ path: 'hooks.json.hooks', message: '必须是数组' })
  if (issues.length > 0) return { ok: false, issues }
  try {
    validateHooks(value as unknown as HooksState)
    return { ok: true, value: value as unknown as HooksState }
  } catch (error) {
    return { ok: false, issues: [{ path: 'hooks.json', message: error instanceof Error ? error.message : String(error) }] }
  }
}

const SUMMARY_FIELDS = ['title', 'characters', 'events', 'stateChanges', 'hookActivity', 'mood', 'chapterType'] as const

/** chapter_summaries.json；rows 每条恰好 8 键，chapter int≥1，title 非空域其余字符串。 */
export function validateSummariesState(value: unknown): StateValidation<ChapterSummariesState> {
  const issues: StateIssue[] = []
  if (!isRecord(value)) return { ok: false, issues: [{ path: 'chapter_summaries.json', message: '必须是对象' }] }
  exactKeys(value, ['rows'], 'chapter_summaries.json', issues)
  if (!Array.isArray(value.rows)) {
    issues.push({ path: 'chapter_summaries.json.rows', message: '必须是数组' })
    return { ok: false, issues }
  }
  value.rows.forEach((row, index) => {
    const at = `chapter_summaries.json.rows[${index}]`
    if (!isRecord(row)) {
      issues.push({ path: at, message: '必须是对象' })
      return
    }
    exactKeys(row, ['chapter', ...SUMMARY_FIELDS], at, issues)
    if (!isInt(row.chapter, 1)) issues.push({ path: `${at}.chapter`, message: '必须是 ≥1 的整数' })
    if (!isNonEmptyString(row.title)) issues.push({ path: `${at}.title`, message: '必须是非空字符串' })
    for (const field of SUMMARY_FIELDS.slice(1)) {
      if (typeof row[field] !== 'string') issues.push({ path: `${at}.${field}`, message: '必须是字符串' })
    }
  })
  return issues.length === 0 ? { ok: true, value: value as unknown as ChapterSummariesState } : { ok: false, issues }
}

/** current_state.json；chapter int≥0，fact 恰好 6 键，字段名与源一致。 */
export function validateCurrentState(value: unknown): StateValidation<CurrentStateState> {
  const issues: StateIssue[] = []
  if (!isRecord(value)) return { ok: false, issues: [{ path: 'current_state.json', message: '必须是对象' }] }
  exactKeys(value, ['chapter', 'facts'], 'current_state.json', issues)
  if (!isInt(value.chapter, 0)) issues.push({ path: 'current_state.json.chapter', message: '必须是 ≥0 的整数' })
  if (!Array.isArray(value.facts)) {
    issues.push({ path: 'current_state.json.facts', message: '必须是数组' })
    return { ok: false, issues }
  }
  value.facts.forEach((fact, index) => {
    const at = `current_state.json.facts[${index}]`
    if (!isRecord(fact)) {
      issues.push({ path: at, message: '必须是对象' })
      return
    }
    exactKeys(fact, ['subject', 'predicate', 'object', 'validFromChapter', 'validUntilChapter', 'sourceChapter'], at, issues)
    for (const field of ['subject', 'predicate', 'object']) {
      if (!isNonEmptyString(fact[field])) issues.push({ path: `${at}.${field}`, message: '必须是非空字符串' })
    }
    if (!isInt(fact.validFromChapter, 0)) issues.push({ path: `${at}.validFromChapter`, message: '必须是 ≥0 的整数' })
    if (fact.validUntilChapter !== null && !isInt(fact.validUntilChapter, 0)) {
      issues.push({ path: `${at}.validUntilChapter`, message: '必须是 ≥0 的整数或 null' })
    }
    if (!isInt(fact.sourceChapter, 0)) issues.push({ path: `${at}.sourceChapter`, message: '必须是 ≥0 的整数' })
  })
  return issues.length === 0 ? { ok: true, value: value as unknown as CurrentStateState } : { ok: false, issues }
}
