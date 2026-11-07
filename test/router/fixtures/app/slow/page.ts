import { defineComponent, h } from 'vue'

export const gate: { release?: () => void } = {}
export default defineComponent({
  name: 'SlowPage',
  async setup() {
    const data = await new Promise<string>((resolve) => (gate.release = () => resolve('slow data')))
    return () => h('tui-text', null, `Slow page: ${data}`)
  },
})
