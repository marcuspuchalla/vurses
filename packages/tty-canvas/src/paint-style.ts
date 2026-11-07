/** Fill / stroke paint: CanvasGradient, CanvasPattern and the shaders that evaluate them per pixel. */
import { parseColor } from './color.js'
import { fromInit, invert, type DOMMatrix2DInit, type Mat } from './matrix.js'
import type { PixelSource } from './image-data.js'

function domError(name: string, message: string) {
  const e = new Error(message)
  e.name = name
  return e
}

type GradientKind =
  | { type: 'linear'; x0: number; y0: number; x1: number; y1: number }
  | { type: 'radial'; x0: number; y0: number; r0: number; x1: number; y1: number; r1: number }
  | { type: 'conic'; angle: number; x: number; y: number }

const LUT_SIZE = 1024

export class CanvasGradient {
  /** @internal */ _kind: GradientKind
  /** @internal */ _stops: { offset: number; color: [number, number, number, number] }[] = []
  private lut: Float32Array | null = null

  /** @internal Use ctx.createLinearGradient / createRadialGradient / createConicGradient. */
  constructor(kind: GradientKind) {
    this._kind = kind
  }

  addColorStop(offset: number, color: string) {
    offset = Number(offset)
    if (!(offset >= 0 && offset <= 1)) throw domError('IndexSizeError', `The provided value (${offset}) is outside the range (0.0, 1.0).`)
    const c = parseColor(String(color))
    if (!c) throw domError('SyntaxError', `The value provided ('${color}') could not be parsed as a color.`)
    let i = this._stops.length
    while (i > 0 && this._stops[i - 1].offset > offset) i--
    this._stops.splice(i, 0, { offset, color: c })
    this.lut = null
  }

  /** @internal Premultiplied RGBA lookup table (0..1). */
  _lut(): Float32Array {
    if (this.lut) return this.lut
    const lut = new Float32Array(LUT_SIZE * 4)
    const stops = this._stops
    for (let i = 0; i < LUT_SIZE; i++) {
      const t = i / (LUT_SIZE - 1)
      let r = 0, g = 0, b = 0, a = 0
      if (stops.length) {
        let A = stops[0], B = stops[0], f = 0
        if (t >= stops[stops.length - 1].offset) A = B = stops[stops.length - 1]
        else if (t > stops[0].offset) {
          let k = 0
          while (stops[k].offset <= t) k++ // stops[k-1].offset <= t < stops[k].offset
          A = stops[k - 1]
          B = stops[k]
          f = (t - A.offset) / (B.offset - A.offset)
        }
        const aa = A.color[3], ba = B.color[3]
        a = aa + (ba - aa) * f
        r = (A.color[0] / 255) * aa * (1 - f) + (B.color[0] / 255) * ba * f
        g = (A.color[1] / 255) * aa * (1 - f) + (B.color[1] / 255) * ba * f
        b = (A.color[2] / 255) * aa * (1 - f) + (B.color[2] / 255) * ba * f
      }
      lut[i * 4] = r
      lut[i * 4 + 1] = g
      lut[i * 4 + 2] = b
      lut[i * 4 + 3] = a
    }
    this.lut = lut
    return lut
  }
}

export type Repetition = 'repeat' | 'repeat-x' | 'repeat-y' | 'no-repeat'

export class CanvasPattern {
  /** @internal */ _image: { width: number; height: number; data: Uint8ClampedArray }
  /** @internal */ _repeat: Repetition
  /** @internal */ _matrix: Mat = [1, 0, 0, 1, 0, 0]

  /** @internal Use ctx.createPattern. */
  constructor(image: { width: number; height: number; data: Uint8ClampedArray }, repetition: Repetition) {
    this._image = image
    this._repeat = repetition
  }

  setTransform(transform?: DOMMatrix2DInit) {
    const m = fromInit(transform ?? {})
    if (m.every(Number.isFinite)) this._matrix = m
  }
}

export function parseRepetition(r: string | null | undefined): Repetition {
  if (r === null || r === undefined || r === '') return 'repeat'
  if (r === 'repeat' || r === 'repeat-x' || r === 'repeat-y' || r === 'no-repeat') return r
  throw domError('SyntaxError', `The provided type ('${r}') is not one of 'repeat', 'repeat-x', 'repeat-y', or 'no-repeat'.`)
}

// ---------------------------------------------------------------- shaders

