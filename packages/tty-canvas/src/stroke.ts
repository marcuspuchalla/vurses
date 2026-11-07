/**
 * Stroker: turns polylines into a set of polygons whose nonzero union is the
 * stroke outline. Every piece (segment quads, joins, caps) is emitted with the
 * same orientation, so overlapping pieces never cancel out.
 */
import type { Polyline } from './path.js'

export type LineCap = 'butt' | 'round' | 'square'
export type LineJoin = 'miter' | 'round' | 'bevel'

export interface StrokeStyle {
  lineWidth: number
  lineCap: LineCap
  lineJoin: LineJoin
  miterLimit: number
  dash: number[]
  dashOffset: number
}

/** Polyline input with knowledge about whether it came from a lone moveTo. */
export interface StrokeInput extends Polyline {
  /** True when the subpath had at least one segment (a lone moveTo draws nothing). */
  hasSegments: boolean
}

const EPS = 1e-9

export function strokePolylines(lines: StrokeInput[], st: StrokeStyle, tolerance: number): Polyline[] {
  const out: Polyline[] = []
  const hw = st.lineWidth / 2
  if (!(hw > 0)) return out
  for (const line of lines) {
    if (!line.hasSegments) continue
    const pts = dedupe(line.pts, line.closed)
    if (st.dash.length) {
      for (const piece of dashPolyline(pts, line.closed, st.dash, st.dashOffset)) strokeOne(piece, false, hw, st, tolerance, out)
    } else strokeOne(pts, line.closed, hw, st, tolerance, out)
  }
  return out
}

function dedupe(pts: number[], closed: boolean): number[] {
  const out: number[] = [pts[0], pts[1]]
  for (let i = 2; i < pts.length; i += 2) {
    const x = pts[i], y = pts[i + 1]
    if (Math.abs(x - out[out.length - 2]) > EPS || Math.abs(y - out[out.length - 1]) > EPS) out.push(x, y)
  }
  if (closed && out.length > 4 && Math.abs(out[0] - out[out.length - 2]) <= EPS && Math.abs(out[1] - out[out.length - 1]) <= EPS) out.length -= 2
  return out
}

function strokeOne(pts: number[], closed: boolean, hw: number, st: StrokeStyle, tol: number, out: Polyline[]) {
  const n = pts.length / 2
  if (n === 1) {
    // zero-length subpath: round and square caps still draw
    const x = pts[0], y = pts[1]
    if (st.lineCap === 'round') push(out, circle(x, y, hw, tol))
    else if (st.lineCap === 'square') push(out, [x - hw, y - hw, x + hw, y - hw, x + hw, y + hw, x - hw, y + hw])
    return
  }
  const segCount = closed ? n : n - 1
  // segment bodies
  for (let i = 0; i < segCount; i++) {
    const j = (i + 1) % n
    const ax = pts[i * 2], ay = pts[i * 2 + 1]
    const bx = pts[j * 2], by = pts[j * 2 + 1]
    const len = Math.hypot(bx - ax, by - ay)
    const nx = (-(by - ay) / len) * hw, ny = ((bx - ax) / len) * hw
    push(out, [ax + nx, ay + ny, bx + nx, by + ny, bx - nx, by - ny, ax - nx, ay - ny])
  }
  // joins
  const first = closed ? 0 : 1
  const last = closed ? n : n - 1
  for (let k = first; k < last; k++) {
    const i = (k - 1 + n) % n
    const j = (k + 1) % n
    join(pts[i * 2], pts[i * 2 + 1], pts[k * 2], pts[k * 2 + 1], pts[j * 2], pts[j * 2 + 1], hw, st, tol, out)
  }
  // caps
  if (!closed && st.lineCap !== 'butt') {
    cap(pts[2], pts[3], pts[0], pts[1], hw, st.lineCap, tol, out)
    cap(pts[(n - 2) * 2], pts[(n - 2) * 2 + 1], pts[(n - 1) * 2], pts[(n - 1) * 2 + 1], hw, st.lineCap, tol, out)
  }
}

