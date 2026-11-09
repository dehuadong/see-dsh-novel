/**
 * 作品工作台：阶段轨道 + 左导航 + 右详情。
 *
 * 组件只接收索引和回调；动作由 StoryView 交给宿主命令/提示，组件不写文件。
 */
import { useState } from 'react'
import type { ReactNode } from 'react'

import type { PanelAction, PanelArtifact, PanelIndex } from './panel-types.js'

export interface NewWorkInput {
  title: string
  language: string
  targetChapters: string
  chapterWordCount: string
  genre: string
  platform: string
}

export interface WorkbenchProps {
  index: PanelIndex
  busy: boolean
  notice: string
  selectedStage: string
  selectedArtifact: PanelArtifact | null
  artifactText: string
  artifactError: string
  onSelectStage(stage: string): void
  onOpenArtifact(artifact: PanelArtifact): void
  onCloseArtifact(): void
  onAction(action: PanelAction): void
  onRefresh(): void
  onNewWork(input: NewWorkInput): void
}

/**
 * 渲染工作台。
 * @param props 索引、选中项与动作回调
 */
export function Workbench(props: WorkbenchProps): ReactNode {
  const { index, busy, notice, selectedStage, selectedArtifact, artifactText, artifactError } = props
  const [newWork, setNewWork] = useState(false)
  const current = index.stages.find((stage) => stage.status === 'current') ?? index.stages[0]

  if (index.work === null && newWork) {
    return (
      <section className="sdn-view sdn-workbench">
        <header className="sdn-workbench-head">
          <h2 className="sdn-title">作品工作台</h2>
          <button type="button" onClick={() => setNewWork(false)}>返回</button>
        </header>
        <NewWorkForm busy={busy} notice={notice} onSubmit={props.onNewWork} />
      </section>
    )
  }

  return (
    <section className="sdn-view sdn-workbench">
      <header className="sdn-workbench-head">
        <div>
          <h2 className="sdn-title">{index.work?.title ?? '作品工作台'}</h2>
          <p className="sdn-muted">
            {index.work === null ? '还没有作品' : `${index.work.status} · 第 ${index.work.currentChapter} 章 · ${index.work.language}`}
            {' · '}
            当前阶段：{current?.label ?? '未知'}
          </p>
        </div>
        <button type="button" disabled={busy} onClick={props.onRefresh}>刷新索引</button>
      </header>

      <div className="sdn-rail" role="list" aria-label="阶段流程">
        {index.stages.map((stage) => (
          <div
            key={stage.id}
            role="listitem"
            className={`sdn-node sdn-node-${stage.status}${selectedStage === stage.id ? ' sdn-node-selected' : ''}`}
          >
            <button type="button" className="sdn-node-title" onClick={() => props.onSelectStage(stage.id)}>
              {stage.status === 'done' ? '✓ ' : stage.status === 'current' ? '● ' : '○ '}
              {stage.label}
            </button>
            <p className="sdn-muted">{stage.summary}</p>
            {stage.action !== null
              ? (
                  <button
                    type="button"
                    disabled={busy || !stage.action.enabled}
                    aria-disabled={busy || !stage.action.enabled}
                    title={stage.action.enabled ? stage.action.label : stage.action.reason}
                    onClick={() => {
                      if (stage.action?.id === 'new-work') setNewWork(true)
                      else props.onAction(stage.action as PanelAction)
                    }}
                  >
                    {busy ? '提交中…' : stage.action.label}
                  </button>
                )
              : null}
            {stage.action !== null && !stage.action.enabled && stage.action.reason !== ''
              ? <p className="sdn-disabled">{stage.action.reason}</p>
              : null}
            {stage.id === 'foundation' && stage.status === 'current' && index.confirmation.kind === 'foundation-signoff'
              ? (
                  <button
                    type="button"
                    disabled={busy}
                    title="作者确认后开始下一章"
                    onClick={() => props.onAction({ id: 'start-chapter', label: '开始下一章', enabled: true, reason: '' })}
                  >
                    开始下一章
                  </button>
                )
              : null}
          </div>
        ))}
      </div>

      <div className="sdn-workbench-body">
        <aside className="sdn-side" aria-label="阶段与产物">
          <h3>阶段</h3>
          <ul className="sdn-side-list">
            {index.stages.map((stage) => (
              <li key={stage.id}>
                <button
                  type="button"
                  className={selectedStage === stage.id ? 'sdn-side-active' : undefined}
                  onClick={() => props.onSelectStage(stage.id)}
                >
                  {stage.label}
                </button>
              </li>
            ))}
          </ul>
          <h3>产物</h3>
          {index.artifacts.length === 0
            ? <p className="sdn-muted">还没有产物；生成索引后会显示。</p>
            : (
                <ul className="sdn-side-list">
                  {index.artifacts.map((artifact) => (
                    <li key={artifact.path}>
                      <button
                        type="button"
                        className={selectedArtifact?.path === artifact.path ? 'sdn-side-active' : undefined}
                        onClick={() => props.onOpenArtifact(artifact)}
                      >
                        {artifact.title}
                      </button>
                      <span className="sdn-muted"> {artifact.type} · {artifact.readonly ? '只读' : '可写'}</span>
                    </li>
                  ))}
                </ul>
              )}
        </aside>

        <main className="sdn-detail">
          {index.work === null
            ? (
                <div>
                  <p>还没有作品。新建作品后，阶段与产物会出现在这里。</p>
                  <button type="button" disabled={busy} onClick={() => setNewWork(true)}>新建作品</button>
                </div>
              )
            : selectedArtifact !== null
              ? (
                  <div>
                    <div className="sdn-row">
                      <button type="button" onClick={props.onCloseArtifact}>返回总览</button>
                      <span className="sdn-muted">{selectedArtifact.path} · {selectedArtifact.revision} · {selectedArtifact.modifiedAt}</span>
                    </div>
                    {artifactError !== ''
                      ? <p className="sdn-muted">{artifactError}</p>
                      : <pre className="sdn-artifact">{artifactText}</pre>}
                  </div>
                )
              : (
                  <div>
                    <h3>{current?.label ?? '当前阶段'}</h3>
                    <p>{current?.summary ?? '等待阶段判定。'}</p>
                    <p className="sdn-muted">
                      确认：{index.confirmation.kind} · {index.confirmation.state}
                      {index.confirmation.reason === '' ? '' : ` · ${index.confirmation.reason}`}
                    </p>
                    {notice !== '' ? <p className="sdn-muted">{notice}</p> : null}
                  </div>
                )}
        </main>
      </div>
    </section>
  )
}

