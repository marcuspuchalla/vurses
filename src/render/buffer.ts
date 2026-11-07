/**
 * A grid of terminal cells. Each cell has a grapheme, a foreground SGR, a
 * background SGR and attribute flags. Wide (2-cell) glyphs occupy their cell
 * plus a continuation cell holding ''.
 */

export const enum Flag {
  Bold = 1,
  Dim = 2,
  Italic = 4,
  Underline = 8,
  Inverse = 16,
  Strike = 32,
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export function intersect(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const r = Math.min(a.x + a.width, b.x + b.width)
  const btm = Math.min(a.y + a.height, b.y + b.height)
  return { x, y, width: Math.max(0, r - x), height: Math.max(0, btm - y) }
}

export function contains(r: Rect, x: number, y: number) {
  return x >= r.x && y >= r.y && x < r.x + r.width && y < r.y + r.height
}

export class CellBuffer {
  readonly chars: string[]
  readonly fg: string[]
  readonly bg: string[]
  readonly flags: Uint8Array

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    const n = width * height
    this.chars = new Array(n).fill(' ')
    this.fg = new Array(n).fill('')
    this.bg = new Array(n).fill('')
    this.flags = new Uint8Array(n)
  }

  /**
   * Writes a glyph. `bg === null` keeps the existing background (text drawn on
   * top of a filled box keeps the box color).
   */
  set(x: number, y: number, ch: string, w: number, fg: string, bg: string | null, flags: number, clip?: Rect) {
    if (y < 0 || y >= this.height || x < 0 || x >= this.width) return
    if (clip && !contains(clip, x, y)) return
    if (w === 2 && (x + 1 >= this.width || (clip && !contains(clip, x + 1, y)))) {
      ch = ' '
      w = 1
    }
    const i = y * this.width + x
    // overwriting the continuation half of a wide glyph: blank its head
    if (this.chars[i] === '' && x > 0) this.chars[i - 1] = ' '
    // overwriting a wide head with a narrow glyph: blank the old continuation
    if (w === 1 && x + 1 < this.width && this.chars[i + 1] === '') this.chars[i + 1] = ' '
    this.chars[i] = ch
    this.fg[i] = fg
    if (bg !== null) this.bg[i] = bg
    this.flags[i] = flags
    if (w === 2) {
      const j = i + 1
      if (x + 2 < this.width && this.chars[j + 1] === '') this.chars[j + 1] = ' '
      this.chars[j] = ''
      this.fg[j] = fg
      if (bg !== null) this.bg[j] = bg
      this.flags[j] = flags
    }
  }

  fill(rect: Rect, bg: string) {
    const x2 = Math.min(this.width, rect.x + rect.width)
    const y2 = Math.min(this.height, rect.y + rect.height)
    for (let y = Math.max(0, rect.y); y < y2; y++) {
      for (let x = Math.max(0, rect.x); x < x2; x++) {
        const i = y * this.width + x
        if (this.chars[i] === '' && x === rect.x && x > 0) this.chars[i - 1] = ' '
        this.chars[i] = ' '
        this.fg[i] = ''
        this.bg[i] = bg
        this.flags[i] = 0
      }
      if (x2 < this.width && this.chars[y * this.width + x2] === '') this.chars[y * this.width + x2] = ' '
    }
  }

  /** Applies dim to every cell of the rect (used for modal backdrops). */
  dim(rect: Rect) {
    const x2 = Math.min(this.width, rect.x + rect.width)
    const y2 = Math.min(this.height, rect.y + rect.height)
    for (let y = Math.max(0, rect.y); y < y2; y++)
      for (let x = Math.max(0, rect.x); x < x2; x++) this.flags[y * this.width + x] |= Flag.Dim
  }

  sameCell(other: CellBuffer, i: number) {
    return (
      this.chars[i] === other.chars[i] &&
      this.fg[i] === other.fg[i] &&
      this.bg[i] === other.bg[i] &&
      this.flags[i] === other.flags[i]
    )
  }

  /** Plain text of the buffer (trailing spaces trimmed per row). */
  toString(): string {
    const rows: string[] = []
    for (let y = 0; y < this.height; y++) {
      let row = ''
      for (let x = 0; x < this.width; x++) row += this.chars[y * this.width + x]
      rows.push(row.replace(/\s+$/, ''))
    }
    while (rows.length && rows[rows.length - 1] === '') rows.pop()
    return rows.join('\n')
  }
}

function sgr(fg: string, bg: string, flags: number): string {
  let s = '0'
  if (flags & Flag.Bold) s += ';1'
  if (flags & Flag.Dim) s += ';2'
  if (flags & Flag.Italic) s += ';3'
  if (flags & Flag.Underline) s += ';4'
  if (flags & Flag.Inverse) s += ';7'
  if (flags & Flag.Strike) s += ';9'
  if (fg) s += ';' + fg
  if (bg) s += ';' + bg
  return `\x1b[${s}m`
}

function emitRange(buf: CellBuffer, y: number, from: number, to: number, out: string[], state: { key: string }) {
  out.push(`\x1b[${y + 1};${from + 1}H`)
  let s = ''
  for (let x = from; x <= to; x++) {
    const i = y * buf.width + x
    const ch = buf.chars[i]
    if (ch === '') continue
    const key = buf.fg[i] + '|' + buf.bg[i] + '|' + buf.flags[i]
    if (key !== state.key) {
      s += sgr(buf.fg[i], buf.bg[i], buf.flags[i])
      state.key = key
    }
    s += ch
  }
  out.push(s)
}

/**
 * Computes the minimal escape sequence that transforms `prev` into `next`.
 * Only rows (and within them, only the span) that changed are emitted.
 */
export function diffBuffers(prev: CellBuffer | null, next: CellBuffer): string {
  const out: string[] = []
  const state = { key: '' }
  const full = !prev || prev.width !== next.width || prev.height !== next.height
  if (full) out.push('\x1b[0m\x1b[H\x1b[2J')
  for (let y = 0; y < next.height; y++) {
    let from = -1
    let to = -1
    if (full) {
      from = 0
      to = next.width - 1
    } else {
      const base = y * next.width
      for (let x = 0; x < next.width; x++) {
        if (!next.sameCell(prev!, base + x)) {
          if (from < 0) from = x
          to = x
        }
      }
      if (from < 0) continue
      // never start on the continuation half of a wide glyph
      while (from > 0 && next.chars[base + from] === '') from--
    }
    emitRange(next, y, from, to, out, state)
  }
  if (out.length === 0) return ''
  out.push('\x1b[0m')
  return out.join('')
}
