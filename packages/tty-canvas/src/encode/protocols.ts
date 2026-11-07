/** Pixel graphics protocols: kitty, sixel and iTerm2 inline images, plus capability detection. */
import { encodePng } from '../png.js'
import { getNodeZlib } from '../zlib.js'

const ST = '\x1b\\'

function base64(bytes: Uint8Array): string {
  const g = globalThis as { Buffer?: { from(b: Uint8Array): { toString(enc: string): string } }; btoa?: (s: string) => string }
  if (g.Buffer) return g.Buffer.from(bytes).toString('base64')
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return g.btoa!(s)
}

export interface KittyOptions {
  /** Image id (1..4294967295). Re-sending the same id replaces the image. Default 1. */
  id?: number
  /** Display size in cells (the terminal scales the image). */
  columns?: number
  rows?: number
  /** 'rgba' (default), 'rgb' (drops alpha, 25% smaller) or 'png'. */
  format?: 'rgba' | 'rgb' | 'png'
  /** zlib-compress the payload (needs node:zlib). Default true when available. */
  compress?: boolean
  /** z-index; negative values draw below text. */
  zIndex?: number
  /** Keep the cursor where it is (default true). */
  holdCursor?: boolean
}

/** Kitty graphics protocol: transmit-and-display escape sequence for an RGBA image. */
export function encodeKitty(rgba: ArrayLike<number>, width: number, height: number, opts: KittyOptions = {}): string {
  const format = opts.format ?? 'rgba'
  let payload: Uint8Array
  let f: number
  if (format === 'png') {
    payload = encodePng(rgba, width, height)
    f = 100
  } else if (format === 'rgb') {
    payload = new Uint8Array(width * height * 3)
    for (let i = 0, j = 0; i < width * height * 4; i += 4, j += 3) {
      payload[j] = rgba[i]; payload[j + 1] = rgba[i + 1]; payload[j + 2] = rgba[i + 2]
    }
    f = 24
  } else {
    payload = Uint8Array.from(rgba as ArrayLike<number>)
    f = 32
  }
  const keys = [`a=T`, `f=${f}`, `i=${opts.id ?? 1}`, `q=2`]
  if (f !== 100) keys.push(`s=${width}`, `v=${height}`)
  const z = format !== 'png' && opts.compress !== false ? getNodeZlib() : null
  if (z) {
    payload = new Uint8Array(z.deflateSync(payload, { level: 1 }))
    keys.push('o=z')
  }
  if (opts.columns) keys.push(`c=${opts.columns}`)
  if (opts.rows) keys.push(`r=${opts.rows}`)
  if (opts.zIndex !== undefined) keys.push(`z=${opts.zIndex}`)
  if (opts.holdCursor !== false) keys.push('C=1')
  const data = base64(payload)
  const CHUNK = 4096
  let out = ''
  for (let i = 0; i < data.length || i === 0; i += CHUNK) {
    const part = data.slice(i, i + CHUNK)
    const more = i + CHUNK < data.length ? 1 : 0
    out += `\x1b_G${i === 0 ? keys.join(',') + ',' : ''}m=${more};${part}${ST}`
    if (!data.length) break
  }
  return out
}

/** Deletes a kitty image (and frees its data). */
export function kittyDelete(id = 1): string {
  return `\x1b_Ga=d,d=I,i=${id},q=2${ST}`
}

export interface Iterm2Options {
  /** Display size in cells. */
  columns?: number
  rows?: number
  preserveAspectRatio?: boolean
  name?: string
}

/** iTerm2 inline image (OSC 1337), also understood by WezTerm, Konsole, VS Code and others. */
export function encodeIterm2(rgba: ArrayLike<number>, width: number, height: number, opts: Iterm2Options = {}): string {
  const png = encodePng(rgba, width, height)
  const args = ['inline=1', `size=${png.length}`]
  if (opts.name) args.push(`name=${base64(new TextEncoder().encode(opts.name))}`)
  if (opts.columns) args.push(`width=${opts.columns}`)
  if (opts.rows) args.push(`height=${opts.rows}`)
  if (opts.preserveAspectRatio === false) args.push('preserveAspectRatio=0')
  return `\x1b]1337;File=${args.join(';')}:${base64(png)}\x07`
}

