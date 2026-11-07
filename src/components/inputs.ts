import { computed, defineComponent, h, ref, watch, type PropType, type VNodeChild } from 'vue'
import { useFocus } from '../composables.js'
import { matchKey, type KeyEvent } from '../input/keys.js'
import { textWidth, graphemeWidth } from '../render/text.js'
import { useLayout } from './primitives.js'

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const graphemes = (s: string) => Array.from(segmenter.segment(s), (x) => x.segment)

type Variant = 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'ghost'
const VARIANT_COLOR: Record<Variant, string> = {
  default: 'text',
  primary: 'primary',
  success: 'success',
  warning: 'warning',
  danger: 'error',
  ghost: 'muted',
}

/**
 * `<Button label="Save" variant="primary" @click="save" />`
 * Activated with enter / space / mouse click.
 */
export const Button = defineComponent({
  name: 'Button',
  props: {
    label: String,
    variant: { type: String as PropType<Variant>, default: 'default' },
    disabled: Boolean,
    autoFocus: Boolean,
    /** Draw a rounded border (default) or render compact `[ label ]`. */
    border: { type: Boolean, default: true },
    /** Optional shortcut hint shown after the label, e.g. "^S". */
    shortcut: String,
  },
  emits: ['click'],
  setup(props, { emit, slots }) {
    const hovered = ref(false)
    const pressed = ref(false)
    const activate = () => {
      if (props.disabled) return
      pressed.value = true
      setTimeout(() => (pressed.value = false), 120)
      emit('click')
    }
    const focus = useFocus({
      autoFocus: props.autoFocus,
      disabled: () => props.disabled,
      onKey(e) {
        if (matchKey(e, 'enter|space')) {
          e.stopPropagation()
          activate()
        }
      },
    })
    return () => {
      const color = VARIANT_COLOR[props.variant] ?? 'text'
      const active = focus.isFocused.value
      const content: VNodeChild = slots.default?.() ?? props.label ?? ''
      const label = h('tui-text', { bold: active || props.variant !== 'default', color: props.disabled ? 'muted' : active ? 'focus' : color, wrap: 'none' }, [
        content,
        props.shortcut ? h('tui-text', { color: 'muted', bold: false }, ` ${props.shortcut}`) : null,
      ])
      const bg = pressed.value ? 'selection' : hovered.value && !props.disabled ? 'surface' : undefined
      return h(
        'tui-box',
        {
          ref: focus.el,
          border: props.border ? (active ? 'bold' : 'round') : 'none',
          borderColor: props.disabled ? 'border' : active ? 'focus' : props.variant === 'default' ? 'border' : color,
          paddingX: props.border ? 1 : 0,
          bg,
          flexShrink: 0,
          onClick: activate,
          onMouseEnter: () => (hovered.value = true),
          onMouseLeave: () => (hovered.value = false),
        },
        props.border
          ? [label]
          : [h('tui-text', { color: active ? 'focus' : color, bold: active }, ['[ ', label, ' ]'])],
      )
    }
  },
})

/**
 * Single-line text input with v-model.
 *   <TextInput v-model="name" placeholder="Your name" @submit="go" />
 */
