/** `CanvasRenderingContext2D`: a spec-faithful software implementation of the Canvas 2D API. */
import type { Canvas } from './canvas.js'
import { parseColor, serializeColor, type RGBA } from './color.js'
import { compositeRow, COMPOSITE_OPS, UNBOUNDED, type CompositeOperation } from './composite.js'
import { BASELINE, DEFAULT_FONT, layoutText, parseFont, strokeWidthFor, UNITS_PER_EM, type FontInfo } from './font.js'
import { ImageData, type ImageDataSettings, type PixelSource } from './image-data.js'
import { DOMMatrix, fromInit, invert, isFiniteMat, matScale, mul, type DOMMatrix2DInit, type Mat } from './matrix.js'
import {
  CanvasGradient, CanvasPattern, gradientShader, imageShader, parseRepetition, patternShader, solidShader, type Shader,
} from './paint-style.js'
import { flatten, Path2D, PathBuilder, transformPts, type Polyline, type SubPath } from './path.js'
import { rasterize, rasterizeMask, windingAt, onEdge, type FillRule } from './raster.js'
import { strokePolylines, type LineCap, type LineJoin, type StrokeInput, type StrokeStyle } from './stroke.js'

export type { FillRule, CompositeOperation, LineCap, LineJoin }
export type CanvasTextAlign = 'start' | 'end' | 'left' | 'right' | 'center'
export type CanvasTextBaseline = 'top' | 'hanging' | 'middle' | 'alphabetic' | 'ideographic' | 'bottom'
export type CanvasDirection = 'ltr' | 'rtl' | 'inherit'
export type ImageSmoothingQuality = 'low' | 'medium' | 'high'
export type Paint = string | CanvasGradient | CanvasPattern

export interface CanvasRenderingContext2DSettings {
  alpha?: boolean
  colorSpace?: 'srgb' | 'display-p3'
  desynchronized?: boolean
  willReadFrequently?: boolean
}

/** Anything drawImage / createPattern accept: Canvas, Image, ImageData, ImageBitmap-like `{ width, height, data }`. */
export type CanvasImageSource = PixelSource | { width: number; height: number; _data?: unknown; data?: unknown; complete?: boolean }

export interface TextMetrics {
  width: number
  actualBoundingBoxLeft: number
  actualBoundingBoxRight: number
  actualBoundingBoxAscent: number
  actualBoundingBoxDescent: number
  fontBoundingBoxAscent: number
  fontBoundingBoxDescent: number
  emHeightAscent: number
  emHeightDescent: number
  hangingBaseline: number
  alphabeticBaseline: number
  ideographicBaseline: number
}

interface State {
  m: Mat
  fill: Paint
  fillColor: RGBA | null
  stroke: Paint
  strokeColor: RGBA | null
  globalAlpha: number
  op: CompositeOperation
  lineWidth: number
  lineCap: LineCap
  lineJoin: LineJoin
  miterLimit: number
  dash: number[]
  dashOffset: number
  shadowColor: RGBA
  shadowBlur: number
  shadowOffsetX: number
  shadowOffsetY: number
  font: FontInfo
  textAlign: CanvasTextAlign
  textBaseline: CanvasTextBaseline
  direction: CanvasDirection
  letterSpacing: string
  letterSpacingPx: number
  wordSpacing: string
  wordSpacingPx: number
  fontKerning: string
  fontStretch: string
  fontVariantCaps: string
  textRendering: string
  smoothing: boolean
  smoothingQuality: ImageSmoothingQuality
  filter: string
  clip: Float32Array | null
}

const defaultFont = parseFont(DEFAULT_FONT)!

function defaultState(): State {
  return {
    m: [1, 0, 0, 1, 0, 0],
    fill: '#000000', fillColor: [0, 0, 0, 1],
    stroke: '#000000', strokeColor: [0, 0, 0, 1],
    globalAlpha: 1, op: 'source-over',
    lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', miterLimit: 10, dash: [], dashOffset: 0,
    shadowColor: [0, 0, 0, 0], shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0,
    font: defaultFont, textAlign: 'start', textBaseline: 'alphabetic', direction: 'inherit',
    letterSpacing: '0px', letterSpacingPx: 0, wordSpacing: '0px', wordSpacingPx: 0,
    fontKerning: 'auto', fontStretch: 'normal', fontVariantCaps: 'normal', textRendering: 'auto',
    smoothing: true, smoothingQuality: 'low', filter: 'none',
    clip: null,
  }
}

const FLATTEN_TOL = 0.15

function domError(name: string, message: string) {
  const e = new Error(message)
  e.name = name
  return e
}

let rowBuf = new Float32Array(0)
function srcRow(n: number) {
  if (rowBuf.length < n * 4) rowBuf = new Float32Array(n * 4)
  return rowBuf
}

export class CanvasRenderingContext2D extends PathBuilder {
  readonly canvas: Canvas
  private s: State = defaultState()
  private stack: State[] = []
  private settings: Required<CanvasRenderingContext2DSettings>

