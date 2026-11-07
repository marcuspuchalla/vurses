import { defineComponent, h } from 'vue'
export const metadata = { title: 'About' }
export const runtime = 'server'
export default defineComponent({ name: 'AboutPage', setup: () => () => h('tui-text', null, 'About page') })
