import { defineComponent, h, ref } from 'vue'
import { useInput } from '../../../../../../src/composables.js'
export default defineComponent({
  name: 'EchoPage',
  setup() {
    const typed = ref('')
    useInput((e) => {
      if (e.paste) typed.value += `[paste:${e.char}]`
      else if (e.char) typed.value += e.char
      else typed.value += `<${e.ctrl ? 'ctrl+' : ''}${e.name}>`
    })
    return () => h('tui-text', { color: 'green', bold: true }, `echo:${typed.value}|`)
  },
})