export interface SixelOptions {
  /** Maximum palette size (2..256). Default 256. */
  colors?: number
  /** 0xRRGGBB to composite transparent pixels onto; default: leave them transparent. */
  background?: number | null
}

/** Encodes an RGBA image as a DEC sixel sequence (median-cut palette). */
export function encodeSixel(rgba: ArrayLike<number>, width: number, height: number, opts: SixelOptions = {}): string {
  const maxColors = Math.max(2, Math.min(256, opts.colors ?? 256))
  const bg = opts.background ?? null
  const n = width * height
  // composite and quantize to 5 bits per channel
  const key = new Int32Array(n)
  const hist = new Uint32Array(32768)
  const sums = new Float64Array(32768 * 3)
  for (let i = 0; i < n; i++) {
    let r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2]
    const a = rgba[i * 4 + 3] / 255
    if (bg !== null) {
      r = r * a + ((bg >> 16) & 255) * (1 - a)
      g = g * a + ((bg >> 8) & 255) * (1 - a)
      b = b * a + (bg & 255) * (1 - a)
    } else if (a < 0.5) {
      key[i] = -1
      continue
    }
    const k = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
    key[i] = k
    hist[k]++
    sums[k * 3] += r
    sums[k * 3 + 1] += g
    sums[k * 3 + 2] += b
  }
  const palette = medianCut(hist, sums, maxColors)
  const nearest = new Int16Array(32768).fill(-1)
  const lookup = (k: number) => {
    let v = nearest[k]
    if (v >= 0) return v
    const r = ((k >> 10) & 31) * 8 + 4, g = ((k >> 5) & 31) * 8 + 4, b = (k & 31) * 8 + 4
    let best = 0, bd = Infinity
    for (let p = 0; p < palette.length; p++) {
      const c = palette[p]
      const d = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2
      if (d < bd) { bd = d; best = p }
    }
    nearest[k] = v = best
    return v
  }
  const idx = new Int16Array(n)
  for (let i = 0; i < n; i++) idx[i] = key[i] < 0 ? -1 : lookup(key[i])
  let out = `\x1bP0;1;0q"1;1;${width};${height}`
  for (let p = 0; p < palette.length; p++) {
    const [r, g, b] = palette[p]
    out += `#${p};2;${Math.round((r / 255) * 100)};${Math.round((g / 255) * 100)};${Math.round((b / 255) * 100)}`
  }
  const bits = new Uint8Array(width)
  for (let band = 0; band < height; band += 6) {
    const used = new Set<number>()
    for (let y = band; y < Math.min(height, band + 6); y++) for (let x = 0; x < width; x++) {
      const c = idx[y * width + x]
      if (c >= 0) used.add(c)
    }
    let first = true
    for (const c of used) {
      bits.fill(0)
      for (let dy = 0; dy < 6 && band + dy < height; dy++) {
        const row = (band + dy) * width
        for (let x = 0; x < width; x++) if (idx[row + x] === c) bits[x] |= 1 << dy
      }
      let end = width
      while (end > 0 && !bits[end - 1]) end--
      let line = ''
      for (let x = 0; x < end; ) {
        const v = bits[x]
        let run = 1
        while (x + run < end && bits[x + run] === v) run++
        const ch = String.fromCharCode(63 + v)
        line += run > 3 ? `!${run}${ch}` : ch.repeat(run)
        x += run
      }
      out += (first ? '' : '$') + `#${c}` + line
      first = false
    }
    out += '-'
  }
  return out + ST
}