  constructor(canvas: Canvas, settings: CanvasRenderingContext2DSettings = {}) {
    super()
    this.canvas = canvas
    this.settings = { alpha: settings.alpha ?? true, colorSpace: settings.colorSpace ?? 'srgb', desynchronized: !!settings.desynchronized, willReadFrequently: !!settings.willReadFrequently }
  }

  getContextAttributes() {
    return { ...this.settings }
  }
  isContextLost() {
    return false
  }

  /** @internal Canvas resize: reset all state (spec). */
  _resetState() {
    this.s = defaultState()
    this.stack = []
    this._clear()
    this._matrix = null
  }
  /** @internal Canvas resized without clearing: drop clip masks that no longer fit. */
  _resizeClip() {
    this.s.clip = null
    for (const st of this.stack) st.clip = null
  }

  /** Resets the context to its default state and clears the canvas. */
  reset() {
    this._resetState()
    this.canvas._data.fill(0)
    this.canvas._touch()
  }

  // ---------------------------------------------------------------- state

  save() {
    this.stack.push({ ...this.s, m: [...this.s.m] as Mat, dash: [...this.s.dash] })
  }
  restore() {
    const st = this.stack.pop()
    if (!st) return
    this.s = st
    this.syncMatrix()
  }

  get fillStyle(): Paint { return this.s.fill }
  set fillStyle(v: Paint) {
    const r = this.parsePaint(v)
    if (r) [this.s.fill, this.s.fillColor] = r
  }
  get strokeStyle(): Paint { return this.s.stroke }
  set strokeStyle(v: Paint) {
    const r = this.parsePaint(v)
    if (r) [this.s.stroke, this.s.strokeColor] = r
  }
  private parsePaint(v: Paint): [Paint, RGBA | null] | null {
    if (v instanceof CanvasGradient || v instanceof CanvasPattern) return [v, null]
    if (typeof v !== 'string' && !(v && typeof v === 'object' && 'toString' in v)) return null
    const c = parseColor(String(v))
    return c ? [serializeColor(c), c] : null
  }

  get globalAlpha() { return this.s.globalAlpha }
  set globalAlpha(v: number) { v = +v; if (v >= 0 && v <= 1) this.s.globalAlpha = v }
  get globalCompositeOperation(): CompositeOperation { return this.s.op }
  set globalCompositeOperation(v: CompositeOperation) { if (COMPOSITE_OPS.has(v)) this.s.op = v }

  get lineWidth() { return this.s.lineWidth }
  set lineWidth(v: number) { v = +v; if (v > 0 && Number.isFinite(v)) this.s.lineWidth = v }
  get lineCap(): LineCap { return this.s.lineCap }
  set lineCap(v: LineCap) { if (v === 'butt' || v === 'round' || v === 'square') this.s.lineCap = v }
  get lineJoin(): LineJoin { return this.s.lineJoin }
  set lineJoin(v: LineJoin) { if (v === 'miter' || v === 'round' || v === 'bevel') this.s.lineJoin = v }
  get miterLimit() { return this.s.miterLimit }
  set miterLimit(v: number) { v = +v; if (v > 0 && Number.isFinite(v)) this.s.miterLimit = v }
  get lineDashOffset() { return this.s.dashOffset }
  set lineDashOffset(v: number) { v = +v; if (Number.isFinite(v)) this.s.dashOffset = v }
  setLineDash(segments: number[]) {
    const arr = Array.from(segments ?? [], Number)
    if (arr.some((n) => !Number.isFinite(n) || n < 0)) return
    this.s.dash = arr.length % 2 ? [...arr, ...arr] : arr
  }
  getLineDash(): number[] { return [...this.s.dash] }

  get shadowColor() { return serializeColor(this.s.shadowColor) }
  set shadowColor(v: string) { const c = parseColor(String(v)); if (c) this.s.shadowColor = c }
  get shadowBlur() { return this.s.shadowBlur }
  set shadowBlur(v: number) { v = +v; if (v >= 0 && Number.isFinite(v)) this.s.shadowBlur = v }
  get shadowOffsetX() { return this.s.shadowOffsetX }
  set shadowOffsetX(v: number) { v = +v; if (Number.isFinite(v)) this.s.shadowOffsetX = v }
  get shadowOffsetY() { return this.s.shadowOffsetY }
  set shadowOffsetY(v: number) { v = +v; if (Number.isFinite(v)) this.s.shadowOffsetY = v }

