import { describe, expect, it, afterEach } from 'vitest'
import { Canvas, decodePng, encodePng, loadImage } from '../src/index.js'
import { _setNodeZlib, adler32, deflateStored, inflateRaw } from '../src/zlib.js'
import { crc32 } from '../src/png.js'
import { deflateSync, deflateRawSync } from 'node:zlib'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

afterEach(() => _setNodeZlib(undefined))

function chunk(type: string, body: Uint8Array) {
  const out = Buffer.alloc(12 + body.length)
  out.writeUInt32BE(body.length, 0)
  out.write(type, 4, 'latin1')
  Buffer.from(body).copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length)
  return out
}
function png(w: number, h: number, depth: number, ctype: number, raw: Uint8Array, extra: Buffer[] = [], interlace = 0) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = depth
  ihdr[9] = ctype
  ihdr[12] = interlace
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), ...extra, chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())]))
}

describe('PNG', () => {
  it('round-trips a canvas through toBuffer / decodePng', () => {
    const c = new Canvas(7, 5)
    const ctx = c.getContext('2d')
    ctx.fillStyle = 'rgba(255, 128, 0, 0.5)'
    ctx.fillRect(1, 1, 3, 3)
    ctx.fillStyle = '#00ff00'
    ctx.fillRect(4, 0, 3, 5)
    const d = decodePng(c.toBuffer())
    expect(d.width).toBe(7)
    expect(d.height).toBe(5)
    expect(Array.from(d.data)).toEqual(Array.from(c.data))
    expect(c.toDataURL()).toMatch(/^data:image\/png;base64,iVBORw0KGgo/)
  })

  it('works without node:zlib (built-in inflate + stored deflate)', () => {
    _setNodeZlib(null)
    const data = new Uint8ClampedArray(16 * 16 * 4).map((_, i) => (i * 7) & 255)
    const bytes = encodePng(data, 16, 16)
    const d = decodePng(bytes)
    expect(Array.from(d.data)).toEqual(Array.from(data))
    // the built-in inflater also handles real (dynamic/fixed Huffman) deflate streams
    const text = new TextEncoder().encode('hello hello hello hello, tty-canvas! '.repeat(50))
    expect(Buffer.from(inflateRaw(deflateRawSync(text))).toString()).toBe(Buffer.from(text).toString())
    expect(adler32(text)).toBe(deflateSync(text).readUInt32BE(deflateSync(text).length - 4))
    expect(deflateStored(text).length).toBeGreaterThan(text.length)
  })

  it('decodes grayscale, palette (with tRNS), 16-bit RGB and gray+alpha', () => {
    // 2x1 grayscale 8-bit
    let d = decodePng(png(2, 1, 8, 0, new Uint8Array([0, 10, 200])))
    expect(Array.from(d.data)).toEqual([10, 10, 10, 255, 200, 200, 200, 255])
    // 4x1 1-bit grayscale: 1010 → white black white black
    d = decodePng(png(4, 1, 1, 0, new Uint8Array([0, 0b10100000])))
    expect(Array.from(d.data.filter((_, i) => i % 4 === 0))).toEqual([255, 0, 255, 0])
    // palette 2-bit with transparency
    const plte = chunk('PLTE', new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255]))
    const trns = chunk('tRNS', new Uint8Array([255, 128]))
    d = decodePng(png(3, 1, 2, 3, new Uint8Array([0, 0b00011000]), [plte, trns]))
    expect(Array.from(d.data)).toEqual([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 255])
    // 16-bit RGB
    d = decodePng(png(1, 1, 16, 2, new Uint8Array([0, 0xff, 0xff, 0x80, 0x00, 0x00, 0x10])))
    expect(Array.from(d.data)).toEqual([255, 128, 0, 255])
    // gray + alpha
    d = decodePng(png(1, 1, 8, 4, new Uint8Array([0, 100, 50])))
    expect(Array.from(d.data)).toEqual([100, 100, 100, 50])
  })

  it('decodes Adam7-interlaced images', () => {
    // 3x3 RGBA interlaced: passes 1 (0,0), 6 (1,0)... build via the pass layout
    const W = 3, H = 3
    const pixel = (x: number, y: number) => [x * 80, y * 80, 7, 255]
    const passes = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]]
    const raw: number[] = []
    for (const [x0, y0, dx, dy] of passes) {
      const pw = Math.ceil((W - x0) / dx), ph = Math.ceil((H - y0) / dy)
      if (pw <= 0 || ph <= 0) continue
      for (let r = 0; r < ph; r++) {
        raw.push(0)
        for (let k = 0; k < pw; k++) raw.push(...pixel(x0 + k * dx, y0 + r * dy))
      }
    }
    const d = decodePng(png(W, H, 8, 6, new Uint8Array(raw), [], 1))
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      expect(Array.from(d.data.slice((y * W + x) * 4, (y * W + x) * 4 + 4))).toEqual(pixel(x, y))
    }
  })

  it('loadImage reads a PNG file and draws it', async () => {
    const c = new Canvas(3, 2)
    c.getContext('2d').fillStyle = 'magenta'
    c.getContext('2d').fillRect(0, 0, 3, 2)
    const dir = mkdtempSync(join(tmpdir(), 'ttyc-'))
    const file = join(dir, 'm.png')
    writeFileSync(file, c.toBuffer())
    const img = await loadImage(file)
    expect(img.width).toBe(3)
    expect(img.complete).toBe(true)
    const out = new Canvas(3, 2)
    out.getContext('2d').drawImage(img, 0, 0)
    expect(Array.from(out.data.slice(0, 4))).toEqual([255, 0, 255, 255])
    const fromData = await loadImage(c.toDataURL())
    expect(fromData.height).toBe(2)
    await expect(loadImage(new Uint8Array([1, 2, 3]))).rejects.toThrow(/Unsupported image format/)
  })
})
