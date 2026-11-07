/**
 * Frame serialization shared by the devtools hook, the MCP server, the VS Code
 * preview and the Chrome DevTools panel. Browser-safe.
 */
import type { CellBuffer } from '../render/buffer.js'

/** Cell attribute bits (same as `Flag` in render/buffer.ts). */
export const FLAGS = { bold: 1, dim: 2, italic: 4, underline: 8, inverse: 16, strike: 32 } as const

/** A run of cells with the same style. Colors are CSS colors (`#rrggbb`), absent = terminal default. */
export interface FrameRun {
  /** Text of the run (wide glyphs count as 2 cells but appear once). */
  t: string
  /** Width of the run in cells. */
  w: number
  fg?: string
  bg?: string
  /** Attribute bitmask (see FLAGS). */
  f?: number
}

/** A JSON-serializable copy of a frame. */
export interface FrameSnapshot {
  width: number
  height: number
  /** Frame counter of the runtime, if known. */
  frame?: number
  /** Plain-text rows (not trimmed). */
  lines: string[]
  /** Styled runs per row. */
  rows: FrameRun[][]
}

const ANSI16: [number, number, number][] = [
  [0, 0, 0], [205, 49, 49], [13, 188, 121], [229, 229, 16],
  [36, 114, 200], [188, 63, 188], [17, 168, 205], [229, 229, 229],
  [102, 102, 102], [241, 76, 76], [35, 209, 139], [245, 245, 67],
  [59, 142, 234], [214, 112, 214], [41, 184, 219], [255, 255, 255],
]

const hex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, '0')).join('')

function xterm256(n: number): [number, number, number] {
  if (n < 16) return ANSI16[n]
  if (n < 232) {
    const i = n - 16
    const c = [Math.floor(i / 36), Math.floor(i / 6) % 6, i % 6].map((v) => (v === 0 ? 0 : 55 + v * 40))
    return c as [number, number, number]
  }
  const g = 8 + (n - 232) * 10
  return [g, g, g]
}

const cssCache = new Map<string, string | undefined>()

/**
 * Converts an SGR color parameter string from a `CellBuffer` (`31`, `97`,
 * `38;5;208`, `48;2;10;20;30`) to a CSS hex color. Empty → undefined (default).
 */
export function sgrToCss(sgr: string): string | undefined {
  if (!sgr) return undefined
  if (cssCache.has(sgr)) return cssCache.get(sgr)
  let out: string | undefined
  const p = sgr.split(';').map(Number)
  if ((p[0] === 38 || p[0] === 48) && p[1] === 2 && p.length >= 5) out = hex(p[2], p[3], p[4])
  else if ((p[0] === 38 || p[0] === 48) && p[1] === 5 && p.length >= 3) out = hex(...xterm256(p[2] & 255))
  else if (p.length === 1) {
    const c = p[0]
    let idx = -1
    if (c >= 30 && c <= 37) idx = c - 30
    else if (c >= 40 && c <= 47) idx = c - 40
    else if (c >= 90 && c <= 97) idx = c - 90 + 8
    else if (c >= 100 && c <= 107) idx = c - 100 + 8
    if (idx >= 0) out = hex(...ANSI16[idx])
  }
  cssCache.set(sgr, out)
  return out
}

/** Plain text of one buffer row (not trimmed). */
export function rowText(buf: CellBuffer, y: number): string {
  let s = ''
  for (let x = 0; x < buf.width; x++) s += buf.chars[y * buf.width + x]
  return s
}

/** Converts a buffer to a JSON-serializable snapshot with CSS colors. */
export function snapshotFrame(buf: CellBuffer, frame?: number): FrameSnapshot {
  const lines: string[] = []
  const rows: FrameRun[][] = []
  for (let y = 0; y < buf.height; y++) {
    lines.push(rowText(buf, y))
    const runs: FrameRun[] = []
    let cur: FrameRun | null = null
    let key = ''
    for (let x = 0; x < buf.width; x++) {
      const i = y * buf.width + x
      const ch = buf.chars[i]
      if (ch === '') {
        if (cur) cur.w++
        continue
      }
      const k = buf.fg[i] + '|' + buf.bg[i] + '|' + buf.flags[i]
      if (!cur || k !== key) {
        cur = { t: '', w: 0 }
        const fg = sgrToCss(buf.fg[i])
        const bg = sgrToCss(buf.bg[i])
        if (fg) cur.fg = fg
        if (bg) cur.bg = bg
        if (buf.flags[i]) cur.f = buf.flags[i]
        runs.push(cur)
        key = k
      }
      cur.t += ch
      cur.w++
    }
    rows.push(runs)
  }
  return { width: buf.width, height: buf.height, frame, lines, rows }
}

