/**
 * 上下文选择与压缩的 task spool：候选正文写 runtime 文件，主模型只拿句柄。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { commitFoundation } from './commit.js'
import { estimateTokens } from './context-package.js'
import type { Candidate, CompressionTask, ContextPurpose, SelectionTask } from './context-package.js'
import { STORY_ROOT } from './story-paths.js'

const RUNTIME_DIR = `${STORY_ROOT}/runtime`
const pad = (chapter: number): string => String(chapter).padStart(4, '0')

export interface SelectionTaskHandle {
  taskId: string
  kind: SelectionTask['kind']
  file?: string
  candidateCount: number
  estimatedTokens: number
}

export interface SelectionManifest {
  version: 1
  chapter: number
  purpose: ContextPurpose
  tasks: SelectionTaskHandle[]
}

export interface SelectionSpool {
  manifest: SelectionManifest
  tasks: SelectionTask[]
}

export interface CompressionChunkHandle {
  chunkId: string
  maxTokens: number
  tokenCount: number
  file: string
}

export interface CompressionTaskSummary {
  chapter: number
  goal: string
  language: 'zh' | 'en'
  maxInputTokens: number
  chunks: CompressionChunkHandle[]
}

interface StoredTask extends SelectionTask {
  version: 1
  chapter: number
  purpose: ContextPurpose
  taskId: string
}

interface StoredChunk {
  version: 1
  chapter: number
  purpose: ContextPurpose
  chunkId: string
  instruction: string
  maxTokens: number
}

export function selectionManifestPath(chapter: number, purpose: ContextPurpose): string {
  return `${RUNTIME_DIR}/chapter-${pad(chapter)}.${purpose}.tasks.json`
}

export function selectionTaskPath(chapter: number, purpose: ContextPurpose, taskId: string): string {
  return `${RUNTIME_DIR}/chapter-${pad(chapter)}.${purpose}.${taskId}.json`
}

export function compressionManifestPath(chapter: number, purpose: ContextPurpose): string {
  return `${RUNTIME_DIR}/chapter-${pad(chapter)}.${purpose}.compress.json`
}

export function compressionChunkPath(chapter: number, purpose: ContextPurpose, chunkId: string): string {
  return `${RUNTIME_DIR}/chapter-${pad(chapter)}.${purpose}.${chunkId}.json`
}

function candidateTokens(candidate: Candidate): number {
  return estimateTokens([candidate.selectionId, candidate.kind, candidate.source, candidate.title, candidate.excerpt].join('\n'))
}

/** 写 candidates 的任务文件与 manifest；返回给主模型的句柄。 */
export async function saveSelectionSpool(
  root: string,
  chapter: number,
  purpose: ContextPurpose,
  tasks: ReadonlyArray<SelectionTask>,
): Promise<SelectionTaskHandle[]> {
  const handles: SelectionTaskHandle[] = []
  const writes: Array<{ relativePath: string, content: string }> = []
  tasks.forEach((task, index) => {
    const taskId = `task-${index + 1}`
    const stored: StoredTask = {
      version: 1,
      chapter,
      purpose,
      taskId,
      kind: task.kind,
      ...(task.file === undefined ? {} : { file: task.file }),
      instruction: task.instruction,
      candidates: task.candidates,
    }
    const estimatedTokens = task.candidates.reduce((sum, candidate) => sum + candidateTokens(candidate), 0)
    handles.push({
      taskId,
      kind: task.kind,
      ...(task.file === undefined ? {} : { file: task.file }),
      candidateCount: task.candidates.length,
      estimatedTokens,
    })
    writes.push({ relativePath: selectionTaskPath(chapter, purpose, taskId), content: `${JSON.stringify(stored, null, 2)}\n` })
  })
  const manifest: SelectionManifest = { version: 1, chapter, purpose, tasks: handles }
  writes.push({ relativePath: selectionManifestPath(chapter, purpose), content: `${JSON.stringify(manifest, null, 2)}\n` })
  await commitFoundation(root, { writes })
  return handles
}

