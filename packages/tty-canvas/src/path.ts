/**
 * Path construction (shared by Path2D and the context's current default path),
 * SVG path-data parsing and curve flattening.
 *
 * Paths are stored as subpaths of line / cubic segments. Quadratic curves,
 * arcs and ellipses are converted to cubic Béziers (exact for quadratics,
 * < 0.03% radial error for arcs), so any affine transform can be applied to the
 * control points without loss.
 */
import { invert, type Mat } from './matrix.js'

export const enum Seg {
  Line = 0,
  Cubic = 1,
}

export interface SubPath {
  /** Flat point list: start point, then per segment 1 (line) or 3 (cubic) points. */
  pts: number[]
  /** Segment kinds, one per segment. */
  segs: Seg[]
  closed: boolean
}

export interface Polyline {
  /** Flat x,y list. */
  pts: number[]
  closed: boolean
}

export type RoundRectRadius = number | { x?: number; y?: number }

function domError(name: string, message: string) {
  const e = new Error(message)
  e.name = name
  return e
}

const TAU = Math.PI * 2

/**
 * Path builder implementing the CanvasPath mixin. `matrix` (when set) is
 * applied to every incoming coordinate — the context uses this for its
 * current transform, Path2D leaves it null.
 */
export class PathBuilder {
  /** @internal */ _subpaths: SubPath[] = []
  /** @internal */ protected _matrix: Mat | null = null
  // current subpath + its start point (device / path space)
  private cur: SubPath | null = null

  /** @internal Reset to an empty path. */
  _clear() {
    this._subpaths = []
    this.cur = null
  }

  private tx(x: number, y: number): [number, number] {
    const m = this._matrix
    if (!m) return [x, y]
    return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
  }

  /** Last point of the path in path (device) space, or null. */
  protected lastPoint(): [number, number] | null {
    const c = this.cur
    if (!c || !c.pts.length) return null
    return [c.pts[c.pts.length - 2], c.pts[c.pts.length - 1]]
  }

  /** @internal moveTo in already-transformed space. */
  _moveToRaw(x: number, y: number) {
    this.cur = { pts: [x, y], segs: [], closed: false }
    this._subpaths.push(this.cur)
  }
  /** @internal */
  _lineToRaw(x: number, y: number) {
    if (!this.cur) return this._moveToRaw(x, y)
    this.cur.pts.push(x, y)
    this.cur.segs.push(Seg.Line)
  }
  /** @internal */
  _cubicToRaw(x1: number, y1: number, x2: number, y2: number, x: number, y: number) {
    if (!this.cur) this._moveToRaw(x1, y1)
    this.cur!.pts.push(x1, y1, x2, y2, x, y)
    this.cur!.segs.push(Seg.Cubic)
  }

  moveTo(x: number, y: number) {
    if (!finite(x, y)) return
    const [a, b] = this.tx(x, y)
    this._moveToRaw(a, b)
  }

  lineTo(x: number, y: number) {
    if (!finite(x, y)) return
    const [a, b] = this.tx(x, y)
    this._lineToRaw(a, b)
  }

