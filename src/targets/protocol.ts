/**
 * Frame delta protocol: how a server-side session streams its screen to a
 * frame player (SSE `frame` events, JSON).
 *
 * ```jsonc
 * {
 *   "n": 12,                 // frame sequence number (per session)
 *   "w": 80, "h": 24,        // screen size
 *   "full": 1,               // optional: clear the screen to blanks before applying rows
 *   "reset": 1,              // optional: clear the style table before applying `s`
 *   "s": [[3, "38;2;255;0;0", "", 1]],   // new styles: [id, fg SGR, bg SGR, flags]
 *   "r": [                   // changed rows
 *     [4, 10, 3, "hello", 0, " "],       // [y, x, styleId, cells, styleId, cells, ...]
 *     [5, 0, 1, ["界", "", "!"]]          // cells: string = one cell per UTF-16 unit,
 *   ]                                    //        array = explicit cells ('' = wide continuation)
 * }
 * ```
 *
 * Each row entry rewrites the cells from `x` to the end of its spans; cells
 * outside are kept. Styles are interned per session: an id is sent once,
 * the first time a frame uses it. A full frame omits rows that are entirely
 * blank (space, default colors, no flags).
 *
 * Browser-safe and dependency-free (the frame player bundles it).
 */
import { Screen, type CellGrid } from './grid.js'

export type StyleDef = [id: number, fg: string, bg: string, flags: number]
export type RowDelta = (number | string | string[])[]

export interface FrameDelta {
  n: number
  w: number
  h: number
  full?: 1
  reset?: 1
  s?: StyleDef[]
  r: RowDelta[]
}

const BLANK_KEY = '||0'

/** Server side: turns successive grids into deltas against what the client already has. */
export class DeltaEncoder {
  private styles = new Map<string, number>()
  private shadow: Screen | null = null
  private seq = 0
  private sentStyles = false

  /** Forget the client state: the next `encode` produces a full frame (and resets styles). */
  reset() {
    this.shadow = null
    this.styles.clear()
    this.sentStyles = false
  }

  /** Returns null when nothing changed. */
  encode(next: CellGrid): FrameDelta | null {
    const full = !this.shadow || this.shadow.width !== next.width || this.shadow.height !== next.height
    const shadow = full ? new Screen(next.width, next.height) : this.shadow!
    const newStyles: StyleDef[] = []
    const rows: RowDelta[] = []
    const w = next.width
    for (let y = 0; y < next.height; y++) {
      const base = y * w
      let from = -1
      let to = -1
      for (let x = 0; x < w; x++) {
        const i = base + x
        if (
          next.chars[i] !== shadow.chars[i] ||
          next.fg[i] !== shadow.fg[i] ||
          next.bg[i] !== shadow.bg[i] ||
          next.flags[i] !== shadow.flags[i]
        ) {
          if (from < 0) from = x
          to = x
        }
      }
      if (from < 0) continue
      while (from > 0 && next.chars[base + from] === '') from--
      const row: RowDelta = [y, from]
      let runStyle = -1
      let cells: string[] = []
      const push = () => {
        if (runStyle < 0) return
        row.push(runStyle, cells.every((c) => c.length === 1) ? cells.join('') : cells)
      }
      for (let x = from; x <= to; x++) {
        const i = base + x
        const key = next.fg[i] + '|' + next.bg[i] + '|' + next.flags[i]
        let id = this.styles.get(key)
        if (id === undefined) {
          id = this.styles.size
          this.styles.set(key, id)
          newStyles.push([id, next.fg[i], next.bg[i], next.flags[i]])
        }
        if (id !== runStyle) {
          push()
          runStyle = id
          cells = []
        }
        cells.push(next.chars[i])
        shadow.chars[i] = next.chars[i]
        shadow.fg[i] = next.fg[i]
        shadow.bg[i] = next.bg[i]
        shadow.flags[i] = next.flags[i]
      }
      push()
      rows.push(row)
    }
    this.shadow = shadow
    if (!full && rows.length === 0) return null
    const delta: FrameDelta = { n: ++this.seq, w: next.width, h: next.height, r: rows }
    if (full) delta.full = 1
    if (!this.sentStyles) {
      delta.reset = 1
      this.sentStyles = true
    }
    if (newStyles.length) delta.s = newStyles
    return delta
  }
}

/** Client side: the screen model a player keeps. */
export class ScreenState {
  screen = new Screen(0, 0)
  readonly styles = new Map<number, [fg: string, bg: string, flags: number]>()
  seq = 0

  /**
   * Applies a delta. Returns the indices of the rows that changed (all rows on
   * a full frame or resize).
   */
  apply(d: FrameDelta): number[] {
    if (d.reset) this.styles.clear()
    if (d.s) for (const [id, fg, bg, fl] of d.s) this.styles.set(id, [fg, bg, fl])
    let changed: number[]
    if (d.full || d.w !== this.screen.width || d.h !== this.screen.height) {
      this.screen = new Screen(d.w, d.h)
      changed = Array.from({ length: d.h }, (_, i) => i)
    } else changed = []
    const s = this.screen
    for (const row of d.r) {
      const y = row[0] as number
      let x = row[1] as number
      if (!d.full) changed.push(y)
      for (let k = 2; k < row.length; k += 2) {
        const st = this.styles.get(row[k] as number) ?? (['', '', 0] as const)
        const cells = row[k + 1] as string | string[]
        for (let c = 0; c < cells.length && x < s.width; c++, x++) {
          const i = y * s.width + x
          s.chars[i] = cells[c]
          s.fg[i] = st[0]
          s.bg[i] = st[1]
          s.flags[i] = st[2]
        }
      }
    }
    this.seq = d.n
    return changed
  }
}

/** Is a full-frame row entirely blank (so it can be skipped)? Exposed for tests/tools. */
export function isBlankRow(g: CellGrid, y: number) {
  for (let x = 0; x < g.width; x++) {
    const i = y * g.width + x
    if (g.chars[i] !== ' ' || g.fg[i] + '|' + g.bg[i] + '|' + g.flags[i] !== BLANK_KEY) return false
  }
  return true
}