/** Fills `out[(x - x0) * 4 ...]` with premultiplied RGBA (0..1) for pixels x0..x1-1 of row y. */
export interface Shader {
  /** Constant premultiplied color when the paint is a solid color. */
  solid: [number, number, number, number] | null
  row(y: number, x0: number, x1: number, out: Float32Array): void
}

export function solidShader(c: [number, number, number, number], alpha = 1): Shader {
  const a = c[3] * alpha
  const s: [number, number, number, number] = [(c[0] / 255) * a, (c[1] / 255) * a, (c[2] / 255) * a, a]
  return {
    solid: s,
    row(_y, x0, x1, out) {
      for (let i = 0, n = x1 - x0; i < n; i++) {
        out[i * 4] = s[0]
        out[i * 4 + 1] = s[1]
        out[i * 4 + 2] = s[2]
        out[i * 4 + 3] = s[3]
      }
    },
  }
}

const transparentShader: Shader = {
  solid: [0, 0, 0, 0],
  row(_y, x0, x1, out) {
    out.fill(0, 0, (x1 - x0) * 4)
  },
}

/** `m` is the current transform (user → device) at the time of drawing. */
export function gradientShader(g: CanvasGradient, m: Mat): Shader {
  const inv = invert(m)
  if (!inv || !g._stops.length) return transparentShader
  const lut = g._lut()
  const k = g._kind
  let param: (ux: number, uy: number) => number // returns t or NaN (transparent)
  if (k.type === 'linear') {
    const dx = k.x1 - k.x0, dy = k.y1 - k.y0
    const l2 = dx * dx + dy * dy
    if (!l2) return transparentShader
    param = (ux, uy) => ((ux - k.x0) * dx + (uy - k.y0) * dy) / l2
  } else if (k.type === 'radial') {
    const cdx = k.x1 - k.x0, cdy = k.y1 - k.y0, dr = k.r1 - k.r0
    if (!cdx && !cdy && !dr) return transparentShader
    const a = cdx * cdx + cdy * cdy - dr * dr
    param = (ux, uy) => {
      const pdx = ux - k.x0, pdy = uy - k.y0
      const b = pdx * cdx + pdy * cdy + k.r0 * dr
      const c = pdx * pdx + pdy * pdy - k.r0 * k.r0
      if (Math.abs(a) < 1e-12) {
        if (!b) return NaN
        const w = c / (2 * b)
        return k.r0 + w * dr >= 0 ? w : NaN
      }
      const disc = b * b - a * c
      if (disc < 0) return NaN
      const sq = Math.sqrt(disc)
      const w1 = (b + sq) / a
      const w2 = (b - sq) / a
      const hi = Math.max(w1, w2), lo = Math.min(w1, w2)
      if (k.r0 + hi * dr >= 0) return hi
      if (k.r0 + lo * dr >= 0) return lo
      return NaN
    }
  } else {
    const TAU = Math.PI * 2
    param = (ux, uy) => {
      let t = (Math.atan2(uy - k.y, ux - k.x) - k.angle) / TAU
      t -= Math.floor(t)
      return t
    }
  }
  const max = LUT_SIZE - 1
  return {
    solid: null,
    row(y, x0, x1, out) {
      const py = y + 0.5
      for (let x = x0, i = 0; x < x1; x++, i += 4) {
        const px = x + 0.5
        const t = param(inv[0] * px + inv[2] * py + inv[4], inv[1] * px + inv[3] * py + inv[5])
        if (t !== t) {
          out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0
          continue
        }
        const li = (t <= 0 ? 0 : t >= 1 ? max : Math.round(t * max)) * 4
        out[i] = lut[li]
        out[i + 1] = lut[li + 1]
        out[i + 2] = lut[li + 2]
        out[i + 3] = lut[li + 3]
      }
    },
  }
}

export type Wrap = 'repeat' | 'clamp' | 'none'

/**
 * Samples a premultiplied color from non-premultiplied RGBA pixels at (u, v)
 * (pixel space, pixel centers at .5). Writes into out[o..o+3].
 */
