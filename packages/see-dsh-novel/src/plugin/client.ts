/**
 * 浏览器半边：向 `conversation.view` 注册「作品」视图。
 *
 * 这个文件由模块加载器当作脚本求值，因此不 import、不 export：
 * `window.__ModuleLoader__.load` 在装载器注入后调用 `factory`。
 *
 * 视图只判断「确认区能不能用」，不读作品内容：目录与预设来自客户端已有通道，
 * 工件清单与摘要由命令结果写在会话里。作品绑定与进入作品的流程不属于本能力。
 */

interface SlotRegistration {
  id: string
  order?: number
  label?: string
  name: string
  inject?: () => unknown
}

interface SessionRow {
  cwd?: string
  projectionValues?: { agentPreset?: string | null }
}

interface SessionListState {
  byId: Record<string, SessionRow | undefined>
  projectionsBySession?: Record<string, { values?: { agentPreset?: string | null } } | undefined>
}

interface ResourceSnapshot {
  status: 'none' | 'loading' | 'live' | 'failed'
  value?: unknown
  failure?: unknown
}

interface ViewProps {
  sessionId: string
  useSessions: <T>(select: (state: SessionListState) => T) => T
  useResource: (address: string) => ResourceSnapshot
  canCommand: (sessionId: string) => boolean
  runCommand: (sessionId: string, line: string) => void
}

interface SessionCommandFace {
  command(line: string): Promise<unknown>
}

interface SessionBindingLike {
  session: SessionCommandFace
}

interface ClientContext {
  slots: {
    inject(slot: string, register: () => unknown): void
    register(options: SlotRegistration, component: (props: ViewProps) => unknown): () => void
  }
  sessions: {
    binding(sessionId: string): SessionBindingLike | undefined
  }
}

interface ClientPlugin {
  inject: string[]
  apply(ctx: ClientContext): void
}

interface ModuleLoader {
  load(declaration: { id: string, factory(require: (name: string) => any): ClientPlugin }): void
}

declare const window: { __ModuleLoader__: ModuleLoader }

const SLOT = 'conversation.view'
/** 与 `cordis.patch.yml` 里 `preset-see-dsh-novel` 的 id 一致；改预设 id 时两处同改。 */
const PRESET = 'see-dsh-novel'
const RESOURCE_PREFIX = 'dsh-resource://file/session/'

/**
 * 作品存在的判据：`file` 协议的 stat 只接受普通文件，探不到目录，
 * 所以用流水线必然先写下的两个锚点文件代替「source/story/ 存在」这层判断。
 */
const ANCHOR_OUTLINE = '/source/story/outline/story_frame.md'
const ANCHOR_MANIFEST = '/source/story/state/manifest.json'

/** 两个锚点合成一个三态：任一存在即作品；都在加载就先等；都报缺失才算没有。 */
function workState(states: ReadonlyArray<'none' | 'loading' | 'live' | 'failed'>): 'none' | 'loading' | 'live' | 'failed' {
  if (states.includes('live')) return 'live'
  if (states.includes('loading')) return 'loading'
  if (states.includes('failed')) return 'failed'
  return 'none'
}

const MUTED = { margin: 0, opacity: 0.7 }
const ROW = { display: 'flex', gap: '8px' }

window.__ModuleLoader__.load({
  id: 'see-dsh-novel',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    function button(label: string, onClick: () => void): unknown {
      return h('button', { type: 'button', onClick }, label)
    }

    function StoryView(props: ViewProps): unknown {
      const { sessionId, useSessions, useResource, canCommand, runCommand } = props
      const cwd = useSessions((state) => state.byId[sessionId]?.cwd)
      const preset = useSessions((state) => state.projectionsBySession?.[sessionId]?.values?.agentPreset
        ?? state.byId[sessionId]?.projectionValues?.agentPreset)
      const outline = useResource(`${RESOURCE_PREFIX}${sessionId}${ANCHOR_OUTLINE}`)
      const manifest = useResource(`${RESOURCE_PREFIX}${sessionId}${ANCHOR_MANIFEST}`)
      const work = workState([outline.status, manifest.status])

      const body: unknown[] = []
      if (work === 'none') {
        body.push(h('p', { style: MUTED }, '读不到工作区状态（文件资源通道不可用），暂时不能确认。'))
      } else if (work === 'loading') {
        body.push(h('p', { style: MUTED }, '正在读取工作区…'))
      } else if (work === 'failed') {
        body.push(h('p', { style: MUTED }, '尚未绑定作品。当前工作区还没有 source/story/，先让本会话跑一遍基础设定。'))
        if (cwd !== undefined) body.push(h('p', { style: MUTED }, `当前工作区：${cwd}`))
      } else if (preset === undefined) {
        body.push(h('p', { style: MUTED }, '正在读取会话预设…'))
      } else if (preset !== PRESET) {
        body.push(h('p', { style: MUTED }, `这是一部作品，但当前会话用的是预设「${preset}」，不能在这里确认基础设定。`))
      } else {
        body.push(h('p', { style: MUTED }, '作者确认闸门：这一版基础设定需要作者认可，才允许签核定稿。'))
        if (canCommand(sessionId)) {
          body.push(h('div', { style: ROW },
            button('查看待确认', () => runCommand(sessionId, '/story-review')),
            button('认可', () => runCommand(sessionId, '/story-approve')),
            button('退回', () => runCommand(sessionId, '/story-reject'))))
          body.push(h('p', { style: MUTED }, '清单、摘要与确认结果会出现在会话里。'))
        } else {
          body.push(h('p', { style: MUTED }, '当前会话还没有就绪，暂时不能提交确认。'))
        }
      }

      return h(
        'section',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            padding: '16px',
            height: '100%',
            boxSizing: 'border-box',
          },
        },
        h('h2', { style: { margin: 0, fontSize: '16px', fontWeight: 600 } }, '作品'),
        ...body,
      )
    }

    return {
      inject: ['slots', 'sessions'],
      apply(ctx: ClientContext): void {
        ctx.slots.inject(SLOT, () => ctx.slots.register(
          {
            name: SLOT,
            id: 'see-dsh-novel',
            order: 20,
            label: '作品',
            inject: () => ({
              canCommand: (sessionId: string): boolean => ctx.sessions.binding(sessionId) !== undefined,
              runCommand: (sessionId: string, line: string): void => {
                const binding = ctx.sessions.binding(sessionId)
                if (binding === undefined) return
                void binding.session.command(line)
              },
            }),
          },
          StoryView,
        ))
      },
    }
  },
})
