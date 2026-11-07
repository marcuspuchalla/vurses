/**
 * Anti-aliased polygon scan conversion.
 *
 * Each pixel row is sampled at `SUB` sub-scanlines; on every sub-scanline the
 * crossings are sorted and the inside spans (nonzero or evenodd) are added
 * with exact fractional horizontal coverage. This handles self-intersecting
 * and overlapping polygons correctly for both fill rules (unlike signed-area
 * accumulation), which also makes it suitable for stroke outlines built as a
 * union of pieces.
 */
import type { Polyline } from './path.js'

export type FillRule = 'nonzero' | 'evenodd'

/** Number of vertical samples per pixel. */
export const SUB = 6

/** Row callback: `cov[x]` for x in [x0, x1) holds coverage in [0, 1]. */
export type RowEmitter = (y: number, x0: number, x1: number, cov: Float32Array) => void

interface EdgeList {
  n: number
  ytop: Float64Array
  ybot: Float64Array
  x0: Float64Array
  dxdy: Float64Array
  dir: Int8Array
}

function buildEdges(polys: Polyline[]): EdgeList {
  let count = 0
  for (const p of polys) count += p.pts.length / 2
  const e: EdgeList = {
    n: 0,
    ytop: new Float64Array(count),
    ybot: new Float64Array(count),
    x0: new Float64Array(count),
    dxdy: new Float64Array(count),
    dir: new Int8Array(count),
  }
  for (const p of polys) {
    const pts = p.pts
    const n = pts.length / 2
    if (n < 2) continue
    for (let i = 0; i < n; i++) {
      const j = i + 1 === n ? 0 : i + 1
      let ax = pts[i * 2], ay = pts[i * 2 + 1]
      let bx = pts[j * 2], by = pts[j * 2 + 1]
      if (ay === by || !Number.isFinite(ax + ay + bx + by)) continue
      let dir = 1
      if (ay > by) {
        ;[ax, bx] = [bx, ax]
        ;[ay, by] = [by, ay]
        dir = -1
      }
      const k = e.n++
      e.ytop[k] = ay
      e.ybot[k] = by
      e.x0[k] = ax
      e.dxdy[k] = (bx - ax) / (by - ay)
      e.dir[k] = dir
    }
  }
  return e
}

let covBuf = new Float32Array(0)

/**
 * Rasterizes polygons (implicitly closed) into rows of coverage.
 * `clipRect` limits the rows/columns processed (defaults to the full surface).
 */
