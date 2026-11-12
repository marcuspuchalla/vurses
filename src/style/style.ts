/**
 * Style model shared by all terminal elements.
 *
 * Styles can be provided three ways (later wins):
 *   1. utility classes:  class="flex-col gap-1 p-2 border-round text-primary"
 *   2. a style object:   :style="{ flexDirection: 'column', padding: 1 }"
 *   3. direct props:     <Box flex-direction="column" :padding="1" />
 */

/** A run of generated text with its own ink (CSS `content`, widget chrome). */
export interface Segment {
  text: string
  ink?: Ink
}

export type Dimension = number | `${number}%` | 'auto'
export type BorderStyle = 'single' | 'round' | 'double' | 'bold' | 'ascii' | 'dashed' | 'none'

export interface Style {
  // layout
  display?: 'flex' | 'none'
  position?: 'relative' | 'absolute'
  top?: Dimension
  left?: Dimension
  right?: Dimension
  bottom?: Dimension
  flexDirection?: 'row' | 'column' | 'row-reverse' | 'column-reverse'
  flexWrap?: 'nowrap' | 'wrap' | 'wrap-reverse'
  flexGrow?: number
  flexShrink?: number
  flexBasis?: Dimension
  alignItems?: 'flex-start' | 'flex-end' | 'center' | 'stretch' | 'baseline'
  alignSelf?: 'auto' | 'flex-start' | 'flex-end' | 'center' | 'stretch' | 'baseline'
  alignContent?: 'flex-start' | 'flex-end' | 'center' | 'stretch' | 'space-between' | 'space-around'
  justifyContent?: 'flex-start' | 'flex-end' | 'center' | 'space-between' | 'space-around' | 'space-evenly'
  width?: Dimension
  height?: Dimension
  minWidth?: Dimension
  minHeight?: Dimension
  maxWidth?: Dimension
  maxHeight?: Dimension
  padding?: number
  paddingX?: number
  paddingY?: number
  paddingTop?: number
  paddingRight?: number
  paddingBottom?: number
  paddingLeft?: number
  margin?: number
  marginX?: number
  marginY?: number
  marginTop?: number
  marginRight?: number
  marginBottom?: number
  marginLeft?: number
  gap?: number
  rowGap?: number
  columnGap?: number
  overflow?: 'visible' | 'hidden'
  zIndex?: number
  // border
  border?: BorderStyle | boolean
  borderColor?: string
  borderTop?: boolean
  borderRight?: boolean
  borderBottom?: boolean
  borderLeft?: boolean
  // visual
  color?: string
  bg?: string
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
  inverse?: boolean
  strikethrough?: boolean
  // text
  wrap?: 'wrap' | 'truncate' | 'truncate-start' | 'truncate-middle' | 'none'
  textAlign?: 'left' | 'center' | 'right'
  /** Base text direction for the Unicode bidi algorithm (default `auto`: first strong character). */
  dir?: 'ltr' | 'rtl' | 'auto'
  // generated content (set by style scopes, e.g. the web layer; not a prop)
  /** Replaces the element's children (form controls, images). */
  content?: Segment[] | string
  /** Inserted before / after the children (CSS ::before / ::after). */
  before?: Segment[] | string
  after?: Segment[] | string
  /** Painted in the left padding, on the first line (list bullets). */
  marker?: Segment[] | string
  /** Web flow: inline-level element (flows inside text runs). */
  inline?: boolean
  /** Web flow: an inline-level box (`inline-block`, `inline-flex`, ...), not plain `inline`. */
  inlineBlock?: boolean
  /** Web flow: CSS float. Shares a line with inline content, pushed to that side. */
  float?: 'left' | 'right'
  /** CSS white-space: `normal`/`nowrap` collapse spaces, `pre` keeps them. */
  whiteSpace?: 'normal' | 'nowrap' | 'pre'
}