  closePath() {
    const c = this.cur
    if (!c) return
    c.closed = true
    this._moveToRaw(c.pts[0], c.pts[1])
  }

  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number) {
    if (!finite(cpx, cpy, x, y)) return
    const [qx, qy] = this.tx(cpx, cpy)
    const [ex, ey] = this.tx(x, y)
    if (!this.cur) this._moveToRaw(qx, qy)
    const [sx, sy] = this.lastPoint()!
    this._cubicToRaw(sx + (2 / 3) * (qx - sx), sy + (2 / 3) * (qy - sy), ex + (2 / 3) * (qx - ex), ey + (2 / 3) * (qy - ey), ex, ey)
  }

  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number) {
    if (!finite(cp1x, cp1y, cp2x, cp2y, x, y)) return
    const [a, b] = this.tx(cp1x, cp1y)
    const [c, d] = this.tx(cp2x, cp2y)
    const [e, f] = this.tx(x, y)
    if (!this.cur) this._moveToRaw(a, b)
    this._cubicToRaw(a, b, c, d, e, f)
  }

  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, counterclockwise = false) {
    this.ellipse(x, y, radius, radius, 0, startAngle, endAngle, counterclockwise)
  }

  ellipse(x: number, y: number, rx: number, ry: number, rotation: number, startAngle: number, endAngle: number, counterclockwise = false) {
    if (!finite(x, y, rx, ry, rotation, startAngle, endAngle)) return
    if (rx < 0 || ry < 0) throw domError('IndexSizeError', `The ${rx < 0 ? 'major' : 'minor'}-axis radius provided (${rx < 0 ? rx : ry}) is negative.`)
    let sweep: number
    if (!counterclockwise) {
      sweep = endAngle - startAngle >= TAU ? TAU : mod(endAngle - startAngle, TAU)
    } else {
      sweep = startAngle - endAngle >= TAU ? -TAU : -mod(startAngle - endAngle, TAU)
    }
    const cosR = Math.cos(rotation)
    const sinR = Math.sin(rotation)
    const pt = (t: number): [number, number] => {
      const ex = rx * Math.cos(t)
      const ey = ry * Math.sin(t)
      return [x + ex * cosR - ey * sinR, y + ex * sinR + ey * cosR]
    }
    const [sx, sy] = this.tx(...pt(startAngle))
    if (this.cur) this._lineToRaw(sx, sy)
    else this._moveToRaw(sx, sy)
    if (sweep === 0) return
    const n = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9))
    const step = sweep / n
    const k = (4 / 3) * Math.tan(step / 4)
    let t = startAngle
    for (let i = 0; i < n; i++) {
      const t2 = t + step
      const c1 = Math.cos(t), s1 = Math.sin(t), c2 = Math.cos(t2), s2 = Math.sin(t2)
      // control points on the unit circle, then scaled/rotated/translated
      const map = (ux: number, uy: number) => {
        const ex = rx * ux
        const ey = ry * uy
        return this.tx(x + ex * cosR - ey * sinR, y + ex * sinR + ey * cosR)
      }
      const p1 = map(c1 - k * s1, s1 + k * c1)
      const p2 = map(c2 + k * s2, s2 - k * c2)
      const p3 = map(c2, s2)
      this._cubicToRaw(p1[0], p1[1], p2[0], p2[1], p3[0], p3[1])
      t = t2
    }
  }

  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number) {
    if (!finite(x1, y1, x2, y2, radius)) return
    if (radius < 0) throw domError('IndexSizeError', `The radius provided (${radius}) is negative.`)
    if (!this.cur) this.moveTo(x1, y1)
    // the last point, in user space
    const last = this.lastPoint()!
    let x0 = last[0]
    let y0 = last[1]
    if (this._matrix) {
      const inv = invert(this._matrix)
      if (!inv) return
      ;[x0, y0] = [inv[0] * last[0] + inv[2] * last[1] + inv[4], inv[1] * last[0] + inv[3] * last[1] + inv[5]]
    }
    const eq = (ax: number, ay: number, bx: number, by: number) => Math.abs(ax - bx) < 1e-9 && Math.abs(ay - by) < 1e-9
    if (eq(x0, y0, x1, y1) || eq(x1, y1, x2, y2) || radius === 0) return this.lineTo(x1, y1)
    const v1x = x0 - x1, v1y = y0 - y1
    const v2x = x2 - x1, v2y = y2 - y1
    const cross = v1x * v2y - v1y * v2x
    if (Math.abs(cross) < 1e-9 * Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y)) return this.lineTo(x1, y1)
    const l1 = Math.hypot(v1x, v1y)
    const l2 = Math.hypot(v2x, v2y)
    const angle = Math.acos(Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (l1 * l2))))
    const dist = radius / Math.tan(angle / 2)
    const t1x = x1 + (v1x / l1) * dist, t1y = y1 + (v1y / l1) * dist
    const t2x = x1 + (v2x / l2) * dist, t2y = y1 + (v2y / l2) * dist
    // center lies on the angle bisector at distance r / sin(angle / 2) from the corner
    const bx = v1x / l1 + v2x / l2, by = v1y / l1 + v2y / l2
    const bl = Math.hypot(bx, by)
    const cd = radius / Math.sin(angle / 2)
    const cx = x1 + (bx / bl) * cd, cy = y1 + (by / bl) * cd
    const a0 = Math.atan2(t1y - cy, t1x - cx)
    const a1 = Math.atan2(t2y - cy, t2x - cx)
    this.lineTo(t1x, t1y)
    this.arc(cx, cy, radius, a0, a1, cross > 0)
  }

  rect(x: number, y: number, w: number, h: number) {
    if (!finite(x, y, w, h)) return
    this.moveTo(x, y)
    this.lineTo(x + w, y)
    this.lineTo(x + w, y + h)
    this.lineTo(x, y + h)
    this.closePath()
  }

  roundRect(x: number, y: number, w: number, h: number, radii: RoundRectRadius | RoundRectRadius[] = 0) {
    if (!finite(x, y, w, h)) return
    const list = Array.isArray(radii) ? radii : [radii]
    if (list.length < 1 || list.length > 4) throw new RangeError(`${list.length} radii provided. Between one and four radii are necessary.`)
    const rs = list.map((r) => {
      if (typeof r === 'number') {
        if (r < 0) throw domError('IndexSizeError', `The radius provided (${r}) is negative.`)
        return { x: r, y: r }
      }
      const rx = r.x ?? 0
      const ry = r.y ?? 0
      if (rx < 0 || ry < 0) throw domError('IndexSizeError', 'The radius provided is negative.')
      return { x: rx, y: ry }
    })
    if (rs.some((r) => !Number.isFinite(r.x) || !Number.isFinite(r.y))) return
    let tl, tr, br, bl
    if (rs.length === 4) [tl, tr, br, bl] = rs
    else if (rs.length === 3) [tl, tr, br, bl] = [rs[0], rs[1], rs[2], rs[1]]
    else if (rs.length === 2) [tl, tr, br, bl] = [rs[0], rs[1], rs[0], rs[1]]
    else tl = tr = br = bl = rs[0]
    tl = { ...tl }; tr = { ...tr }; br = { ...br }; bl = { ...bl }
    // negative width/height flip the corners
    if (w < 0) {
      x += w; w = -w
      ;[tl, tr] = [tr, tl]
      ;[bl, br] = [br, bl]
    }
    if (h < 0) {
      y += h; h = -h
      ;[tl, bl] = [bl, tl]
      ;[tr, br] = [br, tr]
    }
    const scale = Math.min(1, w / (tl.x + tr.x) || 1, w / (bl.x + br.x) || 1, h / (tl.y + bl.y) || 1, h / (tr.y + br.y) || 1)
    for (const r of [tl, tr, br, bl]) {
      r.x *= scale
      r.y *= scale
    }
    const H = Math.PI / 2
    this.moveTo(x + tl.x, y)
    this.lineTo(x + w - tr.x, y)
    if (tr.x || tr.y) this.ellipse(x + w - tr.x, y + tr.y, tr.x, tr.y, 0, -H, 0)
    this.lineTo(x + w, y + h - br.y)
    if (br.x || br.y) this.ellipse(x + w - br.x, y + h - br.y, br.x, br.y, 0, 0, H)
    this.lineTo(x + bl.x, y + h)
    if (bl.x || bl.y) this.ellipse(x + bl.x, y + h - bl.y, bl.x, bl.y, 0, H, Math.PI)
    this.lineTo(x, y + tl.y)
    if (tl.x || tl.y) this.ellipse(x + tl.x, y + tl.y, tl.x, tl.y, 0, Math.PI, Math.PI + H)
    this.closePath()
    this.moveTo(x, y)
  }
}

