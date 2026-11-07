/** PNG encoder (RGBA8, adaptive filtering) and decoder (all color types and bit depths, Adam7 interlace). */
import { zlibDeflate, zlibInflate } from './zlib.js'

let crcTable: Uint32Array | null = null
export function crc32(data: Uint8Array, crc = 0xffffffff): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
  }
  for (let i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]) & 255] ^ (crc >>> 8)
  return crc >>> 0
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

export interface DecodedImage {
  width: number
  height: number
  /** Non-premultiplied RGBA8. */
  data: Uint8ClampedArray
}

export function isPng(buf: Uint8Array) {
  return buf.length > 8 && SIGNATURE.every((b, i) => buf[i] === b)
}

/** Encodes non-premultiplied RGBA pixels as a PNG file. */
export function encodePng(data: ArrayLike<number>, width: number, height: number, opts: { level?: number } = {}): Uint8Array {
  const stride = width * 4
  const raw = new Uint8Array((stride + 1) * height)
  const prev = new Uint8Array(stride)
  const cur = new Uint8Array(stride)
  const cand = [new Uint8Array(stride), new Uint8Array(stride), new Uint8Array(stride), new Uint8Array(stride), new Uint8Array(stride)]
  for (let y = 0; y < height; y++) {
    for (let i = 0; i < stride; i++) cur[i] = data[y * stride + i]
    let best = 0
    let bestSum = Infinity
    for (let f = 0; f < 5; f++) {
      const o = cand[f]
      let sum = 0
      for (let i = 0; i < stride; i++) {
        const a = i >= 4 ? cur[i - 4] : 0
        const b = prev[i]
        const c = i >= 4 ? prev[i - 4] : 0
        const x = cur[i]
        const v = f === 0 ? x : f === 1 ? x - a : f === 2 ? x - b : f === 3 ? x - ((a + b) >> 1) : x - paeth(a, b, c)
        o[i] = v
        const sv = (v << 24) >> 24
        sum += sv < 0 ? -sv : sv
      }
      if (sum < bestSum) {
        bestSum = sum
        best = f
      }
    }
    raw[y * (stride + 1)] = best
    raw.set(cand[best], y * (stride + 1) + 1)
    prev.set(cur)
  }
  const idat = zlibDeflate(raw, opts.level ?? 6)
  const ihdr = new Uint8Array(13)
  const dv = new DataView(ihdr.buffer)
  dv.setUint32(0, width)
  dv.setUint32(4, height)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const chunks = [chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))]
  const total = 8 + chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  out.set(SIGNATURE, 0)
  let o = 8
  for (const c of chunks) {
    out.set(c, o)
    o += c.length
  }
  return out
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, body.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(body, 8)
  dv.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)))
  return out
}

function paeth(a: number, b: number, c: number) {
  const p = a + b - c
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

/** Decodes a PNG file into RGBA8. */
export function decodePng(buf: Uint8Array): DecodedImage {
  if (!isPng(buf)) throw new Error('PNG: invalid signature')
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let pos = 8
  let width = 0, height = 0, depth = 0, ctype = 0, interlace = 0
  let palette: Uint8Array | null = null
  let trns: Uint8Array | null = null
  const idat: Uint8Array[] = []
  while (pos + 8 <= buf.length) {
    const len = dv.getUint32(pos)
    const type = String.fromCharCode(buf[pos + 4], buf[pos + 5], buf[pos + 6], buf[pos + 7])
    const body = buf.subarray(pos + 8, pos + 8 + len)
    pos += 12 + len
    if (type === 'IHDR') {
      width = dv.getUint32(pos - 12 - len + 8)
      height = dv.getUint32(pos - 12 - len + 12)
      depth = body[8]
      ctype = body[9]
      interlace = body[12]
    } else if (type === 'PLTE') palette = body
    else if (type === 'tRNS') trns = body
    else if (type === 'IDAT') idat.push(body)
    else if (type === 'IEND') break
  }
  if (!width || !height) throw new Error('PNG: missing IHDR')
  if (![0, 2, 3, 4, 6].includes(ctype)) throw new Error(`PNG: unsupported color type ${ctype}`)
  const total = idat.reduce((n, c) => n + c.length, 0)
  const z = new Uint8Array(total)
  let o = 0
  for (const c of idat) {
    z.set(c, o)
    o += c.length
  }
  const raw = zlibInflate(z)
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype as 0 | 2 | 3 | 4 | 6]
  const bpp = Math.max(1, (channels * depth) >> 3) // bytes per pixel for filtering
  const out = new Uint8ClampedArray(width * height * 4)
  const passes = interlace
    ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]]
    : [[0, 0, 1, 1]]
  let rp = 0
  for (const [x0, y0, dx, dy] of passes) {
    const pw = Math.ceil((width - x0) / dx)
    const ph = Math.ceil((height - y0) / dy)
    if (pw <= 0 || ph <= 0) continue
    const stride = Math.ceil((pw * channels * depth) / 8)
    let prev = new Uint8Array(stride)
    for (let row = 0; row < ph; row++) {
      const filter = raw[rp++]
      const line = raw.slice(rp, rp + stride)
      rp += stride
      unfilter(filter, line, prev, bpp)
      writeRow(line, out, width, x0, y0 + row * dy, dx, pw, ctype, depth, palette, trns)
      prev = line
    }
  }
  return { width, height, data: out }
}

