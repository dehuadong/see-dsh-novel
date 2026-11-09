/**
 * 面板只读投影：从作品文件构建阶段、产物与确认状态。
 *
 * 它不是第二套状态：所有字段都由 `readWork`/`workProbes`/`detectStage`/`readArtifacts`
 * 重建，`/story-index` 只负责把它写到 `panel.index.json`。
 */
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'

import { readArtifacts } from './artifacts.js'
import { detectStage } from '../pipelines/long/stages/index.js'
import { PANEL_INDEX_PATH, STORY_ROOT } from './story-paths.js'
import { readWork } from './work.js'
import type { PanelAction, PanelArtifact, PanelIndex, PanelStage } from '../panel-types.js'

export type { PanelAction, PanelArtifact, PanelIndex, PanelStage } from '../panel-types.js'

const STAGES: ReadonlyArray<{ id: PanelStage['id'], label: string }> = [
  { id: 'proposal', label: '提案' },
  { id: 'foundation', label: '基础设定' },
  { id: 'plan', label: '章前规划' },
  { id: 'write', label: '正文' },
  { id: 'review', label: '审阅' },
  { id: 'settle', label: '结算' },
]

async function readCurrentChapter(root: string): Promise<number> {
  try {
    const parsed = JSON.parse(await readFile(join(root, `${STORY_ROOT}/state/current_state.json`), 'utf8')) as { chapter?: number }
    return Number.isInteger(parsed.chapter) ? parsed.chapter as number : 0
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
    throw error
  }
}

function artifactType(path: string): PanelArtifact['type'] {
  const extension = extname(path).toLowerCase()
  if (extension === '.md') return 'markdown'
  if (extension === '.json') return 'json'
  return 'text'
}

function artifactGroup(path: string): PanelArtifact['group'] {
  return path.includes('/chapters/') || path.includes('/runtime/chapter-') ? 'chapter' : 'foundation'
}

function stageAction(stage: PanelStage['id'], status: PanelStage['status'], current: string): PanelAction | null {
  if (status !== 'current') return null
  if (stage === 'proposal') return { id: 'new-work', label: '新建作品', enabled: true, reason: '' }
  if (stage === 'foundation') {
    if (current === 'foundation-ready') return { id: 'confirm-foundation', label: '确认基础设定', enabled: true, reason: '' }
    return { id: 'start-foundation', label: '开始基础设定', enabled: true, reason: '' }
  }
  if (stage === 'plan') return { id: 'plan-chapter', label: '规划下一章', enabled: false, reason: 'P2 尚未交付' }
  if (stage === 'write') return { id: 'write-chapter', label: '写下一章', enabled: false, reason: 'P3 尚未交付' }
  if (stage === 'review') return { id: 'review-chapter', label: '审阅下一章', enabled: false, reason: 'P3 尚未交付' }
  return null
}

/**
 * 从作品文件构建面板索引。
 * @param root 作品根目录
 */
export async function buildPanelIndex(root: string): Promise<PanelIndex> {
  const work = await readWork(root)
  const stage = work === null ? 'proposal' : detectStage(root).stage
  const currentChapter = work === null ? 0 : await readCurrentChapter(root)
  const artifacts = await readArtifacts(root)
  const rows: PanelArtifact[] = []
  for (const path of artifacts.files) {
    if (path === PANEL_INDEX_PATH) continue
    const absolute = join(root, path)
    const info = await stat(absolute)
    const content = await readFile(absolute)
    rows.push({
      path,
      title: basename(path),
      type: artifactType(path),
      group: artifactGroup(path),
      modifiedAt: info.mtime.toISOString(),
      bytes: content.byteLength,
      revision: createHash('sha256').update(content).digest('hex').slice(0, 8),
      readonly: true,
    })
  }

  const stages: PanelStage[] = STAGES.map(({ id, label }) => {
    if (id === 'settle') {
      return { id, label, status: 'locked', summary: '结算/定稿尚未交付', action: null }
    }
    let status: PanelStage['status'] = 'locked'
    if (id === 'proposal') status = work === null ? 'current' : 'done'
    else if (id === 'foundation') status = stage === 'foundation' || stage === 'foundation-ready' ? 'current' : ['plan', 'write', 'review', 'chapter-done'].includes(stage) ? 'done' : 'locked'
    else if (id === 'plan') status = stage === 'plan' ? 'current' : ['write', 'review', 'chapter-done'].includes(stage) ? 'done' : 'locked'
    else if (id === 'write') status = stage === 'write' ? 'current' : ['review', 'chapter-done'].includes(stage) ? 'done' : 'locked'
    else if (id === 'review') status = stage === 'review' ? 'current' : stage === 'chapter-done' ? 'done' : 'locked'
    const summary = status === 'done' ? '已完成' : status === 'current' ? '当前阶段' : '等待前一阶段'
    return { id, label, status, summary, action: stageAction(id, status, stage) }
  })

  const confirmation: PanelIndex['confirmation'] = work === null
    ? { kind: 'proposal', state: 'pending', reason: '还没有作品' }
    : stage === 'foundation-ready'
      ? { kind: 'foundation-signoff', state: 'pending', reason: '基础设定已齐，等待作者确认' }
      : stage === 'chapter-done'
        ? { kind: 'chapter', state: 'done', reason: '本章审稿已落盘' }
        : ['plan', 'write', 'review'].includes(stage)
          ? { kind: 'workflow-start', state: 'started', reason: '本章 workflow 已开始' }
          : { kind: 'none', state: 'pending', reason: '' }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    revision: artifacts.digest.slice(0, 12),
    work: work === null
      ? null
      : {
          title: work.title,
          status: work.status,
          language: work.language,
          currentChapter,
          nextChapter: currentChapter + 1,
        },
    stages,
    artifacts: rows.sort((left, right) => left.path.localeCompare(right.path)),
    confirmation,
  }
}

/**
 * 写面板索引；索引写入失败不覆盖旧文件。
 * @param root 作品根目录
 * @param index 已构建的索引
 */
export async function writePanelIndex(root: string, index: PanelIndex): Promise<void> {
  const { commitFile } = await import('./commit.js')
  await commitFile(root, PANEL_INDEX_PATH, `${JSON.stringify(index, null, 2)}\n`)
}
