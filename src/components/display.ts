import { computed, defineComponent, h, ref, watch, type PropType, type VNodeChild } from 'vue'
import { useFocus, useInterval } from '../composables.js'
import { formatKey, matchKey } from '../input/keys.js'
import { textWidth } from '../render/text.js'
import { useLayout } from './primitives.js'
import { ScrollbarTrack } from './inputs.js'

const BLOCKS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉', '█']

/** `<ProgressBar :value="0.42" show-percent />` — value in [0, 1] (or use `max`). */
export const ProgressBar = defineComponent({
  name: 'ProgressBar',
  props: {
    value: { type: Number, required: true },
    max: { type: Number, default: 1 },
    width: Number,
    color: { type: String, default: 'primary' },
    trackColor: { type: String, default: 'border' },
    showPercent: Boolean,
    label: String,
  },
  setup(props) {
    const { layout, onLayout } = useLayout()
    return () => {
      const ratio = Math.max(0, Math.min(1, props.value / (props.max || 1)))
      const pct = `${Math.round(ratio * 100)}%`.padStart(4)
      const width = props.width ?? Math.max(1, layout.value?.innerWidth ?? 20)
      const cells = ratio * width
      const full = Math.floor(cells)
      const part = BLOCKS[Math.round((cells - full) * 8)]
      const rest = Math.max(0, width - full - (part ? 1 : 0))
      return h('tui-box', { flexDirection: 'row', gap: 1, flexGrow: props.width ? 0 : 1, flexShrink: 1 }, [
        props.label ? h('tui-text', { wrap: 'none' }, props.label) : null,
        h('tui-box', { flexGrow: props.width ? 0 : 1, width: props.width, onLayout, height: 1 }, [
          h('tui-text', { wrap: 'none' }, [
            h('tui-text', { color: props.color }, '█'.repeat(full) + part),
            h('tui-text', { color: props.trackColor }, '░'.repeat(rest)),
          ]),
        ]),
        props.showPercent ? h('tui-text', { color: 'muted', wrap: 'none' }, pct) : null,
      ])
    }
  },
})

export const SPINNERS: Record<string, { interval: number; frames: string[] }> = {
  dots: { interval: 80, frames: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] },
  line: { interval: 120, frames: ['-', '\\', '|', '/'] },
  arc: { interval: 100, frames: ['◜', '◠', '◝', '◞', '◡', '◟'] },
  bounce: { interval: 120, frames: ['⠁', '⠂', '⠄', '⠂'] },
  circle: { interval: 120, frames: ['◐', '◓', '◑', '◒'] },
  bar: { interval: 80, frames: ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█', '▇', '▆', '▅', '▄', '▃', '▂'] },
  pulse: { interval: 140, frames: ['●', '◉', '○', '◉'] },
}

/** `<Spinner type="dots" label="Loading…" />` */
export const Spinner = defineComponent({
  name: 'Spinner',
  props: {
    type: { type: String, default: 'dots' },
    label: String,
    color: { type: String, default: 'primary' },
  },
  setup(props, { slots }) {
    const frame = ref(0)
    const spec = computed(() => SPINNERS[props.type] ?? SPINNERS.dots)
    useInterval(() => frame.value++, spec.value.interval)
    return () => {
      const f = spec.value.frames[frame.value % spec.value.frames.length]
      return h('tui-text', { wrap: 'none' }, [
        h('tui-text', { color: props.color }, f),
        props.label || slots.default ? [' ', slots.default?.() ?? props.label] : null,
      ])
    }
  },
})

const SPARK = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']

/** `<Sparkline :data="[1,5,2,8]" :width="20" color="accent" />` */
export const Sparkline = defineComponent({
  name: 'Sparkline',
  props: {
    data: { type: Array as PropType<number[]>, required: true },
    width: Number,
    min: Number,
    max: Number,
    color: { type: String, default: 'accent' },
  },
  setup(props) {
    return () => {
      const data = props.width ? props.data.slice(-props.width) : props.data
      const min = props.min ?? Math.min(...data, 0)
      const max = props.max ?? Math.max(...data, 1)
      const span = max - min || 1
      const s = data.map((v) => SPARK[Math.max(0, Math.min(7, Math.round(((v - min) / span) * 7)))]).join('')
      return h('tui-text', { color: props.color, wrap: 'none' }, s.padStart(props.width ?? 0, ' '))
    }
  },
})

export interface BarDatum {
  label: string
  value: number
  color?: string
}

