/** 面板索引的 client 类型；与根 panel-types 同步，client 不跨层 import。 */

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
  path: string
  title: string
  type: 'markdown' | 'json' | 'text'
  /** 展示类别：作者产物、章节正文、章纲、审稿、运行时诊断。 */
  class: 'truth' | 'chapter' | 'plan' | 'review' | 'diagnostic'
  /** 出现在哪些阶段。 */
  stages: PanelStage['id'][]
  modifiedAt: string
  bytes: number
  revision: string
  readonly: true
}

export interface PanelIndex {
  version: 4
  generatedAt: string
  revision: string
  work: {
    title: string
    status: string
    language: string
    currentChapter: number
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