function medianCut(hist: Uint32Array, sums: Float64Array, maxColors: number): [number, number, number][] {
  const entries: number[] = []
  for (let k = 0; k < 32768; k++) if (hist[k]) entries.push(k)
  if (!entries.length) return [[0, 0, 0]]
  const ch = (k: number, c: number) => (c === 0 ? (k >> 10) & 31 : c === 1 ? (k >> 5) & 31 : k & 31)
  type Box = { keys: number[]; count: number }
  const boxes: Box[] = [{ keys: entries, count: entries.reduce((s, k) => s + hist[k], 0) }]
  while (boxes.length < maxColors) {
    // split the box with the largest (range × count)
    let bi = -1, bestScore = 0, bestCh = 0
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i]
      if (b.keys.length < 2) continue
      for (let c = 0; c < 3; c++) {
        let lo = 31, hi = 0
        for (const k of b.keys) {
          const v = ch(k, c)
          if (v < lo) lo = v
          if (v > hi) hi = v
        }
        const score = (hi - lo) * Math.sqrt(b.count)
        if (score > bestScore) { bestScore = score; bi = i; bestCh = c }
      }
    }
    if (bi < 0) break
    const b = boxes[bi]
    b.keys.sort((x, y) => ch(x, bestCh) - ch(y, bestCh))
    let acc = 0
    let cut = 0
    for (; cut < b.keys.length - 1; cut++) {
      acc += hist[b.keys[cut]]
      if (acc >= b.count / 2) break
    }
    const left = b.keys.slice(0, cut + 1), right = b.keys.slice(cut + 1)
    const lc = left.reduce((s, k) => s + hist[k], 0)
    boxes.splice(bi, 1, { keys: left, count: lc }, { keys: right, count: b.count - lc })
  }
  return boxes.map((b) => {
    let r = 0, g = 0, bl = 0
    for (const k of b.keys) {
      r += sums[k * 3]; g += sums[k * 3 + 1]; bl += sums[k * 3 + 2]
    }
    return [Math.round(r / b.count), Math.round(g / b.count), Math.round(bl / b.count)] as [number, number, number]
  })
}

export type GraphicsProtocol = 'kitty' | 'iterm2' | 'sixel'

export interface GraphicsSupport {
  kitty: boolean
  iterm2: boolean
  sixel: boolean
  truecolor: boolean
  /** Best available pixel protocol, or null (use a cell mode). */
  best: GraphicsProtocol | null
}

/**
 * Guesses terminal graphics capabilities from environment variables. This is
 * a heuristic (no terminal queries); inside tmux/screen pixel protocols are
 * reported as unavailable.
 */
export function detectGraphics(env: Record<string, string | undefined> = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}): GraphicsSupport {
  const term = (env.TERM ?? '').toLowerCase()
  const prog = (env.TERM_PROGRAM ?? '').toLowerCase()
  const truecolor = /truecolor|24bit/i.test(env.COLORTERM ?? '') || /kitty|ghostty|wezterm|iterm|alacritty|foot|vscode|rio|tabby|hyper/.test(term + ' ' + prog) || !!env.WT_SESSION
  const multiplexed = !!env.TMUX || term.startsWith('screen') || term.startsWith('tmux') || !!env.STY || !!env.ZELLIJ
  let kitty = false, iterm2 = false, sixel = false
  if (!multiplexed) {
    if (term === 'xterm-kitty' || env.KITTY_WINDOW_ID) kitty = true
    if (prog === 'ghostty' || term === 'xterm-ghostty' || env.GHOSTTY_RESOURCES_DIR) kitty = true
    if (prog === 'wezterm' || env.WEZTERM_EXECUTABLE) { kitty = true; iterm2 = true; sixel = true }
    if (prog === 'iterm.app' || env.ITERM_SESSION_ID) { iterm2 = true; sixel = true }
    if (env.KONSOLE_VERSION) { kitty = true; sixel = true }
    if (prog === 'rio') { iterm2 = true; sixel = true }
    if (prog === 'vscode') { iterm2 = true; sixel = true }
    if (prog === 'mintty' || term.includes('mintty')) { iterm2 = true; sixel = true }
    if (/^(foot|mlterm|contour|yaft|st-sixel|xterm-sixel)/.test(term)) sixel = true
    if (env.WT_SESSION) sixel = true
  }
  const best: GraphicsProtocol | null = kitty ? 'kitty' : iterm2 ? 'iterm2' : sixel ? 'sixel' : null
  return { kitty, iterm2, sixel, truecolor, best }
}
