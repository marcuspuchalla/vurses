import { defineComponent, h, type PropType, type VNodeChild } from 'vue'
import { useTheme } from '../composables.js'
import { colorToRgb, mix, parseColor } from '../style/colors.js'
import type { Theme } from '../style/theme.js'
import type { CellPainter } from '../render/paint.js'
import { textWidth } from '../render/text.js'

export type GradientDirection = 'horizontal' | 'vertical' | 'diagonal'

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** Built-in named gradients (usable as `colors="rainbow"`). */
export const GRADIENTS: Record<string, string[]> = {
  rainbow: ['#ff5f6d', '#ffc371', '#47e891', '#2fb8ff', '#9d6bff'],
  vue: ['#42b883', '#35495e'],
  sunset: ['#ff7e5f', '#feb47b'],
  ocean: ['#2193b0', '#6dd5ed'],
  fire: ['#f12711', '#f5af19'],
  mint: ['#00b09b', '#96c93d'],
  passion: ['#f953c6', '#b91d73'],
  cristal: ['#bdfff3', '#4ac29a'],
  teen: ['#77a1d3', '#79cbca', '#e684ae'],
}

/**
 * Resolves a color (theme token, named ANSI color, `#hex`, `rgb()`, `ansi256()`)
 * to a `#rrggbb` string, or null if it can't be resolved.
 */
export function resolveColor(name: string, theme?: Theme): string | null {
  let n = name
  for (let i = 0; i < 4 && theme && theme[n] !== undefined && n !== 'name'; i++) n = theme[n]
  const c = parseColor(n)
  if (!c) return null
  const [r, g, b] = colorToRgb(c)
  const hx = (x: number) => x.toString(16).padStart(2, '0')
  return `#${hx(r)}${hx(g)}${hx(b)}`
}

/** `n` evenly spaced colors along a multi-stop gradient. */
export function gradientStops(colors: string[] | string, n: number, theme?: Theme): string[] {
  const list = typeof colors === 'string' ? (GRADIENTS[colors] ?? colors.split(/[\s,]+/)) : colors
  const stops = list.map((c) => resolveColor(c, theme)).filter((c): c is string => !!c)
  if (!stops.length) return Array.from({ length: n }, () => 'text')
  if (stops.length === 1 || n <= 1) return Array.from({ length: n }, () => stops[0])
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * (stops.length - 1)
    const k = Math.min(stops.length - 2, Math.floor(t))
    out.push(mix(stops[k], stops[k + 1], t - k))
  }
  return out
}

/** Picks black or white text for a background color (WCAG relative luminance). */
export function contrastColor(bg: string): string {
  const c = parseColor(bg)
  if (!c) return 'text'
  const [r, g, b] = colorToRgb(c).map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.35 ? '#000000' : '#ffffff'
}

/** Plain text content of slot vnodes. */
export function slotText(nodes: unknown): string {
  if (nodes == null || typeof nodes === 'boolean') return ''
  if (typeof nodes === 'string' || typeof nodes === 'number') return String(nodes)
  if (Array.isArray(nodes)) return nodes.map(slotText).join('')
  const children = (nodes as { children?: unknown }).children
  return typeof children === 'string' ? children : Array.isArray(children) ? slotText(children) : ''
}

/**
 * Text with a color gradient across its characters, or a gradient bar.
 *   <Gradient text="Hello world" :colors="['primary', 'accent']" />
 *   <Gradient colors="rainbow" bar :height="1" text="Loading" />
 */
export const Gradient = defineComponent({
  name: 'Gradient',
  props: {
    text: { type: String, default: '' },
    /** Color stops (theme tokens, names, hex) or a preset name (`rainbow`, `vue`, `sunset`, ...). */
    colors: { type: [Array, String] as PropType<string[] | string>, default: () => ['primary', 'accent'] },
    direction: { type: String as PropType<GradientDirection>, default: 'horizontal' },
    /** Background mode: fill the box with the gradient (text is drawn on top). */
    bar: Boolean,
    width: { type: [Number, String], default: undefined },
    height: { type: Number, default: 1 },
    bold: Boolean,
    italic: Boolean,
    /** Text alignment inside the bar. */
    align: { type: String as PropType<'left' | 'center' | 'right'>, default: 'center' },
    /** Text color in bar mode (default: black/white for contrast). */
    textColor: String,
  },
  setup(props, { slots }) {
    const theme = useTheme()
    const text = () => props.text || slotText(slots.default?.())
    return () => {
      const lines = { value: text().split('\n') }
      if (props.bar) {
        return h('tui-box', {
          width: props.width,
          height: props.height,
          flexGrow: props.width === undefined ? 1 : 0,
          flexShrink: 0,
          paintCells: (p: CellPainter) => {
            const n = props.direction === 'vertical' ? p.height : props.direction === 'diagonal' ? p.width + p.height : p.width
            const stops = gradientStops(props.colors, Math.max(1, n), theme.value)
            const at = (x: number, y: number) => stops[props.direction === 'vertical' ? y : props.direction === 'diagonal' ? x + y : x]
            for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) p.set(x, y, ' ', null, at(x, y))
            const ls = lines.value
            const top = Math.max(0, Math.floor((p.height - ls.length) / 2))
            ls.forEach((line, i) => {
              const y = top + i
              const w = textWidth(line)
              let x = props.align === 'left' ? 1 : props.align === 'right' ? p.width - w - 1 : Math.floor((p.width - w) / 2)
              x = Math.max(0, x)
              for (const { segment } of segmenter.segment(line)) {
                const bg = at(Math.min(p.width - 1, x), y)
                p.set(x, y, segment, props.textColor ?? contrastColor(bg), bg, { bold: props.bold, italic: props.italic })
                x += textWidth(segment)
              }
            })
          },
        })
      }
      const ls = lines.value
      const graphemes = ls.map((l) => Array.from(segmenter.segment(l), (s) => s.segment))
      const width = Math.max(1, ...graphemes.map((g) => g.length))
      const dir = props.direction
      const n = dir === 'vertical' ? ls.length : dir === 'diagonal' ? width + ls.length : width
      const stops = gradientStops(props.colors, Math.max(1, n), theme.value)
      const children: VNodeChild[] = []
      graphemes.forEach((g, y) => {
        if (y) children.push('\n')
        g.forEach((ch, x) => {
          const c = stops[Math.min(stops.length - 1, dir === 'vertical' ? y : dir === 'diagonal' ? x + y : x)]
          children.push(h('tui-text', { color: c }, ch))
        })
      })
      return h('tui-text', { bold: props.bold, italic: props.italic, wrap: 'none', flexShrink: 0 }, children)
    }
  },
})
