/** 面板索引的 client 类型；与根 panel-types 同步，client 不跨层 import。 */

export interface PanelStage {
  id: 'proposal' | 'foundation' | 'plan' | 'write' | 'review' | 'settle'
  label: string
  status: 'done' | 'current' | 'locked'
  summary: string
  action: PanelAction | null
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
  group: 'foundation' | 'chapter'
  modifiedAt: string
  bytes: number
  revision: string
  readonly: true
}

export interface PanelIndex {
  version: 1
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
  confirmation: {
    kind: 'proposal' | 'foundation-signoff' | 'workflow-start' | 'chapter' | 'none'
    state: 'pending' | 'started' | 'done'
    reason: string
  }
}
