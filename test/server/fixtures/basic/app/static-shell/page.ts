import { defineComponent, h } from 'vue'
export const runtime = 'server'
export default defineComponent({ name: 'ShellPage', setup: () => () => h('tui-text', null, 'shell page') })