export function sampleImage(
  img: PixelSource, u: number, v: number, smooth: boolean, wrapX: Wrap, wrapY: Wrap, out: Float32Array, o: number,
  rx = 0, ry = 0, rw = img.width, rh = img.height,
) {
  const d = img.data
  const W = img.width
  if (!smooth) {
    let ix = Math.floor(u), iy = Math.floor(v)
    ix = wrap(ix, rx, rw, wrapX)
    iy = wrap(iy, ry, rh, wrapY)
    if (ix < 0 || iy < 0) {
      out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0
      return
    }
    const p = (iy * W + ix) * 4
    const a = d[p + 3] / 255
    out[o] = (d[p] / 255) * a
    out[o + 1] = (d[p + 1] / 255) * a
    out[o + 2] = (d[p + 2] / 255) * a
    out[o + 3] = a
    return
  }
  const fu = u - 0.5, fv = v - 0.5
  const x0 = Math.floor(fu), y0 = Math.floor(fv)
  const tx = fu - x0, ty = fv - y0
  let r = 0, g = 0, b = 0, a = 0
  for (let j = 0; j < 2; j++) {
    const yy = wrap(y0 + j, ry, rh, wrapY)
    const wy = j ? ty : 1 - ty
    for (let i = 0; i < 2; i++) {
      const wgt = wy * (i ? tx : 1 - tx)
      if (!wgt) continue
      const xx = wrap(x0 + i, rx, rw, wrapX)
      if (xx < 0 || yy < 0) continue
      const p = (yy * W + xx) * 4
      const pa = (d[p + 3] / 255) * wgt
      r += (d[p] / 255) * pa
      g += (d[p + 1] / 255) * pa
      b += (d[p + 2] / 255) * pa
      a += pa
    }
  }
  out[o] = r
  out[o + 1] = g
  out[o + 2] = b
  out[o + 3] = a
}

/** Maps an integer coordinate into [start, start+size) per wrap mode; -1 = transparent. */
function wrap(i: number, start: number, size: number, mode: Wrap): number {
  const rel = i - start
  if (rel >= 0 && rel < size) return i
  if (mode === 'repeat') return start + (((rel % size) + size) % size)
  if (mode === 'clamp') return rel < 0 ? start : start + size - 1
  return -1
}

export function patternShader(p: CanvasPattern, m: Mat, smooth: boolean): Shader {
  const full = invert(mulMat(m, p._matrix))
  const img = p._image
  if (!full || !img.width || !img.height) return transparentShader
  const wx: Wrap = p._repeat === 'repeat' || p._repeat === 'repeat-x' ? 'repeat' : 'none'
  const wy: Wrap = p._repeat === 'repeat' || p._repeat === 'repeat-y' ? 'repeat' : 'none'
  return {
    solid: null,
    row(y, x0, x1, out) {
      const py = y + 0.5
      for (let x = x0, i = 0; x < x1; x++, i += 4) {
        const px = x + 0.5
        sampleImage(img, full[0] * px + full[2] * py + full[4], full[1] * px + full[3] * py + full[5], smooth, wx, wy, out, i)
      }
    },
  }
}

/**
 * Shader for drawImage: maps device pixels back to source-image pixels.
 * `m` maps source pixel space → device space; sampling is clamped to the source rect.
 */
export function imageShader(img: PixelSource, m: Mat, smooth: boolean, sx: number, sy: number, sw: number, sh: number): Shader {
  const inv = invert(m)
  if (!inv) return transparentShader
  const rx = Math.max(0, Math.floor(sx)), ry = Math.max(0, Math.floor(sy))
  const rw = Math.min(img.width, Math.ceil(sx + sw)) - rx
  const rh = Math.min(img.height, Math.ceil(sy + sh)) - ry
  if (rw <= 0 || rh <= 0) return transparentShader
  return {
    solid: null,
    row(y, x0, x1, out) {
      const py = y + 0.5
      for (let x = x0, i = 0; x < x1; x++, i += 4) {
        const px = x + 0.5
        sampleImage(img, inv[0] * px + inv[2] * py + inv[4], inv[1] * px + inv[3] * py + inv[5], smooth, 'clamp', 'clamp', out, i, rx, ry, rw, rh)
      }
    },
  }
}

function mulMat(p: Mat, q: Mat): Mat {
  return [
    p[0] * q[0] + p[2] * q[1], p[1] * q[0] + p[3] * q[1],
    p[0] * q[2] + p[2] * q[3], p[1] * q[2] + p[3] * q[3],
    p[0] * q[4] + p[2] * q[5] + p[4], p[1] * q[4] + p[3] * q[5] + p[5],
  ]
}
