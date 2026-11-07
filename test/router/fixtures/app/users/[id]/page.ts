import { defineComponent, h, type PropType } from 'vue'
import { usePathname } from '../../../../../../src/router/composables.js'

export async function generateMetadata({ params }: { params: { id: string } }) {
  return { title: `User ${params.id}` }
}
export default defineComponent({
  name: 'UserPage',
  props: { params: { type: Object as PropType<{ id: string }>, required: true }, searchParams: Object as PropType<Record<string, string>> },
  setup(props) {
    const pathname = usePathname()
    return () => h('tui-text', null, `User id=${props.params.id} tab=${props.searchParams?.tab ?? '-'} path=${pathname.value}`)
  },
})
