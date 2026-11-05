/**
 * 作品身份文件 `work.json`：解析、校验、读写与探针。
 *
 * 一个工作区一部作品，文件在根目录（与 `source/` 同级）。解析严格：未知字段、
 * 版本不符、类型不对都报错，并指出文件与字段——身份错了宁可炸，也不要静默
 * 补默认值，让「未立项」和「设定写了一半」混在一起。
 */
import { readFile, readdir } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

import { commitFile, pathExists } from './commit.js'

import {
  ROLE_TIER_DIRS,
  STORY_FRAME_FILE,
  STORY_PENDING_HOOKS,
  STORY_RULES_JSON,
  STORY_RULES_MD,
  STORY_VOLUME_MAP_FILE,
  WORK_FILE,
} from './story-paths.js'

export {
  ROLE_TIER_DIRS,
  STORY_FRAME_FILE,
  STORY_PENDING_HOOKS,
  STORY_RULES_JSON,
  STORY_RULES_MD,
  STORY_VOLUME_MAP_FILE,
  WORK_FILE,
}

/** 清单版本；升级结构时递增，旧版本一律拒绝。 */
export const WORK_VERSION = 1

/** 作品类型；v1 只有长篇，将来由它选择管线。 */
export const WORK_PROFILES = ['longform-novel'] as const
/** 作品语言。 */
export const WORK_LANGUAGES = ['zh', 'en'] as const
/** 作品状态；立项即 `draft`，推进留给章节定稿与导出的行。 */
export const WORK_STATUSES = ['draft', 'active', 'archived'] as const

export type WorkProfile = (typeof WORK_PROFILES)[number]
export type WorkLanguage = (typeof WORK_LANGUAGES)[number]
export type WorkStatus = (typeof WORK_STATUSES)[number]

/** 立项时作者给出的目标规模与分类；都可选。 */
export interface WorkMetadata {
  targetChapters?: number
  chapterWordCount?: number
  /** 题材，例如「都市悬疑」；自由字符串。 */
  genre?: string
  /** 目标平台，原样保存。 */
  platform?: string
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

/** `story_next` 用的七项探针；不看内容，只看在不在。 */
export interface FoundationProbes {
  hasWork: boolean
  hasFrame: boolean
  hasVolumeMap: boolean
  hasRulesMd: boolean
  hasRulesJson: boolean
  hasPendingHooks: boolean
  hasRoleCard: boolean
}

/** 立项输入：标题必填，其余可省。 */
export interface WorkCreateInput {
  title: unknown
  language?: unknown
  targetChapters?: unknown
  chapterWordCount?: unknown
  genre?: unknown
  platform?: unknown
}

const FIELDS = [
  'version', 'id', 'title', 'profile', 'language', 'status', 'metadata', 'createdAt', 'updatedAt',
] as const
const METADATA_FIELDS = ['targetChapters', 'chapterWordCount', 'genre', 'platform'] as const

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
  if (Object.hasOwn(metadata, 'genre')) {
    parsedMetadata.genre = text(metadata.genre, file, 'metadata.genre')
  }
  if (Object.hasOwn(metadata, 'platform')) {
    parsedMetadata.platform = text(metadata.platform, file, 'metadata.platform')
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

/** 七项探针：身份、大纲两份、book rules 两份、伏笔池、至少一张角色卡。 */
export async function workProbes(root: string): Promise<FoundationProbes> {
  const base = resolve(root)
  const [hasWork, hasFrame, hasVolumeMap, hasRulesMd, hasRulesJson, hasPendingHooks] = await Promise.all([
    pathExists(join(base, WORK_FILE)),
    pathExists(join(base, STORY_FRAME_FILE)),
    pathExists(join(base, STORY_VOLUME_MAP_FILE)),
    pathExists(join(base, STORY_RULES_MD)),
    pathExists(join(base, STORY_RULES_JSON)),
    pathExists(join(base, STORY_PENDING_HOOKS)),
  ])
  // 必需文件缺一份就先返回：不因为角色目录读不了而把整次探针变成错误。
  const hasRoleCard = hasWork && hasFrame && hasVolumeMap && hasRulesMd && hasRulesJson && hasPendingHooks
    ? await roleCardExists(base)
    : false
  return { hasWork, hasFrame, hasVolumeMap, hasRulesMd, hasRulesJson, hasPendingHooks, hasRoleCard }
}

/** 四个角色目录任一有 .md；目录不存在按空处理。 */
async function roleCardExists(base: string): Promise<boolean> {
  for (const tier of ROLE_TIER_DIRS) {
    let entries: string[]
    try {
      entries = await readdir(join(base, tier))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    if (entries.some((entry) => entry.endsWith('.md'))) return true
  }
  return false
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
  if (input.genre !== undefined) metadata.genre = text(input.genre, path, 'genre')
  if (input.platform !== undefined) metadata.platform = text(input.platform, path, 'platform')
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
 * 标题按作者写的样子加书名号：已经带书名号的不再包第二层。
 * 卡片与身份摘要共用这一条规则。
 * @param title 原始标题
 * @returns 带书名号的标题
 */
export function bracketedTitle(title: string): string {
  return title.startsWith('《') && title.endsWith('》') ? title : `《${title}》`
}

/**
 * 身份的一句话描述；工具卡片、命令回执与测试共用。
 *
 * 标题可能已经带书名号（命令输入按原样保存），这时不再包第二层。
 * @param work 身份对象
 * @returns 形如 `《标题》：profile，language，status（目标 N 章，单章 M 字，题材，平台）`；可选字段缺省时不出现
 */
export function describeWork(work: Work): string {
  const scope = [
    work.metadata.targetChapters === undefined ? '' : `目标 ${work.metadata.targetChapters} 章`,
    work.metadata.chapterWordCount === undefined ? '' : `单章 ${work.metadata.chapterWordCount} 字`,
    work.metadata.genre === undefined ? '' : work.metadata.genre,
    work.metadata.platform === undefined ? '' : work.metadata.platform,
  ].filter((part) => part !== '').join('，')
  const title = bracketedTitle(work.title)
  return `${title}：${work.profile}，${work.language}，${work.status}${scope === '' ? '' : `（${scope}）`}`
}