export function rasterize(polys: Polyline[], width: number, height: number, rule: FillRule, emit: RowEmitter) {
  const e = buildEdges(polys)
  if (!e.n || width <= 0 || height <= 0) return
  // sort edge indices by ytop
  const order = new Uint32Array(e.n)
  for (let i = 0; i < e.n; i++) order[i] = i
  order.sort((a, b) => e.ytop[a] - e.ytop[b])
  let ymin = Infinity, ymax = -Infinity
  for (let i = 0; i < e.n; i++) {
    if (e.ytop[i] < ymin) ymin = e.ytop[i]
    if (e.ybot[i] > ymax) ymax = e.ybot[i]
  }
  const y0 = Math.max(0, Math.floor(ymin))
  const y1 = Math.min(height, Math.ceil(ymax))
  if (y0 >= y1) return
  if (covBuf.length < width + 2) covBuf = new Float32Array(width + 2)
  const cov = covBuf
  const active: number[] = []
  const xs: number[] = []
  const ds: number[] = []
  let next = 0
  const w = 1 / SUB
  const evenodd = rule === 'evenodd'
  for (let y = y0; y < y1; y++) {
    let minX = width, maxX = 0
    for (let s = 0; s < SUB; s++) {
      const sy = y + (s + 0.5) * w
      while (next < e.n && e.ytop[order[next]] <= sy) active.push(order[next++])
      // collect crossings and drop finished edges
      xs.length = 0
      ds.length = 0
      for (let k = active.length - 1; k >= 0; k--) {
        const id = active[k]
        if (e.ybot[id] <= sy) {
          active[k] = active[active.length - 1]
          active.pop()
          continue
        }
        if (e.ytop[id] > sy) continue
        const x = e.x0[id] + (sy - e.ytop[id]) * e.dxdy[id]
        // insertion sort
        let j = xs.length
        xs.push(x)
        ds.push(e.dir[id])
        while (j > 0 && xs[j - 1] > x) {
          xs[j] = xs[j - 1]
          ds[j] = ds[j - 1]
          j--
        }
        xs[j] = x
        ds[j] = e.dir[id]
      }
      let wind = 0
      let start = 0
      for (let k = 0; k < xs.length; k++) {
        const before = evenodd ? (wind & 1) !== 0 : wind !== 0
        wind += ds[k]
        const after = evenodd ? (wind & 1) !== 0 : wind !== 0
        if (!before && after) start = xs[k]
        else if (before && !after) {
          // add span [start, xs[k])
          const xa = start < 0 ? 0 : start
          const xb = xs[k] > width ? width : xs[k]
          if (xb <= xa) continue
          const ia = Math.floor(xa)
          const ib = Math.floor(xb)
          if (ia < minX) minX = ia
          if (ib + 1 > maxX) maxX = Math.min(width, ib + 1)
          if (ia === ib) {
            cov[ia] += (xb - xa) * w
          } else {
            cov[ia] += (ia + 1 - xa) * w
            for (let i = ia + 1; i < ib; i++) cov[i] += w
            if (ib < width) cov[ib] += (xb - ib) * w
          }

        }
      }
    }
    if (maxX > minX) {
      for (let i = minX; i < maxX; i++) if (cov[i] > 1) cov[i] = 1
      emit(y, minX, maxX, cov)
      cov.fill(0, minX, maxX)
    }
  }
}

/** Rasterizes into a full-surface coverage mask. */
export function rasterizeMask(polys: Polyline[], width: number, height: number, rule: FillRule): Float32Array {
  const mask = new Float32Array(width * height)
  rasterize(polys, width, height, rule, (y, x0, x1, cov) => {
    const o = y * width
    for (let x = x0; x < x1; x++) mask[o + x] = cov[x]
  })
  return mask
}

/** Winding number of the point (x, y) against polygons (implicitly closed). */
export function windingAt(polys: Polyline[], x: number, y: number): { wind: number; crossings: number } {
  let wind = 0
  let crossings = 0
  for (const p of polys) {
    const pts = p.pts
    const n = pts.length / 2
    if (n < 2) continue
    for (let i = 0; i < n; i++) {
      const j = i + 1 === n ? 0 : i + 1
      const ax = pts[i * 2], ay = pts[i * 2 + 1]
      const bx = pts[j * 2], by = pts[j * 2 + 1]
      if (ay <= y ? by > y : by <= y) {
        const t = (y - ay) / (by - ay)
        const cx = ax + t * (bx - ax)
        if (cx > x) {
          wind += by > ay ? 1 : -1
          crossings++
        }
      }
    }
  }
  return { wind, crossings }
}

/** True when (x, y) lies on (within eps of) a polygon edge. */
export function onEdge(polys: Polyline[], x: number, y: number, eps = 1e-6): boolean {
  for (const p of polys) {
    const pts = p.pts
    const n = pts.length / 2
    for (let i = 0; i < n; i++) {
      const j = i + 1 === n ? 0 : i + 1
      const ax = pts[i * 2], ay = pts[i * 2 + 1]
      const bx = pts[j * 2], by = pts[j * 2 + 1]
      const dx = bx - ax, dy = by - ay
      const l2 = dx * dx + dy * dy
      const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0
      if (Math.hypot(ax + t * dx - x, ay + t * dy - y) <= eps) return true
    }
  }
  return false
}
