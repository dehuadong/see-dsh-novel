/**
 * 浏览器半边：向 `conversation.view` 注册「作品」视图。
 *
 * 这个文件由模块加载器当作脚本求值，因此不 import、不 export：
 * `window.__ModuleLoader__` 在装载器注入后调用 `load`。
 */

interface SlotRegistration {
  id: string
  order?: number
  label?: string
  name: string
}

interface ClientContext {
  slots: {
    inject(slot: string, register: () => unknown): void
    register(options: SlotRegistration, component: () => unknown): () => void
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

window.__ModuleLoader__.load({
  id: 'see-dsh-novel',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    function StoryView(): unknown {
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
        h(
          'p',
          { style: { margin: 0, opacity: 0.7 } },
          '尚未绑定作品。立项之后，阶段与章节进度会显示在这里。',
        ),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx: ClientContext): void {
        ctx.slots.inject(SLOT, () =>
          ctx.slots.register(
            { name: SLOT, id: 'see-dsh-novel', order: 20, label: '作品' },
            StoryView,
          ),
        )
      },
    }
  },
})
