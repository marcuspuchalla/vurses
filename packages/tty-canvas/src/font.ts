/** CSS font shorthand parsing and text layout with the built-in stroke font. */
import { GLYPHS, MARKS, TOFU } from './glyphs.js'
import { flatten, Path2D, type Polyline } from './path.js'

/** Font units per em of the built-in font. */
export const UNITS_PER_EM = 12
/** Baseline position in glyph units (y down). */
export const BASELINE = 8
export const ASCENT = 9 // em-box ascent (units)
export const DESCENT = 3 // em-box descent (units)
const SIDE_BEARING = 0.9
const MONO_ADVANCE = 7.2

export interface FontInfo {
  style: 'normal' | 'italic' | 'oblique'
  variant: 'normal' | 'small-caps'
  weight: number
  stretch: string
  /** Size in CSS px. */
  size: number
  family: string[]
  monospace: boolean
  /** Canonical serialization (the value `ctx.font` returns). */
  css: string
}

const SIZE_KEYWORDS: Record<string, number> = {
  'xx-small': 9, 'x-small': 10, small: 13, medium: 16, large: 18, 'x-large': 24, 'xx-large': 32, 'xxx-large': 48,
  larger: 12, smaller: 8.33,
}
const STRETCH = new Set(['ultra-condensed', 'extra-condensed', 'condensed', 'semi-condensed', 'semi-expanded', 'expanded', 'extra-expanded', 'ultra-expanded'])
const MONO_FAMILIES = /^(monospace|ui-monospace|courier( new)?|consolas|menlo|monaco|fira (code|mono)|source code pro|jetbrains mono|dejavu sans mono|liberation mono|sf mono|cascadia (code|mono)|ubuntu mono|roboto mono|lucida console)$/i

export const DEFAULT_FONT = '10px sans-serif'

