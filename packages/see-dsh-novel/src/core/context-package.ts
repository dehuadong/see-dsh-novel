/**
 * 章前上下文：候选、选择指令与校验后的上下文包。
 *
 * 选择由模型通过原生 `subagent` 工具完成；宿主只提供候选与指令、校验返回的 id、
 * 组装 `ContextPackage` 与 `ChapterTrace`。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { searchStory } from './story-index.js'
import {
  AUTHOR_INTENT_FILE,
  CURRENT_FOCUS_FILE,
  STORY_FRAME_FILE,
  STORY_VOLUME_MAP_FILE,
} from './story-paths.js'

export type Protection = 'protected' | 'compressible'

export interface ContextSource {
  source: string
  reason: string
  excerpt?: string
  protection: Protection
}

export interface ContextPackage {
  chapter: number
  selectedContext: ContextSource[]
}

export interface ChapterTrace {
  chapter: number
  plannerInputs: string[]
  composerInputs: string[]
  selectedSources: string[]
  contextTiers: { protectedSources: string[], compressibleSources: string[] }
  tokenBudget: { protectedTokens: number, compressibleTokens: number, totalSelectedTokens: number }
  compression?: {
    compiledSource: string
    protectedSources: string[]
    compressedSources: string[]
    protectedTokens: number
    compressibleTokens: number
    budgetTokens: number
  }
  retrieval: {
    engine: 'sqlite-fts5-bm25'
    query: string
    selectionMode: 'semantic' | 'complete'
    candidates: Array<{ id: string, kind: string, source: string, score: number }>
    semanticSelectedIds: string[]
  }
  notes: string[]
}

export interface Candidate {
  id: string
  kind: string
  source: string
  title: string
  excerpt: string
  score: number
}

export interface Selection {
  memory: string[]
  role: string[]
  state: string[]
  outline: string[]
}

/** CJK 感知的 token 估算：CJK 逐字 1 token，拉丁词按 4 字符 1 token。 */
export function estimateTokens(text: string): number {
  const cjk = (text.match(/[\u3400-\u9FFF]/gu) ?? []).length
  const rest = text.replace(/[\u3400-\u9FFF]/gu, '')
  return cjk + Math.ceil(rest.length / 4)
}

/** composer 子代理的选择指令；主编把这段与候选一起交给 `subagent`。 */
export function buildComposerInstruction(chapter: number): string {
  return [
    `你是第 ${chapter} 章的上下文选择器。读候选列表，按四类各选真正需要的条目：`,
    '- memory：伏笔与章节摘要里，本章必须承接的承诺与事实；',
    '- role：本章会出场或必须遵守其设定的角色卡；',
    '- state：与本章冲突相关的当前事实；',
    '- outline：本章所属分卷与相邻章节的章纲。',
    '只允许返回候选列表里出现的 id。只返回一个 JSON 对象：',
    '{"memory": ["..."], "role": ["..."], "state": ["..."], "outline": ["..."]}',
    '宁缺毋滥：不确定的条目不要选；四类都可以为空数组。',
  ].join('\n')
}

