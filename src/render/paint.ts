import { Display, Edge } from 'yoga-layout'
import { borderEdges, hasBorder, TElement, type TNode, type TTextNode } from '../dom/nodes.js'
import { colorSgr, parseColor, type ColorDepth } from '../style/colors.js'
import { mergeInk, type Ink, type Style } from '../style/style.js'
import type { Theme } from '../style/theme.js'
import { CellBuffer, Flag, intersect, type Rect } from './buffer.js'
import { graphemeWidth as graphemeWidthOf, lineWidth, toGlyphs, wrapGlyphs, type Glyph, type WrapMode } from './text.js'

export interface HitRegion {
  el: TElement
  rect: Rect
}

export interface PaintOptions {
  theme: Theme
  depth: ColorDepth
  /** Debug: outline every box. */
  wireframe?: boolean
}

/**
 * An out-of-band pixel image (kitty / sixel / iTerm2 escape data) placed at a
 * cell position. Targets that can't show it simply ignore it (the cells
 * underneath are painted normally as a fallback).
 */
export interface Graphic {
  /** Stable identity (e.g. element id); used to detect moves/removals. */
  key: string
  x: number
  y: number
  width: number
  height: number
  /** Bumped whenever `data` changes. */
  version: number
  /** Escape sequence that draws the image at the cursor position. */
  data: string
  /** Optional escape sequence that removes the image (kitty delete). */
  clear?: string
}

/** Color for `CellPainter.set`: 0xRRGGBB, a color/theme-token string, or null (keep / default). */
export type CellColor = number | string | null

export interface CellStyle {
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
  inverse?: boolean
  strikethrough?: boolean
}

/**
 * Drawing surface handed to an element's `paintCells(painter, rect)` prop.
 * Coordinates are relative to the element's content box; writes outside
 * it (or outside the visible clip) are dropped.
 */
export interface CellPainter {
  readonly width: number
  readonly height: number
  /** Absolute screen position of the content box. */
  readonly x: number
  readonly y: number
  set(x: number, y: number, ch: string, fg?: CellColor, bg?: CellColor, style?: CellStyle): void
  /** Write a string starting at (x, y) (no wrapping). */
  text(x: number, y: number, s: string, fg?: CellColor, bg?: CellColor, style?: CellStyle): void
  /** Add an out-of-band pixel graphic covering the content box (or a sub rect). */
  graphic(g: Omit<Graphic, 'x' | 'y' | 'width' | 'height'> & Partial<Pick<Graphic, 'x' | 'y' | 'width' | 'height'>>): void
  /** Color depth of the output ('truecolor' | 256 | 16). */
  readonly depth: ColorDepth
}

const BORDERS: Record<string, [string, string, string, string, string, string]> = {
  //        tl   tr   bl   br   h    v
  single: ['┌', '┐', '└', '┘', '─', '│'],
  round: ['╭', '╮', '╰', '╯', '─', '│'],
  double: ['╔', '╗', '╚', '╝', '═', '║'],
  bold: ['┏', '┓', '┗', '┛', '━', '┃'],
  ascii: ['+', '+', '+', '+', '-', '|'],
  dashed: ['┌', '┐', '└', '┘', '┄', '┆'],
}

interface ResolvedInk {
  fg: string
  bg: string | null
  flags: number
}

export class Painter {
  private inkCache = new Map<string, ResolvedInk>()
  private rgbCache = new Map<number, string>()
  hits: HitRegion[] = []
  graphics: Graphic[] = []

  constructor(private opts: PaintOptions) {}

  setOptions(opts: PaintOptions) {
    this.opts = opts
    this.inkCache.clear()
    this.rgbCache.clear()
  }

  /** Resolves a color value or theme token to a concrete color string (or null for "default"). */
  resolveColorName(name: string | undefined, depth = 0): string | null {
    if (!name) return null
    if (name === 'default' || name === 'none' || name === 'transparent' || name === 'inherit') return null
    const t = this.opts.theme[name]
    if (t !== undefined && name !== 'name' && depth < 4) return this.resolveColorName(t, depth + 1)
    return name
  }

  private sgrFor(name: string | undefined, layer: 'fg' | 'bg'): string {
    const n = this.resolveColorName(name)
    if (!n) return ''
    const c = parseColor(n)
    return c ? colorSgr(c, layer, this.opts.depth) : ''
  }