/** The `Path2D` interface. Accepts another Path2D or SVG path data. */
export class Path2D extends PathBuilder {
  constructor(path?: Path2D | string) {
    super()
    if (path instanceof PathBuilder) this._append(path._subpaths, null)
    else if (typeof path === 'string') parseSvgPath(path, this)
  }

  /** Adds the subpaths of `path`, optionally transformed by a DOMMatrix2DInit. */
  addPath(path: Path2D, transform?: { a?: number; b?: number; c?: number; d?: number; e?: number; f?: number; m11?: number; m12?: number; m21?: number; m22?: number; m41?: number; m42?: number }) {
    if (!(path instanceof PathBuilder)) throw new TypeError("Failed to execute 'addPath' on 'Path2D': parameter 1 is not of type 'Path2D'.")
    let m: Mat | null = null
    if (transform) {
      m = [transform.a ?? transform.m11 ?? 1, transform.b ?? transform.m12 ?? 0, transform.c ?? transform.m21 ?? 0, transform.d ?? transform.m22 ?? 1, transform.e ?? transform.m41 ?? 0, transform.f ?? transform.m42 ?? 0]
      if (!m.every(Number.isFinite)) return
    }
    this._append(path._subpaths, m)
  }

  /** @internal */
  _append(subs: SubPath[], m: Mat | null) {
    for (const s of subs) {
      const pts = m ? transformPts(s.pts, m) : s.pts.slice()
      this._moveToRaw(pts[0], pts[1])
      const cur = this._subpaths[this._subpaths.length - 1]
      cur.pts = pts
      cur.segs = s.segs.slice()
      cur.closed = s.closed
    }
    if (subs.length) {
      const last = this._subpaths[this._subpaths.length - 1]
      if (last.closed) this._moveToRaw(last.pts[0], last.pts[1])
    }
  }
}

