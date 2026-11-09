/**
 * 产物 manifest 与 revision：artifactId/revision、checksum、current/promote。
 *
 * manifest 是 `source/artifacts/manifest.json` 的可重建索引；章节 revision 的 path
 * 直接指向 `source/chapters/...`，不复制正文。
 */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { commitFoundation } from './commit.js'
import { readWork } from './work.js'

export const MANIFEST_PATH = 'source/artifacts/manifest.json'

export interface ArtifactRevision {
  id: string
  parentRevisionId: string | null
  path: string
  snapshotPath?: string
  contentType: string
  status: 'candidate' | 'current' | 'superseded'
  checksum: string
  byteLength: number
  episodeId?: string
  createdAt: string
}

export interface ArtifactManifest {
  id: string
  kind: string
  currentRevisionId: string | null
  revisions: ArtifactRevision[]
  metadata: Record<string, unknown>
}

export interface ArtifactStore {
  version: 1
  workId: string
  artifacts: ArtifactManifest[]
}

const UNSAFE_ID = /[\u0000-\u001f\u007f/\\:*?"'`{}<>|]/u

export function assertWorkResourceId(value: string): string {
  if (value.length < 1 || value.length > 120 || value.trim() !== value || value === '.' || value === '..' || value.includes('..') || UNSAFE_ID.test(value)) {
    throw new Error(`非法的资源 id：${value}`)
  }
  return value
}

export function assertHarnessId(value: string): string {
  if (!/^[a-z0-9][a-z0-9._-]*$/iu.test(value) || value.length > 128) throw new Error(`非法的 revision id：${value}`)
  return value
}

function assertRelativePath(value: string): string {
  const normalized = value.replaceAll('\\', '/')
  if (normalized.startsWith('/') || /^[a-z]:\//iu.test(normalized) || normalized.split('/').includes('..')) {
    throw new Error(`产物路径必须留在作品内：${value}`)
  }
  return normalized
}

function checksum(bytes: Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

function assertManifest(manifest: ArtifactStore): ArtifactStore {
  for (const artifact of manifest.artifacts) {
    assertWorkResourceId(artifact.id)
    assertHarnessId(artifact.kind)
    const ids = new Set(artifact.revisions.map((revision) => revision.id))
    const current = artifact.revisions.filter((revision) => revision.status === 'current')
    if (current.length > 1) throw new Error(`artifact ${artifact.id} 有多个 current revision`)
    if (artifact.currentRevisionId !== null && !ids.has(artifact.currentRevisionId)) {
      throw new Error(`artifact ${artifact.id} 的 currentRevisionId 不存在`)
    }
    if (artifact.currentRevisionId === null && current.length > 0) throw new Error(`artifact ${artifact.id} 缺少 currentRevisionId`)
    if (artifact.currentRevisionId !== null && current[0]?.id !== artifact.currentRevisionId) {
      throw new Error(`artifact ${artifact.id} 的 currentRevisionId 与 current 不一致`)
    }
  }
  return manifest
}

async function workIdOf(root: string): Promise<string> {
  const work = await readWork(root)
  return work?.id === undefined ? 'work' : assertWorkResourceId(work.id)
}

export async function loadArtifactStore(root: string): Promise<ArtifactStore> {
  const workId = await workIdOf(root)
  let raw: string
  try {
    raw = await readFile(join(root, MANIFEST_PATH), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, workId, artifacts: [] }
    throw error
  }
  const parsed = JSON.parse(raw) as ArtifactStore
  if (parsed.version !== 1 || parsed.workId !== workId || !Array.isArray(parsed.artifacts)) {
    throw new Error('artifact manifest 的版本或 workId 不匹配')
  }
  return assertManifest(parsed)
}

function manifestContent(store: ArtifactStore): string {
  return `${JSON.stringify(assertManifest(store), null, 2)}\n`
}

function baseArtifact(input: { kind: string, path: string, content: Buffer, createdAt: string, parentRevisionId: string | null, current: boolean, revisionId: string, snapshotPath?: string, episodeId?: string }): ArtifactRevision {
  return {
    id: assertHarnessId(input.revisionId),
    parentRevisionId: input.parentRevisionId,
    path: assertRelativePath(input.path),
    ...(input.snapshotPath === undefined ? {} : { snapshotPath: assertRelativePath(input.snapshotPath) }),
    contentType: 'text/markdown',
    status: input.current ? 'current' : 'candidate',
    checksum: checksum(input.content),
    byteLength: input.content.byteLength,
    ...(input.episodeId === undefined ? {} : { episodeId: input.episodeId }),
    createdAt: input.createdAt,
  }
}

/** 为章节写一个 current revision 的 manifest 写入；章节正文本身由调用方同批写入。 */
export async function chapterArtifactWrite(
  root: string,
  input: { chapter: number, chapterPath: string, content: string, createdAt?: string },
): Promise<{ relativePath: string, content: string, artifact: ArtifactManifest }> {
  const store = await loadArtifactStore(root)
  const artifactId = `chapter-${String(input.chapter).padStart(4, '0')}`
  const existing = store.artifacts.find((artifact) => artifact.id === artifactId)
  const revision = baseArtifact({
    revisionId: 'r1',
    kind: 'chapter',
    path: input.chapterPath,
    content: Buffer.from(input.content),
    createdAt: input.createdAt ?? new Date().toISOString(),
    parentRevisionId: existing?.currentRevisionId ?? null,
    current: true,
  })
  const artifact: ArtifactManifest = {
    id: artifactId,
    kind: 'chapter',
    currentRevisionId: revision.id,
    revisions: [
      ...(existing?.revisions.map((item) => item.status === 'current' ? { ...item, status: 'superseded' as const } : item) ?? []),
      revision,
    ],
    metadata: { chapter: input.chapter, chapterPath: input.chapterPath },
  }
  const next: ArtifactStore = {
    ...store,
    artifacts: existing === undefined
      ? [...store.artifacts, artifact]
      : store.artifacts.map((item) => item.id === artifactId ? artifact : item),
  }
  return { relativePath: MANIFEST_PATH, content: manifestContent(next), artifact }
}

/** 通用 artifact revision：写 revision 文件与 manifest。 */
export async function stageArtifactRevision(
  root: string,
  input: { artifactId: string, kind: string, revisionId: string, content: string | Uint8Array, fileName: string, promote?: boolean, episodeId?: string, createdAt?: string },
): Promise<ArtifactRevision> {
  const store = await loadArtifactStore(root)
  const artifactId = assertWorkResourceId(input.artifactId)
  const revisionId = assertHarnessId(input.revisionId)
  const extension = /(\.[a-z0-9._-]+)$/iu.exec(input.fileName)?.[1]
  if (extension === undefined) throw new Error(`artifact revision 文件名缺少安全扩展名：${input.fileName}`)
  const bytes = Buffer.from(input.content)
  const path = `source/artifacts/${artifactId}/revisions/${revisionId}${extension.toLowerCase()}`
  const existing = store.artifacts.find((artifact) => artifact.id === artifactId)
  const revision = baseArtifact({
    revisionId,
    kind: input.kind,
    path,
    content: bytes,
    createdAt: input.createdAt ?? new Date().toISOString(),
    parentRevisionId: existing?.currentRevisionId ?? null,
    current: input.promote === true,
    ...(input.episodeId === undefined ? {} : { episodeId: input.episodeId }),
  })
  const artifact: ArtifactManifest = {
    id: artifactId,
    kind: input.kind,
    currentRevisionId: input.promote === true ? revisionId : existing?.currentRevisionId ?? null,
    revisions: [
      ...(existing?.revisions.map((item) => input.promote === true && item.status === 'current' ? { ...item, status: 'superseded' as const } : item) ?? []),
      revision,
    ],
    metadata: existing?.metadata ?? {},
  }
  const next: ArtifactStore = {
    ...store,
    artifacts: existing === undefined
      ? [...store.artifacts, artifact]
      : store.artifacts.map((item) => item.id === artifactId ? artifact : item),
  }
  await commitFoundation(root, {
    writes: [
      { relativePath: path, content: bytes.toString('utf8') },
      { relativePath: MANIFEST_PATH, content: manifestContent(next) },
    ],
  })
  return revision
}

/** 只切 current；revision 必须已存在。 */
export async function promoteArtifactRevision(root: string, input: { artifactId: string, revisionId: string }): Promise<ArtifactManifest> {
  const store = await loadArtifactStore(root)
  const artifactId = assertWorkResourceId(input.artifactId)
  const revisionId = assertHarnessId(input.revisionId)
  const artifact = store.artifacts.find((item) => item.id === artifactId)
  if (artifact === undefined) throw new Error(`未知 artifact：${artifactId}`)
  if (!artifact.revisions.some((revision) => revision.id === revisionId)) throw new Error(`未知 revision：${artifactId}.${revisionId}`)
  const nextArtifact: ArtifactManifest = {
    ...artifact,
    currentRevisionId: revisionId,
    revisions: artifact.revisions.map((revision) => revision.id === revisionId
      ? { ...revision, status: 'current' as const }
      : revision.status === 'current' ? { ...revision, status: 'superseded' as const } : revision),
  }
  const next: ArtifactStore = { ...store, artifacts: store.artifacts.map((item) => item.id === artifactId ? nextArtifact : item) }
  await commitFoundation(root, { writes: [{ relativePath: MANIFEST_PATH, content: manifestContent(next) }] })
  return nextArtifact
}

export async function readArtifactRevision(
  root: string,
  input: { artifactId: string, revisionId: string },
): Promise<{ revision: ArtifactRevision, bytes: Buffer }> {
  const store = await loadArtifactStore(root)
  const artifact = store.artifacts.find((item) => item.id === assertWorkResourceId(input.artifactId))
  if (artifact === undefined) throw new Error(`未知 artifact：${input.artifactId}`)
  const revision = artifact.revisions.find((item) => item.id === assertHarnessId(input.revisionId))
  if (revision === undefined) throw new Error(`未知 revision：${input.artifactId}.${input.revisionId}`)
  return { revision, bytes: await readFile(join(root, assertRelativePath(revision.path))) }
}

/** 找当前章 current revision；没有返回 null。 */
export async function currentChapterArtifact(
  root: string,
  chapter: number,
): Promise<{ workId: string, artifact: ArtifactManifest, revision: ArtifactRevision } | null> {
  const store = await loadArtifactStore(root)
  const prefix = `source/chapters/${String(chapter).padStart(4, '0')}_`
  const artifact = store.artifacts.find((item) => item.revisions.some((revision) => (
    revision.id === item.currentRevisionId && revision.path.startsWith(prefix) && revision.path.endsWith('.md')
  )))
  if (artifact === undefined || artifact.currentRevisionId === null) return null
  const revision = artifact.revisions.find((item) => item.id === artifact.currentRevisionId)
  if (revision === undefined) return null
  return { workId: store.workId, artifact, revision }
}
