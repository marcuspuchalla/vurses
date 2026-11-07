/** `Image` (HTMLImageElement) and `loadImage()`: PNG decoding from files, buffers, data: URLs and http(s). */
import { Element } from './element.js'
import { Event } from './events.js'
import { ImageData } from './image-data.js'
import { decodePng, isPng } from './png.js'

export type ImageSource = string | URL | Uint8Array | ArrayBuffer

function base64ToBytes(b64: string): Uint8Array {
  const g = globalThis as { Buffer?: { from(s: string, enc: string): Uint8Array }; atob?: (s: string) => string }
  if (g.Buffer) return new Uint8Array(g.Buffer.from(b64, 'base64'))
  const bin = g.atob!(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Decodes image file bytes (PNG) into ImageData. */
export function decodeImage(bytes: Uint8Array): ImageData {
  if (isPng(bytes)) {
    const d = decodePng(bytes)
    return new ImageData(d.data, d.width, d.height)
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) throw new Error('JPEG images are not supported (convert to PNG)')
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) throw new Error('GIF images are not supported (convert to PNG)')
  throw new Error('Unsupported image format (only PNG is supported)')
}

type NodeFs = { promises: { readFile(p: string): Promise<Uint8Array> }; readFileSync(p: string): Uint8Array }
type NodePath = { resolve(...p: string[]): string; isAbsolute(p: string): boolean }

function nodeModule<T>(id: string): T | null {
  try {
    const p = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process
    return (p?.getBuiltinModule?.(id) as T) ?? null
  } catch {
    return null
  }
}

/** Reads the bytes behind an image source. `base` resolves relative paths / URLs. */
export async function readImageBytes(src: ImageSource, base?: string): Promise<Uint8Array> {
  if (src instanceof Uint8Array) return src
  if (src instanceof ArrayBuffer) return new Uint8Array(src)
  const s = String(src)
  if (s.startsWith('data:')) {
    const comma = s.indexOf(',')
    if (comma < 0) throw new Error('Invalid data: URL')
    const meta = s.slice(5, comma)
    const body = s.slice(comma + 1)
    if (/;base64$/i.test(meta)) return base64ToBytes(body)
    return new TextEncoder().encode(decodeURIComponent(body))
  }
  if (/^https?:\/\//i.test(s)) {
    const res = await fetch(s)
    if (!res.ok) throw new Error(`HTTP ${res.status} loading ${s}`)
    return new Uint8Array(await res.arrayBuffer())
  }
  if (base && /^https?:\/\//i.test(base)) return readImageBytes(new URL(s, base).href)
  const fs = nodeModule<NodeFs>('node:fs')
  if (!fs) throw new Error(`Cannot load "${s}": file system access is not available here`)
  let file = s
  if (s.startsWith('file:')) file = decodeURIComponent(new URL(s).pathname)
  else {
    const path = nodeModule<NodePath>('node:path')!
    if (base && !path.isAbsolute(s)) {
      const b = base.startsWith('file:') ? decodeURIComponent(new URL(base).pathname) : base
      file = path.resolve(b, s)
    }
  }
  return new Uint8Array(await fs.promises.readFile(file))
}

/**
 * An HTMLImageElement work-alike. Setting `src` starts loading; `onload` /
 * `onerror` (and 'load' / 'error' events) fire when done. It can be passed to
 * `drawImage` and `createPattern` once `complete`.
 */
export class Image extends Element {
  /** Directory or URL relative `src` values are resolved against (set by the browser environment). */
  static baseURL: string | undefined = undefined
  alt = ''
  crossOrigin: string | null = null
  decoding = 'auto'
  loading = 'eager'
  referrerPolicy = ''
  /** @internal */ _data: ImageData | null = null
  private _src = ''
  private _w: number | null = null
  private _h: number | null = null
  private _pending: Promise<void> | null = null
  private _error: unknown = null
  private _complete = true

  constructor(width?: number, height?: number) {
    super('img')
    if (width !== undefined) this._w = width
    if (height !== undefined) this._h = height
  }

  get src() { return this._src }
  set src(v: string) {
    this._src = String(v)
    this.setAttributeQuiet('src', this._src)
    this._load(this._src)
  }
  get currentSrc() { return this._src }
  get complete() { return this._complete }
  get naturalWidth() { return this._data?.width ?? 0 }
  get naturalHeight() { return this._data?.height ?? 0 }
  get width() { return this._w ?? this.naturalWidth }
  set width(v: number) { this._w = v }
  get height() { return this._h ?? this.naturalHeight }
  set height(v: number) { this._h = v }
  /** Decoded pixels (non-standard; null until loaded). */
  get data(): Uint8ClampedArray | null { return this._data?.data ?? null }

  override setAttribute(name: string, value: string) {
    super.setAttribute(name, value)
    if (name.toLowerCase() === 'src') this.src = value
    if (name.toLowerCase() === 'width') this._w = +value
    if (name.toLowerCase() === 'height') this._h = +value
  }
  private setAttributeQuiet(name: string, value: string) {
    this._attrs.set(name, value)
  }

  decode(): Promise<void> {
    if (!this._pending) return this._error ? Promise.reject(this._error) : Promise.resolve()
    return this._pending.then(() => {
      if (this._error) throw this._error
    })
  }

  /** @internal Load bytes directly (used by loadImage for buffers). */
  _load(src: ImageSource) {
    this._complete = false
    this._error = null
    const base = (this.constructor as typeof Image).baseURL
    const p = (this._pending = readImageBytes(src, base)
      .then((bytes) => {
        if (this._pending !== p) return
        this._data = decodeImage(bytes)
        this._complete = true
        this.dispatchEvent(new Event('load'))
      })
      .catch((err) => {
        if (this._pending !== p) return
        this._data = null
        this._error = err
        this._complete = true
        this.dispatchEvent(new Event('error'))
      }))
  }

  /** @internal Set decoded pixels synchronously. */
  _setData(data: ImageData) {
    this._data = data
    this._complete = true
    this._pending = null
  }
}

/** Loads and decodes an image (file path, file:/http(s):/data: URL, or encoded bytes). */
export async function loadImage(src: ImageSource, options: { base?: string } = {}): Promise<Image> {
  const bytes = await readImageBytes(src, options.base ?? Image.baseURL)
  const img = new Image()
  img._setData(decodeImage(bytes))
  if (typeof src === 'string' || src instanceof URL) (img as unknown as { _attrs: Map<string, string> })._attrs.set('src', String(src))
  return img
}