  get font() { return this.s.font.css }
  set font(v: string) { const f = parseFont(String(v)); if (f) this.s.font = f }
  get textAlign(): CanvasTextAlign { return this.s.textAlign }
  set textAlign(v: CanvasTextAlign) { if (['start', 'end', 'left', 'right', 'center'].includes(v)) this.s.textAlign = v }
  get textBaseline(): CanvasTextBaseline { return this.s.textBaseline }
  set textBaseline(v: CanvasTextBaseline) { if (['top', 'hanging', 'middle', 'alphabetic', 'ideographic', 'bottom'].includes(v)) this.s.textBaseline = v }
  get direction(): CanvasDirection { return this.s.direction }
  set direction(v: CanvasDirection) { if (v === 'ltr' || v === 'rtl' || v === 'inherit') this.s.direction = v }
  get letterSpacing() { return this.s.letterSpacing }
  set letterSpacing(v: string) {
    const px = parseLength(String(v), this.s.font.size)
    if (px !== null) { this.s.letterSpacing = String(v); this.s.letterSpacingPx = px }
  }
  get wordSpacing() { return this.s.wordSpacing }
  set wordSpacing(v: string) {
    const px = parseLength(String(v), this.s.font.size)
    if (px !== null) { this.s.wordSpacing = String(v); this.s.wordSpacingPx = px }
  }
  get fontKerning() { return this.s.fontKerning }
  set fontKerning(v: string) { this.s.fontKerning = v }
  get fontStretch() { return this.s.fontStretch }
  set fontStretch(v: string) { this.s.fontStretch = v }
  get fontVariantCaps() { return this.s.fontVariantCaps }
  set fontVariantCaps(v: string) {
    this.s.fontVariantCaps = v
    this.s.font = { ...this.s.font, variant: v === 'small-caps' || v === 'all-small-caps' ? 'small-caps' : 'normal' }
  }
  get textRendering() { return this.s.textRendering }
  set textRendering(v: string) { this.s.textRendering = v }
  get imageSmoothingEnabled() { return this.s.smoothing }
  set imageSmoothingEnabled(v: boolean) { this.s.smoothing = !!v }
  get imageSmoothingQuality(): ImageSmoothingQuality { return this.s.smoothingQuality }
  set imageSmoothingQuality(v: ImageSmoothingQuality) { if (v === 'low' || v === 'medium' || v === 'high') this.s.smoothingQuality = v }
  /** Only `'none'` is rendered; other filter values are stored but ignored. */
  get filter() { return this.s.filter }
  set filter(v: string) { this.s.filter = String(v) }

  // ---------------------------------------------------------------- transforms

  private syncMatrix() {
    const m = this.s.m
    this._matrix = m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0 ? null : m
  }
  private applyMatrix(q: Mat) {
    if (!isFiniteMat(q)) return
    this.s.m = mul(this.s.m, q)
    this.syncMatrix()
  }
  translate(x: number, y: number) { this.applyMatrix([1, 0, 0, 1, x, y]) }
  scale(x: number, y: number) { this.applyMatrix([x, 0, 0, y, 0, 0]) }
  rotate(angle: number) {
    if (!Number.isFinite(angle)) return
    const c = Math.cos(angle), s = Math.sin(angle)
    this.applyMatrix([c, s, -s, c, 0, 0])
  }
  transform(a: number, b: number, c: number, d: number, e: number, f: number) { this.applyMatrix([a, b, c, d, e, f]) }
  setTransform(a?: number | DOMMatrix2DInit, b?: number, c?: number, d?: number, e?: number, f?: number) {
    let m: Mat
    if (typeof a === 'number') m = [a, b!, c!, d!, e!, f!]
    else m = fromInit(a ?? {})
    if (!isFiniteMat(m)) return
    this.s.m = m
    this.syncMatrix()
  }
  getTransform(): DOMMatrix { return new DOMMatrix([...this.s.m]) }
  resetTransform() { this.setTransform(1, 0, 0, 1, 0, 0) }

  // ---------------------------------------------------------------- paths

  beginPath() { this._clear() }

  private devicePolys(path: Path2D | undefined, tol = FLATTEN_TOL): Polyline[] {
    if (path) return flatten(path._subpaths, tol, this._matrix)
    return flatten(this._subpaths, tol)
  }

  fill(fillRule?: FillRule): void
  fill(path: Path2D, fillRule?: FillRule): void
  fill(a?: Path2D | FillRule, b?: FillRule) {
    const [path, rule] = this.pathArgs(a, b)
    this.drawPolys(this.devicePolys(path), rule, this.shaderFor(this.s.fill, this.s.fillColor))
  }

  stroke(path?: Path2D) {
    if (path !== undefined && !(path instanceof PathBuilder)) throw new TypeError("Failed to execute 'stroke': parameter 1 is not of type 'Path2D'.")
    const polys = this.strokeOutline(path)
    if (polys) this.drawPolys(polys, 'nonzero', this.shaderFor(this.s.stroke, this.s.strokeColor))
  }

  clip(fillRule?: FillRule): void
  clip(path: Path2D, fillRule?: FillRule): void
  clip(a?: Path2D | FillRule, b?: FillRule) {
    const [path, rule] = this.pathArgs(a, b)
    const { _w: w, _h: h } = this.canvas
    const mask = rasterizeMask(this.devicePolys(path), w, h, rule)
    const old = this.s.clip
    if (old) for (let i = 0; i < mask.length; i++) mask[i] *= old[i]
    this.s.clip = mask
  }

