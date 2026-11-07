import { Comment, Fragment, Text as VText, computed, defineComponent, h, ref, watch, type PropType, type VNode, type VNodeChild } from 'vue'
import { useFocus } from '../composables.js'
import { matchKey } from '../input/keys.js'
import { useLayout } from './primitives.js'

// ------------------------------------------------------------------ helpers

/** Flattens slot vnodes (fragments from v-for / templates), dropping comments. */
export function flattenVNodes(nodes: VNodeChild): VNode[] {
  const out: VNode[] = []
  const walk = (n: VNodeChild) => {
    if (n == null || typeof n === 'boolean') return
    if (Array.isArray(n)) return n.forEach(walk)
    if (typeof n === 'string' || typeof n === 'number') {
      out.push(h('tui-text', null, String(n)))
      return
    }
    const v = n as VNode
    if (v.type === Comment) return
    if (v.type === Fragment) return walk(v.children as VNodeChild)
    if (v.type === VText) {
      if (String(v.children ?? '').trim()) out.push(h('tui-text', null, String(v.children)))
      return
    }
    out.push(v)
  }
  walk(nodes)
  return out
}

type Track = { kind: 'fixed'; size: number } | { kind: 'fr'; fr: number } | { kind: 'pct'; pct: number } | { kind: 'auto' }

/** Parses a track template: `3`, `'1fr 2fr 20'`, `'repeat(3, 1fr)'`, `'25% auto'`, `[10, '1fr']`. */
export function parseTracks(spec: number | string | (number | string)[] | undefined): Track[] {
  if (spec === undefined || spec === null || spec === '') return [{ kind: 'fr', fr: 1 }]
  if (typeof spec === 'number') return Array.from({ length: Math.max(1, Math.floor(spec)) }, () => ({ kind: 'fr', fr: 1 }) as Track)
  let parts: (string | number)[]
  if (Array.isArray(spec)) parts = spec
  else {
    let s = spec.trim()
    if (/^\d+$/.test(s)) return parseTracks(Number(s))
    s = s.replace(/repeat\(\s*(\d+)\s*,\s*([^)]+)\)/g, (_, n: string, t: string) => Array(Number(n)).fill(t.trim()).join(' '))
    parts = s.split(/\s+/).filter(Boolean)
  }
  return parts.map((p): Track => {
    if (typeof p === 'number') return { kind: 'fixed', size: Math.max(0, Math.floor(p)) }
    const t = p.trim()
    let m = /^(\d*\.?\d+)fr$/.exec(t)
    if (m) return { kind: 'fr', fr: Number(m[1]) }
    m = /^(\d*\.?\d+)%$/.exec(t)
    if (m) return { kind: 'pct', pct: Number(m[1]) }
    if (t === 'auto') return { kind: 'auto' }
    const n = parseFloat(t)
    return Number.isFinite(n) ? { kind: 'fixed', size: Math.max(0, Math.floor(n)) } : { kind: 'fr', fr: 1 }
  })
}

/** Resolves tracks to integer cell sizes that exactly fill `total` (minus gaps) when fr/auto tracks exist. */
export function resolveTracks(tracks: Track[], total: number, gap: number): number[] {
  const free0 = Math.max(0, total - gap * Math.max(0, tracks.length - 1))
  const sizes = tracks.map((t) => (t.kind === 'fixed' ? t.size : t.kind === 'pct' ? Math.floor((t.pct / 100) * free0) : 0))
  const used = sizes.reduce((a, b) => a + b, 0)
  let free = Math.max(0, free0 - used)
  const frs = tracks.map((t) => (t.kind === 'fr' ? t.fr : t.kind === 'auto' ? 1 : 0))
  const frTotal = frs.reduce((a, b) => a + b, 0)
  if (frTotal > 0) {
    const share = free / frTotal
    let acc = 0
    let last = -1
    tracks.forEach((_, i) => {
      if (!frs[i]) return
      // distribute rounding error left to right so the sum is exact
      const target = Math.round((acc + frs[i]) * share)
      sizes[i] = target - Math.round(acc * share)
      acc += frs[i]
      last = i
    })
    if (last >= 0) free = 0
  }
  return sizes
}

// ------------------------------------------------------------------ Stack

/**
 * Generic flex stack.
 *   <Stack direction="row" :gap="2" align="center">…</Stack>
 */