function join(ax: number, ay: number, px: number, py: number, bx: number, by: number, hw: number, st: StrokeStyle, tol: number, out: Polyline[]) {
  let d0x = px - ax, d0y = py - ay
  let d1x = bx - px, d1y = by - py
  const l0 = Math.hypot(d0x, d0y), l1 = Math.hypot(d1x, d1y)
  d0x /= l0; d0y /= l0; d1x /= l1; d1y /= l1
  const cross = d0x * d1y - d0y * d1x
  const dot = d0x * d1x + d0y * d1y
  if (Math.abs(cross) < 1e-12 && dot > 0) return // straight continuation
  if (st.lineJoin === 'round') {
    push(out, circle(px, py, hw, tol))
    return
  }
  const s = cross > 0 ? -1 : 1 // outer side
  const o0x = -d0y * s * hw, o0y = d0x * s * hw
  const o1x = -d1y * s * hw, o1y = d1x * s * hw
  if (st.lineJoin === 'miter') {
    const cosHalf = Math.sqrt(Math.max(0, (1 + dot) / 2)) // cos(turn / 2)
    const ratio = cosHalf > 1e-12 ? 1 / cosHalf : Infinity
    if (ratio <= st.miterLimit) {
      let mx = o0x + o1x, my = o0y + o1y
      const ml = Math.hypot(mx, my)
      if (ml > 1e-12) {
        mx = (mx / ml) * hw * ratio
        my = (my / ml) * hw * ratio
        push(out, [px, py, px + o0x, py + o0y, px + mx, py + my, px + o1x, py + o1y])
        return
      }
    }
  }
  push(out, [px, py, px + o0x, py + o0y, px + o1x, py + o1y])
}

function cap(ax: number, ay: number, px: number, py: number, hw: number, kind: 'round' | 'square', tol: number, out: Polyline[]) {
  if (kind === 'round') {
    push(out, circle(px, py, hw, tol))
    return
  }
  let dx = px - ax, dy = py - ay
  const l = Math.hypot(dx, dy)
  dx = (dx / l) * hw; dy = (dy / l) * hw
  const nx = -dy, ny = dx
  push(out, [px + nx, py + ny, px + nx + dx, py + ny + dy, px - nx + dx, py - ny + dy, px - nx, py - ny])
}

export function circle(cx: number, cy: number, r: number, tol: number): number[] {
  const n = Math.min(256, Math.max(8, Math.ceil(Math.PI / Math.acos(Math.max(-1, 1 - Math.min(tol, r) / r)))))
  const pts: number[] = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r)
  }
  return pts
}

function push(out: Polyline[], pts: number[]) {
  // normalize orientation (positive signed area)
  let area = 0
  const n = pts.length / 2
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    area += pts[i * 2] * pts[j * 2 + 1] - pts[j * 2] * pts[i * 2 + 1]
  }
  if (Math.abs(area) < 1e-12) return
  if (area < 0) {
    const r: number[] = []
    for (let i = n - 1; i >= 0; i--) r.push(pts[i * 2], pts[i * 2 + 1])
    pts = r
  }
  out.push({ pts, closed: true })
}

/** Splits a polyline into dash pieces (open polylines; a zero-length dash is a single point). */
export function dashPolyline(pts: number[], closed: boolean, dash: number[], offset: number): number[][] {
  const total = dash.reduce((a, b) => a + b, 0)
  if (!(total > 0)) return [pts]
  const path = closed ? [...pts, pts[0], pts[1]] : pts
  let idx = 0
  let rem = ((offset % total) + total) % total
  while (rem >= dash[idx]) {
    rem -= dash[idx]
    idx = (idx + 1) % dash.length
  }
  let left = dash[idx] - rem // remaining length in the current dash entry
  let on = idx % 2 === 0
  const pieces: number[][] = []
  let cur: number[] | null = on ? [path[0], path[1]] : null
  for (let i = 0; i + 2 < path.length; i += 2) {
    let ax = path[i], ay = path[i + 1]
    const bx = path[i + 2], by = path[i + 3]
    let segLen = Math.hypot(bx - ax, by - ay)
    while (segLen > 0) {
      if (left > segLen) {
        left -= segLen
        if (on) cur!.push(bx, by)
        segLen = 0
      } else {
        const t = left / segLen
        const x = ax + (bx - ax) * t, y = ay + (by - ay) * t
        if (on) {
          cur!.push(x, y)
          pieces.push(cur!)
          cur = null
        } else cur = [x, y]
        on = !on
        idx = (idx + 1) % dash.length
        segLen -= left
        ax = x; ay = y
        left = dash[idx]
        // zero-length dash entries flip immediately
        while (left === 0) {
          if (on) {
            pieces.push([x, y])
            cur = null
          } else cur = [x, y]
          on = !on
          idx = (idx + 1) % dash.length
          left = dash[idx]
        }
      }
    }
  }
  if (on && cur && cur.length >= 2) pieces.push(cur)
  return pieces.map((p) => dedupe(p, false))
}
