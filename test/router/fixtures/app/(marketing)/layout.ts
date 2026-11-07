import { defineComponent, h } from 'vue'
export default defineComponent({ name: 'MarketingLayout', setup: (_, { slots }) => () => h('tui-box', { flexDirection: 'column' }, [h('tui-text', null, 'Marketing'), slots.default?.()]) })