  resolveInk(ink: Ink): ResolvedInk {
    const key = `${ink.color}|${ink.bg}|${ink.bold ? 1 : 0}${ink.dim ? 1 : 0}${ink.italic ? 1 : 0}${ink.underline ? 1 : 0}${ink.inverse ? 1 : 0}${ink.strikethrough ? 1 : 0}`
    let r = this.inkCache.get(key)
    if (!r) {
      let flags = 0
      if (ink.bold) flags |= Flag.Bold
      if (ink.dim) flags |= Flag.Dim
      if (ink.italic) flags |= Flag.Italic
      if (ink.underline) flags |= Flag.Underline
      if (ink.inverse) flags |= Flag.Inverse
      if (ink.strikethrough) flags |= Flag.Strike
      const bg = ink.bg === undefined ? null : this.sgrFor(ink.bg, 'bg')
      r = { fg: this.sgrFor(ink.color ?? 'text', 'fg'), bg, flags }
      this.inkCache.set(key, r)
    }
    return r
  }

  paint(root: TElement, width: number, height: number): CellBuffer {
    const buf = new CellBuffer(width, height)
    this.hits = []
    this.graphics = []
    root.calculateLayout(width, height)
    const theme = this.opts.theme
    const bg = this.resolveColorName(theme.background)
    if (bg) buf.fill({ x: 0, y: 0, width, height }, this.sgrFor(bg, 'bg'))
    this.paintElement(root, buf, 0, 0, { x: 0, y: 0, width, height }, {})
    return buf
  }

  private paintElement(el: TElement, buf: CellBuffer, ox: number, oy: number, clip: Rect, inherited: Ink) {
    const yoga = el.yoga
    if (!yoga) return
    const s = el.computedStyle
    if (s.display === 'none') return
    const x = Math.round(ox + yoga.getComputedLeft())
    const y = Math.round(oy + yoga.getComputedTop())
    const w = Math.round(yoga.getComputedWidth())
    const h = Math.round(yoga.getComputedHeight())
    const ink = mergeInk(inherited, s)

    const bt = yoga.getComputedBorder(Edge.Top)
    const br = yoga.getComputedBorder(Edge.Right)
    const bb = yoga.getComputedBorder(Edge.Bottom)
    const bl = yoga.getComputedBorder(Edge.Left)
    const pt = yoga.getComputedPadding(Edge.Top)
    const pr = yoga.getComputedPadding(Edge.Right)
    const pb = yoga.getComputedPadding(Edge.Bottom)
    const pl = yoga.getComputedPadding(Edge.Left)
    const inner: Rect = {
      x: x + bl + pl,
      y: y + bt + pt,
      width: Math.max(0, w - bl - br - pl - pr),
      height: Math.max(0, h - bt - bb - pt - pb),
    }

    let scrollWidth = 0
    let scrollHeight = 0
    if (el.kind !== 'text') {
      for (const c of el.children) {
        const cy = c.yoga
        if (!cy || (c.nodeType === 'element' && c.computedStyle.position === 'absolute')) continue
        scrollWidth = Math.max(scrollWidth, cy.getComputedLeft() + cy.getComputedWidth() - bl - pl)
        scrollHeight = Math.max(scrollHeight, cy.getComputedTop() + cy.getComputedHeight() - bt - pt)
      }
    }
    el.updateLayout({
      x,
      y,
      width: w,
      height: h,
      innerWidth: inner.width,
      innerHeight: inner.height,
      scrollWidth: Math.round(scrollWidth),
      scrollHeight: Math.round(scrollHeight),
    })

    const box: Rect = { x, y, width: w, height: h }
    const visible = intersect(clip, box)
    this.hits.push({ el, rect: visible })

    if (el.props.backdrop) buf.dim(clip)
    if (s.bg !== undefined && visible.width > 0) {
      const bg = this.sgrFor(s.bg, 'bg')
      if (bg || this.resolveColorName(s.bg) === null) buf.fill(visible, bg)
    }
    if (hasBorder(s)) this.paintBorder(el, s, buf, box, clip, ink)
    else if (this.opts.wireframe && el.kind !== 'text' && el.kind !== 'root') this.paintWireframe(buf, box, clip)
    if (typeof el.props.paintCells === 'function') this.runCellPainter(el, buf, inner, intersect(clip, inner), ink)

    if (el.kind === 'text') {
      this.paintGlyphs(el.getGlyphs(), buf, inner, intersect(clip, box), ink, s.wrap ?? 'wrap', s.textAlign)
      return
    }

    const childClip = s.overflow === 'hidden' ? intersect(clip, { x: x + bl, y: y + bt, width: w - bl - br, height: h - bt - bb }) : clip
    const sx = Number(el.props.scrollLeft ?? 0) || 0
    const sy = Number(el.props.scrollTop ?? 0) || 0

    let absolute: TElement[] | null = null
    for (const c of el.children) {
      if (c.nodeType === 'element') {
        if (c.computedStyle.position === 'absolute') {
          ;(absolute ??= []).push(c)
          continue
        }
        // text never bleeds into the parent's padding/border (guards against rounding)
        this.paintElement(c, buf, x - sx, y - sy, c.kind === 'text' ? intersect(childClip, inner) : childClip, ink)
      } else if (c.nodeType === 'text' && c.yoga && c.yoga.getDisplay() !== Display.None) {
        this.paintTextNode(c, buf, x - sx, y - sy, intersect(childClip, inner), ink)
      }
    }
    if (absolute) {
      absolute.sort((a, b) => (a.computedStyle.zIndex ?? 0) - (b.computedStyle.zIndex ?? 0))
      for (const c of absolute) this.paintElement(c, buf, x, y, clip, ink)
    }
  }

