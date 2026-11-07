import { defineComponent, h, shallowRef, type PropType } from 'vue'
import type { LayoutInfo } from '../dom/nodes.js'

/**
 * `<Box>` — a flexbox container. Accepts every style prop directly
 * (`flex-direction`, `padding`, `border`, `bg`, ...), a `style` object, or
 * utility classes. Optional `title` is drawn into the top border.
 */
export const Box = defineComponent({
  name: 'Box',
  setup(_, { slots }) {
    return () => h('tui-box', null, slots.default?.())
  },
})

/**
 * `<Text>` — inline text. Nested `<Text>` elements act as styled spans.
 *   <Text bold color="primary">Hello <Text italic>world</Text></Text>
 */
export const Text = defineComponent({
  name: 'Text',
  setup(_, { slots }) {
    return () => h('tui-text', null, slots.default?.())
  },
})

/** Line break inside `<Text>`. */
export const Newline = defineComponent({
  name: 'Newline',
  props: { count: { type: Number, default: 1 } },
  setup(props) {
    return () => h('tui-newline', { count: props.count })
  },
})

/** Flexible empty space that pushes siblings apart. */
export const Spacer = defineComponent({
  name: 'Spacer',
  setup() {
    return () => h('tui-box', { flexGrow: 1, flexShrink: 1 })
  },
})

/** Centers its content on both axes. */
export const Center = defineComponent({
  name: 'Center',
  setup(_, { slots }) {
    return () =>
      h('tui-box', { flexGrow: 1, alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }, slots.default?.())
  },
})

/** Vertical stack with a gap. */
export const VStack = defineComponent({
  name: 'VStack',
  props: { gap: { type: Number, default: 0 } },
  setup(props, { slots }) {
    return () => h('tui-box', { flexDirection: 'column', gap: props.gap }, slots.default?.())
  },
})

/** Horizontal stack with a gap. */
export const HStack = defineComponent({
  name: 'HStack',
  props: { gap: { type: Number, default: 1 } },
  setup(props, { slots }) {
    return () => h('tui-box', { flexDirection: 'row', gap: props.gap }, slots.default?.())
  },
})

/** A horizontal (or vertical) rule, optionally with a title. */
export const Divider = defineComponent({
  name: 'Divider',
  props: {
    title: String,
    vertical: Boolean,
    variant: { type: String as PropType<'single' | 'double' | 'bold' | 'dashed'>, default: 'single' },
    color: { type: String, default: 'border' },
  },
  setup(props) {
    return () =>
      props.vertical
        ? h('tui-box', {
            border: props.variant,
            borderTop: false,
            borderRight: false,
            borderBottom: false,
            borderColor: props.color,
            width: 1,
            alignSelf: 'stretch',
          })
        : h('tui-box', {
            border: props.variant,
            borderLeft: false,
            borderRight: false,
            borderBottom: false,
            borderColor: props.color,
            title: props.title,
            height: 1,
            flexShrink: 0,
            alignSelf: 'stretch',
          })
  },
})

/** Reactive layout of an element; bind `onLayout` to the element. */
export function useLayout() {
  const layout = shallowRef<LayoutInfo | null>(null)
  return {
    layout,
    onLayout: (info: LayoutInfo) => {
      layout.value = info
    },
  }
}