function NewWorkForm({ busy, notice, onSubmit }: {
  busy: boolean
  notice: string
  onSubmit(input: NewWorkInput): void
}): ReactNode {
  const [title, setTitle] = useState('')
  const [language, setLanguage] = useState('zh')
  const [targetChapters, setTargetChapters] = useState('10')
  const [chapterWordCount, setChapterWordCount] = useState('3000')
  const [genre, setGenre] = useState('')
  const [platform, setPlatform] = useState('')
  return (
    <form
      className="sdn-form"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit({ title, language, targetChapters, chapterWordCount, genre, platform })
      }}
    >
      <h3>新建作品</h3>
      <label>标题<input value={title} onChange={(event) => setTitle(event.target.value)} required /></label>
      <label>语言<input value={language} onChange={(event) => setLanguage(event.target.value)} /></label>
      <label>目标章数<input value={targetChapters} onChange={(event) => setTargetChapters(event.target.value)} /></label>
      <label>单章字数<input value={chapterWordCount} onChange={(event) => setChapterWordCount(event.target.value)} /></label>
      <label>题材<input value={genre} onChange={(event) => setGenre(event.target.value)} /></label>
      <label>平台<input value={platform} onChange={(event) => setPlatform(event.target.value)} /></label>
      <div className="sdn-row">
        <button type="submit" disabled={busy || title.trim() === ''}>{busy ? '提交中…' : '立项'}</button>
      </div>
      {notice !== '' ? <p className="sdn-muted">{notice}</p> : null}
    </form>
  )
}
