import { defineComponent, h } from 'vue'
export default defineComponent({ name: 'UserSettings', props: ['params'], setup: (p) => () => h('tui-text', null, `Settings of ${(p.params as { id: string }).id}`) })
