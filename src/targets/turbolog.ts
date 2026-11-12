/**
 * Turbolog: renders a cell grid into the browser devtools console.
 *
 *   grid -> dirty gate (row hashes; unchanged frames stop here)
 *        -> encode (run-length: consecutive cells with the same style become one `%c` span)
 *        -> ONE `console.log(format, ...css)` per changed frame
 *
 * Frames are appended (never `console.clear()`, which flashes a blank console)
 * and throttled to at least `minInterval` ms apart; frames arriving faster are
 * coalesced so the latest one wins.
 *
 * Shared by the browser console target and the frame player. Browser-safe,
 * no dependencies beyond ./css and ./grid.
 */
import { defaultPalette, styleCss, type Palette } from './css.js'
import { hashRows, type CellGrid } from './grid.js'

export interface TurbologFrame {
  /** Format string: `%c<text>%c<text>...` with `%` escaped as `%%`. */
  format: string
  /** One CSS string per `%c`. */
  styles: string[]
  /**
   * Arguments after the format string, in order: the CSS strings and, when
   * `links` were given, one object per `%o` link. Equals `styles` otherwise.
   */
  args: unknown[]
}

/** One styled piece of a console link's label. */
export interface LinkPart {
  text: string
  css: string
}

/**
 * Clickable cells. A run of cells with the same id on one row is emitted as a
 * `%o` object made by `make` (rendered by a devtools custom formatter).
 */
export interface ConsoleLinks {
  /** Per cell (`y * width + x`): link id, or -1. */
  cells: ArrayLike<number>
  make(id: number, parts: LinkPart[]): unknown
  /**
   * Plain cells removed after each link to make room for the expand triangle
   * the console draws in front of it (only doubled / trailing spaces). Default: 2.
   */
  slack?: number
}

export interface EncodeOptions {
  palette?: Palette
  /** Extra CSS appended to every span (e.g. `font-size:12px`). */
  baseCss?: string
  /** Clickable regions (see `ConsoleLinks`). */
  links?: ConsoleLinks
}

/**
 * Encodes a grid as one console message. Runs of cells with an identical
 * style (across row boundaries too) share a single `%c` span, so a typical
 * 80x40 screen of 3,200 cells becomes ~100-200 spans.
 */
export function encodeTurbolog(g: CellGrid, options: EncodeOptions = {}): TurbologFrame {
  const palette = options.palette ?? defaultPalette
  const base = options.baseCss ? ';' + options.baseCss : ''
  const links = options.links
  const slack = links?.slack ?? 2
  const cssCache = new Map<string, string>()
  const cssOf = (i: number) => {
    const k = g.fg[i] + '|' + g.bg[i] + '|' + g.flags[i]
    let css = cssCache.get(k)
    if (css === undefined) {
      css = styleCss(g.fg[i], g.bg[i], g.flags[i], palette) + base
      cssCache.set(k, css)
    }
    return css
  }
  const styles: string[] = []
  const args: unknown[] = []
  let format = ''
  let text = ''
  let key: string | null = null
  const close = () => {
    if (key !== null) format += '%c' + text
    text = ''
  }
  for (let y = 0; y < g.height; y++) {
    const row = y * g.width
    let debt = 0
    for (let x = 0; x < g.width; x++) {
      const i = row + x
      const ch = g.chars[i]
      if (ch === '') continue // continuation half of a wide glyph
      const id = links ? links.cells[i] : -1
      if (id >= 0) {
        // a link: one `%o` object for the run of cells with this id
        close()
        key = null
        const parts: LinkPart[] = []
        let x2 = x
        for (; x2 < g.width && links!.cells[row + x2] === id; x2++) {
          const c = g.chars[row + x2]
          if (c === '') continue
          const css = cssOf(row + x2)
          const last = parts[parts.length - 1]
          if (last && last.css === css) last.text += c
          else parts.push({ text: c, css })
        }
        format += '%o'
        args.push(links!.make(id, parts))
        x = x2 - 1
        debt = slack
        continue
      }
      // make room for the link's expand triangle: drop doubled / trailing spaces
      if (debt > 0 && ch === ' ' && (x === g.width - 1 || g.chars[i + 1] === ' ')) {
        debt--
        continue
      }
      const k = g.fg[i] + '|' + g.bg[i] + '|' + g.flags[i]
      if (k !== key) {
        close()
        key = k
        const css = cssOf(i)
        styles.push(css)
        args.push(css)
      }
      text += ch === '%' ? '%%' : ch
    }
    if (y < g.height - 1) {
      if (key === null) {
        // a row ending in a link: the newline needs a span of its own
        key = '\n'
        styles.push(base.slice(1))
        args.push(base.slice(1))
      }
      text += '\n'
    }
  }
  close()
  return { format, styles, args }
}

