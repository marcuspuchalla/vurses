import { defineComponent, h } from 'vue'
export default defineComponent({ name: 'Docs', props: ['params'], setup: (p) => () => h('tui-text', null, `Docs: ${((p.params as { slug: string[] }).slug).join('|')}`) })
