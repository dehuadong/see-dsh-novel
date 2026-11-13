/** 面板索引的跨层类型；只放类型，不含运行时代码。 */

export interface PanelStage {
  id: 'proposal' | 'foundation' | 'plan' | 'write' | 'review' | 'settle'
  label: string
  status: 'done' | 'current' | 'locked'
  summary: string
  action: PanelAction | null
  /** 主按钮之外的作者动作；只有 `foundation-ready` 节点有。 */
  secondary: PanelAction[]
}

export interface PanelAction {
  id: string
  label: string
  enabled: boolean
  reason: string
}

export interface PanelArtifact {
  /** 相对作品根的路径，`/` 分隔。 */
  path: string
  /** 列表里显示的名字；章节用「第 N 章 · 标题」。 */
  title: string
  type: 'markdown' | 'json' | 'text'
  /** 展示类别：作者产物、章节正文、章纲、审稿、运行时诊断。 */
  class: 'truth' | 'chapter' | 'plan' | 'review' | 'diagnostic'
  /** 出现在哪些阶段；由宿主投影给出。 */
  stages: PanelStage['id'][]
  modifiedAt: string
  bytes: number
  revision: string
  readonly: true
}

export interface PanelIndex {
  version: 5
  generatedAt: string
  revision: string
  work: {
    title: string
    status: string
    language: string
    currentChapter: number
    /** 章节索引里的最新章；索引缺失或损坏为 0。 */
    latestChapter: number
    nextChapter: number
  } | null
  stages: PanelStage[]
  artifacts: PanelArtifact[]
  /** 没有当前阶段时给出的动作（chapter-done 的「修订本章」）；其余时候为 null。 */
  action: PanelAction | null
  confirmation: {
    kind: 'proposal' | 'foundation-signoff' | 'workflow-start' | 'chapter' | 'none'
    state: 'pending' | 'started' | 'done'
    reason: string
  }
}
