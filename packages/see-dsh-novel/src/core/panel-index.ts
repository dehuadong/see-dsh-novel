/**
 * 面板只读投影：从作品文件构建阶段、产物与确认状态。
 *
 * 它不是第二套状态：所有字段都由 `readWork`/`workProbes`/`detectStage`/`readArtifacts`
 * 重建，`/story-index` 只负责把它写到 `panel.index.json`。
 */
import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'

import { readArtifacts } from './artifacts.js'
import { readChapterIndex } from './chapter-index.js'
import { detectStage } from '../pipelines/long/stages/index.js'
import {
  AUTHOR_INTENT_FILE,
  CURRENT_FOCUS_FILE,
  PANEL_INDEX_PATH,
  ROLE_TIER_DIRS,
  STORY_CHAPTER_SUMMARIES_MD,
  STORY_CURRENT_STATE_MD,
  STORY_FANFIC_CANON_MD,
  STORY_FRAME_FILE,
  STORY_PARENT_CANON_MD,
  STORY_PENDING_HOOKS,
  STORY_ROOT,
  STORY_RULES_MD,
  STORY_STYLE_GUIDE_MD,
  STORY_VOLUME_MAP_FILE,
} from './story-paths.js'
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

/** 章节索引里的最新章号；索引缺失或损坏按 0，面板不让它整体失败。 */
async function readLatestChapter(root: string): Promise<number> {
  try {
    const entries = await readChapterIndex(root)
    return entries.reduce((latest, entry) => Math.max(latest, entry.number), 0)
  } catch {
    return 0
  }
}

function artifactType(path: string): PanelArtifact['type'] {
  const extension = extname(path).toLowerCase()
  if (extension === '.md') return 'markdown'
  if (extension === '.json') return 'json'
  return 'text'
}

/** 展示类别决定它出现在哪些阶段。 */
const DISPLAY_STAGES: Readonly<Record<PanelArtifact['class'], PanelStage['id'][]>> = {
  truth: ['foundation'],
  chapter: ['write', 'review'],
  plan: ['plan'],
  review: ['review'],
  diagnostic: ['plan', 'write', 'review'],
}

/** 真值文件浏览器的固定顺序与中文显示名；白名单与顺序来自源工程的真值文件列表。 */
const TRUTH_FILES: ReadonlyArray<readonly [string, number, string]> = [
  [AUTHOR_INTENT_FILE, 100, '作者意图'],
  [CURRENT_FOCUS_FILE, 101, '当前焦点'],
  [STORY_FRAME_FILE, 110, '故事框架'],
  [STORY_VOLUME_MAP_FILE, 111, '分卷地图'],
  [STORY_RULES_MD, 120, '规则正文'],
  [STORY_PENDING_HOOKS, 130, '待回收伏笔'],
  [STORY_CURRENT_STATE_MD, 131, '当前状态'],
  [STORY_CHAPTER_SUMMARIES_MD, 132, '章节摘要'],
  [STORY_STYLE_GUIDE_MD, 140, '文风指南'],
  [STORY_PARENT_CANON_MD, 141, '母本设定'],
  [STORY_FANFIC_CANON_MD, 142, '同人设定'],
]

/** 运行时章节诊断：出现、但只读且默认折叠。 */
const DIAGNOSTIC_LABELS: Readonly<Record<string, string>> = {
  intent: '意图',
  context: '上下文',
  trace: '轨迹',
}

interface DisplayFile {
  path: string
  title: string
  order: number
  class: PanelArtifact['class']
}

/** 目录不存在按空处理；其它错误照常抛出。 */
async function listDir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function chapterTitle(name: string): string | undefined {
  const match = /^(\d{4})_(.+)\.md$/.exec(name)
  if (match === null) return undefined
  return `第 ${Number(match[1])} 章 · ${(match[2] ?? '').replaceAll('_', ' ')}`
}

/**
 * 面板展示集合：真值文件白名单 + 角色卡 + 章节正文 + 章纲/审稿/运行时诊断。
 * 状态 JSON、`memory.db`、流程记账与索引本身都不在集合里。
 * @param root 作品根目录
 */
async function displayFiles(root: string): Promise<DisplayFile[]> {
  const files: DisplayFile[] = []
  for (const [path, order, title] of TRUTH_FILES) {
    if (await exists(join(root, path))) {
      files.push({ path, title, order, class: 'truth' })
    }
  }
  for (const dir of ROLE_TIER_DIRS) {
    for (const name of await listDir(join(root, dir))) {
      if (!name.endsWith('.md')) continue
      // 角色卡的文件名就是角色名，去掉扩展名做显示名。
      files.push({ path: `${dir}/${name}`, title: name.replace(/\.md$/, ''), order: 160, class: 'truth' })
    }
  }
  for (const name of await listDir(join(root, 'source/chapters'))) {
    const title = chapterTitle(name)
    if (title === undefined) continue
    files.push({ path: `source/chapters/${name}`, title, order: 200, class: 'chapter' })
  }
  for (const name of await listDir(join(root, `${STORY_ROOT}/runtime`))) {
    const match = /^chapter-(\d{4})\.(plan|review|intent|context|trace)\.(json|md)$/.exec(name)
    if (match === null) continue
    const chapter = Number(match[1])
    const kind = match[2] as string
    const path = `${STORY_ROOT}/runtime/${name}`
    if (kind === 'plan') files.push({ path, title: `第 ${chapter} 章 · 章纲`, order: 300, class: 'plan' })
    else if (kind === 'review') files.push({ path, title: `第 ${chapter} 章 · 审稿`, order: 400, class: 'review' })
    else {
      files.push({
        path,
        title: `第 ${chapter} 章 · ${DIAGNOSTIC_LABELS[kind] ?? kind}`,
        order: 500,
        class: 'diagnostic',
      })
    }
  }
  return files.sort((left, right) => left.order - right.order || left.path.localeCompare(right.path))
}

