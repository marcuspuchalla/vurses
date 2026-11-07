import { defineComponent, h, type PropType } from 'vue'
export default defineComponent({
  name: 'BoomError',
  props: { error: { type: null }, reset: { type: Function as PropType<() => void>, required: true } },
  setup(props) {
    return () => h('tui-box', { onClick: () => props.reset() }, [h('tui-text', null, `Boom error: ${(props.error as Error).message} [retry]`)])
  },
})
