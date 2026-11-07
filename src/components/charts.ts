import { computed, defineComponent, h, type PropType, type VNodeChild } from 'vue'
import type { CellPainter } from '../render/paint.js'
import { textWidth } from '../render/text.js'

export interface ChartPoint {
  x: number
  y: number
}

export interface ChartSeries {
  name?: string
  /** Values (x = index) or explicit points. */
  data: number[] | ChartPoint[]
  color?: string
}

export const CHART_COLORS = ['primary', 'accent', 'warning', 'error', 'info', 'success']

// braille dot bit for (column 0/1, row 0..3) inside a cell
const BRAILLE_BITS = [
  [0x01, 0x02, 0x04, 0x40],
  [0x08, 0x10, 0x20, 0x80],
]

/** Rounds a step to 1, 2, 2.5 or 5 × 10^n. */
function niceStep(span: number, count: number): number {
  const raw = span / Math.max(1, count)
  const mag = 10 ** Math.floor(Math.log10(raw || 1))
  const n = raw / mag
  const f = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10
  return f * mag
}

/** "Nice" axis ticks covering [min, max]. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0]
  if (min === max) return [min]
  const step = niceStep(max - min, count)
  const start = Math.ceil(min / step - 1e-9) * step
  const out: number[] = []
  for (let v = start; v <= max + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : +v.toPrecision(12))
  return out
}

/** Compact number formatting for axis labels (1.2k, 3.4M). */
export function formatTick(v: number): string {
  const a = Math.abs(v)
  if (a >= 1e9) return `${+(v / 1e9).toFixed(1)}G`
  if (a >= 1e6) return `${+(v / 1e6).toFixed(1)}M`
  if (a >= 1e4) return `${+(v / 1e3).toFixed(1)}k`
  if (a >= 100 || Number.isInteger(v)) return String(Math.round(v))
  return String(+v.toPrecision(3))
}

function toPoints(data: number[] | ChartPoint[]): ChartPoint[] {
  return (data as unknown[]).map((d, i) =>
    typeof d === 'number' ? { x: i, y: d } : { x: Number((d as ChartPoint).x), y: Number((d as ChartPoint).y) },
  )
}

/**
 * Braille-resolution line chart (2×4 dots per cell) with axes and a legend.
 *   <LineChart :series="[{ name: 'cpu', data: cpu }, { name: 'mem', data: mem, color: 'warning' }]" :height="10" />
 *   <LineChart :data="values" />
 */