/** Horizontal bar chart. `<BarChart :data="[{ label: 'vue', value: 42 }]" />` */
export const BarChart = defineComponent({
  name: 'BarChart',
  props: {
    data: { type: Array as PropType<BarDatum[]>, required: true },
    max: Number,
    color: { type: String, default: 'primary' },
    showValues: { type: Boolean, default: true },
    format: { type: Function as PropType<(v: number) => string>, default: (v: number) => String(v) },
  },
  setup(props) {
    const { layout, onLayout } = useLayout()
    return () => {
      const labelW = Math.max(0, ...props.data.map((d) => textWidth(d.label)))
      const valueW = props.showValues ? Math.max(0, ...props.data.map((d) => textWidth(props.format(d.value)))) : 0
      const total = layout.value?.innerWidth ?? 40
      const barW = Math.max(1, total - labelW - valueW - 2)
      const max = props.max ?? Math.max(...props.data.map((d) => d.value), 1)
      return h(
        'tui-box',
        { flexDirection: 'column', onLayout, flexGrow: 1 },
        props.data.map((d, i) => {
          const cells = (Math.max(0, d.value) / max) * barW
          const full = Math.floor(cells)
          const part = BLOCKS[Math.round((cells - full) * 8)]
          return h('tui-text', { key: i, wrap: 'none' }, [
            h('tui-text', { color: 'muted' }, pad(d.label, labelW) + ' '),
            h('tui-text', { color: d.color ?? props.color }, '█'.repeat(full) + part),
            props.showValues ? h('tui-text', { color: 'text' }, ' ' + props.format(d.value)) : null,
          ])
        }),
      )
    }
  },
})

export interface Column {
  key: string
  title?: string
  width?: number
  align?: 'left' | 'right' | 'center'
  color?: string
  format?: (value: unknown, row: Record<string, unknown>) => string
}

function pad(s: string, w: number, align: Column['align'] = 'left') {
  let tw = textWidth(s)
  if (tw > w) {
    // truncate by graphemes
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    let out = ''
    let acc = 0
    for (const { segment } of seg.segment(s)) {
      const gw = textWidth(segment)
      if (acc + gw > w - 1) break
      out += segment
      acc += gw
    }
    s = out + '…'
    tw = acc + 1
  }
  const free = Math.max(0, w - tw)
  if (align === 'right') return ' '.repeat(free) + s
  if (align === 'center') return ' '.repeat(Math.floor(free / 2)) + s + ' '.repeat(Math.ceil(free / 2))
  return s + ' '.repeat(free)
}

/**
 * Data table with optional row selection.
 *   <Table :columns="cols" :rows="rows" selectable v-model="selected" :height="10" @select="open" />
 */
export const Table = defineComponent({
  name: 'Table',
  props: {
    rows: { type: Array as PropType<Record<string, unknown>[]>, required: true },
    columns: { type: Array as PropType<(Column | string)[]> },
    /** Enables focus & keyboard row selection. */
    selectable: Boolean,
    modelValue: { type: Number, default: 0 },
    /** Visible body rows. */
    height: Number,
    border: { type: String, default: 'round' },
    title: String,
    autoFocus: Boolean,
    zebra: Boolean,
  },
  emits: ['update:modelValue', 'select'],
  setup(props, { emit }) {
    const index = ref(props.modelValue)
    watch(
      () => props.modelValue,
      (v) => (index.value = v),
    )
    let scroll = 0
    const cols = computed<Column[]>(() => {
      const raw = props.columns ?? Object.keys(props.rows[0] ?? {})
      return raw.map((c) => (typeof c === 'string' ? { key: c, title: c } : c))
    })
    const cell = (c: Column, row: Record<string, unknown>) => (c.format ? c.format(row[c.key], row) : String(row[c.key] ?? ''))
    const widths = computed(() =>
      cols.value.map(
        (c) => c.width ?? Math.max(textWidth(c.title ?? c.key), ...props.rows.map((r) => textWidth(cell(c, r)))),
      ),
    )
    const move = (i: number) => {
      const n = props.rows.length
      if (!n) return
      index.value = Math.max(0, Math.min(n - 1, i))
      emit('update:modelValue', index.value)
    }
    const focus = useFocus({
      autoFocus: props.autoFocus,
      disabled: () => !props.selectable,
      onKey(e) {
        const rows = props.height ?? props.rows.length
        if (matchKey(e, 'up|k')) move(index.value - 1)
        else if (matchKey(e, 'down|j')) move(index.value + 1)
        else if (matchKey(e, 'pageup')) move(index.value - rows)
        else if (matchKey(e, 'pagedown')) move(index.value + rows)
        else if (matchKey(e, 'home|g')) move(0)
        else if (matchKey(e, 'end|shift+g')) move(props.rows.length - 1)
        else if (matchKey(e, 'enter')) emit('select', props.rows[index.value], index.value)
        else return
        e.stopPropagation()
      },
    })
    return () => {
      const active = focus.isFocused.value
      const n = props.rows.length
      const visible = props.height ?? n
      let s = scroll
      if (index.value < s) s = index.value
      if (index.value >= s + visible) s = index.value - visible + 1
      s = Math.max(0, Math.min(s, Math.max(0, n - visible)))
      scroll = s
      const ws = widths.value
      const header = h(
        'tui-text',
        { bold: true, color: 'muted', wrap: 'none' },
        cols.value.map((c, i) => pad(c.title ?? c.key, ws[i], c.align) + (i < ws.length - 1 ? '  ' : '')),
      )
      const body = props.rows.slice(s, s + visible).map((row, k) => {
        const i = s + k
        const selected = props.selectable && i === index.value
        return h(
          'tui-box',
          {
            key: i,
            bg: selected ? (active ? 'selection' : 'surface') : props.zebra && i % 2 ? 'surface' : undefined,
            flexShrink: 0,
            onClick: () => {
              move(i)
              emit('select', props.rows[i], i)
            },
          },
          [
            h(
              'tui-text',
              { wrap: 'none', bold: selected && active },
              cols.value.map((c, ci) =>
                h('tui-text', { color: c.color }, pad(cell(c, row), ws[ci], c.align) + (ci < ws.length - 1 ? '  ' : '')),
              ),
            ),
          ],
        )
      })
      return h(
        'tui-box',
        {
          ref: focus.el,
          border: props.border,
          borderColor: active ? 'focus' : 'border',
          title: props.title,
          flexDirection: 'column',
          paddingX: props.border === 'none' ? 0 : 1,
          flexShrink: 0,
          onWheel: (e: { direction: string }) => move(index.value + (e.direction === 'up' ? -1 : 1)),
        },
        [
          header,
          h('tui-box', { border: 'single', borderColor: 'border', borderLeft: false, borderRight: false, borderBottom: false, height: 1, flexShrink: 0 }),
          h('tui-box', { flexDirection: 'row' }, [
            h('tui-box', { flexDirection: 'column', flexGrow: 1 }, body.length ? body : [h('tui-text', { color: 'muted' }, 'No data')]),
            n > visible ? h(ScrollbarTrack, { total: n, visible, offset: s }) : null,
          ]),
        ],
      )
    }
  },
})

