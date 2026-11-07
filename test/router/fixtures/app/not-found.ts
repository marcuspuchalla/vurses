import { defineComponent, h } from 'vue'
export default defineComponent({ name: 'NotFound', setup: () => () => h('tui-text', null, 'Custom 404') })