function unfilter(f: number, line: Uint8Array, prev: Uint8Array, bpp: number) {
  const n = line.length
  switch (f) {
    case 0: return
    case 1: for (let i = bpp; i < n; i++) line[i] = line[i] + line[i - bpp]; return
    case 2: for (let i = 0; i < n; i++) line[i] = line[i] + prev[i]; return
    case 3:
      for (let i = 0; i < n; i++) line[i] = line[i] + (((i >= bpp ? line[i - bpp] : 0) + prev[i]) >> 1)
      return
    case 4:
      for (let i = 0; i < n; i++) line[i] = line[i] + paeth(i >= bpp ? line[i - bpp] : 0, prev[i], i >= bpp ? prev[i - bpp] : 0)
      return
    default: throw new Error(`PNG: invalid filter ${f}`)
  }
}

function writeRow(
  line: Uint8Array, out: Uint8ClampedArray, width: number, x0: number, y: number, dx: number, count: number,
  ctype: number, depth: number, palette: Uint8Array | null, trns: Uint8Array | null,
) {
  const sample = (i: number): number => {
    // i-th sample of the row, scaled to 8 bits (16-bit: high byte)
    if (depth === 8) return line[i]
    if (depth === 16) return line[i * 2]
    const perByte = 8 / depth
    const byte = line[Math.floor(i / perByte)]
    const shift = 8 - depth * ((i % perByte) + 1)
    return (byte >> shift) & ((1 << depth) - 1)
  }
  const raw16 = (i: number) => (depth === 16 ? (line[i * 2] << 8) | line[i * 2 + 1] : sample(i))
  const scale = depth < 8 ? 255 / ((1 << depth) - 1) : 1
  for (let k = 0; k < count; k++) {
    const p = (y * width + x0 + k * dx) * 4
    let r = 0, g = 0, b = 0, a = 255
    switch (ctype) {
      case 0: {
        const v = sample(k)
        r = g = b = Math.round(v * scale)
        if (trns && trns.length >= 2 && raw16(k) === ((trns[0] << 8) | trns[1])) a = 0
        break
      }
      case 2:
        r = sample(k * 3); g = sample(k * 3 + 1); b = sample(k * 3 + 2)
        if (trns && trns.length >= 6) {
          const tr = (trns[0] << 8) | trns[1], tg = (trns[2] << 8) | trns[3], tb = (trns[4] << 8) | trns[5]
          if (raw16(k * 3) === tr && raw16(k * 3 + 1) === tg && raw16(k * 3 + 2) === tb) a = 0
        }
        break
      case 3: {
        const idx = sample(k)
        if (palette) {
          r = palette[idx * 3]; g = palette[idx * 3 + 1]; b = palette[idx * 3 + 2]
        }
        if (trns && idx < trns.length) a = trns[idx]
        break
      }
      case 4: {
        const v = sample(k * 2)
        r = g = b = v
        a = sample(k * 2 + 1)
        break
      }
      case 6:
        r = sample(k * 4); g = sample(k * 4 + 1); b = sample(k * 4 + 2); a = sample(k * 4 + 3)
        break
    }
    out[p] = r
    out[p + 1] = g
    out[p + 2] = b
    out[p + 3] = a
  }
}
