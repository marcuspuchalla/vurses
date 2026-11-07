import { defineComponent, h } from 'vue'
export const state = { fail: true }
export default defineComponent({
  name: 'BoomPage',
  setup() {
    if (state.fail) throw new Error('kaboom')
    return () => h('tui-text', null, 'Boom recovered')
  },
})
