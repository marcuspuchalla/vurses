import { defineComponent, h, ref } from 'vue'
import { useInput } from '../../../../../../src/composables.js'
export const runtime = 'server'
export const metadata = { title: 'Live' }
export default defineComponent({
  name: 'LivePage',
  setup() {
    const typed = ref('')
    useInput((e) => {
      if (e.char) typed.value += e.char
      else if (e.name === 'enter') typed.value += '⏎'
    })
    return () => h('tui-text', null, `typed: ${typed.value}|`)
  },
})
