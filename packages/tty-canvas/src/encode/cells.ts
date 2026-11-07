/**
 * Encoders that turn RGBA pixels into terminal cells (a character plus
 * foreground / background colors as 0xRRGGBB numbers).
 *
 * | mode      | pixels per cell | characters                         |
 * |-----------|-----------------|------------------------------------|
 * | halfblock | 1 × 2           | ▀ ▄ (fg + bg: two exact colors)    |
 * | quadrant  | 2 × 2           | ▘▝▀▖▌▞▛▗▚▐▜▄▙▟                     |
 * | sextant   | 2 × 3           | U+1FB00 block sextants, ▌ ▐        |
 * | braille   | 2 × 4           | U+2800 braille dots (colored)      |
 * | ascii     | 1 × 2           | luminance ramp, e.g. " .:-=+*#%@"  |
 *
 * For multi-pixel cells the two colors are chosen by a 2-means split of the
 * cell's pixels (seeded with the most distant pair), so edges stay crisp.
 */
import { toRgbNumber } from '../color.js'

export type CellMode = 'halfblock' | 'quadrant' | 'sextant' | 'braille' | 'ascii'
export const CELL_MODES: readonly CellMode[] = ['halfblock', 'quadrant', 'sextant', 'braille', 'ascii']

export interface Cell {
  ch: string
  /** Foreground 0xRRGGBB, or null for the terminal default. */
  fg: number | null
  /** Background 0xRRGGBB, or null for the terminal default (transparent). */
  bg: number | null
}

export interface EncodedCells {
  columns: number
  rows: number
  /** Row-major, `columns * rows` cells. */
  cells: Cell[]
}

export interface EncodeOptions {
  mode?: CellMode
  /** Output size in cells. Defaults to the native size (pixels / mode resolution). The image is resampled (area average) to fit exactly. */
  columns?: number
  rows?: number
  /**
   * Color transparent pixels are composited onto (0xRRGGBB or CSS color).
   * `null` (default) keeps them transparent: cells use a null color there.
   */
  background?: number | string | null
  /** Characters from light to dense (ascii mode). */
  ramp?: string
  /** Alpha (0..1) below which a pixel counts as transparent when there is no background. Default 0.5. */
  alphaThreshold?: number
}

/** Pixels per cell [x, y] of each mode. */
export const MODE_RESOLUTION: Record<CellMode, readonly [number, number]> = {
  halfblock: [1, 2],
  quadrant: [2, 2],
  sextant: [2, 3],
  braille: [2, 4],
  ascii: [1, 2],
}

const HALF = [' ', '▀', '▄', '█']
const QUAD = [' ', '▘', '▝', '▀', '▖', '▌', '▞', '▛', '▗', '▚', '▐', '▜', '▄', '▙', '▟', '█']
const BRAILLE_BITS = [0x01, 0x08, 0x02, 0x10, 0x04, 0x20, 0x40, 0x80] // (x, y) row-major in a 2x4 cell

function sextantChar(mask: number): string {
  if (mask === 0) return ' '
  if (mask === 63) return '█'
  if (mask === 21) return '▌'
  if (mask === 42) return '▐'
  return String.fromCodePoint(0x1fb00 + mask - 1 - (mask > 21 ? 1 : 0) - (mask > 42 ? 1 : 0))
}

function glyphFor(mode: CellMode, mask: number): string {
  switch (mode) {
    case 'halfblock': return HALF[mask]
    case 'quadrant': return QUAD[mask]
    case 'sextant': return sextantChar(mask)
    case 'braille': return String.fromCharCode(0x2800 | brailleBits(mask))
    default: return ' '
  }
}

function brailleBits(mask: number) {
  let b = 0
  for (let i = 0; i < 8; i++) if (mask & (1 << i)) b |= BRAILLE_BITS[i]
  return b
}

/**
 * Area-average resampling into premultiplied float RGBA (r, g, b in 0..255
 * premultiplied by a, a in 0..1).
 */
export function resample(rgba: ArrayLike<number>, w: number, h: number, tw: number, th: number): Float32Array {
  const out = new Float32Array(tw * th * 4)
  if (!w || !h || !tw || !th) return out
  if (tw === w && th === h) {
    for (let i = 0; i < w * h; i++) {
      const a = rgba[i * 4 + 3] / 255
      out[i * 4] = rgba[i * 4] * a
      out[i * 4 + 1] = rgba[i * 4 + 1] * a
      out[i * 4 + 2] = rgba[i * 4 + 2] * a
      out[i * 4 + 3] = a
    }
    return out
  }
  const xw = weights(w, tw)
  const yw = weights(h, th)
  // horizontal pass into a w → tw intermediate (per source row)
  const mid = new Float32Array(tw * h * 4)
  for (let y = 0; y < h; y++) {
    for (let tx = 0; tx < tw; tx++) {
      let r = 0, g = 0, b = 0, a = 0
      for (const [sx, wt] of xw[tx]) {
        const p = (y * w + sx) * 4
        const pa = (rgba[p + 3] / 255) * wt
        r += rgba[p] * pa
        g += rgba[p + 1] * pa
        b += rgba[p + 2] * pa
        a += pa
      }
      const o = (y * tw + tx) * 4
      mid[o] = r; mid[o + 1] = g; mid[o + 2] = b; mid[o + 3] = a
    }
  }
  for (let ty = 0; ty < th; ty++) {
    for (let tx = 0; tx < tw; tx++) {
      let r = 0, g = 0, b = 0, a = 0
      for (const [sy, wt] of yw[ty]) {
        const p = (sy * tw + tx) * 4
        r += mid[p] * wt; g += mid[p + 1] * wt; b += mid[p + 2] * wt; a += mid[p + 3] * wt
      }
      const o = (ty * tw + tx) * 4
      out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = a
    }
  }
  return out
}

