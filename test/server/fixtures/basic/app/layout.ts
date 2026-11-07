import { defineComponent, h } from 'vue'
export default defineComponent({
  name: 'RootLayout',
  setup(_, { slots }) {
    return () => h('tui-box', { flexDirection: 'column' }, [h('tui-text', null, '[layout]'), slots.default?.()])
  },
})