export const STYLE_KEYS = new Set<string>([
  'display', 'position', 'top', 'left', 'right', 'bottom', 'flexDirection', 'flexWrap', 'flexGrow',
  'flexShrink', 'flexBasis', 'alignItems', 'alignSelf', 'alignContent', 'justifyContent', 'width',
  'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight', 'padding', 'paddingX', 'paddingY',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'margin', 'marginX', 'marginY',
  'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'gap', 'rowGap', 'columnGap', 'overflow',
  'zIndex', 'border', 'borderColor', 'borderTop', 'borderRight', 'borderBottom', 'borderLeft', 'color',
  'bg', 'bold', 'dim', 'italic', 'underline', 'inverse', 'strikethrough', 'wrap', 'textAlign', 'dir',
])

const ALIASES: Record<string, string> = {
  backgroundColor: 'bg',
  background: 'bg',
  backgroundColour: 'bg',
  colour: 'color',
  fg: 'color',
  borderStyle: 'border',
  textWrap: 'wrap',
  align: 'textAlign',
  direction: 'flexDirection',
  grow: 'flexGrow',
  shrink: 'flexShrink',
  basis: 'flexBasis',
  strike: 'strikethrough',
}

export function camelize(s: string) {
  return s.replace(/-(\w)/g, (_, c: string) => c.toUpperCase())
}

/** Normalizes a key (kebab-case, aliases) to a Style key, or returns null. */
export function normalizeStyleKey(key: string): keyof Style | null {
  let k = key.includes('-') ? camelize(key) : key
  if (k in ALIASES) k = ALIASES[k]
  return STYLE_KEYS.has(k) ? (k as keyof Style) : null
}

const NUMERIC = new Set([
  'flexGrow', 'flexShrink', 'padding', 'paddingX', 'paddingY', 'paddingTop', 'paddingRight', 'paddingBottom',
  'paddingLeft', 'margin', 'marginX', 'marginY', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'gap', 'rowGap', 'columnGap', 'zIndex',
])
const DIMENSION = new Set([
  'top', 'left', 'right', 'bottom', 'flexBasis', 'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight',
])
const BOOLEAN = new Set([
  'bold', 'dim', 'italic', 'underline', 'inverse', 'strikethrough', 'borderTop', 'borderRight', 'borderBottom',
  'borderLeft',
])

/** Coerces template attribute values ("1", "", "50%") into typed style values. */
export function coerceStyleValue(key: keyof Style, value: unknown): unknown {
  if (value === undefined || value === null) return undefined
  if (BOOLEAN.has(key)) return value === '' || value === true || value === 'true'
  if (NUMERIC.has(key)) {
    const n = typeof value === 'number' ? value : parseFloat(String(value))
    return Number.isFinite(n) ? n : undefined
  }
  if (DIMENSION.has(key)) {
    if (typeof value === 'number') return value
    const s = String(value).trim()
    if (s === 'auto' || /%$/.test(s)) return s
    if (s === 'full') return '100%'
    const n = parseFloat(s)
    return Number.isFinite(n) ? n : undefined
  }
  if (key === 'border') {
    if (value === '' || value === true || value === 'true') return 'single'
    if (value === false || value === 'false') return 'none'
    return value
  }
  return value
}

/** Parses a CSS-like string: "padding: 1; color: red". */
export function parseStyleString(s: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of s.split(';')) {
    const i = part.indexOf(':')
    if (i < 0) continue
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim()
  }
  return out
}

export function assignStyle(target: Style, source: Record<string, unknown> | null | undefined) {
  if (!source) return
  for (const raw in source) {
    const key = normalizeStyleKey(raw)
    if (!key) continue
    const v = coerceStyleValue(key, source[raw])
    if (v !== undefined) (target as Record<string, unknown>)[key] = v
  }
}

/** Visual properties that are inherited by descendants (like CSS `color`). */
export interface Ink {
  color?: string
  bg?: string
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
  inverse?: boolean
  strikethrough?: boolean
}

export const INK_KEYS = ['color', 'bg', 'bold', 'dim', 'italic', 'underline', 'inverse', 'strikethrough'] as const

export function mergeInk(base: Ink, style: Style | Ink): Ink {
  let out: Ink | null = null
  for (const k of INK_KEYS) {
    const v = (style as Ink)[k]
    if (v !== undefined) {
      if (!out) out = { ...base }
      ;(out as Record<string, unknown>)[k] = v
    }
  }
  return out || base
}
