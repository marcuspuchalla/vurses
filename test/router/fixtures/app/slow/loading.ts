import { defineComponent, h } from 'vue'
export default defineComponent({ name: 'SlowLoading', setup: () => () => h('tui-text', null, 'Loading slow...') })
