/** Porter-Duff compositing and W3C blend modes on non-premultiplied RGBA8 storage. */

export type CompositeOperation =
  | 'source-over' | 'source-in' | 'source-out' | 'source-atop'
  | 'destination-over' | 'destination-in' | 'destination-out' | 'destination-atop'
  | 'lighter' | 'copy' | 'xor'
  | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'color-dodge' | 'color-burn'
  | 'hard-light' | 'soft-light' | 'difference' | 'exclusion' | 'hue' | 'saturation' | 'color' | 'luminosity'

export const COMPOSITE_OPS: ReadonlySet<string> = new Set<CompositeOperation>([
  'source-over', 'source-in', 'source-out', 'source-atop', 'destination-over', 'destination-in', 'destination-out',
  'destination-atop', 'lighter', 'copy', 'xor', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge',
  'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity',
])

/** Operations that modify the destination where the source is transparent (they clear outside the shape). */
export const UNBOUNDED: ReadonlySet<string> = new Set(['source-in', 'source-out', 'destination-in', 'destination-atop', 'copy'])

type PD = (sa: number, da: number) => [number, number]
const PORTER_DUFF: Record<string, PD> = {
  'source-over': (sa) => [1, 1 - sa],
  'destination-over': (_sa, da) => [1 - da, 1],
  'source-in': (_sa, da) => [da, 0],
  'source-out': (_sa, da) => [1 - da, 0],
  'source-atop': (sa, da) => [da, 1 - sa],
  'destination-in': (sa) => [0, sa],
  'destination-out': (sa) => [0, 1 - sa],
  'destination-atop': (sa, da) => [1 - da, sa],
  copy: () => [1, 0],
  xor: (sa, da) => [1 - da, 1 - sa],
}

type Sep = (cb: number, cs: number) => number
const SEPARABLE: Record<string, Sep> = {
  multiply: (b, s) => b * s,
  screen: (b, s) => b + s - b * s,
  overlay: (b, s) => hardLight(s, b),
  darken: (b, s) => Math.min(b, s),
  lighten: (b, s) => Math.max(b, s),
  'color-dodge': (b, s) => (b === 0 ? 0 : s >= 1 ? 1 : Math.min(1, b / (1 - s))),
  'color-burn': (b, s) => (b >= 1 ? 1 : s <= 0 ? 0 : 1 - Math.min(1, (1 - b) / s)),
  'hard-light': (b, s) => hardLight(b, s),
  'soft-light': (b, s) => {
    if (s <= 0.5) return b - (1 - 2 * s) * b * (1 - b)
    const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b)
    return b + (2 * s - 1) * (d - b)
  },
  difference: (b, s) => Math.abs(b - s),
  exclusion: (b, s) => b + s - 2 * b * s,
}

function hardLight(b: number, s: number) {
  return s <= 0.5 ? b * 2 * s : SEPARABLE.screen(b, 2 * s - 1)
}

// non-separable helpers (W3C compositing level 1)
const lum = (r: number, g: number, b: number) => 0.3 * r + 0.59 * g + 0.11 * b
function clipColor(r: number, g: number, b: number): [number, number, number] {
  const l = lum(r, g, b)
  const n = Math.min(r, g, b), x = Math.max(r, g, b)
  if (n < 0) {
    r = l + ((r - l) * l) / (l - n); g = l + ((g - l) * l) / (l - n); b = l + ((b - l) * l) / (l - n)
  }
  if (x > 1) {
    r = l + ((r - l) * (1 - l)) / (x - l); g = l + ((g - l) * (1 - l)) / (x - l); b = l + ((b - l) * (1 - l)) / (x - l)
  }
  return [r, g, b]
}
function setLum(r: number, g: number, b: number, l: number) {
  const d = l - lum(r, g, b)
  return clipColor(r + d, g + d, b + d)
}
const sat = (r: number, g: number, b: number) => Math.max(r, g, b) - Math.min(r, g, b)
function setSat(r: number, g: number, b: number, s: number): [number, number, number] {
  const c = [r, g, b]
  const idx = [0, 1, 2].sort((i, j) => c[i] - c[j])
  const [mn, md, mx] = idx
  const out = [0, 0, 0]
  if (c[mx] > c[mn]) {
    out[md] = ((c[md] - c[mn]) * s) / (c[mx] - c[mn])
    out[mx] = s
  }
  out[mn] = 0
  return out as [number, number, number]
}
type NonSep = (br: number, bg: number, bb: number, sr: number, sg: number, sb: number) => [number, number, number]
const NON_SEPARABLE: Record<string, NonSep> = {
  hue: (br, bg, bb, sr, sg, sb) => setLum(...setSat(sr, sg, sb, sat(br, bg, bb)), lum(br, bg, bb)),
  saturation: (br, bg, bb, sr, sg, sb) => setLum(...setSat(br, bg, bb, sat(sr, sg, sb)), lum(br, bg, bb)),
  color: (br, bg, bb, sr, sg, sb) => setLum(sr, sg, sb, lum(br, bg, bb)),
  luminosity: (br, bg, bb, sr, sg, sb) => setLum(br, bg, bb, lum(sr, sg, sb)),
}

