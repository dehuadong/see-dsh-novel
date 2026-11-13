/**
 * 「作品」视图：对话的镜像 + 操作面。
 *
 * 阶段、产物与确认状态全部来自宿主投影的 `panel.index.json`；本视图只订阅索引
 * 与文件 stat、读取正文、把按钮交给宿主命令/提示。它不触发索引重建，也不写文件。
 */
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { Workbench } from './Workbench.js'
import type { PanelAction, PanelArtifact, PanelIndex } from './panel-types.js'
import type { CommandOutcome, SessionId, ViewInjected } from './types.js'

const RESOURCE_PREFIX = 'dsh-resource://file/session/'

/**
 * 无索引时的兜底锚点：身份单独判「立没立项」，五份设定判「有没有基础设定」。
 * 正常路径不读它们，索引缺失时才有用。
 */
const ANCHOR_WORK = '/work.json'
const ANCHOR_FRAME = '/source/story/outline/story_frame.md'
const ANCHOR_VOLUME_MAP = '/source/story/outline/volume_map.md'
const ANCHOR_RULES_MD = '/source/story/book_rules.md'
const ANCHOR_RULES_JSON = '/source/story/book_rules.json'
const ANCHOR_PENDING_HOOKS = '/source/story/pending_hooks.md'
const ANCHOR_PANEL_INDEX = '/source/story/runtime/panel.index.json'

/** 面板索引相对作品根的位置；读取正文时用。 */
const PANEL_INDEX_PATH = 'source/story/runtime/panel.index.json'

/** 开工按钮的文案；只在「已立项、还没有索引与基础设定」这一屏出现。 */
const START_LABEL = '开始基础设定'

type ResourceStatus = 'none' | 'loading' | 'live' | 'failed'

/** 通道状态：读不到、在读、都能读。 */
type ChannelState = 'unavailable' | 'loading' | 'ready'

function channelState(statuses: ReadonlyArray<ResourceStatus>): ChannelState {
  if (statuses.includes('none')) return 'unavailable'
  if (statuses.includes('loading')) return 'loading'
  return 'ready'
}

/**
 * 命令失败换成人话；命令真正执行与否，作者必须立刻看见。
 * @param outcome 非成功的命令结果
 */
function failureNotice(outcome: Exclude<CommandOutcome, 'ok'>): string {
  if (outcome === 'unbound') return '当前会话还没有就绪，命令没有执行。'
  if (outcome === 'unmatched') return '这个会话没有该命令：确认预设是 see-dsh-novel。'
  return '提交失败，稍后再试。'
}

/** 命令成功、不需要继续时的回执。 */
function successNotice(line: string): string {
  if (line === '/story-reject') return '已退回；这一版不会签核，等意见后重写再确认。'
  return '已提交，结果在「对话」里。'
}

/** 读出来的索引用前补齐次按钮、产物阶段与根动作；旧格式没有这些字段。 */
function normalizeIndex(raw: unknown): PanelIndex {
  const index = raw as PanelIndex
  return {
    ...index,
    action: index.action ?? null,
    work: index.work === null
      ? null
      : {
          ...index.work,
          latestChapter: Number.isInteger(index.work.latestChapter) ? index.work.latestChapter : 0,
        },
    stages: (Array.isArray(index.stages) ? index.stages : []).map((stage) => ({
      ...stage,
      secondary: Array.isArray(stage.secondary) ? stage.secondary : [],
    })),
    artifacts: (Array.isArray(index.artifacts) ? index.artifacts : []).map((artifact) => ({
      ...artifact,
      stages: Array.isArray(artifact.stages) ? artifact.stages : [],
    })),
  }
}

/** 把读取错误折成作者能看懂的一句；原始原因保留在后面。 */
function indexErrorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return `索引读取失败：${message}`
}

/**
 * 作品页：索引驱动的阶段轨道、产物浏览与阶段动作。
 * @param props slot 的 owner 面加上注册时注入的业务面
 */
