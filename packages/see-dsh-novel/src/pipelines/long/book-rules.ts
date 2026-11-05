/**
 * book_rules 契约：`version: "2"` 的严格形状与读取入口。
 *
 * 字段与校验对齐源工程 `models/book-rules.ts`：未知字段拒绝、`protagonist.name`
 * 与两个字符串数组是裸类型（空串与空数组合法）、`narrativePerson`／`fanficMode`
 * 写入时去首尾空白且空白即拒绝。工具 schema 与校验器共用同一份字段表。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { JsonSchema } from '../../core/types.js'

/** 两个文件的位置；写入方与读取方共用。 */
export const BOOK_RULES_MD = 'source/story/book_rules.md'
export const BOOK_RULES_JSON = 'source/story/book_rules.json'

export interface Protagonist {
  name: string
  personalityLock: string[]
  behavioralConstraints: string[]
}

export interface GenreLock {
  primary: string
  forbidden: string[]
}

/** 落盘形状：带版本。 */
export interface BookRules {
  version: '2'
  protagonist?: Protagonist
  genreLock?: GenreLock
  narrativePerson?: string
  prohibitions: string[]
  enableFullCastTracking: boolean
  fanficMode?: string
  allowedDeviations: string[]
}

/** 模型提供的形状：不提供 version，由写路径注入。 */
export type BookRulesInput = Omit<BookRules, 'version'>

/** 字段类型；校验与 schema 生成都按它走。 */
type FieldKind = 'string' | 'trimmedString' | 'boolean' | 'stringArray' | 'protagonist' | 'genreLock'

interface FieldSpec {
  kind: FieldKind
  optional: boolean
}

/** 唯一的字段表；顺序即落盘顺序。 */
const FIELDS: Readonly<Record<keyof BookRulesInput, FieldSpec>> = {
  protagonist: { kind: 'protagonist', optional: true },
  genreLock: { kind: 'genreLock', optional: true },
  narrativePerson: { kind: 'trimmedString', optional: true },
  prohibitions: { kind: 'stringArray', optional: false },
  enableFullCastTracking: { kind: 'boolean', optional: false },
  fanficMode: { kind: 'trimmedString', optional: true },
  allowedDeviations: { kind: 'stringArray', optional: false },
}

const FIELD_NAMES = Object.keys(FIELDS) as Array<keyof BookRulesInput>

/** 字段名清单；schema 与校验器的键比对用。 */
export function bookRulesFieldNames(): ReadonlyArray<string> {
  return [...FIELD_NAMES]
}

const STRING: JsonSchema = { type: 'string' }
const STRING_ARRAY: JsonSchema = { type: 'array', items: STRING }
const OBJECT = (properties: Record<string, JsonSchema>, required: string[]): JsonSchema => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
})

const PROTAGONIST: JsonSchema = OBJECT(
  { name: STRING, personalityLock: STRING_ARRAY, behavioralConstraints: STRING_ARRAY },
  ['name', 'personalityLock', 'behavioralConstraints'],
)
const GENRE_LOCK: JsonSchema = OBJECT({ primary: STRING, forbidden: STRING_ARRAY }, ['primary', 'forbidden'])

/** 工具 schema 的 metadata 部分：与字段表同源，不含 version。 */
export function bookRulesDataSchema(): JsonSchema {
  const properties: Record<string, JsonSchema> = {}
  const required: string[] = []
  for (const name of FIELD_NAMES) {
    const spec = FIELDS[name]
    properties[name] = spec.kind === 'protagonist'
      ? PROTAGONIST
      : spec.kind === 'genreLock'
        ? GENRE_LOCK
        : spec.kind === 'stringArray'
          ? STRING_ARRAY
          : spec.kind === 'boolean'
            ? { type: 'boolean' }
            : STRING
    if (!spec.optional) required.push(name)
  }
  return OBJECT(properties, required)
}

/** 报错带文件与字段；作者手改之后能直接定位。 */
function fail(file: string, message: string): never {
  throw new Error(`${file}: ${message}`)
}

function record(value: unknown, file: string, where: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(file, `${where} 必须是对象`)
  }
  return value as Record<string, unknown>
}

function rawString(value: unknown, file: string, field: string): string {
  if (typeof value !== 'string') fail(file, `字段 ${field} 必须是字符串`)
  return value
}

function trimmedString(value: unknown, file: string, field: string): string {
  const text = rawString(value, file, field).trim()
  if (text === '') fail(file, `字段 ${field} 必须是非空字符串`)
  return text
}

function stringArray(value: unknown, file: string, field: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    fail(file, `字段 ${field} 必须是字符串数组`)
  }
  return [...value] as string[]
}