export const Stack = defineComponent({
  name: 'Stack',
  props: {
    direction: { type: String as PropType<'row' | 'column' | 'horizontal' | 'vertical' | 'row-reverse' | 'column-reverse'>, default: 'column' },
    gap: { type: Number, default: 0 },
    align: { type: String as PropType<'flex-start' | 'flex-end' | 'center' | 'stretch' | 'start' | 'end'>, default: undefined },
    justify: {
      type: String as PropType<'flex-start' | 'flex-end' | 'center' | 'space-between' | 'space-around' | 'space-evenly' | 'start' | 'end'>,
      default: undefined,
    },
    wrap: Boolean,
    reverse: Boolean,
  },
  setup(props, { slots }) {
    const norm = (v?: string) => (v === 'start' ? 'flex-start' : v === 'end' ? 'flex-end' : v)
    return () => {
      let dir = props.direction === 'horizontal' ? 'row' : props.direction === 'vertical' ? 'column' : props.direction
      if (props.reverse && !dir.endsWith('-reverse')) dir = `${dir}-reverse` as typeof dir
      return h(
        'tui-box',
        { flexDirection: dir, gap: props.gap, alignItems: norm(props.align), justifyContent: norm(props.justify), flexWrap: props.wrap ? 'wrap' : undefined },
        slots.default?.(),
      )
    }
  },
})

// ------------------------------------------------------------------ Grid

/**
 * CSS-grid-like layout. Children are placed in order, row by row.
 *   <Grid columns="1fr 2fr 20" :gap="1">
 *     <Box>a</Box> <Box :col-span="2">wide</Box> …
 *   </Grid>
 * `columns` / `rows`: a count, or a template of cells (`20`), fractions (`1fr`),
 * percentages (`25%`), `auto`, and `repeat(n, track)`. Rows without a template
 * size to their content. Children may set `col-span` (or `colSpan`).
 */
export const Grid = defineComponent({
  name: 'Grid',
  props: {
    columns: { type: [Number, String, Array] as PropType<number | string | (number | string)[]>, default: 2 },
    rows: { type: [Number, String, Array] as PropType<number | string | (number | string)[]>, default: undefined },
    gap: { type: Number, default: 0 },
    columnGap: { type: Number, default: undefined },
    rowGap: { type: Number, default: undefined },
    width: { type: [Number, String], default: undefined },
    height: { type: [Number, String], default: undefined },
  },
  setup(props, { slots }) {
    const { layout, onLayout } = useLayout()
    const colTracks = computed(() => parseTracks(props.columns))
    const rowTracks = computed(() => (props.rows === undefined ? null : parseTracks(props.rows)))
    return () => {
      const cg = props.columnGap ?? props.gap
      const rg = props.rowGap ?? props.gap
      const tracks = colTracks.value
      const ncols = tracks.length
      const widths = resolveTracks(tracks, layout.value?.innerWidth ?? 0, cg)
      // place cells
      const items = flattenVNodes(slots.default?.() ?? [])
      const rowsOut: { vnode: VNode; col: number; span: number }[][] = []
      let row: { vnode: VNode; col: number; span: number }[] = []
      let col = 0
      for (const v of items) {
        const p = (v.props ?? {}) as Record<string, unknown>
        const span = Math.max(1, Math.min(ncols, Number(p.colSpan ?? p['col-span'] ?? 1) || 1))
        if (col + span > ncols) {
          rowsOut.push(row)
          row = []
          col = 0
        }
        row.push({ vnode: v, col, span })
        col += span
        if (col >= ncols) {
          rowsOut.push(row)
          row = []
          col = 0
        }
      }
      if (row.length) rowsOut.push(row)
      const rt = rowTracks.value
      const heights = rt ? resolveTracks(rt, layout.value?.innerHeight ?? 0, rg) : null
      const cellWidth = (c: number, span: number) => {
        let w = 0
        for (let i = c; i < c + span; i++) w += widths[i] ?? 0
        return w + cg * (span - 1)
      }
      const children = rowsOut.map((cells, r) => {
        const rowChildren: VNodeChild[] = []
        let at = 0
        for (const cell of cells) {
          // (cells always fill left to right, `at` tracks the column)
          at = cell.col
          rowChildren.push(
            h(
              'tui-box',
              { key: `${r}:${at}`, width: cellWidth(cell.col, cell.span), flexShrink: 0, flexDirection: 'column', overflow: 'hidden' },
              [cell.vnode],
            ),
          )
        }
        const hgt = heights ? heights[r % heights.length] : undefined
        return h('tui-box', { key: r, flexDirection: 'row', columnGap: cg, height: hgt, flexShrink: 0, overflow: heights ? 'hidden' : undefined }, rowChildren)
      })
      return h(
        'tui-box',
        { flexDirection: 'column', rowGap: rg, width: props.width, height: props.height, flexGrow: props.height === undefined && rt ? 1 : 0, flexShrink: 1, alignSelf: props.width === undefined ? 'stretch' : undefined, onLayout },
        children,
      )
    }
  },
})

