/**
 * Cascade + CSS → terminal style mapping.
 *
 * Units: one terminal cell is treated as 8 CSS px wide and 16 CSS px tall,
 * so `padding: 1rem` becomes 2 columns / 1 row. Heights in px are ignored
 * (terminals are short, fixed heights would clip content); min-heights,
 * percentages and vh are kept.
 */
import type { Style, Segment, Ink, Dimension, BorderStyle } from '../style/style.js'
import { cssColor, cssString, resolveVars, splitTop, StyleSheet, type Declaration, type MediaEnv, type Rule } from './css.js'

/** Terminal style plus the CSS facts the web layer needs later. */
export interface WebStyle extends Style {
  /** Used CSS display (`block`, `inline`, `flex`, `list-item`, ...). */
  cssDisplay: string
  /** Inherited custom properties. */
  vars: Map<string, string>
  listStyle: string
  /** Number of explicit grid columns (`display: grid`). */
  gridCols?: number
  gridGap?: number
  textTransform?: 'uppercase' | 'lowercase' | 'capitalize'
  /** `cursor: pointer`: treated as clickable / focusable when it has listeners. */
  pointer?: boolean
  /** `font-size: 0`: children's text is hidden (generated content stays). */
  hideText?: boolean
  /** Effective background (own or inherited) for contrast checks. */
  effBg?: string
}

/** User-agent stylesheet. `theme(token)` refers to terminal theme colors. */
export const UA_CSS = `
html, body, div, section, article, aside, header, footer, main, nav, form, fieldset, ul, ol, dl, dt, dd,
h1, h2, h3, h4, h5, h6, p, pre, blockquote, figure, figcaption, address, details, summary, hr, menu,
dialog, legend, hgroup, search, center, output, picture { display: block }
li { display: list-item }
table { display: table } tr { display: table-row } td, th { display: table-cell; padding-right: 8px }
thead, tbody, tfoot { display: table-row-group } caption { display: block }
head, script, style, template, noscript, title, meta, link, base, svg, canvas, video, audio, iframe, object,
embed, datalist, param, source, track, map, area, [hidden] { display: none }
dialog:not([open]) { display: none }
details:not([open]) > :not(summary) { display: none }
input, button, select, textarea, img, meter, progress { display: inline-block }
input[type=hidden] { display: none }
h1 { font-weight: bold; margin-bottom: 16px }
h2 { font-weight: bold; margin-bottom: 16px }
h3, h4, h5, h6 { font-weight: bold }
p, pre, blockquote, ul, ol, dl, table, figure, fieldset { margin-bottom: 16px }
li > ul, li > ol, li > p, nav ul, nav ol { margin-bottom: 0 }
ul, ol { padding-left: 16px; list-style-type: disc }
ol { list-style-type: decimal }
ul ul { list-style-type: circle }
strong, b, th, dt, legend, summary { font-weight: bold }
em, i, cite, var, dfn, address { font-style: italic }
u, ins { text-decoration: underline }
s, del, strike { text-decoration: line-through }
a[href] { color: theme(primary); text-decoration: underline }
code, kbd, samp, tt { color: theme(accent) }
pre { white-space: pre }
small, sub, sup { opacity: 0.5 }
mark { background-color: theme(warning); color: #000000 }
blockquote { padding-left: 16px; border-left: 1px solid theme(border) }
hr { border-top: 1px solid theme(border); margin-top: 8px; margin-bottom: 8px }
textarea { display: block; border: 1px solid theme(border) }
fieldset { border: 1px solid theme(border); padding-left: 8px; padding-right: 8px }
`

const BLOCKISH = new Set(['block', 'list-item', 'flex', 'grid', 'table', 'table-row', 'table-row-group', 'table-header-group', 'table-footer-group', 'table-cell', 'flow-root', 'contents', 'table-caption'])
const INLINE_BOX = new Set(['inline-block', 'inline-flex', 'inline-grid', 'inline-table'])

export function isInlineDisplay(d: string) {
  return d === 'inline' || INLINE_BOX.has(d)
}