/** `<Badge color="success">PASS</Badge>` */
export const Badge = defineComponent({
  name: 'Badge',
  props: {
    color: { type: String, default: 'primary' },
    label: String,
  },
  setup(props, { slots }) {
    return () => h('tui-text', { bg: props.color, color: 'black', bold: true, wrap: 'none' }, [' ', slots.default?.() ?? props.label, ' '])
  },
})

export interface KeyHint {
  key: string
  label: string
}

/** Renders key hints: `<KeyHints :keys="[{ key: 'ctrl+s', label: 'save' }]" />` */
export const KeyHints = defineComponent({
  name: 'KeyHints',
  props: {
    keys: { type: Array as PropType<KeyHint[]>, required: true },
    separator: { type: String, default: '  ' },
  },
  setup(props) {
    return () => {
      const children: VNodeChild[] = []
      props.keys.forEach((k, i) => {
        if (i) children.push(h('tui-text', { color: 'muted' }, props.separator))
        children.push(h('tui-text', { color: 'accent', bold: true }, formatKey(k.key)))
        children.push(h('tui-text', { color: 'muted' }, ' ' + k.label))
      })
      return h('tui-text', { wrap: 'truncate' }, children)
    }
  },
})

/** Full-width bar (typically at the bottom). Slots: default (left), `right`. */
export const StatusBar = defineComponent({
  name: 'StatusBar',
  props: { bg: { type: String, default: 'surface' } },
  setup(props, { slots }) {
    return () =>
      h('tui-box', { bg: props.bg, paddingX: 1, flexShrink: 0, gap: 2, height: 1 }, [
        h('tui-box', { flexGrow: 1, flexShrink: 1, overflow: 'hidden' }, slots.default?.()),
        slots.right ? h('tui-box', { flexShrink: 0 }, slots.right()) : null,
      ])
  },
})

/** Key/value line: `<Stat label="CPU" value="42%" color="success" />` */
export const Stat = defineComponent({
  name: 'Stat',
  props: {
    label: { type: String, required: true },
    value: { type: [String, Number], required: true },
    color: { type: String, default: 'text' },
    hint: String,
  },
  setup(props) {
    return () =>
      h('tui-box', { flexDirection: 'column', flexShrink: 0 }, [
        h('tui-text', { color: 'muted', wrap: 'none' }, props.label),
        h('tui-text', { color: props.color, bold: true, wrap: 'none' }, [String(props.value), props.hint ? h('tui-text', { color: 'muted', bold: false }, ' ' + props.hint) : null]),
      ])
  },
})
