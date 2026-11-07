/**
 * zlib (RFC 1950/1951) support that works everywhere: uses node:zlib when it
 * can be reached synchronously (Node's `process.getBuiltinModule`), otherwise a
 * small built-in inflater and a stored-block (uncompressed) deflater.
 */

interface NodeZlib {
  inflateSync(buf: Uint8Array): Uint8Array
  deflateSync(buf: Uint8Array, opts?: { level?: number }): Uint8Array
}

let nodeZlib: NodeZlib | null | undefined

/** @internal */
export function getNodeZlib(): NodeZlib | null {
  if (nodeZlib !== undefined) return nodeZlib
  try {
    const p = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process
    nodeZlib = (p?.getBuiltinModule?.('node:zlib') as NodeZlib | undefined) ?? null
  } catch {
    nodeZlib = null
  }
  return nodeZlib
}

/** @internal For tests: force the pure-JS implementation. */
export function _setNodeZlib(z: NodeZlib | null | undefined) {
  nodeZlib = z
}

export function zlibInflate(data: Uint8Array): Uint8Array {
  const z = getNodeZlib()
  if (z) return new Uint8Array(z.inflateSync(data))
  if (data.length < 2 || (data[0] & 0x0f) !== 8 || ((data[0] << 8) | data[1]) % 31) throw new Error('zlib: invalid header')
  return inflateRaw(data.subarray(2))
}

export function zlibDeflate(data: Uint8Array, level = 6): Uint8Array {
  const z = getNodeZlib()
  if (z) return new Uint8Array(z.deflateSync(data, { level }))
  return deflateStored(data)
}

export function adler32(data: Uint8Array): number {
  let a = 1, b = 0
  for (let i = 0; i < data.length; ) {
    const end = Math.min(data.length, i + 5552)
    for (; i < end; i++) {
      a += data[i]
      b += a
    }
    a %= 65521
    b %= 65521
  }
  return ((b << 16) | a) >>> 0
}

/** zlib stream with uncompressed deflate blocks. */
export function deflateStored(data: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(data.length / 65535))
  const out = new Uint8Array(2 + data.length + blocks * 5 + 4)
  out[0] = 0x78
  out[1] = 0x01
  let o = 2
  for (let b = 0; b < blocks; b++) {
    const start = b * 65535
    const len = Math.min(65535, data.length - start)
    out[o++] = b === blocks - 1 ? 1 : 0
    out[o++] = len & 255
    out[o++] = len >> 8
    out[o++] = ~len & 255
    out[o++] = (~len >> 8) & 255
    out.set(data.subarray(start, start + len), o)
    o += len
  }
  const ad = adler32(data)
  out[o++] = ad >>> 24
  out[o++] = (ad >>> 16) & 255
  out[o++] = (ad >>> 8) & 255
  out[o++] = ad & 255
  return out
}

// ---------------------------------------------------------------- inflate (RFC 1951)

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]

interface Huffman {
  counts: Uint16Array
  symbols: Uint16Array
}

function buildHuffman(lengths: ArrayLike<number>, n: number): Huffman {
  const counts = new Uint16Array(16)
  const symbols = new Uint16Array(n)
  for (let i = 0; i < n; i++) counts[lengths[i]]++
  counts[0] = 0
  const offs = new Uint16Array(16)
  for (let i = 1; i < 16; i++) offs[i] = offs[i - 1] + counts[i - 1]
  for (let i = 0; i < n; i++) if (lengths[i]) symbols[offs[lengths[i]]++] = i
  return { counts, symbols }
}

let fixedLit: Huffman | null = null
let fixedDist: Huffman | null = null

export function inflateRaw(src: Uint8Array): Uint8Array {
  let pos = 0
  let bitBuf = 0
  let bitCnt = 0
  let out = new Uint8Array(Math.max(1024, src.length * 4))
  let olen = 0
  const ensure = (n: number) => {
    if (olen + n <= out.length) return
    let size = out.length * 2
    while (size < olen + n) size *= 2
    const next = new Uint8Array(size)
    next.set(out.subarray(0, olen))
    out = next
  }
  const bits = (n: number) => {
    while (bitCnt < n) {
      if (pos >= src.length) throw new Error('inflate: unexpected end of data')
      bitBuf |= src[pos++] << bitCnt
      bitCnt += 8
    }
    const v = bitBuf & ((1 << n) - 1)
    bitBuf >>>= n
    bitCnt -= n
    return v
  }
  const decode = (h: Huffman) => {
    let code = 0, first = 0, index = 0
    for (let len = 1; len < 16; len++) {
      code |= bits(1)
      const count = h.counts[len]
      if (code - count < first) return h.symbols[index + (code - first)]
      index += count
      first += count
      first <<= 1
      code <<= 1
    }
    throw new Error('inflate: invalid Huffman code')
  }
  let final = 0
  while (!final) {
    final = bits(1)
    const type = bits(2)
    if (type === 0) {
      bitBuf = 0
      bitCnt = 0
      if (pos + 4 > src.length) throw new Error('inflate: truncated stored block')
      const len = src[pos] | (src[pos + 1] << 8)
      pos += 4
      ensure(len)
      out.set(src.subarray(pos, pos + len), olen)
      olen += len
      pos += len
      continue
    }
    let lit: Huffman, dist: Huffman
    if (type === 1) {
      if (!fixedLit) {
        const l = new Uint8Array(288)
        l.fill(8, 0, 144); l.fill(9, 144, 256); l.fill(7, 256, 280); l.fill(8, 280, 288)
        fixedLit = buildHuffman(l, 288)
        fixedDist = buildHuffman(new Uint8Array(30).fill(5), 30)
      }
      lit = fixedLit
      dist = fixedDist!
    } else if (type === 2) {
      const hlit = bits(5) + 257, hdist = bits(5) + 1, hclen = bits(4) + 4
      const cl = new Uint8Array(19)
      for (let i = 0; i < hclen; i++) cl[CL_ORDER[i]] = bits(3)
      const clh = buildHuffman(cl, 19)
      const lens = new Uint8Array(hlit + hdist)
      for (let i = 0; i < hlit + hdist; ) {
        const sym = decode(clh)
        if (sym < 16) lens[i++] = sym
        else {
          let rep = 0, val = 0
          if (sym === 16) {
            if (!i) throw new Error('inflate: repeat with no previous length')
            val = lens[i - 1]
            rep = 3 + bits(2)
          } else if (sym === 17) rep = 3 + bits(3)
          else rep = 11 + bits(7)
          while (rep--) lens[i++] = val
        }
      }
      lit = buildHuffman(lens.subarray(0, hlit), hlit)
      dist = buildHuffman(lens.subarray(hlit), hdist)
    } else throw new Error('inflate: invalid block type')
    for (;;) {
      const sym = decode(lit)
      if (sym < 256) {
        ensure(1)
        out[olen++] = sym
      } else if (sym === 256) break
      else {
        const li = sym - 257
        if (li >= 29) throw new Error('inflate: invalid length symbol')
        const len = LEN_BASE[li] + bits(LEN_EXTRA[li])
        const di = decode(dist)
        if (di >= 30) throw new Error('inflate: invalid distance symbol')
        const d = DIST_BASE[di] + bits(DIST_EXTRA[di])
        if (d > olen) throw new Error('inflate: distance too far back')
        ensure(len)
        for (let k = 0; k < len; k++) out[olen + k] = out[olen - d + k]
        olen += len
      }
    }
  }
  return out.slice(0, olen)
}