  isPointInPath(x: number, y: number, fillRule?: FillRule): boolean
  isPointInPath(path: Path2D, x: number, y: number, fillRule?: FillRule): boolean
  isPointInPath(a: number | Path2D, b: number, c?: number | FillRule, d?: FillRule): boolean {
    let path: Path2D | undefined, x: number, y: number, rule: FillRule
    if (a instanceof PathBuilder) {
      path = a as Path2D; x = b; y = c as number; rule = d ?? 'nonzero'
    } else {
      x = a as number; y = b; rule = (c as FillRule) ?? 'nonzero'
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false
    const polys = this.devicePolys(path, 0.05).filter((p) => p.pts.length >= 6)
    if (onEdge(polys, x, y, 1e-6)) return true
    const { wind } = windingAt(polys, x, y)
    return rule === 'evenodd' ? (wind & 1) !== 0 : wind !== 0
  }

  isPointInStroke(x: number, y: number): boolean
  isPointInStroke(path: Path2D, x: number, y: number): boolean
  isPointInStroke(a: number | Path2D, b: number, c?: number): boolean {
    let path: Path2D | undefined, x: number, y: number
    if (a instanceof PathBuilder) {
      path = a as Path2D; x = b; y = c!
    } else {
      x = a as number; y = b
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false
    const polys = this.strokeOutline(path, 0.05)
    if (!polys) return false
    if (onEdge(polys, x, y, 1e-6)) return true
    return windingAt(polys, x, y).wind !== 0
  }

  private pathArgs(a?: Path2D | FillRule, b?: FillRule): [Path2D | undefined, FillRule] {
    if (a instanceof PathBuilder) return [a as Path2D, b === 'evenodd' ? 'evenodd' : 'nonzero']
    if (a !== undefined && a !== 'nonzero' && a !== 'evenodd') throw new TypeError(`The provided value '${a}' is not a valid enum value of type CanvasFillRule.`)
    return [undefined, a === 'evenodd' ? 'evenodd' : 'nonzero']
  }

  /** Stroke outline polygons in device space (null when nothing would be drawn). */
  private strokeOutline(path?: Path2D, devTol = FLATTEN_TOL): Polyline[] | null {
    const m = this.s.m
    let subs: SubPath[]
    if (path) subs = path._subpaths
    else {
      // the default path is stored in device space: bring it back to user space
      const inv = invert(m)
      if (!inv) return null
      subs = this._subpaths.map((sp) => ({ pts: transformPts(sp.pts, inv), segs: sp.segs, closed: sp.closed }))
    }
    const tol = devTol / matScale(m)
    const lines: StrokeInput[] = flatten(subs, tol).map((p, i) => ({ ...p, hasSegments: subs[i].segs.length > 0 }))
    const st: StrokeStyle = {
      lineWidth: this.s.lineWidth, lineCap: this.s.lineCap, lineJoin: this.s.lineJoin, miterLimit: this.s.miterLimit,
      dash: this.s.dash, dashOffset: this.s.dashOffset,
    }
    const outline = strokePolylines(lines, st, tol)
    return outline.map((p) => ({ pts: transformPts(p.pts, m), closed: true }))
  }

  // ---------------------------------------------------------------- rectangles

  private rectPoly(x: number, y: number, w: number, h: number): Polyline[] {
    const m = this.s.m
    return [{ pts: transformPts([x, y, x + w, y, x + w, y + h, x, y + h], m), closed: true }]
  }

  fillRect(x: number, y: number, w: number, h: number) {
    if (![x, y, w, h].every(Number.isFinite) || !w || !h) return
    this.drawPolys(this.rectPoly(x, y, w, h), 'nonzero', this.shaderFor(this.s.fill, this.s.fillColor))
  }

  strokeRect(x: number, y: number, w: number, h: number) {
    if (![x, y, w, h].every(Number.isFinite)) return
    if (!w && !h) return
    const p = new Path2D()
    if (!w || !h) {
      p.moveTo(x, y)
      p.lineTo(x + w, y + h)
    } else p.rect(x, y, w, h)
    this.stroke(p)
  }

  clearRect(x: number, y: number, w: number, h: number) {
    if (![x, y, w, h].every(Number.isFinite) || !w || !h) return
    const c = this.canvas
    const m = this.s.m
    // fast path: axis-aligned integer rect, no clip
    if (!this.s.clip && m[1] === 0 && m[2] === 0) {
      let x0 = m[0] * x + m[4], x1 = m[0] * (x + w) + m[4]
      let y0 = m[3] * y + m[5], y1 = m[3] * (y + h) + m[5]
      if (x0 > x1) [x0, x1] = [x1, x0]
      if (y0 > y1) [y0, y1] = [y1, y0]
      if ([x0, x1, y0, y1].every(Number.isInteger)) {
        const X0 = Math.max(0, x0), X1 = Math.min(c._w, x1), Y0 = Math.max(0, y0), Y1 = Math.min(c._h, y1)
        for (let yy = Y0; yy < Y1; yy++) c._data.fill(0, (yy * c._w + X0) * 4, (yy * c._w + X1) * 4)
        c._touch()
        return
      }
    }
    const polys = this.rectPoly(x, y, w, h)
    const shader = solidShader([0, 0, 0, 1])
    const clip = this.s.clip
    rasterize(polys, c._w, c._h, 'nonzero', (yy, x0, x1, cov) => {
      const buf = srcRow(x1 - x0)
      shader.row(yy, x0, x1, buf)
      compositeRow(c._data, c._w, yy, x0, x1, buf, cov, 1, 'destination-out', clip)
    })
    c._touch()
  }

  // ---------------------------------------------------------------- core drawing

  private shaderFor(paint: Paint, color: RGBA | null): Shader {
    if (color) return solidShader(color)
    if (paint instanceof CanvasGradient) return gradientShader(paint, this.s.m)
    if (paint instanceof CanvasPattern) return patternShader(paint, this.s.m, this.s.smoothing)
    return solidShader([0, 0, 0, 1])
  }

  private shadowActive() {
    const s = this.s
    return s.shadowColor[3] > 0 && (s.shadowBlur > 0 || s.shadowOffsetX !== 0 || s.shadowOffsetY !== 0)
  }

  /** Fills device-space polygons with a shader, honoring globalAlpha, compositing, clipping and shadows. */
  private drawPolys(polys: Polyline[], rule: FillRule, shader: Shader) {
    const c = this.canvas
    const { _w: w, _h: h } = c
    if (!w || !h) return
    polys = polys.filter((p) => p.pts.length >= 6)
    if (!polys.length && !UNBOUNDED.has(this.s.op)) return
    if (this.shadowActive()) this.drawShadow(polys, rule, shader)
    const { op, globalAlpha: alpha, clip } = this.s
    if (UNBOUNDED.has(op)) {
      const mask = rasterizeMask(polys, w, h, rule)
      this.compositeMask(mask, w, 0, 0, shader, alpha, op)
    } else {
      rasterize(polys, w, h, rule, (y, x0, x1, cov) => {
        const buf = srcRow(x1 - x0)
        shader.row(y, x0, x1, buf)
        compositeRow(c._data, w, y, x0, x1, buf, cov, alpha, op, clip)
      })
    }
    c._touch()
  }

  /**
   * Composites `shader` through a coverage mask covering the whole canvas.
   * `mask` has row stride `mw`; canvas pixel (x, y) reads mask[(y + oy) * mw + x + ox].
   */
  private compositeMask(mask: Float32Array, mw: number, ox: number, oy: number, shader: Shader, alpha: number, op: string) {
    const c = this.canvas
    const { _w: w, _h: h } = c
    const clip = this.s.clip
    const buf = srcRow(w)
    const unbounded = UNBOUNDED.has(op)
    for (let y = 0; y < h; y++) {
      const start = (y + oy) * mw + ox
      const cov = mask.subarray(start, start + w)
      if (!unbounded) {
        let any = false
        for (let x = 0; x < w; x++) if (cov[x] > 0) { any = true; break }
        if (!any) continue
      }
      shader.row(y, 0, w, buf)
      compositeRow(c._data, w, y, 0, w, buf, cov, alpha, op, clip)
    }
  }

  private drawShadow(polys: Polyline[], rule: FillRule, shader: Shader) {
    const s = this.s
    const { _w: w, _h: h } = this.canvas
    const sigma = s.shadowBlur / 2
    const margin = Math.ceil(sigma * 3) + 1
    const ox = Math.round(s.shadowOffsetX), oy = Math.round(s.shadowOffsetY)
    const bw = w + margin * 2, bh = h + margin * 2
    // shape alpha, shifted by the shadow offset, in an enlarged buffer
    const shifted = polys.map((p) => ({ pts: p.pts.map((v, i) => v + (i & 1 ? oy : ox) + margin), closed: true }))
    const A = new Float32Array(bw * bh)
    rasterize(shifted, bw, bh, rule, (y, x0, x1, cov) => {
      const buf = srcRow(x1 - x0)
      if (shader.solid) {
        const a = shader.solid[3]
        for (let x = x0; x < x1; x++) A[y * bw + x] = cov[x] * a
      } else {
        shader.row(y - margin - oy, x0 - margin - ox, x1 - margin - ox, buf)
        for (let x = x0; x < x1; x++) A[y * bw + x] = cov[x] * buf[(x - x0) * 4 + 3]
      }
    })
    if (sigma > 0) gaussianBlur(A, bw, bh, sigma)
    this.compositeMask(A, bw, margin, margin, solidShader(s.shadowColor), s.globalAlpha, s.op)
  }

  // ---------------------------------------------------------------- text

  private textPolys(text: string, x: number, y: number, maxWidth: number | undefined, extraWidth: number): { outer: Polyline[]; inner: Polyline[] | null } | null {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null
    if (maxWidth !== undefined && !(maxWidth > 0)) return null
    const f = this.s.font
    const scale = f.size / UNITS_PER_EM
    if (!(scale > 0)) return null
    const clean = String(text).replace(/[\t\n\f\r\v]/g, ' ')
    const lay = layoutText(clean, f, this.s.letterSpacingPx / scale, this.s.wordSpacingPx / scale)
    const widthPx = lay.advance * scale
    const sx = maxWidth !== undefined && widthPx > maxWidth ? maxWidth / widthPx : 1
    const ax = this.alignOffset(lay.advance)
    const by = this.baselineOffset()
    const k = f.style === 'normal' ? 0 : 0.2
    // glyph units → user space
    let g: Mat = [1, 0, -k, 1, BASELINE * k, 0]
    g = mul([1, 0, 0, 1, ax, by], g)
    g = mul([scale * sx, 0, 0, scale, x, y], g)
    const full = mul(this.s.m, g)
    const devScale = matScale(full)
    if (!(devScale > 0)) return null
    const tol = FLATTEN_TOL / devScale
    const lines: StrokeInput[] = flatten(lay.path._subpaths, tol).map((p, i) => ({ ...p, hasSegments: lay.path._subpaths[i].segs.length > 0 }))
    const weight = strokeWidthFor(f.weight)
    const base = { lineCap: 'round' as const, lineJoin: 'round' as const, miterLimit: 10, dash: [], dashOffset: 0 }
    const outer = strokePolylines(lines, { ...base, lineWidth: weight + extraWidth / scale }, tol)
    const innerW = weight - extraWidth / scale
    const inner = extraWidth > 0 && innerW > 0 ? strokePolylines(lines, { ...base, lineWidth: innerW }, tol) : null
    const tx = (ps: Polyline[]) => ps.map((p) => ({ pts: transformPts(p.pts, full), closed: true }))
    return { outer: tx(outer), inner: inner ? tx(inner) : null }
  }

  private isRtl() {
    return this.s.direction === 'rtl'
  }
  private alignOffset(advance: number) {
    let a = this.s.textAlign
    if (a === 'start') a = this.isRtl() ? 'right' : 'left'
    if (a === 'end') a = this.isRtl() ? 'left' : 'right'
    return a === 'center' ? -advance / 2 : a === 'right' ? -advance : 0
  }
  private baselineOffset() {
    switch (this.s.textBaseline) {
      case 'top': return 1
      case 'hanging': return -0.8
      case 'middle': return -5
      case 'ideographic':
      case 'bottom': return -11
      default: return -BASELINE
    }
  }

  fillText(text: string, x: number, y: number, maxWidth?: number) {
    const r = this.textPolys(text, x, y, maxWidth, 0)
    if (r) this.drawPolys(r.outer, 'nonzero', this.shaderFor(this.s.fill, this.s.fillColor))
  }

  /** Strokes the outline of the (single-stroke) glyphs: a ring of `lineWidth` centered on the glyph edge. */
  strokeText(text: string, x: number, y: number, maxWidth?: number) {
    const r = this.textPolys(text, x, y, maxWidth, this.s.lineWidth)
    if (!r) return
    const shader = this.shaderFor(this.s.stroke, this.s.strokeColor)
    if (!r.inner) return this.drawPolys(r.outer, 'nonzero', shader)
    const c = this.canvas
    const { _w: w, _h: h } = c
    const outer = rasterizeMask(r.outer, w, h, 'nonzero')
    const inner = rasterizeMask(r.inner, w, h, 'nonzero')
    for (let i = 0; i < outer.length; i++) outer[i] = Math.max(0, outer[i] - inner[i])
    this.compositeMask(outer, w, 0, 0, shader, this.s.globalAlpha, this.s.op)
    c._touch()
  }

  measureText(text: string): TextMetrics {
    const f = this.s.font
    const scale = f.size / UNITS_PER_EM
    const lay = layoutText(String(text).replace(/[\t\n\f\r\v]/g, ' '), f, this.s.letterSpacingPx / scale, this.s.wordSpacingPx / scale)
    const width = lay.advance * scale
    const ax = this.alignOffset(lay.advance) * scale
    const by = this.baselineOffset() // glyph units: y_user = (y_g + by) * scale
    const half = strokeWidthFor(f.weight) / 2
    const [bx0, by0, bx1, by1] = lay.bounds
    const empty = !(bx1 > bx0 || by1 > by0)
    const u = (v: number) => v * scale
    // all values relative to the text anchor point; ascent positive upward
    return {
      width,
      actualBoundingBoxLeft: empty ? -ax : -(u(bx0 - half) + ax),
      actualBoundingBoxRight: empty ? ax : u(bx1 + half) + ax,
      actualBoundingBoxAscent: empty ? 0 : -u(by0 - half + by),
      actualBoundingBoxDescent: empty ? 0 : u(by1 + half + by),
      fontBoundingBoxAscent: -u(BASELINE - 9.6 + by),
      fontBoundingBoxDescent: u(BASELINE + 2.4 + by),
      emHeightAscent: -u(BASELINE - 9 + by),
      emHeightDescent: u(BASELINE + 3 + by),
      hangingBaseline: -u(0.8 + by),
      alphabeticBaseline: -u(BASELINE + by),
      ideographicBaseline: -u(11 + by),
    }
  }

  // ---------------------------------------------------------------- images

  drawImage(image: CanvasImageSource, dx: number, dy: number): void
  drawImage(image: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void
  drawImage(image: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void
  drawImage(image: CanvasImageSource, ...a: number[]) {
    const src = pixelsOf(image)
    if (src === 'pending') return
    if (!src) throw new TypeError("Failed to execute 'drawImage': The provided value is not of a supported image type.")
    if (src.width === 0 || src.height === 0) return
    let sx = 0, sy = 0, sw = src.width, sh = src.height, dx: number, dy: number, dw: number, dh: number
    if (a.length === 2) {
      ;[dx, dy] = a
      dw = sw; dh = sh
    } else if (a.length === 4) {
      ;[dx, dy, dw, dh] = a
    } else if (a.length === 8) {
      ;[sx, sy, sw, sh, dx, dy, dw, dh] = a
    } else throw new TypeError(`Failed to execute 'drawImage': Valid arities are: [3, 5, 9], but ${a.length + 1} arguments provided.`)
    if (![sx, sy, sw, sh, dx, dy, dw, dh].every(Number.isFinite)) return
    if (sw < 0) { sx += sw; sw = -sw }
    if (sh < 0) { sy += sh; sh = -sh }
    if (dw < 0) { dx += dw; dw = -dw }
    if (dh < 0) { dy += dh; dh = -dh }
    if (!sw || !sh || !dw || !dh) return
    // clip the source rect to the image, adjusting the destination proportionally
    const kx = dw / sw, ky = dh / sh
    const csx = Math.max(0, sx), csy = Math.max(0, sy)
    const csx1 = Math.min(src.width, sx + sw), csy1 = Math.min(src.height, sy + sh)
    if (csx1 <= csx || csy1 <= csy) return
    dx += (csx - sx) * kx
    dy += (csy - sy) * ky
    dw = (csx1 - csx) * kx
    dh = (csy1 - csy) * ky
    sx = csx; sy = csy; sw = csx1 - csx; sh = csy1 - csy
    // snapshot when drawing a canvas onto itself
    const pixels: PixelSource = src.data === this.canvas._data ? { width: src.width, height: src.height, data: new Uint8ClampedArray(src.data) } : src
    const m = mul(this.s.m, [kx, 0, 0, ky, dx - sx * kx, dy - sy * ky])
    // pixel-aligned 1:1 copies are sampled with nearest neighbour (exact, like browsers)
    const exact = m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && Number.isInteger(m[4]) && Number.isInteger(m[5])
    const shader = imageShader(pixels, m, this.s.smoothing && !exact, sx, sy, sw, sh)
    this.drawPolys(this.rectPoly(dx, dy, dw, dh), 'nonzero', shader)
  }

  createPattern(image: CanvasImageSource, repetition: string | null): CanvasPattern | null {
    const rep = parseRepetition(repetition)
    const src = pixelsOf(image)
    if (src === 'pending') return null
    if (!src) throw new TypeError("Failed to execute 'createPattern': The provided value is not of a supported image type.")
    return new CanvasPattern({ width: src.width, height: src.height, data: new Uint8ClampedArray(src.data) }, rep)
  }

  createLinearGradient(x0: number, y0: number, x1: number, y1: number) {
    if (![x0, y0, x1, y1].every(Number.isFinite)) throw new TypeError("Failed to execute 'createLinearGradient': The provided double value is non-finite.")
    return new CanvasGradient({ type: 'linear', x0, y0, x1, y1 })
  }
  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number) {
    if (![x0, y0, r0, x1, y1, r1].every(Number.isFinite)) throw new TypeError("Failed to execute 'createRadialGradient': The provided double value is non-finite.")
    if (r0 < 0 || r1 < 0) throw domError('IndexSizeError', `The ${r0 < 0 ? 'r0' : 'r1'} provided is less than 0.`)
    return new CanvasGradient({ type: 'radial', x0, y0, r0, x1, y1, r1 })
  }
  createConicGradient(startAngle: number, x: number, y: number) {
    if (![startAngle, x, y].every(Number.isFinite)) throw new TypeError("Failed to execute 'createConicGradient': The provided double value is non-finite.")
    return new CanvasGradient({ type: 'conic', angle: startAngle, x, y })
  }

  // ---------------------------------------------------------------- pixels

  createImageData(sw: number | ImageData, sh?: number, settings?: ImageDataSettings): ImageData {
    if (typeof sw === 'object') return new ImageData(sw.width, sw.height)
    if (!sw || !sh) throw domError('IndexSizeError', `The source ${!sw ? 'width' : 'height'} is 0.`)
    return new ImageData(Math.abs(Math.trunc(sw)), Math.abs(Math.trunc(sh!)), settings)
  }

  getImageData(sx: number, sy: number, sw: number, sh: number, settings?: ImageDataSettings): ImageData {
    if (!sw || !sh) throw domError('IndexSizeError', `The source ${!sw ? 'width' : 'height'} is 0.`)
    if (![sx, sy, sw, sh].every(Number.isFinite)) throw new TypeError("Failed to execute 'getImageData': The provided double value is non-finite.")
    if (sw < 0) { sx += sw; sw = -sw }
    if (sh < 0) { sy += sh; sh = -sh }
    sx = Math.floor(sx); sy = Math.floor(sy); sw = Math.ceil(sw); sh = Math.ceil(sh)
    const out = new ImageData(sw, sh, settings)
    const c = this.canvas
    const x0 = Math.max(0, sx), x1 = Math.min(c._w, sx + sw)
    if (x1 <= x0) return out
    for (let y = Math.max(0, sy); y < Math.min(c._h, sy + sh); y++) {
      out.data.set(c._data.subarray((y * c._w + x0) * 4, (y * c._w + x1) * 4), ((y - sy) * sw + (x0 - sx)) * 4)
    }
    return out
  }

  putImageData(img: ImageData, dx: number, dy: number, dirtyX = 0, dirtyY = 0, dirtyW?: number, dirtyH?: number) {
    if (!img || typeof img.width !== 'number' || !img.data) throw new TypeError("Failed to execute 'putImageData': parameter 1 is not of type 'ImageData'.")
    dirtyW ??= img.width
    dirtyH ??= img.height
    if (![dx, dy, dirtyX, dirtyY, dirtyW, dirtyH].every(Number.isFinite)) return
    if (dirtyW < 0) { dirtyX += dirtyW; dirtyW = -dirtyW }
    if (dirtyH < 0) { dirtyY += dirtyH; dirtyH = -dirtyH }
    dx = Math.trunc(dx); dy = Math.trunc(dy)
    let x0 = Math.max(0, Math.floor(dirtyX)), y0 = Math.max(0, Math.floor(dirtyY))
    let x1 = Math.min(img.width, Math.floor(dirtyX + dirtyW)), y1 = Math.min(img.height, Math.floor(dirtyY + dirtyH))
    const c = this.canvas
    x0 = Math.max(x0, -dx); y0 = Math.max(y0, -dy)
    x1 = Math.min(x1, c._w - dx); y1 = Math.min(y1, c._h - dy)
    if (x1 <= x0 || y1 <= y0) return
    for (let y = y0; y < y1; y++) {
      c._data.set(img.data.subarray((y * img.width + x0) * 4, (y * img.width + x1) * 4), ((y + dy) * c._w + x0 + dx) * 4)
    }
    c._touch()
  }

  // ---------------------------------------------------------------- misc no-ops

  drawFocusIfNeeded() {}
  scrollPathIntoView() {}
}

function parseLength(v: string, fontSize: number): number | null {
  const m = /^\s*(-?[\d.]+)(px|em|rem|pt)?\s*$/.exec(v)
  if (!m) return null
  const n = parseFloat(m[1])
  if (!Number.isFinite(n)) return null
  switch (m[2]) {
    case 'em': return n * fontSize
    case 'rem': return n * 16
    case 'pt': return (n * 4) / 3
    case 'px': return n
    default: return n === 0 ? 0 : null
  }
}

/** Resolves a drawImage/createPattern source to pixels. 'pending' = not yet decoded image (draws nothing). */
function pixelsOf(image: CanvasImageSource): PixelSource | 'pending' | null {
  if (!image || typeof image !== 'object') return null
  const any = image as { _data?: unknown; data?: unknown; width: number; height: number; complete?: boolean; tagName?: string }
  // Canvas: _data is the bitmap array
  if (any._data instanceof Uint8ClampedArray) return { width: any.width, height: any.height, data: any._data }
  // Image: _data is ImageData (or null while loading)
  if (any.tagName === 'IMG') {
    const d = any._data as ImageData | null
    if (!d) {
      if (any.complete === false) return 'pending'
      throw domError('InvalidStateError', "Failed to execute 'drawImage': The HTMLImageElement provided is in the 'broken' state.")
    }
    return { width: d.width, height: d.height, data: d.data }
  }
  if (any._data && typeof any._data === 'object' && (any._data as ImageData).data) {
    const d = any._data as ImageData
    return { width: d.width, height: d.height, data: d.data }
  }
  if (ArrayBuffer.isView(any.data) && typeof any.width === 'number' && typeof any.height === 'number') {
    return { width: any.width, height: any.height, data: any.data as Uint8ClampedArray }
  }
  return null
}

/** In-place Gaussian blur approximation (3 box passes, horizontal + vertical). */
function gaussianBlur(a: Float32Array, w: number, h: number, sigma: number) {
  const n = 3
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1)
  let wl = Math.floor(wIdeal)
  if (wl % 2 === 0) wl--
  const wu = wl + 2
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4)
  const m = Math.round(mIdeal)
  const tmp = new Float32Array(a.length)
  for (let i = 0; i < n; i++) {
    const r = ((i < m ? wl : wu) - 1) / 2
    if (r <= 0) continue
    boxH(a, tmp, w, h, r)
    boxV(tmp, a, w, h, r)
  }
}

function boxH(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const iarr = 1 / (r + r + 1)
  for (let y = 0; y < h; y++) {
    const o = y * w
    let acc = 0
    for (let x = -r; x <= r; x++) acc += x >= 0 && x < w ? src[o + x] : 0
    for (let x = 0; x < w; x++) {
      dst[o + x] = acc * iarr
      const add = x + r + 1, sub = x - r
      if (add < w) acc += src[o + add]
      if (sub >= 0) acc -= src[o + sub]
    }
  }
}

function boxV(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const iarr = 1 / (r + r + 1)
  for (let x = 0; x < w; x++) {
    let acc = 0
    for (let y = -r; y <= r; y++) acc += y >= 0 && y < h ? src[y * w + x] : 0
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = acc * iarr
      const add = y + r + 1, sub = y - r
      if (add < h) acc += src[add * w + x]
      if (sub >= 0) acc -= src[sub * w + x]
    }
  }
}