export function StoryView(props: ConvViewProps & InjectFace<ViewInjected>): ReactNode {
  const { sessionId, useSessions, useResource, runCommand, resume, start, advance, readArtifact } = props
  const cwd = useSessions((state: SessionListState) => state.byId[sessionId]?.cwd)
  const sessionRunning = useSessions((state: SessionListState) => state.byId[sessionId]?.running === true)

  const frame = useResource(`${RESOURCE_PREFIX}${sessionId}${ANCHOR_FRAME}`)
  const volumeMap = useResource(`${RESOURCE_PREFIX}${sessionId}${ANCHOR_VOLUME_MAP}`)
  const rulesMd = useResource(`${RESOURCE_PREFIX}${sessionId}${ANCHOR_RULES_MD}`)
  const rulesJson = useResource(`${RESOURCE_PREFIX}${sessionId}${ANCHOR_RULES_JSON}`)
  const pendingHooks = useResource(`${RESOURCE_PREFIX}${sessionId}${ANCHOR_PENDING_HOOKS}`)
  const identity = useResource(`${RESOURCE_PREFIX}${sessionId}${ANCHOR_WORK}`)
  const panelIndexResource = useResource(`${RESOURCE_PREFIX}${sessionId}${ANCHOR_PANEL_INDEX}`)

  const [panelIndex, setPanelIndex] = useState<PanelIndex | null>(null)
  const [indexError, setIndexError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [selectedStage, setSelectedStage] = useState('')
  const [selectedArtifact, setSelectedArtifact] = useState<PanelArtifact | null>(null)
  const [artifactText, setArtifactText] = useState('')
  const [artifactError, setArtifactError] = useState('')

  // 在途提交只对发起它的会话有效：面板实例会被复用，切换会话后旧结果必须丢弃。
  const currentSession = useRef<SessionId>(sessionId)
  const inFlight = useRef(false)

  const channel = channelState([
    frame.status, volumeMap.status, rulesMd.status, rulesJson.status, pendingHooks.status, identity.status,
  ])
  const identified = identity.status === 'live'
  const hasFoundation = [frame, volumeMap, rulesMd, rulesJson, pendingHooks].every((resource) => resource.status === 'live')

  /** 读索引正文；索引 stat 的版本变化会再次触发。 */
  async function loadPanel(): Promise<void> {
    if (typeof readArtifact !== 'function') return
    const text = await readArtifact(sessionId, PANEL_INDEX_PATH)
    setPanelIndex(normalizeIndex(JSON.parse(text)))
    setIndexError('')
  }

  // 挂载与索引版本变化时读一次正文：索引由宿主投影，面板不触发重建。
  useEffect(() => {
    if (typeof readArtifact !== 'function') {
      setIndexError('文件读取通道不可用')
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const text = await readArtifact(sessionId, PANEL_INDEX_PATH)
        if (cancelled) return
        setPanelIndex(normalizeIndex(JSON.parse(text)))
        setIndexError('')
      } catch (error) {
        if (cancelled) return
        setPanelIndex(null)
        setIndexError(indexErrorText(error))
      }
    })()
    return () => { cancelled = true }
  }, [sessionId, panelIndexResource.value?.version])

  // 面板实例在会话之间复用：换会话要清掉上一个会话的索引、选中与回执。
  useLayoutEffect(() => {
    currentSession.current = sessionId
    inFlight.current = false
    setPanelIndex(null)
    setIndexError('')
    setNotice('')
    setBusy(false)
    setSelectedStage('')
    setSelectedArtifact(null)
    setArtifactText('')
    setArtifactError('')
  }, [sessionId])

  /** 取一次点击的入口；已经在处理中时拒绝。 */
  function begin(): (() => boolean) | undefined {
    if (inFlight.current) return undefined
    inFlight.current = true
    const startedFor = sessionId
    return () => currentSession.current === startedFor
  }

  /** 读一个产物正文；失败显示具体路径。 */
  async function openArtifact(artifact: PanelArtifact): Promise<void> {
    setSelectedArtifact(artifact)
    setArtifactText('')
    setArtifactError('')
    if (typeof readArtifact !== 'function') return
    try {
      setArtifactText(await readArtifact(sessionId, artifact.path))
    } catch (error) {
      setArtifactError(`读不到 ${artifact.path}：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** 提交一条命令；成功后读回宿主已重建的索引。 */
  async function command(label: string, line: string, resumeAfter = false): Promise<void> {
    const stillHere = begin()
    if (stillHere === undefined) return
    setBusy(true)
    setNotice(`正在执行「${label}」…`)
    try {
      const outcome = await runCommand(sessionId, line)
      if (!stillHere()) return
      if (outcome !== 'ok') {
        setNotice(failureNotice(outcome))
        return
      }
      if (resumeAfter) {
        let resumed = 'failed'
        try {
          resumed = await resume(sessionId)
        } catch {
          resumed = 'failed'
        }
        if (!stillHere()) return
        setNotice(resumed === 'ok'
          ? '已确认，正在继续…'
          : '已确认；会话没能自动继续，在「对话」里说一句「继续」即可。')
        return
      }
      setNotice(successNotice(line))
      // 命令已成功：索引读取失败不能改写成提交失败，版本变化会再读一次。
      try {
        await loadPanel()
      } catch {
        // 保持命令回执；索引由 stat 版本变化或下次动作后重新读取。
      }
    } catch {
      if (stillHere()) setNotice('提交失败，稍后再试。')
    } finally {
      inFlight.current = false
      if (currentSession.current === sessionId) setBusy(false)
    }
  }

  /** 立项之后把开工指令投回会话。 */
  async function startFoundation(): Promise<void> {
    const stillHere = begin()
    if (stillHere === undefined) return
    setBusy(true)
    setNotice('正在开始基础设定…')
    try {
      const outcome = await start(sessionId, cwd)
      if (!stillHere()) return
      setNotice(outcome === 'ok'
        ? '已开始基础设定，这一轮结束后这里会按实际文件重新判定。'
        : '已立项，但没能自动开始；在「对话」里说一句「开始写基础设定」即可。')
    } catch {
      if (stillHere()) setNotice('没能确认会话是否收到开工指令：先看「对话」里有没有新的一轮。')
    } finally {
      inFlight.current = false
      if (currentSession.current === sessionId) setBusy(false)
    }
  }

  /** 规划/写作/审阅/修订：把阶段提示交给宿主，由模型继续。 */
  async function advanceStage(action: PanelAction): Promise<void> {
    const chapter = panelIndex?.work?.nextChapter ?? 1
    const text = action.id === 'plan-chapter'
      ? `作者在工作台确认规划第 ${chapter} 章；按当前阶段调用规划工具，不要写正文。`
      : action.id === 'write-chapter'
        ? `作者在工作台确认写第 ${chapter} 章正文；按当前阶段调用写作工具，不要审阅。`
        : action.id === 'review-chapter'
          ? `作者在工作台确认审阅第 ${chapter} 章；按当前阶段调用审阅工具，不要进入下一章。`
          : '作者在工作台点了「修订本章」；先问清要改哪里、用哪种模式，再派 reviser 子代理并调用 story_revise_chapter；修订后必须重新审稿。'
    const stillHere = begin()
    if (stillHere === undefined) return
    setBusy(true)
    setNotice(`正在提交「${action.label}」…`)
    try {
      await advance(sessionId, text)
      if (stillHere()) setNotice('已提交；这一轮结束后这里会按实际文件重新判定。')
    } catch {
      if (stillHere()) setNotice('提交失败，稍后再试。')
    } finally {
      inFlight.current = false
      if (currentSession.current === sessionId) setBusy(false)
    }
  }

  /** 阶段动作的总入口；面板只派发，不写文件。 */
  async function handleAction(action: PanelAction): Promise<void> {
    if (busy || sessionRunning) return
    if (action.id === 'start-foundation') { await startFoundation(); return }
    if (action.id === 'later') { setNotice('已稍后：开始下一章前不会写入 workflow start。'); return }
    if (action.id === 'confirm-foundation') { await command('确认基础设定', '/story-approve', true); return }
    if (action.id === 'reject-foundation') { await command('退回', '/story-reject'); return }
    if (action.id === 'review-foundation') { await command('查看待确认', '/story-review'); return }
    if (action.id === 'delete-chapter') { await command('删除本章', '/story-delete'); return }
    if (action.id === 'start-chapter') { await command('开始下一章', '/story-write'); return }
    if (action.id === 'plan-chapter' || action.id === 'write-chapter' || action.id === 'review-chapter' || action.id === 'revise-chapter') {
      await advanceStage(action)
    }
  }

  const running = busy || sessionRunning
  const status = sessionRunning ? '会话正在运行，结束后这里会按实际文件重新判定。' : notice

  if (panelIndex !== null) {
    return (
      <Workbench
        index={panelIndex}
        busy={busy}
        running={sessionRunning}
        notice={status}
        selectedStage={selectedStage}
        selectedArtifact={selectedArtifact}
        artifactText={artifactText}
        artifactError={artifactError}
        onSelectStage={setSelectedStage}
        onOpenArtifact={(artifact) => { void openArtifact(artifact) }}
        onCloseArtifact={() => setSelectedArtifact(null)}
        onAction={(action) => { void handleAction(action) }}
        onExport={(format) => { void command('导出', `/story-export ${format}`) }}
      />
    )
  }

  const body: ReactNode[] = []
  if (channel === 'unavailable') {
    body.push(<p key="none" className="sdn-muted">读不到工作区状态（文件资源通道不可用），暂时不能确认。</p>)
  } else if (channel === 'loading') {
    body.push(<p key="loading" className="sdn-muted">正在读取工作区…</p>)
  } else if (!identified) {
    body.push(<p key="empty" className="sdn-muted">尚未立项：在「对话」里描述作品，主编会收敛成提案；这里只显示阶段与产物。</p>)
    if (cwd !== undefined) body.push(<p key="cwd" className="sdn-muted">当前工作区：{cwd}</p>)
  } else if (!hasFoundation) {
    body.push(<p key="empty" className="sdn-muted">已立项，还没有基础设定。</p>)
    if (cwd !== undefined) body.push(<p key="cwd" className="sdn-muted">当前工作区：{cwd}</p>)
    if (!running) {
      body.push(
        <div key="start" className="sdn-row">
          <button type="button" onClick={() => { void startFoundation() }}>
            {START_LABEL}
          </button>
        </div>,
      )
    }
  } else {
    body.push(
      <p key="index-missing" className="sdn-muted">
        索引还没生成：宿主会在下一次作品写入或重新打开会话时补建；也可以先在「对话」里继续。
      </p>,
    )
  }
  if (indexError !== '') body.push(<p key="index-error" className="sdn-muted">{indexError}</p>)
  if (status !== '') body.push(<p key="notice" className="sdn-muted">{status}</p>)

  return (
    <section className="sdn-view">
      <h2 className="sdn-title">作品</h2>
      {body}
    </section>
  )
}