export interface ConsoleLike {
  log(...args: unknown[]): void
}

export interface TurbologOptions extends EncodeOptions {
  /** Where to log. Default: `globalThis.console`. */
  console?: ConsoleLike
  /** Minimum time between two emitted frames, in ms. Default: 66 (~15 fps). */
  minInterval?: number
  /** Clock (for tests). Default: `Date.now`. */
  now?: () => number
  /** Called after each emitted frame. */
  onEmit?(frame: TurbologFrame): void
}

export interface TurbologStats {
  /** Frames written to the console. */
  emitted: number
  /** Frames dropped by the dirty gate (no row changed). */
  unchanged: number
  /** Frames replaced by a newer one while waiting for the throttle. */
  coalesced: number
  /** Spans in the last emitted frame. */
  spans: number
  /** Format string length of the last emitted frame. */
  chars: number
}

/** Throttled, dirty-gated console presenter. */
export class Turbolog {
  readonly stats: TurbologStats = { emitted: 0, unchanged: 0, coalesced: 0, spans: 0, chars: 0 }
  private hashes: Uint32Array | null = null
  private width = -1
  private pending: TurbologFrame | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private lastEmit = -Infinity
  private readonly out: ConsoleLike
  private readonly minInterval: number
  private readonly now: () => number

  constructor(private options: TurbologOptions = {}) {
    this.out = options.console ?? globalThis.console
    this.minInterval = options.minInterval ?? 66
    this.now = options.now ?? Date.now
  }

  /**
   * Offers a frame. Returns false when the dirty gate dropped it (identical to
   * the last accepted frame), true when it was emitted or queued.
   */
  present(g: CellGrid, extra: { links?: ConsoleLinks; trailing?: unknown[] } = {}): boolean {
    const hashes = hashRows(g)
    const prev = this.hashes
    if (prev && this.width === g.width && prev.length === hashes.length && sameHashes(prev, hashes)) {
      this.stats.unchanged++
      return false
    }
    this.hashes = hashes
    this.width = g.width
    if (this.pending) this.stats.coalesced++
    // encode now: the caller may reuse or mutate the grid after this returns
    const f = encodeTurbolog(g, extra.links ? { ...this.options, links: extra.links } : this.options)
    if (extra.trailing) f.args.push(...extra.trailing)
    this.pending = f
    const wait = this.lastEmit + this.minInterval - this.now()
    if (wait <= 0) this.flush()
    else if (!this.timer) this.timer = setTimeout(() => this.flush(), wait)
    return true
  }

  /** Emits the queued frame now (if any). */
  flush() {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const f = this.pending
    if (!f) return
    this.pending = null
    this.lastEmit = this.now()
    this.out.log(f.format, ...f.args)
    this.stats.emitted++
    this.stats.spans = f.styles.length
    this.stats.chars = f.format.length
    this.options.onEmit?.(f)
  }

  /** Forget the last frame so the next `present` always emits (e.g. after the console was cleared by the user). */
  reset() {
    this.hashes = null
  }

  dispose() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.pending = null
  }
}

function sameHashes(a: Uint32Array, b: Uint32Array) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
