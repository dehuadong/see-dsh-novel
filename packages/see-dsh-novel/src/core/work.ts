/**
 * 作品身份文件 `work.json`：解析、校验、读写与探针。
 *
 * 一个工作区一部作品，文件在根目录（与 `source/` 同级）。解析严格：未知字段、
 * 版本不符、类型不对都报错，并指出文件与字段——身份错了宁可炸，也不要静默
 * 补默认值，让「未立项」和「设定写了一半」混在一起。
 */
import { readFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

import { commitFile, pathExists } from './commit.js'

/** 身份文件名；与 `source/` 同级。 */
export const WORK_FILE = 'work.json'

/** 清单版本；升级结构时递增，旧版本一律拒绝。 */
export const WORK_VERSION = 1

/** 作品类型；v1 只有长篇，将来由它选择管线。 */
export const WORK_PROFILES = ['longform-novel'] as const
/** 作品语言。 */
export const WORK_LANGUAGES = ['zh', 'en'] as const
/** 作品状态；立项即 `draft`，推进留给章节定稿与导出的行。 */
export const WORK_STATUSES = ['draft', 'active', 'archived'] as const

/** 长篇基础设定阶段的探针：先看有没有大纲。 */
export const STORY_FRAME_FILE = 'source/story/outline/story_frame.md'
/** 基础设定完成的探针：状态清单存在。 */
export const STORY_STATE_FILE = 'source/story/state/manifest.json'

export type WorkProfile = (typeof WORK_PROFILES)[number]
export type WorkLanguage = (typeof WORK_LANGUAGES)[number]
export type WorkStatus = (typeof WORK_STATUSES)[number]

/** 立项时作者给出的目标规模；都可选。 */
export interface WorkMetadata {
  targetChapters?: number
  chapterWordCount?: number
}

/** 一部作品的身份。 */
export interface Work {
  version: number
  id: string
  title: string
  profile: WorkProfile
  language: WorkLanguage
  status: WorkStatus
  metadata: WorkMetadata
  createdAt: string
  updatedAt: string
}

/** `story_next` 用的三个探针；不看内容，只看在不在。 */
export interface WorkProbes {
  hasWork: boolean
  hasFrame: boolean
  hasState: boolean
}

/** 立项输入：标题必填，其余可省。 */
export interface WorkCreateInput {
  title: unknown
  language?: unknown
  targetChapters?: unknown
  chapterWordCount?: unknown
}

const FIELDS = [
  'version', 'id', 'title', 'profile', 'language', 'status', 'metadata', 'createdAt', 'updatedAt',
] as const
const METADATA_FIELDS = ['targetChapters', 'chapterWordCount'] as const

/** 报错一律带文件与字段，作者手改之后能直接定位。 */
function fail(file: string, message: string): never {
  throw new Error(`${file}: ${message}`)
}

function record(value: unknown, file: string, where: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(file, `${where} 必须是对象`)
  }
  return value as Record<string, unknown>
}

function text(value: unknown, file: string, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(file, `字段 ${field} 必须是非空字符串`)
  }
  return value.trim()
}

function oneOf(value: unknown, allowed: ReadonlyArray<string>, file: string, field: string): string {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    fail(file, `字段 ${field} 只能是 ${allowed.join('/')}，实际是 ${JSON.stringify(value)}`)
  }
  return value
}

function positiveInteger(value: unknown, file: string, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    fail(file, `字段 ${field} 必须是正整数，实际是 ${JSON.stringify(value)}`)
  }
  return value
}

function timestamp(value: unknown, file: string, field: string): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    fail(file, `字段 ${field} 必须是 ISO 时间戳，实际是 ${JSON.stringify(value)}`)
  }
  return value
}