/** 固定层：方向文档与大纲；缺失的跳过。 */
export async function protectedContext(root: string): Promise<ContextSource[]> {
  const entries: ContextSource[] = []
  for (const [path, reason] of [
    [CURRENT_FOCUS_FILE, '当前聚焦'],
    [AUTHOR_INTENT_FILE, '作者意图'],
    [STORY_FRAME_FILE, '故事框架'],
    [STORY_VOLUME_MAP_FILE, '卷图'],
  ] as const) {
    try {
      const body = await readFile(join(root, path), 'utf8')
      entries.push({ source: path, reason, excerpt: body.slice(0, 4000), protection: 'protected' })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return entries
}

/** 组装 package 与 trace；selection 里的未知 id 丢弃并记 notes。 */
export function assembleContext(input: {
  chapter: number
  query: string
  protectedEntries: ReadonlyArray<ContextSource>
  candidates: ReadonlyArray<Candidate>
  selection: Selection
  maxChars?: number
  compression?: { text: string }
}): { package: ContextPackage, trace: ChapterTrace } {
  const notes: string[] = []
  const byId = new Map(input.candidates.map((candidate) => [candidate.id, candidate]))
  const selected: ContextSource[] = [...input.protectedEntries]
  const selectedIds: string[] = []
  const pick = (ids: ReadonlyArray<string>, kind: string): void => {
    for (const id of ids) {
      const candidate = byId.get(id)
      if (candidate === undefined) {
        notes.push(`丢弃未知 id: ${id}`)
        continue
      }
      if (candidate.kind !== kind) {
        notes.push(`丢弃类型不符的 id: ${id}（${candidate.kind} ≠ ${kind}）`)
        continue
      }
      selectedIds.push(id)
      selected.push({ source: candidate.source, reason: `composer ${kind}`, excerpt: candidate.excerpt, protection: 'compressible' })
    }
  }
  pick(input.selection.memory, 'memory')
  pick(input.selection.role, 'role')
  pick(input.selection.state, 'state')
  pick(input.selection.outline, 'outline')

  const protectedEntries = selected.filter((entry) => entry.protection === 'protected')
  const compressible = selected.filter((entry) => entry.protection === 'compressible')
  const protectedTokens = protectedEntries.reduce((sum, entry) => sum + estimateTokens(entry.excerpt ?? ''), 0)
  const compressibleTokens = compressible.reduce((sum, entry) => sum + estimateTokens(entry.excerpt ?? ''), 0)
  const maxChars = input.maxChars ?? 24000
  const totalChars = selected.reduce((sum, entry) => sum + (entry.excerpt?.length ?? 0), 0)
  let compressionTrace: ChapterTrace['compression']
  if (totalChars > maxChars) {
    if (input.compression === undefined) {
      throw new Error(`上下文超预算 ${totalChars - maxChars} 字符，需要先压缩可压缩层`)
    }
    const compiled = input.compression.text.trim()
    if (compiled === '') throw new Error('compressedText 不能为空')
    const compressedSources = selected.filter((entry) => entry.protection === 'compressible').map((entry) => entry.source)
    const protectedOnly = selected.filter((entry) => entry.protection === 'protected')
    compressionTrace = {
      compiledSource: compiled,
      protectedSources: protectedOnly.map((entry) => entry.source),
      compressedSources,
      protectedTokens: protectedOnly.reduce((sum, entry) => sum + estimateTokens(entry.excerpt ?? ''), 0),
      compressibleTokens: estimateTokens(compiled),
      budgetTokens: Math.floor(maxChars / 2),
    }
    notes.push(`已压缩 ${compressedSources.length} 条可压缩来源`)
    selected.splice(0, selected.length, ...protectedOnly, {
      source: 'compiled:context',
      reason: '压缩后的可压缩层',
      excerpt: compiled,
      protection: 'compressible',
    })
  }

  return {
    package: { chapter: input.chapter, selectedContext: selected },
    trace: {
      chapter: input.chapter,
      plannerInputs: selected.map((entry) => entry.source),
      composerInputs: input.candidates.map((candidate) => candidate.source),
      selectedSources: selected.map((entry) => entry.source),
      contextTiers: {
        protectedSources: protectedEntries.map((entry) => entry.source),
        compressibleSources: compressible.map((entry) => entry.source),
      },
      tokenBudget: { protectedTokens, compressibleTokens, totalSelectedTokens: protectedTokens + compressibleTokens },
      retrieval: {
        engine: 'sqlite-fts5-bm25',
        query: input.query,
        selectionMode: input.selection.memory.length + input.selection.role.length + input.selection.state.length + input.selection.outline.length > 0
          ? 'semantic'
          : 'complete',
        candidates: input.candidates.map((candidate) => ({ id: candidate.id, kind: candidate.kind, source: candidate.source, score: candidate.score })),
        semanticSelectedIds: selectedIds,
      },
      notes,
      ...(compressionTrace === undefined ? {} : { compression: compressionTrace }),
    },
  }
}

/** 章节必须是当前章 + 1；当前章来自 current_state.json。 */
export async function nextChapter(root: string): Promise<number> {
  try {
    const raw = await readFile(join(root, 'source/story/state/current_state.json'), 'utf8')
    const chapter = (JSON.parse(raw) as { chapter?: number }).chapter ?? 0
    return chapter + 1
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 1
    throw error
  }
}

/** 检索候选：四类统一 query，按 kind 映射到选择器。 */
export async function collectCandidates(root: string, query: string, limit = 24): Promise<Candidate[]> {
  const hits = await searchStory(root, query, { limit })
  return hits.map((hit) => ({
    id: `${hit.kind}:${hit.source}#${hit.title}`,
    kind: hit.kind === 'hook' || hit.kind === 'summary' ? 'memory' : hit.kind,
    source: hit.source,
    title: hit.title,
    excerpt: hit.body.slice(0, 1000),
    score: hit.score,
  }))
}