// ------------------------------------------------------------------ SplitPane

type SizeValue = number | string

/** Converts `20`, `'20'`, `'30%'` to cells for a given total. */
function toCells(v: SizeValue | undefined, total: number, fallback: number): number {
  if (v === undefined || v === null || v === '') return fallback
  if (typeof v === 'number') return v
  const s = v.trim()
  if (s.endsWith('%')) return Math.round((parseFloat(s) / 100) * total)
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : fallback
}

/**
 * Two resizable panes with a draggable divider.
 *   <SplitPane v-model:size="sidebar" :min="10" :max="'60%'" collapsible>
 *     <template #first>…</template>
 *     <template #second>…</template>
 *   </SplitPane>
 * `size` is the first pane's size in cells or as a percentage string (`'30%'`);
 * the emitted value keeps the same unit. Focus the divider (tab or click) to
 * resize with arrows (shift: ×5), home/end for min/max, and enter to collapse.
 */
export const SplitPane = defineComponent({
  name: 'SplitPane',
  props: {
    direction: { type: String as PropType<'horizontal' | 'vertical'>, default: 'horizontal' },
    size: { type: [Number, String] as PropType<SizeValue>, default: '50%' },
    min: { type: [Number, String] as PropType<SizeValue>, default: 1 },
    max: { type: [Number, String] as PropType<SizeValue>, default: undefined },
    /** Allow collapsing the first pane (enter / double-click on the divider). */
    collapsible: Boolean,
    collapsed: { type: Boolean, default: undefined },
    /** Cells per arrow key press. */
    step: { type: Number, default: 1 },
    disabled: Boolean,
    /** Divider color when idle. */
    dividerColor: { type: String, default: 'border' },
  },
  emits: ['update:size', 'update:collapsed', 'resize', 'collapse'],
  setup(props, { emit, slots, expose }) {
    const { layout, onLayout } = useLayout()
    const horizontal = computed(() => props.direction !== 'vertical')
    const total = () => {
      const l = layout.value
      if (!l) return 0
      return Math.max(0, (horizontal.value ? l.innerWidth : l.innerHeight) - 1)
    }
    const internalCollapsed = ref(false)
    const isCollapsed = computed(() => props.collapsed ?? internalCollapsed.value)
    // the current size in cells (null until the first layout, then follows the prop)
    const cells = ref<number | null>(null)
    const clamp = (v: number) => {
      const t = total()
      const lo = Math.max(0, toCells(props.min, t, 0))
      const hi = Math.min(t, toCells(props.max, t, t))
      return Math.max(lo, Math.min(Math.max(lo, hi), Math.round(v)))
    }
    watch(
      () => [props.size, layout.value?.innerWidth, layout.value?.innerHeight] as const,
      () => {
        if (layout.value) cells.value = clamp(toCells(props.size, total(), Math.floor(total() / 2)))
      },
    )
    const current = () => cells.value ?? clamp(toCells(props.size, total(), Math.floor(total() / 2)))
    const setCells = (v: number) => {
      const c = clamp(v)
      if (c === cells.value) return
      cells.value = c
      const t = total()
      const out: SizeValue = typeof props.size === 'string' && props.size.trim().endsWith('%') && t > 0 ? `${Math.round((c / t) * 1000) / 10}%` : c
      emit('update:size', out)
      emit('resize', c)
    }
    const setCollapsed = (v: boolean) => {
      if (!props.collapsible && v) return
      internalCollapsed.value = v
      emit('update:collapsed', v)
      emit('collapse', v)
    }
    const focus = useFocus({
      disabled: () => props.disabled,
      onKey(e) {
        const big = props.step * 5
        const dec = horizontal.value ? 'left|h|shift+left|shift+h' : 'up|k|shift+up|shift+k'
        const inc = horizontal.value ? 'right|l|shift+right|shift+l' : 'down|j|shift+down|shift+j'
        const amount = e.shift ? big : props.step
        if (matchKey(e, dec)) {
          if (isCollapsed.value) return
          setCells(current() - amount)
        } else if (matchKey(e, inc)) {
          if (isCollapsed.value) setCollapsed(false)
          else setCells(current() + amount)
        } else if (matchKey(e, 'home')) setCells(0)
        else if (matchKey(e, 'end')) setCells(total())
        else if (props.collapsible && matchKey(e, 'enter|space')) setCollapsed(!isCollapsed.value)
        else return
        e.stopPropagation()
      },
    })
    const dragging = ref(false)
    let lastDown = 0
    const posFrom = (e: { x: number; y: number }) => {
      const l = layout.value
      if (!l) return 0
      return horizontal.value ? e.x - l.x - (l.width - l.innerWidth) / 2 : e.y - l.y - (l.height - l.innerHeight) / 2
    }
    const hovered = ref(false)
    expose({ setSize: setCells, collapse: () => setCollapsed(true), expand: () => setCollapsed(false) })

    return () => {
      const hz = horizontal.value
      const size = isCollapsed.value ? 0 : current()
      const active = focus.isFocused.value || dragging.value
      const dividerColor = active ? 'focus' : hovered.value ? 'text' : props.dividerColor
      const first = slots.first?.() ?? slots.start?.() ?? flattenVNodes(slots.default?.() ?? [])[0]
      const second = slots.second?.() ?? slots.end?.() ?? flattenVNodes(slots.default?.() ?? [])[1]
      const len = hz ? (layout.value?.innerHeight ?? 1) : (layout.value?.innerWidth ?? 1)
      const ch = hz ? (active ? '┃' : '│') : active ? '━' : '─'
      const grip = isCollapsed.value ? (hz ? '›' : '⌄') : hz ? '┇' : '┅'
      const mid = Math.floor(len / 2)
      const line = Array.from({ length: Math.max(1, len) }, (_, i) => (i === mid && (active || hovered.value || isCollapsed.value) ? grip : ch))
      const divider = h(
        'tui-box',
        {
          ref: focus.el,
          [hz ? 'width' : 'height']: 1,
          flexShrink: 0,
          flexDirection: hz ? 'column' : 'row',
          overflow: 'hidden',
          onMouseDown: (e: { button: string }) => {
            if (props.disabled || e.button !== 'left') return
            const now = Date.now()
            if (props.collapsible && now - lastDown < 400) {
              setCollapsed(!isCollapsed.value)
              lastDown = 0
              return
            }
            lastDown = now
            dragging.value = true
          },
          onMouseEnter: () => (hovered.value = true),
          onMouseLeave: () => (hovered.value = false),
        },
        [h('tui-text', { color: dividerColor, wrap: 'none' }, hz ? line.join('\n') : line.join(''))],
      )
      const pane = (content: VNodeChild, isFirst: boolean) =>
        h(
          'tui-box',
          {
            flexDirection: 'column',
            overflow: 'hidden',
            ...(isFirst
              ? { [hz ? 'width' : 'height']: size, flexShrink: 0, display: size === 0 ? 'none' : 'flex' }
              : { flexGrow: 1, flexShrink: 1, flexBasis: 0 }),
            [hz ? 'minWidth' : 'minHeight']: 0,
          },
          content as VNodeChild[],
        )
      return h(
        'tui-box',
        {
          flexDirection: hz ? 'row' : 'column',
          flexGrow: 1,
          flexShrink: 1,
          alignSelf: 'stretch',
          onLayout,
          onMouseMove: (e: { action: string; x: number; y: number }) => {
            if (!dragging.value) return
            if (e.action !== 'drag') {
              dragging.value = false
              return
            }
            if (isCollapsed.value) setCollapsed(false)
            setCells(posFrom(e))
          },
          onMouseUp: () => (dragging.value = false),
        },
        [pane(first, true), divider, pane(second, false)],
      )
    }
  },
})