/** For each target index, the source indices and normalized weights it covers. */
function weights(src: number, dst: number): [number, number][][] {
  const scale = src / dst
  const out: [number, number][][] = []
  for (let t = 0; t < dst; t++) {
    let s0 = t * scale
    let s1 = (t + 1) * scale
    if (scale < 1) {
      // upscaling: nearest source pixel
      const c = Math.min(src - 1, Math.floor((t + 0.5) * scale))
      out.push([[c, 1]])
      continue
    }
    const list: [number, number][] = []
    const total = s1 - s0
    for (let i = Math.floor(s0); i < Math.ceil(s1) && i < src; i++) {
      const lo = Math.max(s0, i), hi = Math.min(s1, i + 1)
      if (hi > lo) list.push([i, (hi - lo) / total])
    }
    out.push(list)
    s0 = s1
  }
  return out
}

const dist2 = (a: number[], i: number, b: number[], j: number) => {
  const dr = a[i] - b[j], dg = a[i + 1] - b[j + 1], db = a[i + 2] - b[j + 2]
  return 2 * dr * dr + 4 * dg * dg + 3 * db * db
}

const pack = (r: number, g: number, b: number) => ((Math.round(r) & 255) << 16) | ((Math.round(g) & 255) << 8) | (Math.round(b) & 255)

