window.__ModuleLoader__.load({
  id: 'see-dsh-novel',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    function StoryView() {
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
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('conversation.view', () =>
          ctx.slots.register(
            { name: 'conversation.view', id: 'see-dsh-novel', order: 20, label: '作品' },
            StoryView,
          ),
        );
      },
    };
  },
});