/** Parses a CSS `font` shorthand. Returns null for invalid values (canvas then ignores the assignment). */
export function parseFont(input: string): FontInfo | null {
  const s = String(input).trim()
  const m = /^((?:(?:normal|italic|oblique|small-caps|bold|bolder|lighter|[1-9]00|[a-z-]*condensed|[a-z-]*expanded)\s+)*)((?:[\d.]+(?:px|pt|pc|in|cm|mm|q|em|rem|%|ex|ch|vw|vh)?)|xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|larger|smaller)(?:\s*\/\s*[^\s]+)?\s+(.+)$/i.exec(s)
  if (!m) return null
  let style: FontInfo['style'] = 'normal'
  let variant: FontInfo['variant'] = 'normal'
  let weight = 400
  let stretch = 'normal'
  for (const tok of m[1].trim().split(/\s+/).filter(Boolean)) {
    const t = tok.toLowerCase()
    if (t === 'normal') continue
    if (t === 'italic' || t === 'oblique') style = t
    else if (t === 'small-caps') variant = 'small-caps'
    else if (t === 'bold' || t === 'bolder') weight = 700
    else if (t === 'lighter') weight = 300
    else if (/^[1-9]00$/.test(t)) weight = +t
    else if (STRETCH.has(t)) stretch = t
    else return null
  }
  const size = parseSize(m[2].toLowerCase())
  if (size === null || !(size >= 0)) return null
  const family = splitFamilies(m[3])
  if (!family.length) return null
  const parts: string[] = []
  if (style !== 'normal') parts.push(style)
  if (variant !== 'normal') parts.push(variant)
  if (weight !== 400) parts.push(weight === 700 ? 'bold' : String(weight))
  if (stretch !== 'normal') parts.push(stretch)
  parts.push(`${round(size)}px`)
  parts.push(family.map((f) => (/[\s,]/.test(f) && !/^["']/.test(f) ? `"${f}"` : f)).join(', '))
  return {
    style, variant, weight, stretch, size, family,
    monospace: family.some((f) => MONO_FAMILIES.test(f.replace(/^["']|["']$/g, ''))),
    css: parts.join(' '),
  }
}

function round(n: number) {
  return Math.round(n * 1000) / 1000
}

function parseSize(v: string): number | null {
  if (v in SIZE_KEYWORDS) return SIZE_KEYWORDS[v]
  const m = /^([\d.]+)([a-z%]*)$/.exec(v)
  if (!m) return null
  const n = parseFloat(m[1])
  if (!Number.isFinite(n)) return null
  switch (m[2]) {
    case '':
      return n === 0 ? 0 : null
    case 'px': return n
    case 'pt': return (n * 4) / 3
    case 'pc': return n * 16
    case 'in': return n * 96
    case 'cm': return (n * 96) / 2.54
    case 'mm': return (n * 96) / 25.4
    case 'q': return (n * 96) / 101.6
    case 'em': case 'rem': return n * 10
    case '%': return n / 10
    case 'ex': case 'ch': return n * 5
    default: return null
  }
}

function splitFamilies(s: string): string[] {
  const out: string[] = []
  const re = /\s*("[^"]*"|'[^']*'|[^,]+)\s*(,|$)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) && m[0]) {
    const f = m[1].trim()
    if (f) out.push(/^["']/.test(f) ? f.slice(1, -1) : f)
    if (!m[2]) break
  }
  return out
}

// ---------------------------------------------------------------- glyphs

export interface Glyph {
  /** Advance in font units. */
  advance: number
  path: Path2D
  /** Ink bounds in glyph units (before stroking): [x0, y0, x1, y1] */
  bounds: [number, number, number, number]
}

const glyphCache = new Map<string, Glyph>()
const markCache = new Map<string, Path2D>()

export function getGlyph(ch: string, mono: boolean): Glyph {
  const key = (mono ? 'm' : 'p') + ch
  let g = glyphCache.get(key)
  if (g) return g
  let def = GLYPHS[ch]
  if (!def && ch === ' ') def = [4 - 2 * SIDE_BEARING + 1.6, '']
  if (!def && /\s/.test(ch)) def = [4 - 2 * SIDE_BEARING + 1.6, '']
  if (!def) def = TOFU
  const [w, d] = def
  const raw = new Path2D(d)
  let advance = w + SIDE_BEARING * 2
  let sx = 1
  let ox = SIDE_BEARING
  if (mono) {
    advance = MONO_ADVANCE
    const maxInk = MONO_ADVANCE - 1.4
    if (w > maxInk) sx = maxInk / w
    ox = (MONO_ADVANCE - w * sx) / 2
  }
  const path = new Path2D()
  path.addPath(raw, { a: sx, d: 1, e: ox, f: 0 })
  g = { advance, path, bounds: pathBounds(path) }
  glyphCache.set(key, g)
  return g
}

function getMark(ch: string): Path2D | null {
  const m = MARKS[ch]
  if (!m) return null
  let p = markCache.get(ch)
  if (!p) markCache.set(ch, (p = new Path2D(m.d)))
  return p
}

function pathBounds(p: Path2D): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const poly of flatten(p._subpaths, 0.1)) {
    for (let i = 0; i < poly.pts.length; i += 2) {
      const x = poly.pts[i], y = poly.pts[i + 1]
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  return x0 === Infinity ? [0, 0, 0, 0] : [x0, y0, x1, y1]
}

/** Stroke width (font units) for a CSS weight. */
export function strokeWidthFor(weight: number) {
  if (weight >= 600) return 1.65
  if (weight <= 300) return 0.7
  return weight >= 500 ? 1.25 : 1.05
}

export interface TextLayout {
  /** All glyph outlines in font units (x from 0 at the start of the text, baseline at y=8). */
  path: Path2D
  /** Total advance in font units (letter spacing excluded). */
  advance: number
  /** Number of advancing glyphs (for letter spacing). */
  count: number
  /** Ink bounds in font units. */
  bounds: [number, number, number, number]
}

/**
 * Lays out a single line. `extraSpacing` (font units) is added after every
 * glyph (letterSpacing) and `wordSpacing` after spaces.
 */
export function layoutText(text: string, font: FontInfo, extraSpacing = 0, wordSpacing = 0): TextLayout {
  const path = new Path2D()
  let x = 0
  let count = 0
  let prevCenter = 0
  let prevCap = false
  let prevBase = ''
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  const smallCaps = font.variant === 'small-caps'
  const chars = Array.from(text.normalize('NFD'))
  for (let i = 0; i < chars.length; i++) {
    let ch = chars[i]
    const mark = MARKS[ch]
    if (mark) {
      const mp = getMark(ch)!
      const dy = mark.lift && prevCap ? -2.3 : 0
      path.addPath(mp, { e: prevCenter, f: dy })
      if (prevBase) y0 = Math.min(y0, dy)
      continue
    }
    // dotless i/j under marks above
    if ((ch === 'i' || ch === 'j') && MARKS[chars[i + 1]]?.lift) ch = ch === 'i' ? 'ı' : 'j'
    let sy = 1
    if (smallCaps && ch !== ch.toUpperCase()) {
      ch = ch.toUpperCase()
      sy = 0.75
    }
    const g = getGlyph(ch, font.monospace)
    if (sy !== 1) path.addPath(g.path, { a: sy, d: sy, e: x, f: BASELINE * (1 - sy) })
    else path.addPath(g.path, { e: x })
    const adv = g.advance * (sy !== 1 ? sy : 1)
    if (g.bounds[2] > g.bounds[0] || g.bounds[3] > g.bounds[1]) {
      x0 = Math.min(x0, x + g.bounds[0])
      x1 = Math.max(x1, x + g.bounds[2] * sy)
      y0 = Math.min(y0, BASELINE - (BASELINE - g.bounds[1]) * sy)
      y1 = Math.max(y1, g.bounds[3])
    }
    prevCenter = x + adv / 2
    prevCap = sy === 1 && /[A-ZÀ-Þ0-9]/.test(ch)
    prevBase = ch
    x += adv + extraSpacing
    if (ch === ' ') x += wordSpacing
    count++
  }
  return { path, advance: x, count, bounds: x0 === Infinity ? [0, BASELINE, 0, BASELINE] : [x0, y0, x1, y1] }
}

export type { Polyline }
