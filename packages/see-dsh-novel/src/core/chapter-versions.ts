/**
 * 章节历史版本：`chapters/.versions/<NNNN>/` 下的归档。
 *
 * id 形如 `<13 位时间戳>_<来源>_<uuid>`；修订工具已经按这个规则归档，恢复与
 * 列表都只认合法 id，不猜文件名。
 */
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

/** 版本来源；与归档命名保持一致。 */
export const CHAPTER_VERSION_SOURCES = ['manual', 'agent', 'revision', 'regeneration', 'restore'] as const

export type ChapterVersionSource = (typeof CHAPTER_VERSION_SOURCES)[number]

const VERSION_ID = /^(\d{13})_(manual|agent|revision|regeneration|restore)_([0-9a-f-]{36})$/u

export interface ChapterVersion {
  id: string
  chapter: number
  source: ChapterVersionSource
  createdAt: string
  characterCount: number
}

function pad(chapter: number): string {
  return String(chapter).padStart(4, '0')
}

/** 该章的版本目录，相对作品根。 */
export function chapterVersionsDir(chapter: number): string {
  return `source/chapters/.versions/${pad(chapter)}`
}

/** 校验版本 id；不合法直接抛错。 */
export function parseVersionId(versionId: string): { timestamp: number, source: ChapterVersionSource } {
  const match = VERSION_ID.exec(versionId)
  if (match === null) throw new Error(`版本 id 不合法：${versionId}`)
  const timestamp = Number.parseInt(match[1] as string, 10)
  if (!Number.isFinite(timestamp)) throw new Error(`版本 id 不合法：${versionId}`)
  return { timestamp, source: match[2] as ChapterVersionSource }
}

/**
 * 列出该章的归档版本，按创建时间倒序。
 * @param root 作品根目录
 * @param chapter 章号
 */
export async function listChapterVersions(root: string, chapter: number): Promise<ChapterVersion[]> {
  let files: string[]
  try {
    files = await readdir(join(root, chapterVersionsDir(chapter)))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const versions: ChapterVersion[] = []
  for (const file of files.sort()) {
    if (!file.endsWith('.md')) continue
    const id = file.slice(0, -3)
    let parsed: { timestamp: number, source: ChapterVersionSource }
    try {
      parsed = parseVersionId(id)
    } catch {
      continue
    }
    const content = await readFile(join(root, chapterVersionsDir(chapter), file), 'utf8')
    versions.push({
      id,
      chapter,
      source: parsed.source,
      createdAt: new Date(parsed.timestamp).toISOString(),
      characterCount: content.length,
    })
  }
  return versions.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
}

/**
 * 读一个归档版本的全文。
 * @param root 作品根目录
 * @param chapter 章号
 * @param versionId 版本 id
 */
export async function readChapterVersion(root: string, chapter: number, versionId: string): Promise<string> {
  parseVersionId(versionId)
  return readFile(join(root, chapterVersionsDir(chapter), `${versionId}.md`), 'utf8')
}