/**
 * 构建面板展示集合的元数据行。
 * @param root 作品根目录
 */
async function buildPanelArtifacts(root: string): Promise<PanelArtifact[]> {
  const rows: PanelArtifact[] = []
  for (const file of await displayFiles(root)) {
    const absolute = join(root, file.path)
    const info = await stat(absolute)
    const content = await readFile(absolute)
    rows.push({
      path: file.path,
      title: file.title,
      type: artifactType(file.path),
      class: file.class,
      stages: DISPLAY_STAGES[file.class],
      modifiedAt: info.mtime.toISOString(),
      bytes: content.byteLength,
      revision: createHash('sha256').update(content).digest('hex').slice(0, 8),
      readonly: true,
    })
  }
  return rows
}

/** 索引格式版本；加字段时同步 `panel-types.ts`。 */
export const PANEL_INDEX_VERSION = 5

function stageAction(stage: PanelStage['id'], status: PanelStage['status'], current: string): PanelAction | null {
  if (status !== 'current') return null
  if (stage === 'proposal') return null
  if (stage === 'foundation') {
    if (current === 'foundation-ready') return { id: 'confirm-foundation', label: '确认基础设定', enabled: true, reason: '' }
    return { id: 'start-foundation', label: '开始基础设定', enabled: true, reason: '' }
  }
  if (stage === 'plan') return { id: 'plan-chapter', label: '规划下一章', enabled: true, reason: '' }
  if (stage === 'write') return { id: 'write-chapter', label: '写下一章', enabled: true, reason: '' }
  if (stage === 'review') return { id: 'review-chapter', label: '审阅下一章', enabled: true, reason: '' }
  return null
}

/**
 * 除主按钮外的作者动作；只在基础设定齐全、等工作流开始的节点上出现。
 * @param stage 阶段 id
 * @param status 阶段状态
 * @param current 阶段探针给出的当前阶段
 */
function stageSecondary(stage: PanelStage['id'], status: PanelStage['status'], current: string): PanelAction[] {
  if (status !== 'current' || stage !== 'foundation' || current !== 'foundation-ready') return []
  return [
    { id: 'start-chapter', label: '开始下一章', enabled: true, reason: '' },
    { id: 'reject-foundation', label: '退回', enabled: true, reason: '' },
    { id: 'review-foundation', label: '查看待确认', enabled: true, reason: '' },
    { id: 'later', label: '稍后', enabled: true, reason: '' },
  ]
}

/**
 * 从作品文件构建面板索引。
 * @param root 作品根目录
 */
export async function buildPanelIndex(root: string): Promise<PanelIndex> {
  const work = await readWork(root)
  const stage = work === null ? 'proposal' : detectStage(root).stage
  const currentChapter = work === null ? 0 : await readCurrentChapter(root)
  const latestChapter = work === null ? 0 : await readLatestChapter(root)
  // 摘要仍是 source/story 全量（签核语义），面板只显示白名单里的展示集合。
  const digest = await readArtifacts(root)
  const rows = await buildPanelArtifacts(root)

  const stages: PanelStage[] = STAGES.map(({ id, label }) => {
    if (id === 'settle') {
      return { id, label, status: 'locked', summary: '结算/定稿尚未交付', action: null, secondary: [] }
    }
    let status: PanelStage['status'] = 'locked'
    if (id === 'proposal') status = work === null ? 'current' : 'done'
    else if (id === 'foundation') status = stage === 'foundation' || stage === 'foundation-ready' ? 'current' : ['plan', 'write', 'review', 'chapter-done'].includes(stage) ? 'done' : 'locked'
    else if (id === 'plan') status = stage === 'plan' ? 'current' : ['write', 'review', 'chapter-done'].includes(stage) ? 'done' : 'locked'
    else if (id === 'write') status = stage === 'write' ? 'current' : ['review', 'chapter-done'].includes(stage) ? 'done' : 'locked'
    else if (id === 'review') status = stage === 'review' ? 'current' : stage === 'chapter-done' ? 'done' : 'locked'
    const summary = status === 'done' ? '已完成' : status === 'current' ? '当前阶段' : '等待前一阶段'
    return { id, label, status, summary, action: stageAction(id, status, stage), secondary: stageSecondary(id, status, stage) }
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

  // 一章审完后没有「当前阶段」，修订动作挂在索引根上。
  const action: PanelAction | null = stage === 'chapter-done'
    ? { id: 'revise-chapter', label: '修订本章', enabled: true, reason: '' }
    : null

  return {
    version: PANEL_INDEX_VERSION,
    generatedAt: new Date().toISOString(),
    revision: digest.digest.slice(0, 12),
    work: work === null
      ? null
      : {
          title: work.title,
          status: work.status,
          language: work.language,
          currentChapter,
          latestChapter,
          nextChapter: currentChapter + 1,
        },
    stages,
    artifacts: rows,
    action,
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