  private paintTextNode(t: TTextNode, buf: CellBuffer, ox: number, oy: number, clip: Rect, ink: Ink) {
    const yoga = t.yoga!
    const rect: Rect = {
      x: Math.round(ox + yoga.getComputedLeft()),
      y: Math.round(oy + yoga.getComputedTop()),
      width: Math.round(yoga.getComputedWidth()),
      height: Math.round(yoga.getComputedHeight()),
    }
    this.paintGlyphs(t.getGlyphs(), buf, rect, intersect(clip, rect), ink, 'wrap', undefined)
  }

  private paintGlyphs(
    glyphs: Glyph[],
    buf: CellBuffer,
    rect: Rect,
    clip: Rect,
    base: Ink,
    wrap: WrapMode,
    align: Style['textAlign'],
  ) {
    if (rect.width <= 0 || rect.height <= 0 || glyphs.length === 0) return
    const lines = wrapGlyphs(glyphs, rect.width, wrap)
    let lastInk: Ink | null = null
    let resolved: ResolvedInk | null = null
    for (let row = 0; row < lines.length && row < rect.height; row++) {
      const line = lines[row]
      let cx = rect.x
      if (align === 'center' || align === 'right') {
        const free = rect.width - lineWidth(line)
        if (free > 0) cx += align === 'center' ? Math.floor(free / 2) : free
      }
      for (const g of line) {
        if (g.ink !== lastInk) {
          lastInk = g.ink
          resolved = this.resolveInk(g.ink === EMPTY || isEmpty(g.ink) ? base : mergeInk(base, g.ink))
        }
        const r = resolved!
        buf.set(cx, rect.y + row, g.ch, g.w, r.fg, r.bg, r.flags, clip)
        cx += g.w
      }
    }
  }

  private paintBorder(el: TElement, s: Style, buf: CellBuffer, box: Rect, clip: Rect, ink: Ink) {
    const chars = BORDERS[String(s.border)] ?? BORDERS.single
    const [tl, tr, bl, br, hz, vt] = chars
    const edges = borderEdges(s)
    const r = this.resolveInk({ ...ink, color: s.borderColor ?? 'border', bold: false, underline: false, inverse: false })
    const { x, y, width: w, height: h } = box
    if (w <= 0 || h <= 0) return
    const put = (cx: number, cy: number, ch: string) => buf.set(cx, cy, ch, 1, r.fg, r.bg, r.flags, clip)
    if (edges.top) {
      for (let i = 1; i < w - 1; i++) put(x + i, y, hz)
      put(x, y, edges.left ? tl : hz)
      if (w > 1) put(x + w - 1, y, edges.right ? tr : hz)
    }
    if (edges.bottom && h > 1) {
      for (let i = 1; i < w - 1; i++) put(x + i, y + h - 1, hz)
      put(x, y + h - 1, edges.left ? bl : hz)
      if (w > 1) put(x + w - 1, y + h - 1, edges.right ? br : hz)
    }
    for (let j = edges.top; j < h - edges.bottom; j++) {
      if (edges.left) put(x, y + j, vt)
      if (edges.right && w > 1) put(x + w - 1, y + j, vt)
    }
    const title = el.props.title
    if (title && edges.top && w > 4) {
      const titleInk: Ink = { ...ink, color: el.props.titleColor ?? s.borderColor ?? ink.color, bold: true }
      const glyphs = toGlyphs(` ${title} `, titleInk)
      const [line] = wrapGlyphs(glyphs, w - 4, 'truncate')
      const align = el.props.titleAlign
      const lw = lineWidth(line)
      let cx = align === 'center' ? x + Math.floor((w - lw) / 2) : align === 'right' ? x + w - 2 - lw : x + 2
      const tr2 = this.resolveInk(titleInk)
      for (const g of line) {
        buf.set(cx, y, g.ch, g.w, tr2.fg, tr2.bg, tr2.flags, clip)
        cx += g.w
      }
    }
  }