/**
 * Composites a row of premultiplied source pixels (0..1) onto `data`.
 * - `src[(x - x0) * 4 + c]` source for pixel x
 * - `cov[x]` coverage (null = 1), multiplied by `alpha`
 * - `clip` full-surface clip mask (null = no clip)
 */
export function compositeRow(
  data: Uint8ClampedArray, width: number, y: number, x0: number, x1: number,
  src: Float32Array, cov: Float32Array | null, alpha: number, op: string, clip: Float32Array | null,
) {
  const unbounded = UNBOUNDED.has(op)
  const row = y * width
  if (op === 'source-over') {
    for (let x = x0; x < x1; x++) {
      let k = alpha * (cov ? cov[x] : 1)
      if (clip) k *= clip[row + x]
      if (k <= 0) continue
      const s = (x - x0) * 4
      const sa = src[s + 3] * k
      if (sa <= 0) continue
      const p = (row + x) * 4
      if (sa >= 0.999999) {
        data[p] = (src[s] * k / sa) * 255
        data[p + 1] = (src[s + 1] * k / sa) * 255
        data[p + 2] = (src[s + 2] * k / sa) * 255
        data[p + 3] = 255
        continue
      }
      const da = data[p + 3] / 255
      const fb = da * (1 - sa)
      const ao = sa + fb
      const inv = 255 / ao
      data[p] = (src[s] * k + (data[p] / 255) * fb) * inv
      data[p + 1] = (src[s + 1] * k + (data[p + 1] / 255) * fb) * inv
      data[p + 2] = (src[s + 2] * k + (data[p + 2] / 255) * fb) * inv
      data[p + 3] = ao * 255
    }
    return
  }
  const pd = PORTER_DUFF[op]
  const sep = SEPARABLE[op]
  const nonsep = NON_SEPARABLE[op]
  for (let x = x0; x < x1; x++) {
    const c = cov ? cov[x] : 1
    const cl = clip ? clip[row + x] : 1
    // bounded ops: fold the clip into the coverage; unbounded: lerp afterwards
    const k = alpha * c * (unbounded ? 1 : cl)
    if (!unbounded && k <= 0) continue
    if (unbounded && cl <= 0) continue
    const s = (x - x0) * 4
    const sr = src[s] * k, sg = src[s + 1] * k, sb = src[s + 2] * k, sa = src[s + 3] * k
    const p = (row + x) * 4
    const da = data[p + 3] / 255
    const dr = (data[p] / 255) * da, dg = (data[p + 1] / 255) * da, db = (data[p + 2] / 255) * da
    let ro: number, go: number, bo: number, ao: number
    if (pd) {
      const [fa, fb] = pd(sa, da)
      ro = sr * fa + dr * fb
      go = sg * fa + dg * fb
      bo = sb * fa + db * fb
      ao = sa * fa + da * fb
    } else if (op === 'lighter') {
      ao = Math.min(1, sa + da)
      ro = Math.min(1, sr + dr)
      go = Math.min(1, sg + dg)
      bo = Math.min(1, sb + db)
    } else {
      if (sa <= 0) continue
      ao = sa + da - sa * da
      const csr = sr / sa, csg = sg / sa, csb = sb / sa
      const cbr = da > 0 ? dr / da : 0, cbg = da > 0 ? dg / da : 0, cbb = da > 0 ? db / da : 0
      let br: number, bg: number, bb: number
      if (sep) {
        br = sep(cbr, csr); bg = sep(cbg, csg); bb = sep(cbb, csb)
      } else if (nonsep) {
        ;[br, bg, bb] = nonsep(cbr, cbg, cbb, csr, csg, csb)
      } else {
        br = csr; bg = csg; bb = csb
      }
      ro = sr * (1 - da) + dr * (1 - sa) + sa * da * br
      go = sg * (1 - da) + dg * (1 - sa) + sa * da * bg
      bo = sb * (1 - da) + db * (1 - sa) + sa * da * bb
    }
    if (unbounded && cl < 1) {
      ro = dr + (ro - dr) * cl
      go = dg + (go - dg) * cl
      bo = db + (bo - db) * cl
      ao = da + (ao - da) * cl
    }
    if (ao <= 0) {
      data[p] = data[p + 1] = data[p + 2] = data[p + 3] = 0
      continue
    }
    const inv = 255 / ao
    data[p] = ro * inv
    data[p + 1] = go * inv
    data[p + 2] = bo * inv
    data[p + 3] = ao * 255
  }
}
