/** The `ImageData` interface: non-premultiplied RGBA, row-major. */

export type PredefinedColorSpace = 'srgb' | 'display-p3'

export interface ImageDataSettings {
  colorSpace?: PredefinedColorSpace
}

function indexSizeError(msg: string) {
  const e = new Error(msg)
  e.name = 'IndexSizeError'
  return e
}

export class ImageData {
  readonly width: number
  readonly height: number
  readonly data: Uint8ClampedArray
  readonly colorSpace: PredefinedColorSpace = 'srgb'

  constructor(sw: number, sh: number, settings?: ImageDataSettings)
  constructor(data: Uint8ClampedArray, sw: number, sh?: number, settings?: ImageDataSettings)
  constructor(a: number | Uint8ClampedArray, b: number, c?: number | ImageDataSettings, d?: ImageDataSettings) {
    if (typeof a === 'number') {
      const w = Math.trunc(a), h = Math.trunc(b)
      if (!(w > 0) || !(h > 0)) throw indexSizeError(`The source ${!(w > 0) ? 'width' : 'height'} is zero or not a number.`)
      this.width = w
      this.height = h
      this.data = new Uint8ClampedArray(w * h * 4)
      if (c && typeof c === 'object' && c.colorSpace) this.colorSpace = c.colorSpace
    } else {
      if (!a || typeof a.length !== 'number') throw new TypeError('ImageData: data must be a Uint8ClampedArray')
      const len = a.length
      if (len === 0 || len % 4) throw indexSizeError('The input data has a zero byte length or is not a multiple of 4.')
      const w = Math.trunc(b)
      if (!(w > 0)) throw indexSizeError('The source width is zero or not a number.')
      const pixels = len / 4
      if (pixels % w) throw indexSizeError('The input data length is not a multiple of (4 * width).')
      const h = typeof c === 'number' ? Math.trunc(c) : pixels / w
      if (h * w !== pixels) throw indexSizeError('The input data length is not equal to (4 * width * height).')
      this.width = w
      this.height = h
      this.data = a
      const s = typeof c === 'object' ? c : d
      if (s?.colorSpace) this.colorSpace = s.colorSpace
    }
  }
}

/** Anything with RGBA pixels: ImageData, a Canvas, a decoded Image. */
export interface PixelSource {
  width: number
  height: number
  data: Uint8ClampedArray | Uint8Array
}