export const TextInput = defineComponent({
  name: 'TextInput',
  props: {
    modelValue: { type: String, default: '' },
    placeholder: { type: String, default: '' },
    /** Mask character for passwords, e.g. "•". */
    mask: String,
    password: Boolean,
    disabled: Boolean,
    autoFocus: Boolean,
    border: { type: Boolean, default: true },
    width: { type: [Number, String], default: undefined },
    maxLength: Number,
    /** Label drawn into the top border. */
    label: String,
  },
  emits: ['update:modelValue', 'submit', 'change', 'focus', 'blur'],
  setup(props, { emit }) {
    const value = ref(props.modelValue)
    watch(
      () => props.modelValue,
      (v) => {
        if (v !== value.value) {
          value.value = v
          cursor.value = Math.min(cursor.value, graphemes(v).length)
        }
      },
    )
    const cursor = ref(graphemes(props.modelValue).length)
    // horizontal scroll offset (plain variable: updated during render)
    let offset = 0
    const { layout, onLayout } = useLayout()

    const set = (v: string, c: number) => {
      if (props.maxLength !== undefined && graphemes(v).length > props.maxLength) return
      value.value = v
      cursor.value = c
      emit('update:modelValue', v)
      emit('change', v)
    }

    const wordLeft = (g: string[], c: number) => {
      let i = c
      while (i > 0 && g[i - 1] === ' ') i--
      while (i > 0 && g[i - 1] !== ' ') i--
      return i
    }
    const wordRight = (g: string[], c: number) => {
      let i = c
      while (i < g.length && g[i] === ' ') i++
      while (i < g.length && g[i] !== ' ') i++
      return i
    }

    const onKey = (e: KeyEvent) => {
      const g = graphemes(value.value)
      const c = cursor.value
      let handled = true
      if (e.paste || (e.char && !e.ctrl && !e.meta)) {
        const text = e.char.replace(/[\r\n]+/g, ' ')
        set([...g.slice(0, c), text, ...g.slice(c)].join(''), c + graphemes(text).length)
      } else if (matchKey(e, 'backspace')) {
        if (c > 0) set([...g.slice(0, c - 1), ...g.slice(c)].join(''), c - 1)
      } else if (matchKey(e, 'meta+backspace|ctrl+w|ctrl+backspace')) {
        const i = wordLeft(g, c)
        set([...g.slice(0, i), ...g.slice(c)].join(''), i)
      } else if (matchKey(e, 'delete|ctrl+d')) {
        if (c < g.length) set([...g.slice(0, c), ...g.slice(c + 1)].join(''), c)
      } else if (matchKey(e, 'left|ctrl+b')) cursor.value = Math.max(0, c - 1)
      else if (matchKey(e, 'right|ctrl+f')) cursor.value = Math.min(g.length, c + 1)
      else if (matchKey(e, 'meta+left|ctrl+left|meta+b')) cursor.value = wordLeft(g, c)
      else if (matchKey(e, 'meta+right|ctrl+right|meta+f')) cursor.value = wordRight(g, c)
      else if (matchKey(e, 'home|ctrl+a')) cursor.value = 0
      else if (matchKey(e, 'end|ctrl+e')) cursor.value = g.length
      else if (matchKey(e, 'ctrl+u')) set(g.slice(c).join(''), 0)
      else if (matchKey(e, 'ctrl+k')) set(g.slice(0, c).join(''), c)
      else if (matchKey(e, 'enter')) emit('submit', value.value)
      else handled = false
      if (handled) e.stopPropagation()
    }

    const focus = useFocus({
      autoFocus: props.autoFocus,
      disabled: () => props.disabled,
      onKey,
      onFocus: () => emit('focus'),
      onBlur: () => emit('blur'),
    })

    const display = computed(() => {
      const g = graphemes(value.value)
      const mask = props.mask ?? (props.password ? '•' : undefined)
      return mask ? g.map(() => mask) : g
    })

    return () => {
      const active = focus.isFocused.value
      const g = display.value
      const width = Math.max(1, (layout.value?.innerWidth ?? 20) - 1)
      // keep the cursor visible
      let off = offset
      if (cursor.value < off) off = cursor.value
      let w = 0
      for (let i = off; i < cursor.value; i++) w += graphemeWidth(g[i])
      while (w > width && off < cursor.value) {
        w -= graphemeWidth(g[off])
        off++
      }
      offset = off

      let children: VNodeChild[]
      if (!g.length) {
        const ph = props.placeholder
        children = active
          ? [h('tui-text', { inverse: true }, ph ? ph[0] : ' '), h('tui-text', { color: 'muted' }, ph.slice(1))]
          : [h('tui-text', { color: 'muted' }, ph || ' ')]
      } else {
        const before = g.slice(off, cursor.value).join('')
        const at = g[cursor.value] ?? ' '
        let after = ''
        let aw = textWidth(before) + 1
        for (let i = cursor.value + 1; i < g.length && aw < width + 1; i++) {
          after += g[i]
          aw += graphemeWidth(g[i])
        }
        children = active
          ? [before, h('tui-text', { inverse: true }, at), after]
          : [g.slice(off).join('')]
      }
      return h(
        'tui-box',
        {
          ref: focus.el,
          border: props.border ? 'round' : 'none',
          borderColor: active ? 'focus' : 'border',
          title: props.label,
          titleColor: active ? 'focus' : 'muted',
          paddingX: props.border ? 1 : 0,
          width: props.width,
          flexShrink: 0,
          onLayout,
          onClick: (e: { localX: number }) => {
            const x = e.localX - (props.border ? 2 : 0)
            let acc = 0
            let i = off
            while (i < g.length && acc + graphemeWidth(g[i]) <= x) acc += graphemeWidth(g[i++])
            cursor.value = Math.min(g.length, i)
          },
        },
        [h('tui-text', { wrap: 'none', color: props.disabled ? 'muted' : undefined, overflow: 'hidden' }, children)],
      )
    }
  },
})

