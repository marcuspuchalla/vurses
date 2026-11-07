import type { Style } from './style.js'

/**
 * A small, Tailwind-flavoured utility class vocabulary for terminal layouts.
 * Units are terminal cells.
 *
 *   flex-row flex-col flex-1 grow shrink-0 wrap
 *   items-center justify-between self-end
 *   gap-1 gap-x-2 gap-y-1  p-1 px-2 pt-1  m-1 mx-auto
 *   w-20 w-full w-1/2 h-10 min-w-10 max-h-5
 *   border border-round border-double border-bold border-primary
 *   bg-surface text-muted text-[#ff8800] bold dim italic underline inverse strike
 *   text-center text-right truncate hidden absolute top-0 left-0 overflow-hidden z-10
 */

const cache = new Map<string, Style>()

const SIDES: Record<string, string[]> = {
  '': [''],
  x: ['X'],
  y: ['Y'],
  t: ['Top'],
  r: ['Right'],
  b: ['Bottom'],
  l: ['Left'],
}

const BORDER_STYLES = new Set(['single', 'round', 'double', 'bold', 'ascii', 'dashed', 'none'])

function dim(v: string): Style['width'] | undefined {
  if (v === 'full') return '100%'
  if (v === 'auto') return 'auto'
  if (v === 'half') return '50%'
  const frac = /^(\d+)\/(\d+)$/.exec(v)
  if (frac) return `${(+frac[1] / +frac[2]) * 100}%` as `${number}%`
  const arb = /^\[(.+)\]$/.exec(v)
  if (arb) v = arb[1]
  if (/^\d+(\.\d+)?%$/.test(v)) return v as `${number}%`
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

function color(v: string): string {
  const arb = /^\[(.+)\]$/.exec(v)
  return arb ? arb[1] : v
}

function applyClass(s: Style, cls: string) {
  const r = s as Record<string, unknown>
  switch (cls) {
    case 'flex':
      r.display = 'flex'
      return
    case 'hidden':
      r.display = 'none'
      return
    case 'flex-row':
      r.flexDirection = 'row'
      return
    case 'flex-col':
    case 'flex-column':
      r.flexDirection = 'column'
      return
    case 'flex-row-reverse':
      r.flexDirection = 'row-reverse'
      return
    case 'flex-col-reverse':
      r.flexDirection = 'column-reverse'
      return
    case 'flex-wrap':
      r.flexWrap = 'wrap'
      return
    case 'flex-1':
      r.flexGrow = 1
      r.flexShrink = 1
      r.flexBasis = 0
      return
    case 'flex-auto':
      r.flexGrow = 1
      r.flexShrink = 1
      r.flexBasis = 'auto'
      return
    case 'flex-none':
      r.flexGrow = 0
      r.flexShrink = 0
      return
    case 'grow':
      r.flexGrow = 1
      return
    case 'grow-0':
      r.flexGrow = 0
      return
    case 'shrink':
      r.flexShrink = 1
      return
    case 'shrink-0':
      r.flexShrink = 0
      return
    case 'absolute':
      r.position = 'absolute'
      return
    case 'relative':
      r.position = 'relative'
      return
    case 'inset-0':
      r.top = r.left = r.right = r.bottom = 0
      return
    case 'overflow-hidden':
      r.overflow = 'hidden'
      return
    case 'overflow-visible':
      r.overflow = 'visible'
      return
    case 'border':
      r.border = 'single'
      return
    case 'bold':
    case 'font-bold':
      r.bold = true
      return
    case 'dim':
      r.dim = true
      return
    case 'italic':
      r.italic = true
      return
    case 'underline':
      r.underline = true
      return
    case 'inverse':
      r.inverse = true
      return
    case 'strike':
    case 'line-through':
      r.strikethrough = true
      return
    case 'text-left':
      r.textAlign = 'left'
      return
    case 'text-center':
      r.textAlign = 'center'
      return
    case 'text-right':
      r.textAlign = 'right'
      return
    case 'truncate':
      r.wrap = 'truncate'
      return
    case 'truncate-start':
      r.wrap = 'truncate-start'
      return
    case 'truncate-middle':
      r.wrap = 'truncate-middle'
      return
    case 'wrap':
      r.wrap = 'wrap'
      return
    case 'nowrap':
    case 'whitespace-nowrap':
      r.wrap = 'none'
      return
    case 'mx-auto':
      // centering is handled by parent alignment in terminal layouts
      r.alignSelf = 'center'
      return
    case 'center':
      r.alignItems = 'center'
      r.justifyContent = 'center'
      return
  }

  let m: RegExpExecArray | null
  if ((m = /^items-(start|end|center|stretch|baseline)$/.exec(cls))) {
    r.alignItems = m[1] === 'start' ? 'flex-start' : m[1] === 'end' ? 'flex-end' : m[1]
    return
  }
  if ((m = /^self-(auto|start|end|center|stretch|baseline)$/.exec(cls))) {
    r.alignSelf = m[1] === 'start' ? 'flex-start' : m[1] === 'end' ? 'flex-end' : m[1]
    return
  }
  if ((m = /^content-(start|end|center|stretch|between|around)$/.exec(cls))) {
    const map: Record<string, string> = { start: 'flex-start', end: 'flex-end', between: 'space-between', around: 'space-around' }
    r.alignContent = map[m[1]] || m[1]
    return
  }
  if ((m = /^justify-(start|end|center|between|around|evenly)$/.exec(cls))) {
    const map: Record<string, string> = {
      start: 'flex-start', end: 'flex-end', between: 'space-between', around: 'space-around', evenly: 'space-evenly',
    }
    r.justifyContent = map[m[1]] || m[1]
    return
  }
  if ((m = /^(grow|shrink)-(\d+)$/.exec(cls))) {
    r[m[1] === 'grow' ? 'flexGrow' : 'flexShrink'] = +m[2]
    return
  }
  if ((m = /^basis-(.+)$/.exec(cls))) {
    r.flexBasis = dim(m[1])
    return
  }
  if ((m = /^gap-(x-|y-)?(\d+)$/.exec(cls))) {
    const k = m[1] === 'x-' ? 'columnGap' : m[1] === 'y-' ? 'rowGap' : 'gap'
    r[k] = +m[2]
    return
  }
  if ((m = /^(p|m)([xytrbl]?)-(\d+)$/.exec(cls))) {
    const base = m[1] === 'p' ? 'padding' : 'margin'
    for (const side of SIDES[m[2]]) r[base + side] = +m[3]
    return
  }
  if ((m = /^(min-|max-)?(w|h)-(.+)$/.exec(cls))) {
    const prop = (m[2] === 'w' ? 'Width' : 'Height') as 'Width' | 'Height'
    const key = m[1] === 'min-' ? `min${prop}` : m[1] === 'max-' ? `max${prop}` : prop.toLowerCase()
    const v = dim(m[3])
    if (v !== undefined) r[key] = v
    return
  }
  if ((m = /^(top|left|right|bottom)-(.+)$/.exec(cls))) {
    const v = dim(m[2])
    if (v !== undefined) r[m[1]] = v
    return
  }
  if ((m = /^z-(\d+)$/.exec(cls))) {
    r.zIndex = +m[1]
    return
  }
  if ((m = /^border-(.+)$/.exec(cls))) {
    if (BORDER_STYLES.has(m[1])) r.border = m[1]
    else if (m[1] === 'rounded') r.border = 'round'
    else if (m[1] === 'thick') r.border = 'bold'
    else r.borderColor = color(m[1])
    return
  }
  if ((m = /^bg-(.+)$/.exec(cls))) {
    r.bg = color(m[1])
    return
  }
  if ((m = /^(?:text|fg|color)-(.+)$/.exec(cls))) {
    r.color = color(m[1])
    return
  }
}

export function parseClasses(input: string): Style {
  const cached = cache.get(input)
  if (cached) return cached
  const style: Style = {}
  for (const cls of input.split(/\s+/)) if (cls) applyClass(style, cls)
  if (cache.size > 5000) cache.clear()
  cache.set(input, style)
  return style
}
