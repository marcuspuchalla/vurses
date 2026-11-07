/** The `Canvas` element (HTMLCanvasElement work-alike) backed by an RGBA8 bitmap. */
import { CanvasRenderingContext2D, type CanvasRenderingContext2DSettings } from './context.js'
import { Element } from './element.js'
import { ImageData } from './image-data.js'
import { encodePng } from './png.js'

const MAX_DIM = 32767

function base64(bytes: Uint8Array): string {
  const g = globalThis as { Buffer?: { from(b: Uint8Array): { toString(enc: string): string } }; btoa?: (s: string) => string }
  if (g.Buffer) return g.Buffer.from(bytes).toString('base64')
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return g.btoa!(s)
}

export class Canvas extends Element {
  /** @internal */ _w: number
  /** @internal */ _h: number
  /** @internal */ _data: Uint8ClampedArray
  /** @internal */ _ctx: CanvasRenderingContext2D | null = null
  /** Incremented whenever the bitmap changes (drawing, resize). */
  version = 0
  private _subs = new Set<(canvas: Canvas) => void>()

  constructor(width = 300, height = 150) {
    super('canvas')
    this._w = clampDim(width, 300)
    this._h = clampDim(height, 150)
    this._data = new Uint8ClampedArray(this._w * this._h * 4)
  }

  get width() { return this._w }
  set width(v: number) {
    this._w = clampDim(v, 300)
    this._resetBitmap()
  }
  get height() { return this._h }
  set height(v: number) {
    this._h = clampDim(v, 150)
    this._resetBitmap()
  }

  /** The raw non-premultiplied RGBA pixels (non-standard; live view). */
  get data(): Uint8ClampedArray {
    return this._data
  }

  override setAttribute(name: string, value: string) {
    super.setAttribute(name, value)
    const n = name.toLowerCase()
    if (n === 'width') this.width = parseInt(value, 10)
    if (n === 'height') this.height = parseInt(value, 10)
  }

  getContext(type: '2d', settings?: CanvasRenderingContext2DSettings): CanvasRenderingContext2D
  getContext(type: string, settings?: CanvasRenderingContext2DSettings): CanvasRenderingContext2D | null
  getContext(type: string, settings?: CanvasRenderingContext2DSettings): CanvasRenderingContext2D | null {
    if (type !== '2d') return null
    if (!this._ctx) this._ctx = new CanvasRenderingContext2D(this, settings)
    return this._ctx
  }

  /** PNG-encodes the bitmap. Other types fall back to PNG, like browsers do for unsupported types. */
  toBuffer(_type = 'image/png'): Uint8Array {
    const png = encodePng(this._data, this._w, this._h)
    const B = (globalThis as { Buffer?: { from(b: Uint8Array): Uint8Array } }).Buffer
    return B ? B.from(png) : png
  }

  toDataURL(_type = 'image/png', _quality?: number): string {
    if (!this._w || !this._h) return 'data:,'
    return 'data:image/png;base64,' + base64(encodePng(this._data, this._w, this._h))
  }

  toBlob(callback: (blob: unknown) => void, type = 'image/png') {
    const B = (globalThis as { Blob?: new (parts: unknown[], o: { type: string }) => unknown }).Blob
    const png = encodePng(this._data, this._w, this._h)
    queueMicrotask(() => callback(B ? new B([png], { type: 'image/png' }) : null))
    void type
  }

  /** A copy of the pixels as ImageData (non-standard convenience). */
  toImageData(): ImageData {
    return new ImageData(new Uint8ClampedArray(this._data), Math.max(1, this._w), Math.max(1, this._h))
  }

  /** Calls `fn` (synchronously) after every change to the bitmap. Returns an unsubscribe function. */
  subscribe(fn: (canvas: Canvas) => void): () => void {
    this._subs.add(fn)
    return () => this._subs.delete(fn)
  }

  /** @internal Called by the context after drawing. */
  _touch() {
    this.version++
    if (this._subs.size) for (const fn of this._subs) fn(this)
  }

  /** @internal */
  _resetBitmap() {
    this._data = new Uint8ClampedArray(this._w * this._h * 4)
    this._ctx?._resetState()
    this._touch()
  }

  /** @internal Resizes while keeping the existing pixels (top-left anchored). Non-standard. */
  _resizeKeep(w: number, h: number) {
    w = clampDim(w, 300)
    h = clampDim(h, 150)
    if (w === this._w && h === this._h) return
    const old = this._data, ow = this._w, oh = this._h
    const next = new Uint8ClampedArray(w * h * 4)
    const cw = Math.min(w, ow), ch = Math.min(h, oh)
    for (let y = 0; y < ch; y++) next.set(old.subarray(y * ow * 4, (y * ow + cw) * 4), y * w * 4)
    this._w = w
    this._h = h
    this._data = next
    this._ctx?._resizeClip()
    this._touch()
  }

  override _defaultRect() {
    // the canvas' CSS size defaults to its bitmap size
    const sw = parseFloat(this.style.width) || this._w
    const sh = parseFloat(this.style.height) || this._h
    return { x: 0, y: 0, width: sw, height: sh }
  }
}

function clampDim(v: number, fallback: number) {
  const n = Math.floor(Number(v))
  if (!Number.isFinite(n) || n < 0) return fallback
  return Math.min(MAX_DIM, n)
}

/** Creates a canvas (node-canvas style helper). */
export function createCanvas(width: number, height: number): Canvas {
  return new Canvas(width, height)
}