/** `<Checkbox v-model="agree" label="I agree" />` */
export const Checkbox = defineComponent({
  name: 'Checkbox',
  props: {
    modelValue: Boolean,
    label: String,
    disabled: Boolean,
    autoFocus: Boolean,
  },
  emits: ['update:modelValue', 'change'],
  setup(props, { emit, slots }) {
    const toggle = () => {
      if (props.disabled) return
      emit('update:modelValue', !props.modelValue)
      emit('change', !props.modelValue)
    }
    const focus = useFocus({
      autoFocus: props.autoFocus,
      disabled: () => props.disabled,
      onKey(e) {
        if (matchKey(e, 'space|enter')) {
          e.stopPropagation()
          toggle()
        }
      },
    })
    return () => {
      const active = focus.isFocused.value
      return h('tui-box', { ref: focus.el, onClick: toggle, flexShrink: 0 }, [
        h('tui-text', { wrap: 'none' }, [
          h('tui-text', { color: active ? 'focus' : props.modelValue ? 'primary' : 'muted', bold: active }, props.modelValue ? '[✓] ' : '[ ] '),
          h('tui-text', { color: props.disabled ? 'muted' : active ? 'focus' : undefined, underline: active }, slots.default?.() ?? props.label ?? ''),
        ]),
      ])
    }
  },
})

/** `<Switch v-model="enabled" label="Notifications" />` */
export const Switch = defineComponent({
  name: 'Switch',
  props: {
    modelValue: Boolean,
    label: String,
    disabled: Boolean,
    autoFocus: Boolean,
  },
  emits: ['update:modelValue', 'change'],
  setup(props, { emit, slots }) {
    const toggle = () => {
      if (props.disabled) return
      emit('update:modelValue', !props.modelValue)
      emit('change', !props.modelValue)
    }
    const focus = useFocus({
      autoFocus: props.autoFocus,
      disabled: () => props.disabled,
      onKey(e) {
        if (matchKey(e, 'space|enter')) {
          e.stopPropagation()
          toggle()
        } else if (matchKey(e, 'left') && props.modelValue) {
          e.stopPropagation()
          toggle()
        } else if (matchKey(e, 'right') && !props.modelValue) {
          e.stopPropagation()
          toggle()
        }
      },
    })
    return () => {
      const on = props.modelValue
      const active = focus.isFocused.value
      return h('tui-box', { ref: focus.el, onClick: toggle, flexShrink: 0, gap: 1 }, [
        h('tui-text', { wrap: 'none' }, [
          h('tui-text', { bg: on ? 'success' : 'border', color: on ? 'black' : 'text' }, on ? ' ON ' : '    '),
          h('tui-text', { bg: on ? 'border' : 'muted', color: on ? 'text' : 'black' }, on ? '  ' : 'OFF '),
        ]),
        props.label || slots.default
          ? h('tui-text', { color: active ? 'focus' : undefined, bold: active }, slots.default?.() ?? props.label)
          : null,
      ])
    }
  },
})

export interface Option<T = unknown> {
  label: string
  value: T
  disabled?: boolean
  description?: string
  /** Optional color for the label. */
  color?: string
}

export function normalizeOptions(items: unknown[]): Option[] {
  return items.map((o) =>
    typeof o === 'object' && o !== null && 'label' in o
      ? (o as Option)
      : { label: String(o), value: o },
  )
}

/**
 * Radio buttons. `<RadioGroup v-model="size" :options="['S','M','L']" />`
 */