function mod(a: number, n: number) {
  return ((a % n) + n) % n
}

function finite(...v: number[]) {
  for (const n of v) if (!Number.isFinite(n)) return false
  return true
}

export function transformPts(pts: number[], m: Readonly<Mat>): number[] {
  const out = new Array<number>(pts.length)
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i], y = pts[i + 1]
    out[i] = m[0] * x + m[2] * y + m[4]
    out[i + 1] = m[1] * x + m[3] * y + m[5]
  }
  return out
}

/** Applies a matrix to a whole subpath list. */
export function transformSubpaths(subs: SubPath[], m: Readonly<Mat>): SubPath[] {
  return subs.map((s) => ({ pts: transformPts(s.pts, m), segs: s.segs, closed: s.closed }))
}

/**
 * Flattens subpaths into polylines. `tolerance` is the max deviation in the
 * output coordinate space. Subpaths with a single point are kept (strokes need
 * them for caps); fill ignores them.
 */
export function flatten(subs: SubPath[], tolerance = 0.2, m?: Readonly<Mat> | null): Polyline[] {
  const out: Polyline[] = []
  for (const s of subs) {
    const src = m ? transformPts(s.pts, m) : s.pts
    const pts: number[] = [src[0], src[1]]
    let i = 2
    for (const seg of s.segs) {
      if (seg === Seg.Line) {
        pts.push(src[i], src[i + 1])
        i += 2
      } else {
        const x0 = pts[pts.length - 2], y0 = pts[pts.length - 1]
        flattenCubic(pts, x0, y0, src[i], src[i + 1], src[i + 2], src[i + 3], src[i + 4], src[i + 5], tolerance)
        i += 6
      }
    }
    if (s.segs.length === 0 && !s.closed && out.length && subs.length > 1) {
      // isolated moveTo: keep as a degenerate polyline (for stroke caps)
    }
    out.push({ pts, closed: s.closed })
  }
  return out
}

function flattenCubic(out: number[], x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, tol: number) {
  const ddx = Math.max(Math.abs(x0 - 2 * x1 + x2), Math.abs(x1 - 2 * x2 + x3))
  const ddy = Math.max(Math.abs(y0 - 2 * y1 + y2), Math.abs(y1 - 2 * y2 + y3))
  const dd = Math.hypot(ddx, ddy)
  const n = Math.min(1000, Math.max(1, Math.ceil(Math.sqrt((0.75 * dd) / tol))))
  for (let k = 1; k <= n; k++) {
    const t = k / n
    const mt = 1 - t
    const a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, d = t * t * t
    out.push(a * x0 + b * x1 + c * x2 + d * x3, a * y0 + b * y1 + c * y2 + d * y3)
  }
}

// ---------------------------------------------------------------- SVG path data