export function isBlockDisplay(d: string) {
  return BLOCKISH.has(d)
}

// ------------------------------------------------------------------ lengths

export interface LengthEnv {
  columns: number
  rows: number
}

/** CSS length → cells (x: 8px, y: 16px), `n%`, `auto`, or undefined. */
export function length(v: string, axis: 'x' | 'y', env: LengthEnv): Dimension | undefined {
  const s = v.trim().toLowerCase()
  if (s === 'auto') return 'auto'
  if (s === '0') return 0
  if (/^(calc|min|max|clamp)\(/.test(s)) {
    // Tailwind v4 spacing is calc(var(--spacing) * 4): evaluate in CSS px
    const r = evalMath(s, axis, env)
    if (!r) return undefined
    if (r.px === 0 && r.pct !== 0) return `${round3(r.pct)}%`
    if (r.pct !== 0) return undefined // px + % needs the container size, which Yoga can't mix
    return pxToCells(r.px, axis)
  }
  const m = /^(-?[\d.]+)(px|rem|em|%|vw|vh|ch|ex|pt|vmin|vmax|lh)?$/.exec(s)
  if (!m) return undefined
  const n = parseFloat(m[1])
  if (!Number.isFinite(n)) return undefined
  const unit = m[2] ?? 'px'
  if (unit === '%') return `${n}%`
  if (unit === 'vw') return axis === 'x' ? `${n}%` : Math.round((env.columns * n) / 100)
  if (unit === 'vh') return axis === 'y' ? Math.round((env.rows * n) / 100) : undefined
  if (unit === 'vmin' || unit === 'vmax') return undefined
  if (unit === 'ch') return axis === 'x' ? Math.round(n) : undefined
  if (unit === 'lh') return axis === 'y' ? Math.round(n) : undefined
  const pxv = unit === 'rem' || unit === 'em' ? n * 16 : unit === 'ex' ? n * 8 : unit === 'pt' ? (n * 4) / 3 : n
  return pxToCells(pxv, axis)
}

const pxToCells = (px: number, axis: 'x' | 'y') => (axis === 'x' ? Math.round(px / 8) : Math.floor(px / 16 + 0.4))
const round3 = (n: number) => Math.round(n * 1000) / 1000

/** A math value: `px` CSS pixels plus `pct` percent of the container. */
interface MathValue {
  px: number
  pct: number
  /** A plain number (no unit): only these can multiply / divide. */
  unitless: boolean
}

/** Evaluates calc() / min() / max() / clamp() with +, -, *, / and nesting. Undefined if unsupported. */
export function evalMath(src: string, axis: 'x' | 'y', env: LengthEnv): MathValue | undefined {
  let i = 0
  const ws = () => {
    while (i < src.length && /\s/.test(src[i])) i++
  }
  const fail = (): never => {
    throw new Error('unsupported')
  }
  const unitPx = (n: number, unit: string): MathValue => {
    switch (unit) {
      case '': return { px: n, pct: 0, unitless: true }
      case 'px': return { px: n, pct: 0, unitless: false }
      case 'rem': case 'em': return { px: n * 16, pct: 0, unitless: false }
      case 'ex': case 'ch': return { px: n * 8, pct: 0, unitless: false }
      case 'pt': return { px: (n * 4) / 3, pct: 0, unitless: false }
      case 'lh': return { px: n * 16, pct: 0, unitless: false }
      case 'vw': return { px: (env.columns * 8 * n) / 100, pct: 0, unitless: false }
      case 'vh': return { px: (env.rows * 16 * n) / 100, pct: 0, unitless: false }
      case '%': return { px: 0, pct: n, unitless: false }
      default: return fail()
    }
  }
  const fn = (name: string): MathValue => {
    const args: MathValue[] = [sum()]
    ws()
    while (src[i] === ',') {
      i++
      args.push(sum())
      ws()
    }
    if (src[i++] !== ')') fail()
    if (name === 'calc') return args.length === 1 ? args[0] : fail()
    if (args.some((a) => a.pct !== 0)) fail() // min/max of percentages needs the container
    if (name === 'min') return { px: Math.min(...args.map((a) => a.px)), pct: 0, unitless: args.every((a) => a.unitless) }
    if (name === 'max') return { px: Math.max(...args.map((a) => a.px)), pct: 0, unitless: args.every((a) => a.unitless) }
    if (name === 'clamp' && args.length === 3) return { px: Math.min(Math.max(args[1].px, args[0].px), args[2].px), pct: 0, unitless: false }
    return fail()
  }
  const atom = (): MathValue => {
    ws()
    if (src[i] === '(') {
      i++
      const v = sum()
      ws()
      if (src[i++] !== ')') fail()
      return v
    }
    const f = /^(calc|min|max|clamp)\(/.exec(src.slice(i))
    if (f) {
      i += f[0].length
      return fn(f[1])
    }
    const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%|[a-z]+)?/.exec(src.slice(i))
    if (!m) return fail()
    i += m[0].length
    return unitPx(parseFloat(m[1]), m[2] ?? '')
  }
  const product = (): MathValue => {
    let v = atom()
    for (;;) {
      ws()
      const op = src[i]
      if (op !== '*' && op !== '/') return v
      i++
      const r = atom()
      if (op === '*') {
        if (r.unitless) v = { px: v.px * r.px, pct: v.pct * r.px, unitless: v.unitless }
        else if (v.unitless) v = { px: r.px * v.px, pct: r.pct * v.px, unitless: false }
        else fail()
      } else {
        if (!r.unitless || r.px === 0) fail()
        v = { px: v.px / r.px, pct: v.pct / r.px, unitless: v.unitless }
      }
    }
  }
  const sum = (): MathValue => {
    let v = product()
    for (;;) {
      ws()
      const op = src[i]
      if (op !== '+' && op !== '-') return v
      i++
      const r = product()
      const k = op === '+' ? 1 : -1
      v = { px: v.px + k * r.px, pct: v.pct + k * r.pct, unitless: v.unitless && r.unitless }
    }
  }
  try {
    const v = atom()
    ws()
    return i === src.length ? v : undefined
  } catch {
    return undefined
  }
}

function cells(v: string, axis: 'x' | 'y', env: LengthEnv): number | undefined {
  const d = length(v, axis, env)
  return typeof d === 'number' ? Math.max(0, d) : undefined
}

// ------------------------------------------------------------------ shorthand expansion

const EDGES = ['top', 'right', 'bottom', 'left'] as const

function boxValues(v: string): [string, string, string, string] {
  const p = splitTop(v.trim().replace(/\s+/g, ' '), ' ').filter(Boolean)
  const [t, r = t, b = t, l = r] = p
  return [t, r, b, l]
}

const BORDER_STYLES = new Set(['none', 'hidden', 'dotted', 'dashed', 'solid', 'double', 'groove', 'ridge', 'inset', 'outset'])

function parseBorder(v: string): { width?: string; style?: string; color?: string } {
  const out: { width?: string; style?: string; color?: string } = {}
  for (const tok of splitTop(v.trim().replace(/\s+/g, ' '), ' ')) {
    const t = tok.toLowerCase()
    if (BORDER_STYLES.has(t)) out.style = t
    else if (/^[\d.]/.test(t) || t === 'thin' || t === 'medium' || t === 'thick') out.width = t
    else out.color = tok
  }
  return out
}

/** Expands shorthands into longhands, in place, preserving cascade order. */
function expand(prop: string, value: string, set: (p: string, v: string) => void) {
  switch (prop) {
    case 'margin':
    case 'padding': {
      const [t, r, b, l] = boxValues(value)
      set(`${prop}-top`, t)
      set(`${prop}-right`, r)
      set(`${prop}-bottom`, b)
      set(`${prop}-left`, l)
      return
    }
    case 'margin-inline':
    case 'padding-inline': {
      const [a, b = a] = value.trim().split(/\s+/)
      const base = prop.split('-')[0]
      set(`${base}-left`, a)
      set(`${base}-right`, b)
      return
    }
    case 'margin-block':
    case 'padding-block': {
      const [a, b = a] = value.trim().split(/\s+/)
      const base = prop.split('-')[0]
      set(`${base}-top`, a)
      set(`${base}-bottom`, b)
      return
    }
    case 'border':
    case 'border-top':
    case 'border-right':
    case 'border-bottom':
    case 'border-left': {
      const b = parseBorder(value)
      const edges = prop === 'border' ? EDGES : [prop.slice(7) as (typeof EDGES)[number]]
      for (const e of edges) {
        set(`border-${e}-width`, b.width ?? 'medium')
        set(`border-${e}-style`, b.style ?? 'none')
        set(`border-${e}-color`, b.color ?? 'currentcolor')
      }
      return
    }
    case 'border-width':
    case 'border-style':
    case 'border-color': {
      const kind = prop.slice(7)
      boxValues(value).forEach((v, i) => set(`border-${EDGES[i]}-${kind}`, v))
      return
    }
    case 'flex': {
      const v = value.trim().toLowerCase()
      if (v === 'none') return (set('flex-grow', '0'), set('flex-shrink', '0'), set('flex-basis', 'auto'))
      if (v === 'auto') return (set('flex-grow', '1'), set('flex-shrink', '1'), set('flex-basis', 'auto'))
      const parts = v.split(/\s+/)
      const nums = parts.filter((p) => /^[\d.]+$/.test(p))
      const basis = parts.find((p) => !/^[\d.]+$/.test(p))
      set('flex-grow', nums[0] ?? '1')
      set('flex-shrink', nums[1] ?? '1')
      set('flex-basis', basis ?? (nums.length ? '0' : 'auto'))
      return
    }
    case 'flex-flow':
      for (const p of value.trim().split(/\s+/)) set(/wrap/.test(p) ? 'flex-wrap' : 'flex-direction', p)
      return
    case 'background': {
      // keep the original token: its alpha decides whether it is painted
      const tok = splitTop(value.trim().replace(/\s+/g, ' '), ' ').find((t) => cssColor(t) !== undefined || /^theme\(/.test(t))
      set('background-color', tok ?? 'transparent')
      return
    }
    case 'list-style': {
      const t = value.trim().split(/\s+/).find((p) => /^(none|disc|circle|square|decimal|decimal-leading-zero|lower-alpha|upper-alpha|lower-roman|upper-roman|lower-latin|upper-latin)$/.test(p))
      if (t) set('list-style-type', t)
      else if (/\bnone\b/.test(value)) set('list-style-type', 'none')
      return
    }
    case 'gap':
    case 'grid-gap': {
      const [r, c = r] = value.trim().split(/\s+/)
      set('row-gap', r)
      set('column-gap', c)
      return
    }
    case 'place-items': {
      const [a] = value.trim().split(/\s+/)
      set('align-items', a)
      return
    }
    case 'place-content': {
      const [a, j = a] = value.trim().split(/\s+/)
      set('align-content', a)
      set('justify-content', j)
      return
    }
    case 'overflow': {
      const [x, y = x] = value.trim().split(/\s+/)
      set('overflow-x', x)
      set('overflow-y', y)
      return
    }
    case 'text-decoration':
      set('text-decoration-line', value)
      return
    case 'font': {
      if (/\bbold\b|\b[6-9]00\b/.test(value)) set('font-weight', 'bold')
      if (/\bitalic\b|\boblique\b/.test(value)) set('font-style', 'italic')
      return
    }
    case 'grid-template': {
      const cols = value.split('/')[1]
      if (cols) set('grid-template-columns', cols)
      return
    }
    default:
      set(prop, value)
  }
}

// ------------------------------------------------------------------ cascade

export interface CascadeInput {
  ua: Rule[]
  author: Rule[]
  /** Inline `style` declarations (highest priority). */
  inline: Declaration[]
  parent: WebStyle | null
  env: LengthEnv & MediaEnv
}

/** Cascaded values for one element (or pseudo-element). */
export function cascade(rules: Rule[], ua: Rule[], inline: Declaration[], parentVars: Map<string, string>) {
  const ordered: Declaration[] = []
  const important: Declaration[] = []
  for (const r of ua) for (const d of r.decls) ordered.push(d)
  for (const r of rules) for (const d of r.decls) (d.important ? important : ordered).push(d)
  for (const d of inline) (d.important ? important : ordered).push(d)
  const all = [...ordered, ...important]
  // custom properties first (they can be referenced by any declaration)
  let vars = parentVars
  for (const d of all) {
    if (!d.prop.startsWith('--')) continue
    if (vars === parentVars) vars = new Map(parentVars)
    vars.set(d.prop, d.value)
  }
  const values = new Map<string, string>()
  const set = (p: string, v: string) => {
    values.delete(p) // keep insertion order = cascade order
    values.set(p, v)
  }
  for (const d of all) {
    if (d.prop.startsWith('--')) continue
    const v = resolveVars(d.value, vars).trim()
    if (!v) continue
    expand(d.prop, v, set)
  }
  return { values, vars }
}

const INHERIT_DEFAULTS = { textAlign: undefined, whiteSpace: 'normal', listStyle: 'disc' }

function themeColor(v: string): string | undefined {
  const m = /^theme\(\s*([\w-]+)\s*\)$/.exec(v.trim())
  return m ? m[1] : undefined
}

/** CSS color (or `theme(token)`) for the terminal; undefined to leave unset. */
function color(v: string, parentColor: string | undefined): string | undefined {
  const t = themeColor(v)
  if (t) return t
  const lv = v.trim().toLowerCase()
  if (lv === 'inherit' || lv === 'currentcolor') return parentColor
  if (lv === 'initial' || lv === 'unset' || lv === 'revert') return undefined
  const alpha = { a: 1 }
  const c = cssColor(v, alpha)
  if (!c || c === 'transparent' || alpha.a < 0.35) return undefined
  return c
}

const ALIGN_MAP: Record<string, string> = {
  start: 'flex-start', 'flex-start': 'flex-start', 'self-start': 'flex-start', left: 'flex-start',
  end: 'flex-end', 'flex-end': 'flex-end', 'self-end': 'flex-end', right: 'flex-end',
  center: 'center', stretch: 'stretch', baseline: 'baseline', normal: 'stretch',
  'space-between': 'space-between', 'space-around': 'space-around', 'space-evenly': 'space-evenly',
}

function gridColumns(v: string): number | undefined {
  const s = v.trim()
  if (!s || s === 'none') return undefined
  let n = 0
  for (const tok of splitTop(s.replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' '), ' ')) {
    if (!tok) continue
    const rep = /^repeat\(\s*(\d+)\s*,/.exec(tok)
    if (rep) n += parseInt(rep[1], 10)
    else if (/^repeat\(/.test(tok)) return undefined // auto-fill / auto-fit
    else n++
  }
  return n || undefined
}

/** Turns cascaded values into a terminal style. */
export function computeStyle(values: Map<string, string>, vars: Map<string, string>, parent: WebStyle | null, env: LengthEnv, tag: string): WebStyle {
  const get = (p: string) => values.get(p)
  const ws: WebStyle = {
    cssDisplay: 'inline',
    vars,
    listStyle: parent?.listStyle ?? INHERIT_DEFAULTS.listStyle,
    whiteSpace: parent?.whiteSpace ?? 'normal',
  }
  if (parent?.textAlign) ws.textAlign = parent.textAlign
  if (parent?.textTransform) ws.textTransform = parent.textTransform

  let display = (get('display') ?? 'inline').toLowerCase().trim()
  if (display.includes(' ')) {
    // two-value syntax: "block flex", "inline flow-root"
    const [outer, inner] = display.split(/\s+/)
    display = inner === 'flex' || inner === 'grid' ? (outer === 'inline' ? `inline-${inner}` : inner) : outer
  }
  if (display === 'contents') display = 'block'
  // floats are blockified (CSS 2.1 §9.7) and pushed to their side
  const float = get('float')?.trim()
  const floated = (float === 'left' || float === 'right') && display !== 'none' && get('position')?.trim() !== 'absolute'
  if (floated && isInlineDisplay(display)) display = 'block'
  if (display === 'none' || get('visibility') === 'hidden' || get('visibility') === 'collapse') ws.display = 'none'
  ws.cssDisplay = display

  // flex container direction
  const isFlex = display === 'flex' || display === 'inline-flex'
  const isGrid = display === 'grid' || display === 'inline-grid'
  if (isFlex) {
    const dir = (get('flex-direction') ?? 'row').trim()
    ws.flexDirection = (['row', 'column', 'row-reverse', 'column-reverse'].includes(dir) ? dir : 'row') as Style['flexDirection']
    const wrap = get('flex-wrap')?.trim()
    if (wrap === 'wrap' || wrap === 'wrap-reverse') ws.flexWrap = wrap
  } else if (isGrid) {
    ws.gridCols = gridColumns(get('grid-template-columns') ?? '')
    ws.flexDirection = ws.gridCols && ws.gridCols > 1 ? 'row' : 'column'
    if (ws.gridCols && ws.gridCols > 1) ws.flexWrap = 'wrap'
  } else if (display === 'table-row') ws.flexDirection = 'row'
  else ws.flexDirection = 'column'

  const ai = get('align-items')
  if (ai && ALIGN_MAP[ai.trim()]) ws.alignItems = ALIGN_MAP[ai.trim()] as Style['alignItems']
  const as = get('align-self')
  if (as && as.trim() !== 'auto' && ALIGN_MAP[as.trim()]) ws.alignSelf = ALIGN_MAP[as.trim()] as Style['alignSelf']
  const ac = get('align-content')
  if (ac && ALIGN_MAP[ac.trim()] && ALIGN_MAP[ac.trim()] !== 'baseline') ws.alignContent = ALIGN_MAP[ac.trim()] as Style['alignContent']
  const jc = get('justify-content')
  if (jc && ALIGN_MAP[jc.trim()] && !['stretch', 'baseline'].includes(ALIGN_MAP[jc.trim()])) ws.justifyContent = ALIGN_MAP[jc.trim()] as Style['justifyContent']

  const num = (p: string) => {
    const v = get(p)
    if (v === undefined) return undefined
    const n = parseFloat(v)
    return Number.isFinite(n) ? n : undefined
  }
  const grow = num('flex-grow')
  if (grow !== undefined) ws.flexGrow = grow
  const shrink = num('flex-shrink')
  if (shrink !== undefined) ws.flexShrink = shrink
  const basis = get('flex-basis')
  if (basis !== undefined) {
    const b = length(basis, 'x', env)
    if (b !== undefined) ws.flexBasis = b
  }

  // gaps
  const rg = get('row-gap')
  if (rg && rg !== 'normal') ws.rowGap = cells(rg, 'y', env)
  const cg = get('column-gap')
  if (cg && cg !== 'normal') ws.columnGap = cells(cg, 'x', env)
  if (isGrid && ws.gridCols && ws.gridCols > 1) {
    ws.gridGap = ws.columnGap ?? 0
    ws.columnGap = 0
  }

  // sizes
  const w = get('width')
  if (w) {
    const d = length(w, 'x', env)
    if (d !== undefined && d !== 'auto') ws.width = typeof d === 'number' ? Math.max(0, d) : d
  }
  const minW = get('min-width')
  if (minW) {
    const d = length(minW, 'x', env)
    if (d !== undefined && d !== 'auto') ws.minWidth = d
  }
  const maxW = get('max-width')
  if (maxW && maxW !== 'none') {
    const d = length(maxW, 'x', env)
    if (d !== undefined && d !== 'auto') ws.maxWidth = d
  }
  const h = get('height')
  if (h && (/%$/.test(h.trim()) || /vh$/.test(h.trim()))) {
    const d = length(h, 'y', env)
    if (d !== undefined && d !== 'auto') ws.height = d
  }
  const minH = get('min-height')
  if (minH) {
    const d = length(minH, 'y', env)
    if (d !== undefined && d !== 'auto') ws.minHeight = d
  }

  // box model
  const axis = (e: string) => (e === 'top' || e === 'bottom' ? 'y' : 'x') as 'x' | 'y'
  const cap = (e: string) => e[0].toUpperCase() + e.slice(1)
  let autoLeft = false
  let autoRight = false
  for (const e of EDGES) {
    const p = get(`padding-${e}`)
    if (p !== undefined) {
      const c = cells(p, axis(e), env)
      if (c !== undefined) (ws as unknown as Record<string, unknown>)[`padding${cap(e)}`] = c
    }
    const m = get(`margin-${e}`)
    if (m !== undefined) {
      if (m.trim() === 'auto') {
        if (e === 'left') autoLeft = true
        if (e === 'right') autoRight = true
        continue
      }
      const c = cells(m, axis(e), env)
      if (c !== undefined) (ws as unknown as Record<string, unknown>)[`margin${cap(e)}`] = c
    }
  }
  if (floated) {
    ws.alignSelf = float === 'left' ? 'flex-start' : 'flex-end'
    ws.float = float
  }
  if (autoLeft && autoRight && isBlockDisplay(display)) {
    // `margin: 0 auto` centers a block
    ws.alignSelf = 'center'
    if (ws.width === undefined) ws.width = '100%'
  }

  // borders
  let any = false
  let rounded = false
  let style: BorderStyle = 'single'
  let bColor: string | undefined
  for (const e of EDGES) {
    const st = (get(`border-${e}-style`) ?? 'none').trim().toLowerCase()
    const wd = (get(`border-${e}-width`) ?? 'medium').trim().toLowerCase()
    const rawColor = (get(`border-${e}-color`) ?? '').trim()
    const alpha = { a: 1 }
    const invisible = !!rawColor && (cssColor(rawColor, alpha) === 'transparent' || alpha.a < 0.2)
    const on = st !== 'none' && st !== 'hidden' && !/^0(px|rem|em)?$/.test(wd) && !invisible
    ;(ws as unknown as Record<string, unknown>)[`border${cap(e)}`] = on
    if (on) {
      any = true
      if (st === 'dashed' || st === 'dotted') style = 'dashed'
      else if (st === 'double') style = 'double'
      else if (parseFloat(wd) >= 3 || wd === 'thick') style = 'bold'
      bColor ??= color(get(`border-${e}-color`) ?? '', undefined)
    }
  }
  if (any) {
    const radius = get('border-radius')
    if (radius && parseFloat(radius) > 0 && style === 'single') rounded = true
    ws.border = rounded ? 'round' : style
    if (bColor) ws.borderColor = bColor
  } else {
    delete ws.borderTop
    delete ws.borderRight
    delete ws.borderBottom
    delete ws.borderLeft
  }

  // text & ink
  const c = get('color')
  if (c) {
    const v = color(c, undefined)
    if (v) ws.color = v
  }
  const bg = get('background-color')
  if (bg) {
    const v = color(bg, undefined)
    if (v) ws.bg = v
  }
  const fw = get('font-weight')?.trim().toLowerCase()
  if (fw) ws.bold = fw === 'bold' || fw === 'bolder' || parseInt(fw, 10) >= 600
  const fs = get('font-style')?.trim().toLowerCase()
  if (fs) ws.italic = fs === 'italic' || fs.startsWith('oblique')
  const td = get('text-decoration-line')?.toLowerCase()
  if (td) {
    ws.underline = td.includes('underline')
    ws.strikethrough = td.includes('line-through')
  }
  const op = num('opacity')
  if (op !== undefined && op < 0.6) ws.dim = true
  const ta = get('text-align')?.trim()
  if (ta) ws.textAlign = ta === 'center' ? 'center' : ta === 'right' || ta === 'end' ? 'right' : 'left'
  const wsp = get('white-space')?.trim()
  if (wsp) ws.whiteSpace = wsp.startsWith('pre') ? 'pre' : wsp === 'nowrap' ? 'nowrap' : 'normal'
  if (ws.whiteSpace === 'nowrap' || (ws.whiteSpace === 'pre' && tag === 'pre')) ws.wrap = 'none'
  if (get('text-overflow')?.includes('ellipsis')) ws.wrap = 'truncate'
  const tt = get('text-transform')?.trim()
  if (tt === 'uppercase' || tt === 'lowercase' || tt === 'capitalize') ws.textTransform = tt
  else if (tt === 'none') delete ws.textTransform
  const ls = get('list-style-type')?.trim()
  if (ls) ws.listStyle = ls
  const ox = get('overflow-x')?.trim()
  const oy = get('overflow-y')?.trim()
  if (ox === 'hidden' || ox === 'clip' || oy === 'hidden' || oy === 'clip') ws.overflow = 'hidden'
  if (get('cursor')?.trim() === 'pointer') ws.pointer = true
  // visually-hidden patterns (sr-only, 1px inputs): nothing to show in a terminal
  const tiny = (v: string | undefined) => !!v && /^(0|[0-2](\.\d+)?px)$/.test(v.trim())
  if ((tiny(get('width')) && tiny(get('height'))) || /rect\(\s*0/.test(get('clip') ?? '') || /inset\(\s*50%/.test(get('clip-path') ?? '')) ws.display = 'none'
  const fsz = get('font-size')?.trim()
  if (fsz && /^0(px|rem|em|%)?$/.test(fsz)) ws.hideText = true

  // absolute positioning: kept when its offsets stay inside the containing
  // box; elements pushed outside (negative offsets, decorative tricks) stay
  // in normal flow. fixed / sticky become static (no viewport overlays).
  if (get('position')?.trim() === 'absolute' && ws.display !== 'none') {
    const off: Partial<Record<(typeof EDGES)[number], Dimension>> = {}
    let outside = false
    for (const e of EDGES) {
      const v = get(e)
      if (v === undefined || v.trim() === 'auto') continue
      const d = length(v, axis(e), env)
      if (d === undefined) continue
      if ((typeof d === 'number' && d < 0) || (typeof d === 'string' && parseFloat(d) < 0) || (typeof d === 'string' && parseFloat(d) >= 100)) outside = true
      off[e] = d
    }
    if (!outside) {
      ws.position = 'absolute'
      // top:0; bottom:0; margin:auto 0 → vertically centered
      if (off.top === 0 && off.bottom === 0 && get('margin-top')?.trim() === 'auto') {
        off.top = '50%'
        delete off.bottom
      }
      Object.assign(ws, off)
    }
  }
  return ws
}

/** `content` of a ::before / ::after rule, or undefined. */
export function pseudoContent(values: Map<string, string>, attr: (n: string) => string | undefined): string | undefined {
  const v = values.get('content')
  if (!v || v === 'none' || v === 'normal') return undefined
  if (values.get('display')?.trim() === 'none') return undefined
  let out = ''
  for (const tok of splitTop(v.trim().replace(/\s+/g, ' '), ' ')) {
    const s = cssString(tok)
    if (s !== undefined) out += s
    else {
      const a = /^attr\(\s*([\w-]+)\s*\)$/.exec(tok)
      if (a) out += attr(a[1]) ?? ''
    }
  }
  // icon fonts use private-use code points: unprintable in a terminal
  out = out.replace(/[-]/g, '')
  return out || undefined
}

/** Ink of a pseudo-element (color / weight). */
export function pseudoInk(values: Map<string, string>): Ink | undefined {
  const ink: Ink = {}
  const c = values.get('color')
  if (c) {
    const v = color(c, undefined)
    if (v) ink.color = v
  }
  const fw = values.get('font-weight')
  if (fw) ink.bold = /bold|[6-9]00/.test(fw)
  return Object.keys(ink).length ? ink : undefined
}

export function segment(text: string, ink?: Ink): Segment {
  return ink ? { text, ink } : { text }
}

export { StyleSheet }
