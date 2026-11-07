import { defineComponent, h, ref } from 'vue'
import { Outlet } from '../../../../../src/components/router.js'

export let usersLayoutMounts = 0
export default defineComponent({
  name: 'UsersLayout',
  setup() {
    usersLayoutMounts++
    const local = ref(usersLayoutMounts)
    return () => h('tui-box', { flexDirection: 'column' }, [h('tui-text', null, `Users layout #${local.value}`), h(Outlet)])
  },
})