  private colorToSgr(c: CellColor | undefined, layer: 'fg' | 'bg'): string | null {
    if (c === null || c === undefined) return null
    if (typeof c === 'number') {
      const key = layer === 'fg' ? c : c + 0x1000000
      let v = this.rgbCache.get(key)
      if (v === undefined) {
        v = colorSgr({ kind: 'rgb', r: (c >> 16) & 255, g: (c >> 8) & 255, b: c & 255 }, layer, this.opts.depth)
        this.rgbCache.set(key, v)
      }
      return v
    }
    return this.sgrFor(c, layer)
  }

  private runCellPainter(el: TElement, buf: CellBuffer, inner: Rect, clip: Rect, ink: Ink) {
    const base = this.resolveInk(ink)
    const flagsOf = (st?: CellStyle) => {
      if (!st) return base.flags
      let f = 0
      if (st.bold) f |= Flag.Bold
      if (st.dim) f |= Flag.Dim
      if (st.italic) f |= Flag.Italic
      if (st.underline) f |= Flag.Underline
      if (st.inverse) f |= Flag.Inverse
      if (st.strikethrough) f |= Flag.Strike
      return f
    }
    const graphics = this.graphics
    const api: CellPainter = {
      width: inner.width,
      height: inner.height,
      x: inner.x,
      y: inner.y,
      depth: this.opts.depth,
      set: (x, y, ch, fg, bg, st) => {
        if (x < 0 || y < 0 || x >= inner.width || y >= inner.height) return
        const w = ch.length === 1 && ch.charCodeAt(0) < 0x7f ? 1 : graphemeWidthOf(ch)
        buf.set(inner.x + x, inner.y + y, ch, w, this.colorToSgr(fg, 'fg') ?? base.fg, this.colorToSgr(bg, 'bg') ?? base.bg, flagsOf(st), clip)
      },
      text: (x, y, str, fg, bg, st) => {
        let cx = x
        for (const g of toGlyphs(str, {})) {
          api.set(cx, y, g.ch, fg, bg, st)
          cx += g.w
        }
      },
      graphic: (g) => {
        graphics.push({
          x: inner.x + (g.x ?? 0),
          y: inner.y + (g.y ?? 0),
          width: g.width ?? inner.width,
          height: g.height ?? inner.height,
          key: g.key,
          version: g.version,
          data: g.data,
          clear: g.clear,
        })
      },
    }
    el.props.paintCells(api, { ...inner })
  }

  private paintWireframe(buf: CellBuffer, box: Rect, clip: Rect) {
    const r = this.resolveInk({ color: 'accent', dim: true })
    const { x, y, width: w, height: h } = box
    if (w <= 0 || h <= 0) return
    const put = (cx: number, cy: number, ch: string) => {
      const i = cy * buf.width + cx
      if (cy >= 0 && cy < buf.height && cx >= 0 && cx < buf.width && buf.chars[i] === ' ') buf.set(cx, cy, ch, 1, r.fg, null, r.flags, clip)
    }
    for (let i = 0; i < w; i++) {
      put(x + i, y, '┄')
      if (h > 1) put(x + i, y + h - 1, '┄')
    }
    for (let j = 0; j < h; j++) {
      put(x, y + j, '┆')
      if (w > 1) put(x + w - 1, y + j, '┆')
    }
  }

  /** Topmost element at a screen position. */
  hitTest(x: number, y: number): TElement | null {
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const { el, rect } = this.hits[i]
      if (x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height) return el
    }
    return null
  }
}

const EMPTY: Ink = {}
function isEmpty(ink: Ink) {
  for (const _ in ink) return false
  return true
}

export type { TNode }
