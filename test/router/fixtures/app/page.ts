import { defineComponent, h } from 'vue'
export const metadata = { title: 'Home' }
export default defineComponent({ name: 'HomePage', setup: () => () => h('tui-text', null, 'Home page') })