export const RadioGroup = defineComponent({
  name: 'RadioGroup',
  props: {
    modelValue: { type: null as unknown as PropType<unknown>, default: undefined },
    options: { type: Array as PropType<unknown[]>, required: true },
    horizontal: Boolean,
    disabled: Boolean,
    autoFocus: Boolean,
  },
  emits: ['update:modelValue', 'change'],
  setup(props, { emit }) {
    const opts = computed(() => normalizeOptions(props.options))
    const cursor = ref(Math.max(0, opts.value.findIndex((o) => o.value === props.modelValue)))
    const choose = (i: number) => {
      const o = opts.value[i]
      if (!o || o.disabled) return
      cursor.value = i
      emit('update:modelValue', o.value)
      emit('change', o.value)
    }
    const focus = useFocus({
      autoFocus: props.autoFocus,
      disabled: () => props.disabled,
      onKey(e) {
        const prevKey = props.horizontal ? 'left|h' : 'up|k'
        const nextKey = props.horizontal ? 'right|l' : 'down|j'
        if (matchKey(e, prevKey)) cursor.value = Math.max(0, cursor.value - 1)
        else if (matchKey(e, nextKey)) cursor.value = Math.min(opts.value.length - 1, cursor.value + 1)
        else if (matchKey(e, 'space|enter')) choose(cursor.value)
        else return
        e.stopPropagation()
      },
    })
    return () => {
      const active = focus.isFocused.value
      return h(
        'tui-box',
        { ref: focus.el, flexDirection: props.horizontal ? 'row' : 'column', gap: props.horizontal ? 2 : 0, flexShrink: 0 },
        opts.value.map((o, i) => {
          const checked = o.value === props.modelValue
          const hl = active && i === cursor.value
          return h('tui-text', { key: i, wrap: 'none', onClick: () => choose(i) }, [
            h('tui-text', { color: checked ? 'primary' : 'muted' }, checked ? '◉ ' : '○ '),
            h('tui-text', { color: o.disabled ? 'muted' : hl ? 'focus' : o.color, bold: hl, underline: hl }, o.label),
          ])
        }),
      )
    }
  },
})

/**
 * Selectable, scrollable list.
 *   <List :items="files" v-model="index" @select="open" :height="10" />
 * Custom rendering: `<template #item="{ item, index, selected, active }">`
 */
export const List = defineComponent({
  name: 'List',
  props: {
    items: { type: Array as PropType<unknown[]>, required: true },
    /** Index of the highlighted item. */
    modelValue: { type: Number, default: 0 },
    /** Visible rows (scrolls when there are more items). Defaults to all. */
    height: Number,
    disabled: Boolean,
    autoFocus: Boolean,
    /** Indicator drawn before the highlighted item. */
    indicator: { type: String, default: '❯' },
    /** Keep the highlight visible when not focused. */
    showSelectionWhenBlurred: { type: Boolean, default: true },
    /** Wrap around at the ends. */
    loop: Boolean,
  },
  emits: ['update:modelValue', 'select', 'highlight'],
  setup(props, { emit, slots }) {
    const opts = computed(() => normalizeOptions(props.items))
    const index = ref(props.modelValue)
    let scroll = 0
    const { layout, onLayout } = useLayout()
    watch(
      () => props.modelValue,
      (v) => (index.value = v),
    )
    const visibleRows = () => props.height ?? layout.value?.innerHeight ?? opts.value.length
    const move = (to: number) => {
      const n = opts.value.length
      if (!n) return
      if (props.loop) to = (to + n) % n
      to = Math.max(0, Math.min(n - 1, to))
      index.value = to
      emit('update:modelValue', to)
      emit('highlight', props.items[to], to)
    }
    const select = (i: number) => {
      const o = opts.value[i]
      if (!o || o.disabled) return
      emit('select', props.items[i], i)
    }
    const focus = useFocus({
      autoFocus: props.autoFocus,
      disabled: () => props.disabled,
      onKey(e) {
        const rows = Math.max(1, visibleRows())
        if (matchKey(e, 'up|k|ctrl+p')) move(index.value - 1)
        else if (matchKey(e, 'down|j|ctrl+n')) move(index.value + 1)
        else if (matchKey(e, 'pageup')) move(index.value - rows)
        else if (matchKey(e, 'pagedown')) move(index.value + rows)
        else if (matchKey(e, 'home|g')) move(0)
        else if (matchKey(e, 'end|shift+g')) move(opts.value.length - 1)
        else if (matchKey(e, 'enter|space')) select(index.value)
        else return
        e.stopPropagation()
      },
    })
    return () => {
      const active = focus.isFocused.value
      const rows = Math.max(1, visibleRows())
      const n = opts.value.length
      let s = scroll
      if (index.value < s) s = index.value
      if (index.value >= s + rows) s = index.value - rows + 1
      s = Math.max(0, Math.min(s, Math.max(0, n - rows)))
      scroll = s
      const visible = opts.value.slice(s, s + rows)
      const showSel = active || props.showSelectionWhenBlurred
      const children = visible.map((o, k) => {
        const i = s + k
        const selected = i === index.value && showSel
        if (slots.item) {
          return h(
            'tui-box',
            { key: i, bg: selected ? 'selection' : undefined, flexShrink: 0, onClick: () => (move(i), select(i)) },
            slots.item({ item: props.items[i], index: i, selected, active }),
          )
        }
        return h(
          'tui-box',
          { key: i, bg: selected ? 'selection' : undefined, flexShrink: 0, onClick: () => (move(i), select(i)), gap: 1 },
          [
            h('tui-text', { color: active ? 'focus' : 'muted', wrap: 'none' }, selected ? props.indicator : ' '.repeat(textWidth(props.indicator))),
            h('tui-text', { wrap: 'truncate', flexGrow: 1, color: o.disabled ? 'muted' : selected ? (active ? 'text' : 'text') : o.color, bold: selected && active }, o.label),
            o.description ? h('tui-text', { color: 'muted', wrap: 'truncate', flexShrink: 1 }, o.description) : null,
          ],
        )
      })
      const scrollable = n > rows
      return h('tui-box', { ref: focus.el, flexDirection: 'row', height: props.height, onLayout: props.height ? undefined : onLayout, flexShrink: props.height ? 0 : 1, onWheel: (e: { direction: string }) => move(index.value + (e.direction === 'up' ? -1 : 1)) }, [
        h('tui-box', { flexDirection: 'column', flexGrow: 1, overflow: 'hidden' }, children),
        scrollable ? h(ScrollbarTrack, { total: n, visible: rows, offset: s }) : null,
      ])
    }
  },
})