/** Plain text of a frame (trailing whitespace trimmed per row, trailing empty rows dropped). */
export function frameToText(buf: CellBuffer): string {
  return buf.toString()
}

function sgr(fg: string, bg: string, flags: number) {
  let s = '0'
  if (flags & 1) s += ';1'
  if (flags & 2) s += ';2'
  if (flags & 4) s += ';3'
  if (flags & 8) s += ';4'
  if (flags & 16) s += ';7'
  if (flags & 32) s += ';9'
  if (fg) s += ';' + fg
  if (bg) s += ';' + bg
  return `\x1b[${s}m`
}

/**
 * The frame as ANSI text: one line per row with SGR escapes, reset at the end
 * of each row. Prints correctly with `console.log` / `cat`.
 */
export function frameToAnsi(buf: CellBuffer): string {
  const out: string[] = []
  for (let y = 0; y < buf.height; y++) {
    let line = ''
    let key = '||0'
    // drop trailing default cells
    let end = buf.width - 1
    while (end >= 0) {
      const i = y * buf.width + end
      if ((buf.chars[i] === ' ' || buf.chars[i] === '') && !buf.bg[i] && !(buf.flags[i] & (8 | 16))) end--
      else break
    }
    for (let x = 0; x <= end; x++) {
      const i = y * buf.width + x
      const ch = buf.chars[i]
      if (ch === '') continue
      const k = buf.fg[i] + '|' + buf.bg[i] + '|' + buf.flags[i]
      if (k !== key) {
        line += sgr(buf.fg[i], buf.bg[i], buf.flags[i])
        key = k
      }
      line += ch
    }
    if (key !== '||0') line += '\x1b[0m'
    out.push(line)
  }
  while (out.length && out[out.length - 1] === '') out.pop()
  return out.join('\n')
}

export interface StyleSpan {
  row: number
  col: number
  /** Width in cells. */
  width: number
  text: string
  fg?: string
  bg?: string
  bold?: true
  dim?: true
  italic?: true
  underline?: true
  inverse?: true
  strike?: true
}

/** Decodes an attribute bitmask into named booleans. */
export function decodeFlags(f: number | undefined): Partial<Record<keyof typeof FLAGS, true>> {
  const out: Partial<Record<keyof typeof FLAGS, true>> = {}
  if (!f) return out
  for (const [name, bit] of Object.entries(FLAGS)) if (f & bit) out[name as keyof typeof FLAGS] = true
  return out
}

/**
 * All styled spans of a frame (runs that have a color or an attribute), with
 * cell positions. Unstyled whitespace is omitted. Used by MCP `read_frame`.
 */
export function styleSpans(buf: CellBuffer): StyleSpan[] {
  const snap = snapshotFrame(buf)
  const spans: StyleSpan[] = []
  snap.rows.forEach((runs, row) => {
    let col = 0
    for (const r of runs) {
      if (r.fg || r.bg || r.f) {
        if (r.t.trim() || r.bg || (r.f ?? 0) & (8 | 16)) {
          spans.push({ row, col, width: r.w, text: r.t, ...(r.fg && { fg: r.fg }), ...(r.bg && { bg: r.bg }), ...decodeFlags(r.f) })
        }
      }
      col += r.w
    }
  })
  return spans
}

/**
 * Finds the cell position of the first occurrence of `text` (wide-glyph aware).
 * `nth` selects a later occurrence (0-based).
 */
export function locateText(buf: CellBuffer, text: string, nth = 0): { x: number; y: number } | null {
  if (!text) return null
  let seen = 0
  for (let y = 0; y < buf.height; y++) {
    // map string index → cell x
    let s = ''
    const xs: number[] = []
    for (let x = 0; x < buf.width; x++) {
      const ch = buf.chars[y * buf.width + x]
      if (ch === '') continue
      for (let k = 0; k < ch.length; k++) xs.push(x)
      s += ch
    }
    let from = 0
    for (;;) {
      const idx = s.indexOf(text, from)
      if (idx < 0) break
      if (seen++ === nth) return { x: xs[idx], y }
      from = idx + 1
    }
  }
  return null
}

/** Rows that differ between two buffers (all rows when `prev` is null or sizes differ). */
export function changedRows(next: CellBuffer, prev: CellBuffer | null): number {
  if (!prev || prev.width !== next.width || prev.height !== next.height) return next.height
  let n = 0
  for (let y = 0; y < next.height; y++) {
    for (let x = 0; x < next.width; x++) {
      if (!next.sameCell(prev, y * next.width + x)) {
        n++
        break
      }
    }
  }
  return n
}
