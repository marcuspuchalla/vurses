/**
 * The minimal cell-grid shape shared by the server (`CellBuffer`) and the
 * frame player (`Screen`). Wide (2-cell) glyphs occupy their cell plus a
 * continuation cell holding ''.
 */
export interface CellGrid {
  readonly width: number
  readonly height: number
  readonly chars: ArrayLike<string>
  /** SGR color parameters ('' = default), e.g. `38;2;255;0;0`. */
  readonly fg: ArrayLike<string>
  readonly bg: ArrayLike<string>
  /** Bitmask: 1 bold, 2 dim, 4 italic, 8 underline, 16 inverse, 32 strike. */
  readonly flags: ArrayLike<number>
}

/** A mutable grid (player-side screen model). Structurally a `CellGrid`. */
export class Screen implements CellGrid {
  readonly chars: string[]
  readonly fg: string[]
  readonly bg: string[]
  readonly flags: number[]
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    const n = width * height
    this.chars = new Array(n).fill(' ')
    this.fg = new Array(n).fill('')
    this.bg = new Array(n).fill('')
    this.flags = new Array(n).fill(0)
  }
}

/** 32-bit FNV-1a hash of one row (glyphs and styles). */
export function hashRow(g: CellGrid, y: number): number {
  let h = 0x811c9dc5
  const mix = (s: string) => {
    for (let k = 0; k < s.length; k++) {
      h ^= s.charCodeAt(k)
      h = Math.imul(h, 0x01000193)
    }
    h ^= 0x1f
    h = Math.imul(h, 0x01000193)
  }
  const base = y * g.width
  for (let x = 0; x < g.width; x++) {
    const i = base + x
    mix(g.chars[i])
    mix(g.fg[i])
    mix(g.bg[i])
    h ^= g.flags[i] + 0x100
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Per-row hashes of a grid. */
export function hashRows(g: CellGrid): Uint32Array {
  const out = new Uint32Array(g.height)
  for (let y = 0; y < g.height; y++) out[y] = hashRow(g, y)
  return out
}

/** Plain text of a grid (trailing spaces trimmed per row, trailing blank rows dropped). */
export function gridText(g: CellGrid): string {
  const rows: string[] = []
  for (let y = 0; y < g.height; y++) {
    let row = ''
    for (let x = 0; x < g.width; x++) row += g.chars[y * g.width + x]
    rows.push(row.replace(/\s+$/, ''))
  }
  while (rows.length && rows[rows.length - 1] === '') rows.pop()
  return rows.join('\n')
}
