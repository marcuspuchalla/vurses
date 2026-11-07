/** Turning cells into ANSI escape sequences: whole frames and minimal diffs. */
import type { Cell, EncodedCells } from './cells.js'

export type ColorDepth = 'truecolor' | 256 | 16

const ESC = '\x1b['

/** Nearest xterm-256 color index for an RGB value. */
export function rgbTo256(rgb: number): number {
  const r = (rgb >> 16) & 255, g = (rgb >> 8) & 255, b = rgb & 255
  const q = (v: number) => (v < 48 ? 0 : v < 115 ? 1 : Math.floor((v - 35) / 40))
  const qr = q(r), qg = q(g), qb = q(b)
  const levels = [0, 95, 135, 175, 215, 255]
  const cube = 16 + 36 * qr + 6 * qg + qb
  const cd = (levels[qr] - r) ** 2 + (levels[qg] - g) ** 2 + (levels[qb] - b) ** 2
  const avg = (r + g + b) / 3
  const gi = Math.max(0, Math.min(23, Math.round((avg - 8) / 10)))
  const gv = 8 + gi * 10
  const gd = (gv - r) ** 2 + (gv - g) ** 2 + (gv - b) ** 2
  return gd < cd ? 232 + gi : cube
}

const BASIC16 = [
  0x000000, 0x800000, 0x008000, 0x808000, 0x000080, 0x800080, 0x008080, 0xc0c0c0,
  0x808080, 0xff0000, 0x00ff00, 0xffff00, 0x0000ff, 0xff00ff, 0x00ffff, 0xffffff,
]
/** Nearest of the 16 basic ANSI colors (0-15). */
export function rgbTo16(rgb: number): number {
  let best = 0, bd = Infinity
  for (let i = 0; i < 16; i++) {
    const c = BASIC16[i]
    const d = (((c >> 16) & 255) - ((rgb >> 16) & 255)) ** 2 + (((c >> 8) & 255) - ((rgb >> 8) & 255)) ** 2 + ((c & 255) - (rgb & 255)) ** 2
    if (d < bd) { bd = d; best = i }
  }
  return best
}

/** SGR parameters for a color (without ESC[ and m), e.g. "38;2;255;0;0". */
export function sgrColor(rgb: number | null, layer: 'fg' | 'bg', depth: ColorDepth = 'truecolor'): string {
  if (rgb === null) return layer === 'fg' ? '39' : '49'
  if (depth === 'truecolor') return `${layer === 'fg' ? 38 : 48};2;${(rgb >> 16) & 255};${(rgb >> 8) & 255};${rgb & 255}`
  if (depth === 256) return `${layer === 'fg' ? 38 : 48};5;${rgbTo256(rgb)}`
  const n = rgbTo16(rgb)
  return String((layer === 'fg' ? 30 : 40) + (n & 7) + (n >= 8 ? 60 : 0))
}

/** Renders cells as plain ANSI text (one line per row, each ending with a reset). */
export function cellsToAnsi(enc: EncodedCells, opts: { colorDepth?: ColorDepth } = {}): string {
  const depth = opts.colorDepth ?? 'truecolor'
  const lines: string[] = []
  for (let y = 0; y < enc.rows; y++) {
    let line = ''
    let fg: number | null | undefined
    let bg: number | null | undefined
    for (let x = 0; x < enc.columns; x++) {
      const c = enc.cells[y * enc.columns + x]
      const sgr: string[] = []
      const cfg = c.ch === ' ' ? fg ?? null : c.fg
      if (cfg !== fg) { sgr.push(sgrColor(cfg, 'fg', depth)); fg = cfg }
      if (c.bg !== bg) { sgr.push(sgrColor(c.bg, 'bg', depth)); bg = c.bg }
      if (sgr.length) line += `${ESC}${sgr.join(';')}m`
      line += c.ch
    }
    lines.push(line + `${ESC}0m`)
  }
  return lines.join('\n')
}

const sameCell = (a: Cell, b: Cell) => a.ch === b.ch && a.fg === b.fg && a.bg === b.bg

/**
 * Minimal ANSI update from `prev` to `next` (same size), drawn at the
 * 0-based screen offset (ox, oy). `prev = null` repaints everything.
 */
export function diffCells(prev: EncodedCells | null, next: EncodedCells, opts: { x?: number; y?: number; colorDepth?: ColorDepth } = {}): string {
  const ox = opts.x ?? 0, oy = opts.y ?? 0
  const depth = opts.colorDepth ?? 'truecolor'
  const full = !prev || prev.columns !== next.columns || prev.rows !== next.rows
  let out = ''
  let fg: number | null | undefined
  let bg: number | null | undefined
  let cursorX = -1, cursorY = -1
  for (let y = 0; y < next.rows; y++) {
    for (let x = 0; x < next.columns; x++) {
      const i = y * next.columns + x
      const c = next.cells[i]
      if (!full && sameCell(c, prev!.cells[i])) continue
      if (cursorY !== y || cursorX !== x) out += `${ESC}${oy + y + 1};${ox + x + 1}H`
      const sgr: string[] = []
      if (c.fg !== fg) { sgr.push(sgrColor(c.fg, 'fg', depth)); fg = c.fg }
      if (c.bg !== bg) { sgr.push(sgrColor(c.bg, 'bg', depth)); bg = c.bg }
      if (sgr.length) out += `${ESC}${sgr.join(';')}m`
      out += c.ch
      cursorX = x + 1
      cursorY = y
    }
  }
  if (out) out += `${ESC}0m`
  return out
}
