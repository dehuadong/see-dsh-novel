/**
 * 「作品」视图。
 *
 * 只判断「确认区能不能用」，不读作品内容：目录、预设与三个探针来自客户端
 * 已有通道，工件清单与摘要由命令结果写在会话里。作品身份的存在性在这里显示，
 * 但「当前作品是哪一个」的进入与切换不属于本能力。
 */
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import { useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { PRESET_ID, presetSelector } from './preset.js'
import type { CommandOutcome, ResumeOutcome, SessionId, ViewInjected } from './types.js'

const RESOURCE_PREFIX = 'dsh-resource://file/session/'

/**
 * 作品存在的判据：`file` 协议的 stat 只接受普通文件，探不到目录，
 * 所以用流水线必然先写下的两个锚点文件代替「source/story/ 存在」这层判断。
 * 身份文件 `work.json` 单独探：它回答「立没立项」，不参与「有没有设定」。
 */
const ANCHOR_OUTLINE = '/source/story/outline/story_frame.md'
const ANCHOR_MANIFEST = '/source/story/state/manifest.json'
const ANCHOR_WORK = '/work.json'

/** 三个确认命令；按钮与命令成对写在这里，避免散落在渲染里。 */
const COMMANDS = [
  { label: '查看待确认', line: '/story-review' },
  { label: '认可', line: '/story-approve' },
  { label: '退回', line: '/story-reject' },
] as const

/** 认可：成功后要把「继续」投回会话的那一条。 */
const APPROVE = COMMANDS[1]
const REJECT = COMMANDS[2]

/** 开工按钮的文案；只在「已立项、还没有基础设定」这一屏出现。 */
const START_LABEL = '开始基础设定'

/**
 * 一次点击的生命周期：空闲、提交中、已确认并继续、已确认但没继续、
 * 已开工（等这一轮开始/结束）、开工结果未知（指令可能已送达）。
 */
type Phase = 'idle' | 'submitting' | 'resumed' | 'resume-failed' | 'started' | 'start-unknown'

/** 认可已经落定的两种结局；它们的屏不再接受第二次认可。 */
type ApproveSettled = 'resumed' | 'resume-failed'

/** 认可是否已经落定。 */
function isApproveSettled(phase: Phase): phase is ApproveSettled {
  return phase === 'resumed' || phase === 'resume-failed'
}

/** 认可后的状态文案；两种都意味着按钮不再可用。 */
function settledText(phase: ApproveSettled): string {
  return phase === 'resumed'
    ? '已确认，正在继续…'
    : '已确认；会话没能自动继续，在「对话」里说一句「继续」即可。'
}

/** 命令成功但不需要继续时，按命令给出作者能看懂的回执。 */
function successNotice(line: string): string {
  if (line === REJECT.line) return '已退回；这一版不会签核，等意见后重写再确认。'
  return '已提交，结果在「对话」里。'
}

type ResourceStatus = 'none' | 'loading' | 'live' | 'failed'

/** 通道状态：读不到、在读、都能读。能读之后再分别看身份与设定在不在。 */
type ChannelState = 'unavailable' | 'loading' | 'ready'

/**
 * 先把「读不到」与「在读」判掉：三个探针里任何一个没通道或还在加载，
 * 都不能对作者断言「有没有作品」。
 */
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
  if (outcome === 'unmatched') return `这个会话没有该命令：确认预设是 ${PRESET_ID}。`
  return '提交失败，稍后再试。'
}

/**
 * 作品页：作者确认闸门、立项后的开工入口与提交回执。
 * @param props slot 的 owner 面加上注册时注入的业务面
 */
