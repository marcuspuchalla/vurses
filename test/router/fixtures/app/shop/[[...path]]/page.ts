import { defineComponent, h } from 'vue'
export default defineComponent({ name: 'Shop', props: ['params'], setup: (p) => () => h('tui-text', null, `Shop: ${((p.params as { path?: string[] }).path ?? ['(root)']).join('|')}`) })