/** Parses SVG path data (`M10 10 h 20 a5 5 0 0 1 5 5 z ...`) into a path builder. Stops at the first error, like browsers. */
export function parseSvgPath(d: string, p: PathBuilder) {
  const re = /([MmLlHhVvCcSsQqTtAaZz])|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g
  const tokens: (string | number)[] = []
  let m: RegExpExecArray | null
  let lastIndex = 0
  while ((m = re.exec(d))) {
    const between = d.slice(lastIndex, m.index)
    if (/[^\s,]/.test(between)) break
    lastIndex = re.lastIndex
    tokens.push(m[1] ?? parseFloat(m[2]))
  }
  let i = 0
  let cx = 0, cy = 0 // current point
  let sx = 0, sy = 0 // subpath start
  let lcx = 0, lcy = 0 // last control point
  let prev = ''
  let cmd = ''
  const isNum = () => typeof tokens[i] === 'number'
  const nums = (n: number): number[] | null => {
    if (i + n > tokens.length) return null
    const out: number[] = []
    for (let k = 0; k < n; k++) {
      const t = tokens[i + k]
      if (typeof t !== 'number') return null
      out.push(t)
    }
    i += n
    return out
  }
  // arc flags may be written without separators ("a5 5 0 105 5"); the tokenizer merges
  // them, so re-split numbers for flags when needed
  const flag = (): number | null => {
    const t = tokens[i]
    if (t === 0 || t === 1) {
      i++
      return t
    }
    if (typeof t === 'number') {
      const s = String(t)
      if (s[0] === '0' || s[0] === '1') {
        tokens[i] = parseFloat(s.slice(1))
        if (s.length === 1) i++
        return +s[0]
      }
    }
    return null
  }
  while (i < tokens.length) {
    const t = tokens[i]
    if (typeof t === 'string') {
      cmd = t
      i++
    } else if (!cmd) return
    else if (cmd === 'M') cmd = 'L'
    else if (cmd === 'm') cmd = 'l'
    else if (cmd === 'Z' || cmd === 'z') return
    const rel = cmd === cmd.toLowerCase()
    const ox = rel ? cx : 0
    const oy = rel ? cy : 0
    switch (cmd.toUpperCase()) {
      case 'M': {
        const v = nums(2)
        if (!v) return
        cx = v[0] + ox; cy = v[1] + oy
        sx = cx; sy = cy
        p.moveTo(cx, cy)
        break
      }
      case 'L': {
        const v = nums(2)
        if (!v) return
        cx = v[0] + ox; cy = v[1] + oy
        p.lineTo(cx, cy)
        break
      }
      case 'H': {
        const v = nums(1)
        if (!v) return
        cx = v[0] + ox
        p.lineTo(cx, cy)
        break
      }
      case 'V': {
        const v = nums(1)
        if (!v) return
        cy = v[0] + oy
        p.lineTo(cx, cy)
        break
      }
      case 'C': {
        const v = nums(6)
        if (!v) return
        p.bezierCurveTo(v[0] + ox, v[1] + oy, v[2] + ox, v[3] + oy, v[4] + ox, v[5] + oy)
        lcx = v[2] + ox; lcy = v[3] + oy
        cx = v[4] + ox; cy = v[5] + oy
        break
      }
      case 'S': {
        const v = nums(4)
        if (!v) return
        const r = /[CcSs]/.test(prev)
        const c1x = r ? 2 * cx - lcx : cx, c1y = r ? 2 * cy - lcy : cy
        p.bezierCurveTo(c1x, c1y, v[0] + ox, v[1] + oy, v[2] + ox, v[3] + oy)
        lcx = v[0] + ox; lcy = v[1] + oy
        cx = v[2] + ox; cy = v[3] + oy
        break
      }
      case 'Q': {
        const v = nums(4)
        if (!v) return
        p.quadraticCurveTo(v[0] + ox, v[1] + oy, v[2] + ox, v[3] + oy)
        lcx = v[0] + ox; lcy = v[1] + oy
        cx = v[2] + ox; cy = v[3] + oy
        break
      }
      case 'T': {
        const v = nums(2)
        if (!v) return
        const r = /[QqTt]/.test(prev)
        const qx = r ? 2 * cx - lcx : cx, qy = r ? 2 * cy - lcy : cy
        p.quadraticCurveTo(qx, qy, v[0] + ox, v[1] + oy)
        lcx = qx; lcy = qy
        cx = v[0] + ox; cy = v[1] + oy
        break
      }
      case 'A': {
        const v = nums(3)
        if (!v) return
        const large = flag()
        const sweep = flag()
        const e = nums(2)
        if (large === null || sweep === null || !e) return
        const x = e[0] + ox, y = e[1] + oy
        svgArc(p, cx, cy, v[0], v[1], v[2], large, sweep, x, y)
        cx = x; cy = y
        break
      }
      case 'Z':
        p.closePath()
        cx = sx; cy = sy
        prev = cmd
        while (i < tokens.length && isNum()) return // numbers after Z are an error
        continue
    }
    prev = cmd
  }
}

/** SVG elliptical arc (endpoint parameterization, F.6.5) → PathBuilder.ellipse. */
function svgArc(p: PathBuilder, x1: number, y1: number, rx: number, ry: number, angleDeg: number, large: number, sweep: number, x2: number, y2: number) {
  if (x1 === x2 && y1 === y2) return
  rx = Math.abs(rx)
  ry = Math.abs(ry)
  if (!rx || !ry) return p.lineTo(x2, y2)
  const phi = (angleDeg * Math.PI) / 180
  const cos = Math.cos(phi), sin = Math.sin(phi)
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2
  const x1p = cos * dx + sin * dy
  const y1p = -sin * dx + cos * dy
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
  if (lambda > 1) {
    rx *= Math.sqrt(lambda)
    ry *= Math.sqrt(lambda)
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p
  let co = Math.sqrt(Math.max(0, num / den))
  if (large === sweep) co = -co
  const cxp = (co * rx * y1p) / ry
  const cyp = (-co * ry * x1p) / rx
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2
  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
    return a
  }
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
  if (!sweep && dt > 0) dt -= TAU
  else if (sweep && dt < 0) dt += TAU
  p.ellipse(cx, cy, rx, ry, phi, t1, t1 + dt, !sweep)
}
