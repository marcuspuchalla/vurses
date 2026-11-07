import { defineComponent, h } from 'vue'
export const runtime = 'server'
export const revalidate = 60
let renders = 0
export default defineComponent({ name: 'CachedPage', setup: () => { const n = ++renders; return () => h('tui-text', null, `render #${n}`) } })