export function StoryView(props: ConvViewProps & InjectFace<ViewInjected>): ReactNode {
  const { sessionId, useSessions, useResource, canCommand, runCommand, resume, start } = props
  const [notice, setNotice] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  // 双击在同一帧内连发两次 onClick，state 还没来得及更新；用 ref 抢先占位。
  const phaseRef = useRef<Phase>('idle')
  const moveTo = (next: Phase): void => {
    phaseRef.current = next
    setPhase(next)
  }
  // 在途的提交只对发起它的会话有效：面板实例会被复用，切换会话后旧结果必须丢弃。
  const currentSession = useRef<SessionId>(sessionId)
  // 开工后要见过「这一轮真的跑起来」再结束 started：否则一次瞬时 false 就会把它清掉。
  const sawTurn = useRef(false)
  const cwd = useSessions((state: SessionListState) => state.byId[sessionId]?.cwd)
  const preset = useSessions(presetSelector(sessionId))
  const sessionRunning = useSessions((state: SessionListState) => state.byId[sessionId]?.running === true)
  const outline = useResource(`${RESOURCE_PREFIX}${sessionId}${ANCHOR_OUTLINE}`)
  const manifest = useResource(`${RESOURCE_PREFIX}${sessionId}${ANCHOR_MANIFEST}`)
  const identity = useResource(`${RESOURCE_PREFIX}${sessionId}${ANCHOR_WORK}`)
  const channel = channelState([outline.status, manifest.status, identity.status])
  // 身份只看在不在：资源通道不带正文，面板不解析 JSON。
  const identified = identity.status === 'live'
  // 任一锚点存在就算有基础设定；两个都确认缺失才算还没有。
  const hasFoundation = outline.status === 'live' || manifest.status === 'live'

  // 面板实例在会话之间复用，不跟 sessionId 走就会把上一个会话的「已确认」带过来。
  // 用 layout effect 而不是 passive effect：后者要等绘制之后才跑，中间落地的旧请求
  // 会通过 stillHere 检查，把上一个会话的状态画到新会话上。
  useLayoutEffect(() => {
    currentSession.current = sessionId
    sawTurn.current = false
    phaseRef.current = 'idle'
    setPhase('idle')
    setNotice('')
  }, [sessionId])

  // 开工后的收尾：见过这一轮跑起来、又结束，就回到探针判定。会话级 running 也可能是
  // 别的轮（作者自己补的那句），所以它只用来结束 started，不用来清 start-unknown。
  useLayoutEffect(() => {
    if (phase !== 'started') return
    if (sessionRunning) {
      sawTurn.current = true
      return
    }
    if (sawTurn.current) {
      sawTurn.current = false
      phaseRef.current = 'idle'
      setPhase('idle')
    }
  }, [phase, sessionRunning])

  /**
   * 取一次点击的入口：已经在处理中、或认可已经落定时不再接受新的点击。
   * 返回 `stillHere` 判别函数；拿不到入口时返回 `undefined`。
   */
  function begin(): (() => boolean) | undefined {
    if (phaseRef.current === 'submitting' || isApproveSettled(phaseRef.current)) return undefined
    const startedFor = sessionId
    moveTo('submitting')
    return () => currentSession.current === startedFor
  }

  /**
   * 提交一条确认命令；认可成功后再把「继续」投回会话。
   * 一次点击完成两步，失败时如实区分「确认没成功」与「确认了但没继续」；
   * 调用方抛错时也要落到一句可见的失败，不能把「正在执行」挂着。
   * @param label 按钮文案
   * @param line 要提交的斜杠命令
   */
  async function submit(label: string, line: string): Promise<void> {
    const stillHere = begin()
    if (stillHere === undefined) return
    setNotice(`正在执行「${label}」…`)
    try {
      const outcome = await runCommand(sessionId, line)
      if (!stillHere()) return
      if (outcome !== 'ok') {
        setNotice(failureNotice(outcome))
        moveTo('idle')
        return
      }
      if (line !== APPROVE.line) {
        setNotice(successNotice(line))
        moveTo('idle')
        return
      }
      // 回执已经写下，从这里开始的失败只影响「有没有自动继续」。
      let resumed: ResumeOutcome = 'failed'
      try {
        resumed = await resume(sessionId)
      } catch {
        resumed = 'failed'
      }
      if (!stillHere()) return
      moveTo(resumed === 'ok' ? 'resumed' : 'resume-failed')
      setNotice('')
    } catch {
      if (stillHere()) {
        setNotice('提交失败，稍后再试。')
        moveTo('idle')
      }
    }
  }

  /**
   * 立项之后把开工指令投回会话。确定失败可以重试；抛错算结果未知，
   * 不再给按钮——请求可能已经被宿主接受，再点一次会排出第二轮。
   */
  async function startFoundation(): Promise<void> {
    const stillHere = begin()
    if (stillHere === undefined) return
    setNotice('正在开始基础设定…')
    try {
      const outcome = await start(sessionId, cwd)
      if (!stillHere()) return
      if (outcome === 'ok') {
        sawTurn.current = false
        moveTo('started')
        setNotice('')
        return
      }
      setNotice('已立项，但没能自动开始；在「对话」里说一句「开始写基础设定」即可。')
      moveTo('idle')
    } catch {
      if (!stillHere()) return
      setNotice('')
      moveTo('start-unknown')
    }
  }

  /** 两屏共用的状态行：会话运行中优先于「刚开工」。 */
  const status = sessionRunning
    ? '会话正在运行，结束后这里会按实际文件重新判定。'
    : phase === 'started'
      ? '已开始基础设定，这一轮结束后这里会按实际文件重新判定。'
      : undefined

  const body: ReactNode[] = []
  if (channel === 'unavailable') {
    body.push(<p key="none" className="sdn-muted">读不到工作区状态（文件资源通道不可用），暂时不能确认。</p>)
  } else if (channel === 'loading') {
    body.push(<p key="loading" className="sdn-muted">正在读取工作区…</p>)
  } else if (!hasFoundation) {
    if (status !== undefined) {
      body.push(<p key="status" className="sdn-muted">{status}</p>)
    } else if (phase === 'start-unknown') {
      body.push(
        <p key="unknown" className="sdn-muted">
          没能确认会话是否收到开工指令：先看「对话」里有没有新的一轮；没有的话直接在对话里说一句「开始写基础设定」。
        </p>,
      )
    } else if (identified) {
      body.push(<p key="empty" className="sdn-muted">已立项，还没有基础设定。</p>)
      if (cwd !== undefined) body.push(<p key="cwd" className="sdn-muted">当前工作区：{cwd}</p>)
      body.push(
        <div key="start" className="sdn-row">
          <button type="button" disabled={phase === 'submitting'} onClick={() => { void startFoundation() }}>
            {START_LABEL}
          </button>
        </div>,
      )
      if (notice !== '') body.push(<p key="notice" className="sdn-muted">{notice}</p>)
    } else {
      body.push(<p key="empty" className="sdn-muted">尚未立项。当前工作区既没有 work.json，也没有 source/story/。</p>)
      if (cwd !== undefined) body.push(<p key="cwd" className="sdn-muted">当前工作区：{cwd}</p>)
    }
  } else if (preset === undefined) {
    body.push(<p key="preset-loading" className="sdn-muted">正在读取会话预设…</p>)
  } else if (preset !== PRESET_ID) {
    body.push(<p key="preset-other" className="sdn-muted">这是一部作品，但当前会话用的是预设「{preset}」，不能在这里确认基础设定。</p>)
  } else if (status !== undefined) {
    body.push(<p key="status" className="sdn-muted">{status}</p>)
  } else {
    body.push(<p key="gate" className="sdn-muted">作者确认闸门：这一版基础设定需要作者认可，才允许签核定稿。</p>)
    if (!identified) {
      body.push(
        <p key="identity" className="sdn-muted">
          身份文件缺失：这个工作区有基础设定，但没有 work.json；让主编补一次立项，导出与备份才有元信息。
        </p>,
      )
    }
    if (isApproveSettled(phase)) {
      body.push(<p key="settled" className="sdn-muted">{settledText(phase)}</p>)
    } else if (canCommand(sessionId)) {
      body.push(
        <div key="actions" className="sdn-row">
          {COMMANDS.map((command) => (
            <button
              key={command.line}
              type="button"
              disabled={phase === 'submitting'}
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