/** Encodes RGBA pixels into terminal cells. */
export function encodeCells(rgba: ArrayLike<number>, width: number, height: number, opts: EncodeOptions = {}): EncodedCells {
  const mode = opts.mode ?? 'halfblock'
  const res = MODE_RESOLUTION[mode]
  if (!res) throw new Error(`Unknown cell mode "${mode}"`)
  const [cw, ch] = res
  const columns = Math.max(0, Math.floor(opts.columns ?? Math.ceil(width / cw)))
  const rows = Math.max(0, Math.floor(opts.rows ?? Math.ceil(height / ch)))
  const bgNum = opts.background === undefined || opts.background === null ? null : toRgbNumber(opts.background)
  const bgRgb = bgNum === null ? null : [(bgNum >> 16) & 255, (bgNum >> 8) & 255, bgNum & 255]
  const threshold = opts.alphaThreshold ?? 0.5
  const tw = columns * cw, th = rows * ch
  // when the requested grid is the native one, pad instead of resampling
  let px: Float32Array
  if (tw >= width && th >= height && tw - width < cw && th - height < ch) {
    px = new Float32Array(tw * th * 4)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const s = (y * width + x) * 4, o = (y * tw + x) * 4
        const a = rgba[s + 3] / 255
        px[o] = rgba[s] * a; px[o + 1] = rgba[s + 1] * a; px[o + 2] = rgba[s + 2] * a; px[o + 3] = a
      }
    }
  } else px = resample(rgba, width, height, tw, th)

  const n = cw * ch
  const full = (1 << n) - 1
  const cols: number[] = new Array(n * 3).fill(0)
  const opaque: boolean[] = new Array(n).fill(false)
  const cells: Cell[] = new Array(columns * rows)
  const ramp = opts.ramp ?? ' .:-=+*#%@'
  const bgLum = bgRgb ? (0.2126 * bgRgb[0] + 0.7152 * bgRgb[1] + 0.0722 * bgRgb[2]) / 255 : 0
  const seedA = [0, 0, 0], seedB = [0, 0, 0]
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < columns; cx++) {
      // gather the cell's pixels
      let nOpaque = 0
      for (let j = 0; j < ch; j++) {
        for (let i = 0; i < cw; i++) {
          const k = j * cw + i
          const o = ((cy * ch + j) * tw + cx * cw + i) * 4
          const a = px[o + 3]
          if (bgRgb) {
            cols[k * 3] = px[o] + bgRgb[0] * (1 - a)
            cols[k * 3 + 1] = px[o + 1] + bgRgb[1] * (1 - a)
            cols[k * 3 + 2] = px[o + 2] + bgRgb[2] * (1 - a)
            opaque[k] = true
          } else if (a >= threshold && a > 0) {
            cols[k * 3] = px[o] / a
            cols[k * 3 + 1] = px[o + 1] / a
            cols[k * 3 + 2] = px[o + 2] / a
            opaque[k] = true
          } else opaque[k] = false
          if (opaque[k]) nOpaque++
        }
      }
      const idx = cy * columns + cx
      if (mode === 'ascii') {
        if (!nOpaque) {
          cells[idx] = { ch: ' ', fg: null, bg: bgNum }
          continue
        }
        let r = 0, g = 0, b = 0
        for (let k = 0; k < n; k++) if (opaque[k]) { r += cols[k * 3]; g += cols[k * 3 + 1]; b += cols[k * 3 + 2] }
        r /= nOpaque; g /= nOpaque; b /= nOpaque
        let lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
        if (bgRgb) lum = Math.abs(lum - bgLum)
        lum *= nOpaque / n
        const c = ramp[Math.min(ramp.length - 1, Math.round(lum * (ramp.length - 1)))]
        cells[idx] = { ch: c, fg: c === ' ' ? null : pack(r, g, b), bg: bgNum }
        continue
      }
      if (!nOpaque) {
        cells[idx] = { ch: ' ', fg: null, bg: null }
        continue
      }
      if (nOpaque < n) {
        // transparent pixels form the background group
        let r = 0, g = 0, b = 0, mask = 0
        for (let k = 0; k < n; k++) {
          if (!opaque[k]) continue
          mask |= 1 << k
          r += cols[k * 3]; g += cols[k * 3 + 1]; b += cols[k * 3 + 2]
        }
        cells[idx] = { ch: glyphFor(mode, mask), fg: pack(r / nOpaque, g / nOpaque, b / nOpaque), bg: null }
        continue
      }
      // all opaque: split into two colors
      let bi = 0, bj = 0, best = -1
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const d = dist2(cols, i * 3, cols, j * 3)
        if (d > best) { best = d; bi = i; bj = j }
      }
      if (best <= 24) {
        // uniform cell
        let r = 0, g = 0, b = 0
        for (let k = 0; k < n; k++) { r += cols[k * 3]; g += cols[k * 3 + 1]; b += cols[k * 3 + 2] }
        cells[idx] = { ch: ' ', fg: null, bg: pack(r / n, g / n, b / n) }
        continue
      }
      seedA[0] = cols[bi * 3]; seedA[1] = cols[bi * 3 + 1]; seedA[2] = cols[bi * 3 + 2]
      seedB[0] = cols[bj * 3]; seedB[1] = cols[bj * 3 + 1]; seedB[2] = cols[bj * 3 + 2]
      let mask = 0
      for (let iter = 0; iter < 2; iter++) {
        mask = 0
        let ar = 0, ag = 0, ab = 0, an = 0, br = 0, bg = 0, bb = 0, bn = 0
        for (let k = 0; k < n; k++) {
          if (dist2(cols, k * 3, seedA, 0) <= dist2(cols, k * 3, seedB, 0)) {
            mask |= 1 << k
            ar += cols[k * 3]; ag += cols[k * 3 + 1]; ab += cols[k * 3 + 2]; an++
          } else {
            br += cols[k * 3]; bg += cols[k * 3 + 1]; bb += cols[k * 3 + 2]; bn++
          }
        }
        if (an) { seedA[0] = ar / an; seedA[1] = ag / an; seedA[2] = ab / an }
        if (bn) { seedB[0] = br / bn; seedB[1] = bg / bn; seedB[2] = bb / bn }
      }
      let fg = pack(seedA[0], seedA[1], seedA[2])
      let bg = pack(seedB[0], seedB[1], seedB[2])
      if (mode === 'braille') {
        // dots = the cluster that stands out from the background
        const ref = bgRgb ?? [0, 0, 0]
        if (dist2(seedA, 0, ref, 0) < dist2(seedB, 0, ref, 0)) {
          mask = ~mask & full
          ;[fg, bg] = [bg, fg]
        }
      } else if (!(mask & 1)) {
        // canonical form: the top-left pixel is always foreground
        mask = ~mask & full
        ;[fg, bg] = [bg, fg]
      }
      if (mask === full) cells[idx] = { ch: ' ', fg: null, bg: fg }
      else cells[idx] = { ch: glyphFor(mode, mask), fg, bg }
    }
  }
  return { columns, rows, cells }
}

/**
 * Computes the cell box that shows a `width × height` pixel image inside a
 * `columns × rows` cell area with the given fit, assuming cells are twice as
 * tall as they are wide. Returns the image's position and size in cells.
 */
export function fitCells(width: number, height: number, columns: number, rows: number, fit: 'contain' | 'cover' | 'fill' | 'none' = 'contain', mode: CellMode = 'halfblock') {
  if (fit === 'fill' || !width || !height) return { x: 0, y: 0, columns, rows }
  const [cw] = MODE_RESOLUTION[mode]
  // natural size in cells with square pixels: one pixel = 1/cw cell wide, 2/cw... cells are 1:2
  const natCols = width / cw
  const natRows = height / (2 * cw)
  let s: number
  if (fit === 'none') s = 1
  else if (fit === 'cover') s = Math.max(columns / natCols, rows / natRows)
  else s = Math.min(columns / natCols, rows / natRows)
  const c = Math.max(1, Math.round(natCols * s))
  const r = Math.max(1, Math.round(natRows * s))
  return { x: Math.floor((columns - c) / 2), y: Math.floor((rows - r) / 2), columns: c, rows: r }
}
