import { computed, defineComponent, h, type PropType, type VNodeChild } from 'vue'
import { useTheme } from '../composables.js'
import {
  getFigletFont,
  loadFigletFont,
  registerFigletFont,
  renderFiglet,
  figletFontNames,
  type FigletFont,
  type FigletLayout,
} from '../fonts/index.js'
import { gradientStops, type GradientDirection } from './gradient.js'

export { loadFigletFont, renderFiglet, registerFigletFont, getFigletFont, figletFontNames }
export type { FigletFont, FigletLayout }

/**
 * Large text rendered with a FIGlet font.
 *   <AsciiFont text="vurses" font="slant" color="primary" />
 *   <AsciiFont text="Hi" :gradient="['#42b883', '#7aa2f7']" />
 * Bundled fonts: standard, slant, small, mini. Register more with
 * `registerFigletFont(name, flfSource)` or pass a parsed font (`loadFigletFont(src)`).
 */
export const AsciiFont = defineComponent({
  name: 'AsciiFont',
  props: {
    text: { type: String, required: true },
    font: { type: [String, Object] as PropType<string | FigletFont>, default: 'standard' },
    color: { type: String, default: undefined },
    /** Colors of a gradient across the text (overrides `color`). */
    gradient: { type: Array as PropType<string[]>, default: undefined },
    gradientDirection: { type: String as PropType<GradientDirection>, default: 'horizontal' },
    /** Override the font's horizontal layout. */
    layout: { type: String as PropType<FigletLayout>, default: 'default' },
    bold: Boolean,
    textAlign: { type: String as PropType<'left' | 'center' | 'right'>, default: undefined },
  },
  setup(props) {
    const theme = useTheme()
    const rows = computed(() => {
      const font = typeof props.font === 'string' ? getFigletFont(props.font) : props.font
      if (!font) return [`[unknown font "${String(props.font)}"] ${props.text}`]
      const out = renderFiglet(props.text, font, { layout: props.layout === 'default' ? undefined : props.layout })
      // drop trailing blank rows (most fonts reserve descender rows)
      while (out.length > 1 && !out[out.length - 1].trim()) out.pop()
      return out
    })
    return () => {
      const lines = rows.value
      const width = Math.max(0, ...lines.map((l) => l.length))
      if (!props.gradient?.length) {
        return h(
          'tui-text',
          { color: props.color, bold: props.bold, wrap: 'none', textAlign: props.textAlign, flexShrink: 0 },
          lines.join('\n'),
        )
      }
      const dir = props.gradientDirection
      const steps = dir === 'vertical' ? lines.length : dir === 'diagonal' ? width + lines.length : width
      const stops = gradientStops(props.gradient, Math.max(1, steps), theme.value)
      const children: VNodeChild[] = []
      lines.forEach((line, y) => {
        if (y) children.push('\n')
        if (dir === 'vertical') {
          children.push(h('tui-text', { color: stops[y] }, line))
          return
        }
        // group runs of equal color to keep the node count low
        let run = ''
        let runColor = ''
        for (let x = 0; x < line.length; x++) {
          const c = stops[Math.min(stops.length - 1, dir === 'diagonal' ? x + y : x)]
          if (c !== runColor && run) {
            children.push(h('tui-text', { color: runColor }, run))
            run = ''
          }
          runColor = c
          run += line[x]
        }
        if (run) children.push(h('tui-text', { color: runColor }, run))
      })
      return h('tui-text', { bold: props.bold, wrap: 'none', textAlign: props.textAlign, flexShrink: 0 }, children)
    }
  },
})