export async function loadSelectionSpool(
  root: string,
  chapter: number,
  purpose: ContextPurpose,
): Promise<SelectionSpool> {
  const manifest = JSON.parse(await readFile(join(root, selectionManifestPath(chapter, purpose)), 'utf8')) as SelectionManifest
  if (manifest.version !== 1 || manifest.chapter !== chapter || manifest.purpose !== purpose || !Array.isArray(manifest.tasks)) {
    throw new Error('候选 spool 的版本、章号或 purpose 不匹配')
  }
  const tasks: SelectionTask[] = []
  for (const handle of manifest.tasks) {
    const stored = JSON.parse(await readFile(join(root, selectionTaskPath(chapter, purpose, handle.taskId)), 'utf8')) as StoredTask
    if (stored.version !== 1 || stored.chapter !== chapter || stored.purpose !== purpose || stored.taskId !== handle.taskId) {
      throw new Error(`候选任务 ${handle.taskId} 的元数据不匹配`)
    }
    tasks.push({ kind: stored.kind, ...(stored.file === undefined ? {} : { file: stored.file }), instruction: stored.instruction, candidates: stored.candidates })
  }
  return { manifest, tasks }
}

export async function loadSelectionTask(
  root: string,
  chapter: number,
  purpose: ContextPurpose,
  taskId: string,
): Promise<SelectionTask> {
  const stored = JSON.parse(await readFile(join(root, selectionTaskPath(chapter, purpose, taskId)), 'utf8')) as StoredTask
  if (stored.version !== 1 || stored.chapter !== chapter || stored.purpose !== purpose || stored.taskId !== taskId) {
    throw new Error(`候选任务 ${taskId} 的元数据不匹配`)
  }
  return { kind: stored.kind, ...(stored.file === undefined ? {} : { file: stored.file }), instruction: stored.instruction, candidates: stored.candidates }
}

/** 写压缩分块文件与 manifest；返回给主模型的句柄。 */
export async function saveCompressionSpool(
  root: string,
  chapter: number,
  purpose: ContextPurpose,
  task: CompressionTask,
): Promise<CompressionTaskSummary> {
  const chunks: CompressionChunkHandle[] = []
  const writes: Array<{ relativePath: string, content: string }> = []
  task.chunks.forEach((chunk, index) => {
    const chunkId = `compress-${index + 1}`
    const stored: StoredChunk = { version: 1, chapter, purpose, chunkId, instruction: chunk.instruction, maxTokens: chunk.maxTokens }
    const relativePath = compressionChunkPath(chapter, purpose, chunkId)
    chunks.push({
      chunkId,
      maxTokens: chunk.maxTokens,
      tokenCount: estimateTokens(chunk.instruction),
      file: relativePath,
    })
    writes.push({ relativePath, content: `${JSON.stringify(stored, null, 2)}\n` })
  })
  const summary: CompressionTaskSummary = {
    chapter: task.chapter,
    goal: task.goal,
    language: task.language,
    maxInputTokens: task.maxInputTokens,
    chunks,
  }
  writes.push({ relativePath: compressionManifestPath(chapter, purpose), content: `${JSON.stringify(summary, null, 2)}\n` })
  await commitFoundation(root, { writes })
  return summary
}

export async function loadCompressionChunk(
  root: string,
  chapter: number,
  purpose: ContextPurpose,
  chunkId: string,
): Promise<{ chunkId: string, instruction: string, maxTokens: number }> {
  const stored = JSON.parse(await readFile(join(root, compressionChunkPath(chapter, purpose, chunkId)), 'utf8')) as StoredChunk
  if (stored.version !== 1 || stored.chapter !== chapter || stored.purpose !== purpose || stored.chunkId !== chunkId) {
    throw new Error(`压缩分块 ${chunkId} 的元数据不匹配`)
  }
  return { chunkId, instruction: stored.instruction, maxTokens: stored.maxTokens }
}
