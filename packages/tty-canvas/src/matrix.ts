/** A 2D affine matrix compatible with the 2D subset of `DOMMatrix`. */

export interface DOMMatrix2DInit {
  a?: number; b?: number; c?: number; d?: number; e?: number; f?: number
  m11?: number; m12?: number; m21?: number; m22?: number; m41?: number; m42?: number
}

export class DOMMatrix {
  a = 1
  b = 0
  c = 0
  d = 1
  e = 0
  f = 0

  constructor(init?: number[] | DOMMatrix2DInit | string) {
    if (Array.isArray(init)) {
      if (init.length === 6) [this.a, this.b, this.c, this.d, this.e, this.f] = init
      else if (init.length === 16) {
        this.a = init[0]; this.b = init[1]; this.c = init[4]; this.d = init[5]; this.e = init[12]; this.f = init[13]
      } else throw new TypeError('DOMMatrix: expected 6 or 16 values')
    } else if (init && typeof init === 'object') {
      const m = fromInit(init)
      this.a = m[0]; this.b = m[1]; this.c = m[2]; this.d = m[3]; this.e = m[4]; this.f = m[5]
    } else if (typeof init === 'string' && init.trim() && init.trim() !== 'none') {
      const m = /matrix\(([^)]*)\)/.exec(init)
      if (!m) throw new SyntaxError(`DOMMatrix: unsupported transform "${init}"`)
      const v = m[1].split(/[\s,]+/).filter(Boolean).map(Number)
      ;[this.a, this.b, this.c, this.d, this.e, this.f] = v
    }
  }

  get m11() { return this.a } set m11(v) { this.a = v }
  get m12() { return this.b } set m12(v) { this.b = v }
  get m21() { return this.c } set m21(v) { this.c = v }
  get m22() { return this.d } set m22(v) { this.d = v }
  get m41() { return this.e } set m41(v) { this.e = v }
  get m42() { return this.f } set m42(v) { this.f = v }
  get is2D() { return true }
  get isIdentity() {
    return this.a === 1 && this.b === 0 && this.c === 0 && this.d === 1 && this.e === 0 && this.f === 0
  }

  static fromMatrix(init?: DOMMatrix2DInit) {
    return new DOMMatrix(init ?? {})
  }

  toArray(): [number, number, number, number, number, number] {
    return [this.a, this.b, this.c, this.d, this.e, this.f]
  }

  /** this × m (m applied first). */
  multiply(m: DOMMatrix2DInit): DOMMatrix {
    return new DOMMatrix(mul(this.toArray(), fromInit(m)))
  }
  multiplySelf(m: DOMMatrix2DInit): this {
    return this.set(mul(this.toArray(), fromInit(m)))
  }
  preMultiplySelf(m: DOMMatrix2DInit): this {
    return this.set(mul(fromInit(m), this.toArray()))
  }
  translate(tx = 0, ty = 0) { return this.multiply({ e: tx, f: ty }) }
  translateSelf(tx = 0, ty = 0) { return this.multiplySelf({ e: tx, f: ty }) }
  scale(sx = 1, sy = sx) { return this.multiply({ a: sx, d: sy }) }
  scaleSelf(sx = 1, sy = sx) { return this.multiplySelf({ a: sx, d: sy }) }
  /** Rotation in degrees (DOMMatrix semantics). */
  rotate(deg = 0) { return new DOMMatrix(this.toArray()).rotateSelf(deg) }
  rotateSelf(deg = 0) {
    const r = (deg * Math.PI) / 180
    return this.multiplySelf({ a: Math.cos(r), b: Math.sin(r), c: -Math.sin(r), d: Math.cos(r) })
  }
  inverse(): DOMMatrix { return new DOMMatrix(this.toArray()).invertSelf() }
  invertSelf(): this {
    const inv = invert(this.toArray())
    return this.set(inv ?? [NaN, NaN, NaN, NaN, NaN, NaN])
  }
  transformPoint(p: { x?: number; y?: number } = {}) {
    const x = p.x ?? 0
    const y = p.y ?? 0
    return { x: this.a * x + this.c * y + this.e, y: this.b * x + this.d * y + this.f, z: 0, w: 1 }
  }
  toString() {
    return `matrix(${this.a}, ${this.b}, ${this.c}, ${this.d}, ${this.e}, ${this.f})`
  }
  toJSON() {
    const { a, b, c, d, e, f } = this
    return { a, b, c, d, e, f, is2D: true, isIdentity: this.isIdentity }
  }
  private set(m: Mat): this {
    ;[this.a, this.b, this.c, this.d, this.e, this.f] = m
    return this
  }
}

/** [a, b, c, d, e, f] */
export type Mat = [number, number, number, number, number, number]

export const IDENTITY: Readonly<Mat> = [1, 0, 0, 1, 0, 0]

export function fromInit(m: DOMMatrix2DInit): Mat {
  return [m.a ?? m.m11 ?? 1, m.b ?? m.m12 ?? 0, m.c ?? m.m21 ?? 0, m.d ?? m.m22 ?? 1, m.e ?? m.m41 ?? 0, m.f ?? m.m42 ?? 0]
}

/** p × q (q applied first, then p). */
export function mul(p: Readonly<Mat>, q: Readonly<Mat>): Mat {
  return [
    p[0] * q[0] + p[2] * q[1],
    p[1] * q[0] + p[3] * q[1],
    p[0] * q[2] + p[2] * q[3],
    p[1] * q[2] + p[3] * q[3],
    p[0] * q[4] + p[2] * q[5] + p[4],
    p[1] * q[4] + p[3] * q[5] + p[5],
  ]
}

export function invert(m: Readonly<Mat>): Mat | null {
  const det = m[0] * m[3] - m[1] * m[2]
  if (!det || !Number.isFinite(det)) return null
  const id = 1 / det
  return [m[3] * id, -m[1] * id, -m[2] * id, m[0] * id, (m[2] * m[5] - m[3] * m[4]) * id, (m[1] * m[4] - m[0] * m[5]) * id]
}

export function isFiniteMat(m: Readonly<Mat>) {
  return m.every(Number.isFinite)
}

/** Approximate uniform scale factor of a matrix (for curve flattening tolerances). */
export function matScale(m: Readonly<Mat>) {
  return Math.sqrt(Math.max(Math.abs(m[0] * m[3] - m[1] * m[2]), 1e-12)) || 1
}
