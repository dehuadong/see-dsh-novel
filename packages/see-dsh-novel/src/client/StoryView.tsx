/**
 * 「作品」视图。
 *
 * 只判断「确认区能不能用」，不读作品内容：目录与预设来自客户端已有通道，
 * 工件清单与摘要由命令结果写在会话里。作品绑定与进入作品的流程不属于本能力。
 */
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import { useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { PRESET_ID, presetSelector } from './preset.js'
import type { CommandOutcome, ViewInjected } from './types.js'

const RESOURCE_PREFIX = 'dsh-resource://file/session/'

/**
 * 作品存在的判据：`file` 协议的 stat 只接受普通文件，探不到目录，
 * 所以用流水线必然先写下的两个锚点文件代替「source/story/ 存在」这层判断。
 */
const ANCHOR_OUTLINE = '/source/story/outline/story_frame.md'
const ANCHOR_MANIFEST = '/source/story/state/manifest.json'

/** 三个确认命令；按钮与命令成对写在这里，避免散落在渲染里。 */
const COMMANDS = [
  { label: '查看待确认', line: '/story-review' },
  { label: '认可', line: '/story-approve' },
  { label: '退回', line: '/story-reject' },
] as const

/** 认可成功后要接着做的下一步：把「继续」投回会话。 */
const APPROVE_LINE = '/story-approve'

/** 认可之后的状态：正在继续、继续失败，或还没认可。 */
type Settled = '' | 'resumed' | 'resume-failed'

/** 认可后的状态文案；两种都意味着按钮不再可用。 */
function settledText(settled: Exclude<Settled, ''>): string {
  return settled === 'resumed'
    ? '已确认，正在继续…'
    : '已确认；会话没能自动继续，在「对话」里说一句「继续」即可。'
}

type ResourceStatus = 'none' | 'loading' | 'live' | 'failed'

/** 两个锚点合成一个三态：任一存在即作品；都在加载就先等；都报缺失才算没有。 */
function workState(states: ReadonlyArray<ResourceStatus>): ResourceStatus {
  if (states.includes('live')) return 'live'
  if (states.includes('loading')) return 'loading'
  if (states.includes('failed')) return 'failed'
  return 'none'
}

/** 提交结果换成人话；命令真正执行与否，作者必须立刻看见。 */
function noticeOf(label: string, outcome: CommandOutcome): string {
  if (outcome === 'ok') return `已提交「${label}」，结果在「对话」里。`
  if (outcome === 'unbound') return '当前会话还没有就绪，命令没有执行。'
  if (outcome === 'unmatched') return `这个会话没有该命令：确认预设是 ${PRESET_ID}。`
  return '提交失败，稍后再试。'
}

/**
 * 作品页：作者确认闸门与提交回执。
 * @param props slot 的 owner 面加上注册时注入的业务面
 */
export function StoryView(props: ConvViewProps & InjectFace<ViewInjected>): ReactNode {
  const { sessionId, useSessions, useResource, canCommand, runCommand, resume } = props
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [settled, setSettled] = useState<Settled>('')
  // 双击在同一帧内连发两次 onClick，state 还没来得及更新；用 ref 抢先占位。
  const inFlight = useRef(false)
  const done = useRef(false)
  const cwd = useSessions((state: SessionListState) => state.byId[sessionId]?.cwd)
  const preset = useSessions(presetSelector(sessionId))
  const outline = useResource(`${RESOURCE_PREFIX}${sessionId}${ANCHOR_OUTLINE}`)
  const manifest = useResource(`${RESOURCE_PREFIX}${sessionId}${ANCHOR_MANIFEST}`)
  const work = workState([outline.status, manifest.status])

  /**
   * 提交一条确认命令；认可成功后再把「继续」投回会话。
   * 一次点击完成两步，失败时如实区分「确认没成功」与「确认了但没继续」。
   * @param label 按钮文案
   * @param line 要提交的斜杠命令
   */
  async function submit(label: string, line: string): Promise<void> {
    if (inFlight.current || done.current) return
    inFlight.current = true
    setBusy(true)
    setNotice(`正在执行「${label}」…`)
    try {
      const outcome = await runCommand(sessionId, line)
      if (outcome !== 'ok' || line !== APPROVE_LINE) {
        setNotice(noticeOf(label, outcome))
        return
      }
      const resumed = await resume(sessionId)
      done.current = true
      setSettled(resumed === 'ok' ? 'resumed' : 'resume-failed')
      setNotice('')
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  const body: ReactNode[] = []
  if (work === 'none') {
    body.push(<p key="none" className="sdn-muted">读不到工作区状态（文件资源通道不可用），暂时不能确认。</p>)
  } else if (work === 'loading') {
    body.push(<p key="loading" className="sdn-muted">正在读取工作区…</p>)
  } else if (work === 'failed') {
    body.push(<p key="empty" className="sdn-muted">尚未绑定作品。当前工作区还没有 source/story/，先让本会话跑一遍基础设定。</p>)
    if (cwd !== undefined) body.push(<p key="cwd" className="sdn-muted">当前工作区：{cwd}</p>)
  } else if (preset === undefined) {
    body.push(<p key="preset-loading" className="sdn-muted">正在读取会话预设…</p>)
  } else if (preset !== PRESET_ID) {
    body.push(<p key="preset-other" className="sdn-muted">这是一部作品，但当前会话用的是预设「{preset}」，不能在这里确认基础设定。</p>)
  } else {
    body.push(<p key="gate" className="sdn-muted">作者确认闸门：这一版基础设定需要作者认可，才允许签核定稿。</p>)
    if (settled !== '') {
      body.push(<p key="settled" className="sdn-muted">{settledText(settled)}</p>)
    } else if (canCommand(sessionId)) {
      body.push(
        <div key="actions" className="sdn-row">
          {COMMANDS.map((command) => (
            <button
              key={command.line}
              type="button"
              disabled={busy}
              onClick={() => { void submit(command.label, command.line) }}
            >
              {command.label}
            </button>
          ))}
        </div>,
      )
      body.push(
        <p key="notice" className="sdn-muted">
          {notice === '' ? '清单、摘要与确认结果会出现在「对话」页。' : notice}
        </p>,
      )
    } else {
      body.push(<p key="unbound" className="sdn-muted">当前会话还没有就绪，暂时不能提交确认。</p>)
    }
  }

  return (
    <section className="sdn-view">
      <h2 className="sdn-title">作品</h2>
      {body}
    </section>
  )
}