function objectFields(
  value: unknown,
  file: string,
  where: string,
  known: ReadonlyArray<string>,
  required: ReadonlyArray<string>,
): Record<string, unknown> {
  const source = record(value, file, where)
  for (const key of Object.keys(source)) {
    if (!known.includes(key)) fail(file, `${where} 里的未知字段 ${JSON.stringify(key)}`)
  }
  for (const key of required) {
    if (!Object.hasOwn(source, key)) fail(file, `${where} 缺少字段 ${JSON.stringify(key)}`)
  }
  return source
}

/**
 * 严格解析 book_rules（含 version）。
 * @param value 读取或写入前的对象
 * @param file 报错里点名的文件
 * @returns 规范化后的规则
 */
export function parseBookRules(value: unknown, file: string = BOOK_RULES_JSON): BookRules {
  const source = record(value, file, '顶层')
  for (const key of Object.keys(source)) {
    if (key !== 'version' && !(FIELD_NAMES as ReadonlyArray<string>).includes(key)) {
      fail(file, `未知字段 ${JSON.stringify(key)}`)
    }
  }
  if (source.version !== '2') {
    fail(file, `字段 version 必须是 "2"，实际是 ${JSON.stringify(source.version)}`)
  }

  const rules: BookRules = {
    version: '2',
    prohibitions: [],
    enableFullCastTracking: false,
    allowedDeviations: [],
  }
  for (const name of FIELD_NAMES) {
    if (!Object.hasOwn(source, name)) {
      if (FIELDS[name].optional) continue
      fail(file, `缺少字段 ${JSON.stringify(name)}`)
    }
    const value = source[name]
    switch (FIELDS[name].kind) {
      case 'protagonist': {
        const inner = objectFields(value, file, 'protagonist', ['name', 'personalityLock', 'behavioralConstraints'], ['name', 'personalityLock', 'behavioralConstraints'])
        rules.protagonist = {
          name: rawString(inner.name, file, 'protagonist.name'),
          personalityLock: stringArray(inner.personalityLock, file, 'protagonist.personalityLock'),
          behavioralConstraints: stringArray(inner.behavioralConstraints, file, 'protagonist.behavioralConstraints'),
        }
        break
      }
      case 'genreLock': {
        const inner = objectFields(value, file, 'genreLock', ['primary', 'forbidden'], ['primary', 'forbidden'])
        rules.genreLock = {
          primary: rawString(inner.primary, file, 'genreLock.primary'),
          forbidden: stringArray(inner.forbidden, file, 'genreLock.forbidden'),
        }
        break
      }
      case 'trimmedString':
        if (name === 'narrativePerson') rules.narrativePerson = trimmedString(value, file, name)
        else rules.fanficMode = trimmedString(value, file, name)
        break
      case 'stringArray':
        if (name === 'prohibitions') rules.prohibitions = stringArray(value, file, name)
        else rules.allowedDeviations = stringArray(value, file, name)
        break
      case 'boolean':
        if (typeof value !== 'boolean') fail(file, `字段 ${name} 必须是布尔`)
        rules.enableFullCastTracking = value
        break
      case 'string':
        fail(file, `字段 ${name} 没有对应的校验分支`)
        break
    }
  }
  // 落盘顺序固定：version 在前，其余按字段表；可选字段缺省时不出现。
  return {
    version: '2',
    ...(rules.protagonist === undefined ? {} : { protagonist: rules.protagonist }),
    ...(rules.genreLock === undefined ? {} : { genreLock: rules.genreLock }),
    ...(rules.narrativePerson === undefined ? {} : { narrativePerson: rules.narrativePerson }),
    prohibitions: rules.prohibitions,
    enableFullCastTracking: rules.enableFullCastTracking,
    ...(rules.fanficMode === undefined ? {} : { fanficMode: rules.fanficMode }),
    allowedDeviations: rules.allowedDeviations,
  }
}

/**
 * 写路径用：补上版本再校验。模型不提供 version（与源工程一致）。
 * @param input 模型给出的规则
 * @returns 合法的落盘对象
 */
export function withVersion(input: BookRulesInput): BookRules {
  return parseBookRules({ version: '2', ...input })
}

/**
 * 读 `source/story/book_rules.md` 与 `.json`。
 * @param root 作品根
 * @returns 规则与散文正文（已去首尾空白）
 */
export async function readBookRules(root: string): Promise<{ rules: BookRules, body: string }> {
  const base = join(root)
  let markdown: string
  let json: string
  try {
    [markdown, json] = await Promise.all([
      readFile(join(base, BOOK_RULES_MD), 'utf8'),
      readFile(join(base, BOOK_RULES_JSON), 'utf8'),
    ])
  } catch (error) {
    const path = (error as NodeJS.ErrnoException).path ?? ''
    const missing = path.includes('book_rules.md') ? BOOK_RULES_MD : BOOK_RULES_JSON
    fail(missing, `读不出来（${(error as Error).message}）`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (error) {
    fail(BOOK_RULES_JSON, `不是合法 JSON（${(error as Error).message}）`)
  }
  return { rules: parseBookRules(parsed, BOOK_RULES_JSON), body: markdown.trim() }
}
