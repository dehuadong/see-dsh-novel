/**
 * book_rules 契约：`version: "2"` 的严格形状与读取入口。
 *
 * 字段表同时驱动校验与工具 schema；未知字段拒绝。`protagonist`／`genreLock`
 * 是可选严格对象，`narrativePerson`／`fanficMode` 写入时去首尾空白且空白即拒绝，
 * 其余字符串与数组是裸类型（空串与空数组合法）。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { JsonSchema } from '../../core/types.js'

import { STORY_RULES_JSON, STORY_RULES_MD } from '../../core/story-paths.js'

/** 两个文件的位置；写入方与读取方共用。 */
export const BOOK_RULES_MD = STORY_RULES_MD
export const BOOK_RULES_JSON = STORY_RULES_JSON

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

const STRING: JsonSchema = { type: 'string' }
const STRING_ARRAY: JsonSchema = { type: 'array', items: STRING }
const OBJECT = (properties: Record<string, JsonSchema>, required: string[]): JsonSchema => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
})

/** 报错带文件与字段；作者手改之后能直接定位。 */
function fail(file: string, message: string): never {
  throw new Error(`${file}: ${message}`)
}

function record(value: unknown, file: string, where: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(file, `${where} 必须是对象`)
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

/** 嵌套对象的一组字段；schema 与校验共用。 */
interface NestedField {
  schema: JsonSchema
  /** 必填与否；schema 的 required 与校验的缺字段检查都从这里推。 */
  required: boolean
  read(value: unknown, file: string, where: string): unknown
}

/** 严格对象：只接受已知字段、必填项齐全。 */
function nestedObject(
  fields: Readonly<Record<string, NestedField>>,
): { schema: JsonSchema, read(value: unknown, file: string, where: string): Record<string, unknown> } {
  const properties: Record<string, JsonSchema> = {}
  const required: string[] = []
  for (const [name, field] of Object.entries(fields)) {
    properties[name] = field.schema
    if (field.required) required.push(name)
  }
  return {
    schema: OBJECT(properties, required),
    read(value, file, where) {
      const source = record(value, file, where)
      for (const key of Object.keys(source)) {
        if (!Object.hasOwn(fields, key)) fail(file, `${where} 里的未知字段 ${JSON.stringify(key)}`)
      }
      for (const key of required) {
        if (!Object.hasOwn(source, key)) fail(file, `${where} 缺少字段 ${JSON.stringify(key)}`)
      }
      const parsed: Record<string, unknown> = {}
      for (const [name, field] of Object.entries(fields)) {
        if (!Object.hasOwn(source, name)) continue
        parsed[name] = field.read(source[name], file, `${where}.${name}`)
      }
      return parsed
    },
  }
}

const PROTAGONIST = nestedObject({
  name: { schema: STRING, required: true, read: (value, file) => rawString(value, file, 'protagonist.name') },
  personalityLock: { schema: STRING_ARRAY, required: true, read: (value, file) => stringArray(value, file, 'protagonist.personalityLock') },
  behavioralConstraints: { schema: STRING_ARRAY, required: true, read: (value, file) => stringArray(value, file, 'protagonist.behavioralConstraints') },
})

const GENRE_LOCK = nestedObject({
  primary: { schema: STRING, required: true, read: (value, file) => rawString(value, file, 'genreLock.primary') },
  forbidden: { schema: STRING_ARRAY, required: true, read: (value, file) => stringArray(value, file, 'genreLock.forbidden') },
})

/** 顶层字段；schema 与校验共用这一张表。 */
interface FieldSpec {
  optional: boolean
  schema: JsonSchema
  read(value: unknown, file: string): unknown
}

const FIELDS: Readonly<Record<keyof BookRulesInput, FieldSpec>> = {
  protagonist: { optional: true, schema: PROTAGONIST.schema, read: (value, file) => PROTAGONIST.read(value, file, 'protagonist') },
  genreLock: { optional: true, schema: GENRE_LOCK.schema, read: (value, file) => GENRE_LOCK.read(value, file, 'genreLock') },
  narrativePerson: {
    optional: true,
    schema: { type: 'string', description: '作者自己的表述，不做枚举' },
    read: (value, file) => trimmedString(value, file, 'narrativePerson'),
  },
  prohibitions: { optional: false, schema: STRING_ARRAY, read: (value, file) => stringArray(value, file, 'prohibitions') },
  enableFullCastTracking: {
    optional: false,
    schema: { type: 'boolean' },
    read: (value, file) => {
      if (typeof value !== 'boolean') fail(file, '字段 enableFullCastTracking 必须是布尔')
      return value
    },
  },
  fanficMode: { optional: true, schema: STRING, read: (value, file) => trimmedString(value, file, 'fanficMode') },
  allowedDeviations: { optional: false, schema: STRING_ARRAY, read: (value, file) => stringArray(value, file, 'allowedDeviations') },
}

const FIELD_NAMES = Object.keys(FIELDS) as Array<keyof BookRulesInput>

/** 字段名清单；schema 与校验器的键比对用。 */
export function bookRulesFieldNames(): ReadonlyArray<string> {
  return [...FIELD_NAMES]
}

/** 工具 schema 的 metadata 部分：与字段表同源，不含 version。 */
export function bookRulesDataSchema(): JsonSchema {
  const properties: Record<string, JsonSchema> = {}
  const required: string[] = []
  for (const name of FIELD_NAMES) {
    properties[name] = FIELDS[name].schema
    if (!FIELDS[name].optional) required.push(name)
  }
  return OBJECT(properties, required)
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

  const rules: Record<string, unknown> = { version: '2' }
  for (const name of FIELD_NAMES) {
    const value = source[name]
    if (!Object.hasOwn(source, name)) {
      if (FIELDS[name].optional) continue
      fail(file, `缺少字段 ${JSON.stringify(name)}`)
    }
    rules[name] = FIELDS[name].read(value, file)
  }
  // 装配后的自检：必填字段齐全、已写入的值仍能通过同一份字段表。
  // 类型系统看不到运行时的键值对应，这一步让「读函数返回错类型」当场失败。
  for (const name of FIELD_NAMES) {
    if (!Object.hasOwn(rules, name)) {
      if (FIELDS[name].optional) continue
      fail(file, `内部错误：缺少字段 ${name}`)
    }
    FIELDS[name].read(rules[name], file)
  }
  return rules as unknown as BookRules
}

/** book rules 的两份落盘写入项；md 内容由调用方给，JSON 带版本。 */
export function bookRulesWrites(content: string, rules: BookRules): Array<{ relativePath: string, content: string }> {
  return [
    { relativePath: BOOK_RULES_MD, content },
    { relativePath: BOOK_RULES_JSON, content: `${JSON.stringify(rules, null, 2)}\n` },
  ]
}

/**
 * 写路径用：补上版本再校验。模型不提供 version。
 * @param input 模型给出的规则
 * @returns 合法的落盘对象
 */
export function withVersion(input: BookRulesInput): BookRules {
  return parseBookRules({ version: '2', ...input })
}

/** 读一个文件；读不出来时点名它自己的路径。 */
async function readText(root: string, relativePath: string): Promise<string> {
  try {
    return await readFile(join(root, relativePath), 'utf8')
  } catch (error) {
    fail(relativePath, `读不出来（${(error as Error).message}）`)
  }
}

/**
 * 读 `source/story/book_rules.md` 与 `.json`。
 * @param root 作品根
 * @returns 规则与散文正文（已去首尾空白）
 */
export async function readBookRules(root: string): Promise<{ rules: BookRules, body: string }> {
  const [markdown, json] = await Promise.all([
    readText(root, BOOK_RULES_MD),
    readText(root, BOOK_RULES_JSON),
  ])
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (error) {
    fail(BOOK_RULES_JSON, `不是合法 JSON（${(error as Error).message}）`)
  }
  return { rules: parseBookRules(parsed, BOOK_RULES_JSON), body: markdown.trim() }
}