/**
 * Value-based select: `<Select v-model="lang" :options="[{label:'Vue', value:'vue'}]" />`
 */
export const Select = defineComponent({
  name: 'Select',
  props: {
    modelValue: { type: null as unknown as PropType<unknown>, default: undefined },
    options: { type: Array as PropType<unknown[]>, required: true },
    height: Number,
    disabled: Boolean,
    autoFocus: Boolean,
  },
  emits: ['update:modelValue', 'change'],
  setup(props, { emit }) {
    const opts = computed(() => normalizeOptions(props.options))
    const index = ref(Math.max(0, opts.value.findIndex((o) => o.value === props.modelValue)))
    return () =>
      h(
        List,
        {
          items: props.options,
          modelValue: index.value,
          'onUpdate:modelValue': (i: number) => (index.value = i),
          height: props.height,
          disabled: props.disabled,
          autoFocus: props.autoFocus,
          onSelect: (_: unknown, i: number) => {
            const v = opts.value[i].value
            emit('update:modelValue', v)
            emit('change', v)
          },
        },
        {
          item: ({ item, selected, active }: { item: unknown; selected: boolean; active: boolean }) => {
            const o = normalizeOptions([item])[0]
            const chosen = o.value === props.modelValue
            return [
              h('tui-text', { color: active && selected ? 'focus' : 'muted', wrap: 'none' }, selected ? '❯ ' : '  '),
              h('tui-text', { color: chosen ? 'primary' : o.disabled ? 'muted' : undefined, bold: chosen, wrap: 'truncate', flexGrow: 1 }, o.label),
              chosen ? h('tui-text', { color: 'primary' }, ' ✓') : null,
            ]
          },
        },
      )
  },
})

/** Vertical scrollbar track (used by List and ScrollBox). */
export const ScrollbarTrack = defineComponent({
  name: 'ScrollbarTrack',
  props: {
    total: { type: Number, required: true },
    visible: { type: Number, required: true },
    offset: { type: Number, required: true },
    height: Number,
  },
  setup(props) {
    return () => {
      const h0 = Math.max(1, props.height ?? props.visible)
      const thumb = Math.max(1, Math.round((props.visible / Math.max(1, props.total)) * h0))
      const maxOff = Math.max(1, props.total - props.visible)
      const pos = Math.round((Math.min(props.offset, maxOff) / maxOff) * (h0 - thumb))
      const lines: string[] = []
      for (let i = 0; i < h0; i++) lines.push(i >= pos && i < pos + thumb ? '┃' : '│')
      const children: VNodeChild[] = []
      lines.forEach((l, i) => {
        if (i) children.push('\n')
        children.push(i >= pos && i < pos + thumb ? h('tui-text', { color: 'muted' }, l) : l)
      })
      return h('tui-box', { width: 1, flexShrink: 0, flexDirection: 'column' }, [h('tui-text', { color: 'border' }, children)])
    }
  },
})
