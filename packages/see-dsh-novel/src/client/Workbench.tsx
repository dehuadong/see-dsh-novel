/**
 * 作品工作台：阶段栏 → 本阶段产物 → 详情/正文。
 *
 * 一条导航轴（阶段）只出现一次；左侧列表只列该阶段的展示集合，运行时诊断收在
 * 默认折叠的分组里；当前阶段的动作集中在右栏顶部的动作条。组件只接收索引和
 * 回调，动作由 StoryView 交给宿主命令/提示，组件不写文件。
 */
import type { ReactNode } from 'react'

import { JsonView } from './JsonView.js'
import type { PanelAction, PanelArtifact, PanelIndex, PanelStage } from './panel-types.js'

export interface WorkbenchProps {
  index: PanelIndex
  busy: boolean
  /** 会话正在跑别的轮：动作一并禁用，但不是本面板在提交。 */
  running: boolean
  notice: string
  selectedStage: string
  selectedArtifact: PanelArtifact | null
  artifactText: string
  artifactError: string
  onSelectStage(stage: string): void
  onOpenArtifact(artifact: PanelArtifact): void
  onCloseArtifact(): void
  onAction(action: PanelAction): void
}

function statusMark(status: PanelStage['status']): string {
  return status === 'done' ? '✓' : status === 'current' ? '●' : '○'
}

/**
 * 渲染工作台。
 * @param props 索引、选中项与动作回调
 */
export function Workbench(props: WorkbenchProps): ReactNode {
  const { index, busy, running, notice, selectedStage, selectedArtifact, artifactText, artifactError } = props
  const disabled = busy || running
  // 一章审阅完时没有「当前阶段」节点：标题按本章完成显示，导航默认停在审阅。
  const current = index.stages.find((stage) => stage.status === 'current')
  const defaultStage = current?.id
    ?? [...index.stages].reverse().find((stage) => stage.status === 'done')?.id
    ?? 'proposal'
  const activeId = selectedStage === '' ? defaultStage : selectedStage
  const active = index.stages.find((stage) => stage.id === activeId)
  const rows = index.artifacts.filter((artifact) => artifact.stages.includes(activeId as PanelStage['id']))
  const visible = rows.filter((artifact) => artifact.class !== 'diagnostic')
  const diagnostics = rows.filter((artifact) => artifact.class === 'diagnostic')
  const currentLabel = current?.label ?? (index.work === null ? '还没有作品' : '本章完成')
  // 没有当前阶段时用索引根动作（一章审完的「修订本章」）。
  const action = current?.action ?? index.action ?? null
  const secondary = current?.secondary ?? []
  const diagnostic = selectedArtifact?.class === 'diagnostic'

  const artifactButton = (artifact: PanelArtifact): ReactNode => (
    <button
      key={artifact.path}
      type="button"
      className={artifact.class === 'diagnostic' ? 'sdn-list-row sdn-diagnostic' : 'sdn-list-row'}
      data-active={selectedArtifact?.path === artifact.path ? true : undefined}
      onClick={() => props.onOpenArtifact(artifact)}
    >
      <span>{artifact.title}</span>
      <span className="sdn-muted">{artifact.type} · 只读</span>
    </button>
  )

  return (
    <section className="sdn-view sdn-workbench">
      <header className="sdn-workbench-head">
        <h2 className="sdn-title">{index.work?.title ?? '作品工作台'}</h2>
        <p className="sdn-muted">
          {index.work === null ? '还没有作品' : `${index.work.status} · 第 ${index.work.currentChapter} 章 · ${index.work.language}`}
          {' · '}
          索引生成于 {index.generatedAt}
        </p>
      </header>

      <div className="sdn-columns">
        <nav className="sdn-stages" aria-label="阶段">
          {index.stages.map((stage) => (
            <button
              key={stage.id}
              type="button"
              className="sdn-stage"
              data-active={activeId === stage.id ? true : undefined}
              data-status={stage.status}
              title={stage.summary}
              onClick={() => {
                props.onSelectStage(stage.id)
                props.onCloseArtifact()
              }}
            >
              <span className="sdn-stage-mark" aria-hidden>{statusMark(stage.status)}</span>
              <span>{stage.label}</span>
            </button>
          ))}
        </nav>

        <aside className="sdn-list" aria-label="产物">
          <div className="sdn-list-head">{active?.label ?? '产物'}</div>
          <div className="sdn-list-body">
            {visible.length === 0
              ? <p className="sdn-muted">{active?.summary ?? '这个阶段还没有产物。'}</p>
              : visible.map(artifactButton)}
            {diagnostics.length > 0
              ? (
                  <details className="sdn-diag">
                    <summary>运行时诊断（{diagnostics.length}）</summary>
                    {diagnostics.map(artifactButton)}
                  </details>
                )
              : null}
          </div>
        </aside>

        <main className="sdn-detail">
          <div className="sdn-actionbar">
            <span className="sdn-actionbar-stage">{currentLabel}</span>
            {action !== null
              ? (
                  <button
                    type="button"
                    className="sdn-primary"
                    disabled={disabled || !action.enabled}
                    aria-disabled={disabled || !action.enabled}
                    title={action.enabled ? action.label : action.reason}
                    onClick={() => props.onAction(action)}
                  >
                    {busy ? '提交中…' : action.label}
                  </button>
                )
              : null}
            {secondary.map((item) => (
              <button
                key={item.id}
                type="button"
                className="sdn-secondary"
                disabled={disabled || !item.enabled}
                aria-disabled={disabled || !item.enabled}
                title={item.enabled ? item.label : item.reason}
                onClick={() => props.onAction(item)}
              >
                {item.label}
              </button>
            ))}
            {action !== null && !action.enabled && action.reason !== ''
              ? <span className="sdn-disabled">{action.reason}</span>
              : null}
            {notice !== '' ? <span className="sdn-muted">{notice}</span> : null}
          </div>

          <div className="sdn-detail-body">
            {index.work === null
              ? (
                  <p>还没有作品。请在「对话」里描述作品，主编会收敛成提案；这里只显示阶段与产物。</p>
                )
              : selectedArtifact !== null
                ? (
                    <>
                      <div className="sdn-row">
                        <button type="button" onClick={props.onCloseArtifact}>返回阶段</button>
                        <span className="sdn-muted">{selectedArtifact.path} · {selectedArtifact.revision} · {selectedArtifact.modifiedAt}</span>
                      </div>
                      {diagnostic
                        ? (
                            <p className="sdn-warning">
                              运行时诊断文件：这里展示本章写作时的上下文选择与预算 trace，只用于追溯系统看了什么，不作为可编辑设定。
                            </p>
                          )
                        : null}
                      {artifactError !== ''
                        ? <p className="sdn-muted">{artifactError}</p>
                        : selectedArtifact.type === 'json' && !diagnostic
                          ? <JsonView key={selectedArtifact.path} text={artifactText} />
                          : <pre className="sdn-artifact">{artifactText}</pre>}
                    </>
                  )
                : (
                    <>
                      <h3 className="sdn-detail-title">{active?.label ?? currentLabel}</h3>
                      <p>{active?.summary ?? index.confirmation.reason}</p>
                      {index.confirmation.kind !== 'none'
                        ? (
                            <p className="sdn-muted">
                              确认：{index.confirmation.kind} · {index.confirmation.state}
                              {index.confirmation.reason === '' ? '' : ` · ${index.confirmation.reason}`}
                            </p>
                          )
                        : null}
                    </>
                  )}
          </div>
        </main>
      </div>
    </section>
  )
}