export const LineChart = defineComponent({
  name: 'LineChart',
  props: {
    series: { type: Array as PropType<ChartSeries[]>, default: undefined },
    /** Shorthand for a single series. */
    data: { type: Array as PropType<number[] | ChartPoint[]>, default: undefined },
    /** Height in rows (including axes). */
    height: { type: Number, default: 10 },
    width: { type: Number, default: undefined },
    min: { type: Number, default: undefined },
    max: { type: Number, default: undefined },
    xMin: { type: Number, default: undefined },
    xMax: { type: Number, default: undefined },
    /** Labels for x values (by index), e.g. dates. */
    xLabels: { type: Array as PropType<string[]>, default: undefined },
    axes: { type: Boolean, default: true },
    /** Show the legend (default: when any series has a name). */
    legend: { type: Boolean, default: undefined },
    /** Approximate number of y ticks. */
    yTicks: { type: Number, default: undefined },
    xTicks: { type: Number, default: undefined },
    formatY: { type: Function as PropType<(v: number) => string>, default: undefined },
    formatX: { type: Function as PropType<(v: number) => string>, default: undefined },
    title: String,
    color: { type: String, default: undefined },
    /** Fill the area below a single series. */
    fill: Boolean,
  },
  setup(props) {
    const all = computed(() => {
      const list = props.series ?? (props.data ? [{ data: props.data, color: props.color }] : [])
      return list.map((s, i) => ({ name: s.name, color: s.color ?? CHART_COLORS[i % CHART_COLORS.length], points: toPoints(s.data) }))
    })
    const bounds = computed(() => {
      let xmin = Infinity
      let xmax = -Infinity
      let ymin = Infinity
      let ymax = -Infinity
      for (const s of all.value)
        for (const p of s.points) {
          if (!Number.isFinite(p.y) || !Number.isFinite(p.x)) continue
          xmin = Math.min(xmin, p.x)
          xmax = Math.max(xmax, p.x)
          ymin = Math.min(ymin, p.y)
          ymax = Math.max(ymax, p.y)
        }
      if (!Number.isFinite(ymin)) {
        ymin = 0
        ymax = 1
        xmin = 0
        xmax = 1
      }
      ymin = props.min ?? ymin
      ymax = props.max ?? ymax
      if (ymin === ymax) {
        ymin -= 1
        ymax += 1
      }
      xmin = props.xMin ?? xmin
      xmax = props.xMax ?? xmax
      if (xmin === xmax) xmax = xmin + 1
      return { xmin, xmax, ymin, ymax }
    })

    const paint = (p: CellPainter) => {
      const { xmin, xmax } = bounds.value
      let { ymin, ymax } = bounds.value
      const W = p.width
      const H = p.height
      if (W < 2 || H < 1) return
      const fmtY = props.formatY ?? formatTick
      const fmtX = props.formatX ?? ((v: number) => (props.xLabels ? (props.xLabels[Math.round(v)] ?? '') : formatTick(v)))
      const axisRows = props.axes ? 2 : 0
      const plotH = Math.max(1, H - axisRows)
      const tickCount = props.yTicks ?? Math.max(2, Math.floor(plotH / 2))
      // auto bounds snap outwards to "nice" tick values
      const step = niceStep(ymax - ymin, tickCount)
      if (props.min === undefined) ymin = Math.floor(ymin / step + 1e-9) * step
      if (props.max === undefined) ymax = Math.ceil(ymax / step - 1e-9) * step
      const ticks = props.axes ? niceTicks(ymin, ymax, tickCount) : []
      const labels = ticks.map(fmtY)
      const labelW = props.axes ? Math.max(...labels.map(textWidth), textWidth(fmtY(ymin))) : 0
      const x0 = props.axes ? labelW + 1 : 0
      const plotW = Math.max(1, W - x0)
      const dotsW = plotW * 2
      const dotsH = plotH * 4
      const sx = (x: number) => ((x - xmin) / (xmax - xmin)) * (dotsW - 1)
      const sy = (y: number) => (1 - (y - ymin) / (ymax - ymin)) * (dotsH - 1)

      // ---- axes
      if (props.axes) {
        for (let r = 0; r < plotH; r++) p.set(labelW, r, '│', 'border')
        ticks.forEach((t, i) => {
          const row = Math.max(0, Math.min(plotH - 1, Math.floor(sy(t) / 4)))
          p.text(labelW - textWidth(labels[i]), row, labels[i], 'muted')
          p.set(labelW, row, '┤', 'border')
        })
        p.set(labelW, plotH, '└', 'border')
        for (let c = x0; c < W; c++) p.set(c, plotH, '─', 'border')
        // x ticks: evenly spaced labels that don't overlap
        const count = props.xTicks ?? Math.max(2, Math.floor(plotW / 12))
        const xt = props.xLabels ? Array.from({ length: count }, (_, i) => xmin + ((xmax - xmin) * i) / Math.max(1, count - 1)) : niceTicks(xmin, xmax, count)
        let lastEnd = -1
        for (const t of xt) {
          const col = x0 + Math.round(sx(t) / 2 - 0.25)
          if (col < x0 || col >= W) continue
          const label = fmtX(t)
          const lw = textWidth(label)
          let start = col - Math.floor(lw / 2)
          start = Math.max(x0 - 1, Math.min(W - lw, start))
          if (start <= lastEnd) continue
          p.set(col, plotH, '┬', 'border')
          p.text(start, plotH + 1, label, 'muted')
          lastEnd = start + lw
        }
      }

      // ---- plot (braille)
      const bits = new Uint8Array(plotW * plotH)
      const owner = new Int16Array(plotW * plotH).fill(-1)
      const dot = (x: number, y: number, s: number) => {
        const xi = Math.round(x)
        const yi = Math.round(y)
        if (xi < 0 || yi < 0 || xi >= dotsW || yi >= dotsH) return
        const cell = (yi >> 2) * plotW + (xi >> 1)
        bits[cell] |= BRAILLE_BITS[xi & 1][yi & 3]
        owner[cell] = s
      }
      const line = (x1: number, y1: number, x2: number, y2: number, s: number) => {
        const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1))))
        for (let i = 0; i <= steps; i++) dot(x1 + ((x2 - x1) * i) / steps, y1 + ((y2 - y1) * i) / steps, s)
      }
      all.value.forEach((s, si) => {
        let prev: [number, number] | null = null
        for (const pt of s.points) {
          if (!Number.isFinite(pt.y)) {
            prev = null
            continue
          }
          const cur: [number, number] = [sx(pt.x), sy(Math.max(ymin, Math.min(ymax, pt.y)))]
          if (prev) line(prev[0], prev[1], cur[0], cur[1], si)
          else dot(cur[0], cur[1], si)
          if (props.fill && all.value.length === 1) for (let y = Math.ceil(cur[1]) + 1; y < dotsH; y += 1) dot(cur[0], y, si)
          prev = cur
        }
      })
      for (let r = 0; r < plotH; r++)
        for (let c = 0; c < plotW; c++) {
          const b = bits[r * plotW + c]
          if (b) p.set(x0 + c, r, String.fromCharCode(0x2800 + b), all.value[owner[r * plotW + c]].color)
        }
    }

    return () => {
      // read reactive inputs here so changes re-render (and repaint) the chart
      void bounds.value
      const showLegend = props.legend ?? all.value.some((s) => s.name)
      const legend: VNodeChild = showLegend
        ? h(
            'tui-text',
            { wrap: 'truncate', flexShrink: 0 },
            all.value.flatMap((s, i) => [
              i ? '  ' : '',
              h('tui-text', { color: s.color }, '━━ '),
              h('tui-text', { color: 'muted' }, s.name ?? `series ${i + 1}`),
            ]),
          )
        : null
      return h('tui-box', { flexDirection: 'column', flexShrink: 0, width: props.width, flexGrow: props.width ? 0 : 1 }, [
        props.title ? h('tui-text', { bold: true, wrap: 'truncate' }, props.title) : null,
        h('tui-box', { height: props.height, flexShrink: 0, paintCells: (p: CellPainter) => paint(p), alignSelf: 'stretch' }),
        legend,
      ])
    }
  },
})