/** 校验并返回身份对象；未知字段、版本不符、类型不对都报错。 */
export function parseWork(value: unknown, file: string = WORK_FILE): Work {
  const source = record(value, file, '顶层')
  for (const key of Object.keys(source)) {
    if (!FIELDS.includes(key as (typeof FIELDS)[number])) fail(file, `未知字段 ${JSON.stringify(key)}`)
  }
  if (source.version !== WORK_VERSION) {
    fail(file, `字段 version 必须是 ${WORK_VERSION}，实际是 ${JSON.stringify(source.version)}`)
  }
  const metadata = record(source.metadata, file, '字段 metadata')
  for (const key of Object.keys(metadata)) {
    if (!METADATA_FIELDS.includes(key as (typeof METADATA_FIELDS)[number])) {
      fail(file, `metadata 里的未知字段 ${JSON.stringify(key)}`)
    }
  }
  const parsedMetadata: WorkMetadata = {}
  if (Object.hasOwn(metadata, 'targetChapters')) {
    parsedMetadata.targetChapters = positiveInteger(metadata.targetChapters, file, 'metadata.targetChapters')
  }
  if (Object.hasOwn(metadata, 'chapterWordCount')) {
    parsedMetadata.chapterWordCount = positiveInteger(metadata.chapterWordCount, file, 'metadata.chapterWordCount')
  }
  return {
    version: WORK_VERSION,
    id: text(source.id, file, 'id'),
    title: text(source.title, file, 'title'),
    profile: oneOf(source.profile, WORK_PROFILES, file, 'profile') as WorkProfile,
    language: oneOf(source.language, WORK_LANGUAGES, file, 'language') as WorkLanguage,
    status: oneOf(source.status, WORK_STATUSES, file, 'status') as WorkStatus,
    metadata: parsedMetadata,
    createdAt: timestamp(source.createdAt, file, 'createdAt'),
    updatedAt: timestamp(source.updatedAt, file, 'updatedAt'),
  }
}

/** 读身份文件；没有就是 `null`，内容非法则抛错。 */
export async function readWork(root: string): Promise<Work | null> {
  const path = join(resolve(root), WORK_FILE)
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    fail(path, `不是合法 JSON（${(error as Error).message}）`)
  }
  return parseWork(parsed, path)
}

/** 三个探针：身份、大纲、状态清单在不在。 */
export async function workProbes(root: string): Promise<WorkProbes> {
  const base = resolve(root)
  return {
    hasWork: await pathExists(join(base, WORK_FILE)),
    hasFrame: await pathExists(join(base, STORY_FRAME_FILE)),
    hasState: await pathExists(join(base, STORY_STATE_FILE)),
  }
}

/**
 * 立项：校验输入后写 `work.json`；已经存在就报错，不覆盖。
 * @param root 工作区根（作品根）
 * @param input 作者给出的标题、语言与目标规模
 * @returns 落盘的身份对象
 */
export async function writeWork(root: string, input: WorkCreateInput): Promise<Work> {
  const base = resolve(root)
  const path = join(base, WORK_FILE)
  if (await pathExists(path)) {
    // 内容坏了先按字段报错：作者手改出错时，「已经不存在的字段」比「已存在」更有用。
    await readWork(base)
    fail(path, '已经存在，不覆盖；改身份请手改这一份文件')
  }

  const title = text(input.title, path, 'title')
  const language = oneOf(input.language ?? 'zh', WORK_LANGUAGES, path, 'language') as WorkLanguage
  const metadata: WorkMetadata = {}
  if (input.targetChapters !== undefined) {
    metadata.targetChapters = positiveInteger(input.targetChapters, path, 'targetChapters')
  }
  if (input.chapterWordCount !== undefined) {
    metadata.chapterWordCount = positiveInteger(input.chapterWordCount, path, 'chapterWordCount')
  }
  const now = new Date().toISOString()
  const work: Work = {
    version: WORK_VERSION,
    id: basename(base),
    title,
    profile: 'longform-novel',
    language,
    status: 'draft',
    metadata,
    createdAt: now,
    updatedAt: now,
  }
  await commitFile(base, WORK_FILE, `${JSON.stringify(work, null, 2)}\n`)
  return work
}

/**
 * 身份的一句话描述；工具卡片、命令回执与测试共用。
 *
 * 标题可能已经带书名号（命令输入按原样保存），这时不再包第二层：
 * 首尾都是书名号的标题按作者写的样子输出。
 * @param work 身份对象
 * @returns 形如 `《标题》：profile，language，status（目标 N 章）`
 */
export function describeWork(work: Work): string {
  const scope = [
    work.metadata.targetChapters === undefined ? '' : `目标 ${work.metadata.targetChapters} 章`,
    work.metadata.chapterWordCount === undefined ? '' : `单章 ${work.metadata.chapterWordCount} 字`,
  ].filter((part) => part !== '').join('，')
  const bracketed = work.title.startsWith('《') && work.title.endsWith('》')
  const title = bracketed ? work.title : `《${work.title}》`
  return `${title}：${work.profile}，${work.language}，${work.status}${scope === '' ? '' : `（${scope}）`}`
}
