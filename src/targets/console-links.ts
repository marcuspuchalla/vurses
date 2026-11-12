/**
 * Clickable elements in console frames.
 *
 * The devtools console can't report mouse positions, but it does run page
 * code in two places when the user clicks:
 *
 *  1. **Custom formatters** (`window.devtoolsFormatters`, needs DevTools →
 *     Settings → Console → "Enable custom formatters"). Each clickable
 *     element is logged as a `%o` object, drawn by the formatter as an
 *     underlined label; expanding it (one click) calls `body()`, which clicks
 *     the element. Up to Chrome 145 the objects sit inline, at the element's
 *     place in the frame; newer DevTools puts each formatted object on a line
 *     of its own, so there they form a link list under the frame.
 *  2. **Getters** (fallback, always available). A `click: {…}` object is
 *     appended to the frame; expanding it lists one accessor per element and
 *     clicking `(...)` runs the getter, which clicks the element.
 *
 * Chrome calls a formatter's `header()` synchronously inside `console.log`,
 * and only when devtools is open with the setting enabled, so every frame
 * tells us which of the two modes the viewer can use.
 */
import type { Runtime } from '../app/app.js'
import type { TElement } from '../dom/nodes.js'
import type { CellGrid } from './grid.js'
import type { ConsoleLinks, LinkPart } from './turbolog.js'

/** A clickable element as it appears in one frame. */
export interface ClickTarget {
  el: TElement
  label: string
  /** A cell inside the element (hit-tests to it or a descendant). */
  x: number
  y: number
}

export interface ClickMap {
  /** Per cell: index into `targets`, or -1. Only the element's label row is marked. */
  cells: Int32Array
  targets: ClickTarget[]
}

/** Focusable elements taller than this (lists, text areas) are not links. */
const MAX_FOCUS_ROWS = 3
const WORD = /[\p{L}\p{N}]/u
/** Box drawing and block elements (borders, focus bars) are not part of a label. */
const FRAME_CHARS = /[\u2500-\u259f|]/g

const isClickable = (el: TElement, focusable: Set<TElement>) =>
  focusable.has(el) || el.hasListener('click') || el.hasListener('mouseDown') || el.hasListener('mouseUp')

/** Which elements of the last painted frame are clickable, and where. */
export function clickMap(rt: Runtime, g: CellGrid): ClickMap {
  const w = g.width
  const h = g.height
  const focusable = new Set<TElement>()
  for (const e of rt.ctx.focus.entries) {
    if (e.disabled()) continue
    const el = e.el()
    if (el && el.layout.height <= MAX_FOCUS_ROWS) focusable.add(el)
  }
  // nearest clickable ancestor, memoised
  const memo = new Map<TElement, TElement | null>()
  const owner = (el: TElement): TElement | null => {
    if (memo.has(el)) return memo.get(el)!
    const r = isClickable(el, focusable) ? el : el.parent ? owner(el.parent) : null
    memo.set(el, r)
    return r
  }
  // paint hit regions in order: the topmost element owns a cell
  const index = new Map<TElement, number>()
  const els: TElement[] = []
  const own = new Int32Array(w * h).fill(-1)
  for (const { el, rect } of rt.painter.hits) {
    const c = owner(el)
    let id = -1
    if (c) {
      id = index.get(c) ?? -1
      if (id < 0) {
        id = els.push(c) - 1
        index.set(c, id)
      }
    }
    const x0 = Math.max(0, rect.x)
    const x1 = Math.min(w, rect.x + rect.width)
    for (let y = Math.max(0, rect.y); y < Math.min(h, rect.y + rect.height); y++) own.fill(id, y * w + x0, y * w + Math.max(x0, x1))
  }
  // one row per element: the first one with a letter or digit in it
  const cells = new Int32Array(w * h).fill(-1)
  const targets: ClickTarget[] = []
  const done = new Set<number>()
  for (let y = 0; y < h; y++) {
    const seen = new Map<number, { text: string; x: number }>()
    for (let x = 0; x < w; x++) {
      const id = own[y * w + x]
      if (id < 0 || done.has(id)) continue
      const ch = g.chars[y * w + x]
      const s = seen.get(id)
      if (s) s.text += ch
      else seen.set(id, { text: ch, x: -1 })
      if (WORD.test(ch) && seen.get(id)!.x < 0) seen.get(id)!.x = x
    }
    for (const [id, s] of seen) {
      if (s.x < 0) continue
      done.add(id)
      const t = targets.push({ el: els[id], label: labelOf(s.text), x: s.x, y }) - 1
      for (let x = 0; x < w; x++) if (own[y * w + x] === id) cells[y * w + x] = t
    }
  }
  return { cells, targets }
}

function labelOf(text: string) {
  const s = text.replace(FRAME_CHARS, ' ').replace(/\s+/g, ' ').trim()
  return s.length > 40 ? s.slice(0, 39) + '…' : s
}

// ------------------------------------------------------------------ formatter

/** A clickable element logged with `%o` (drawn by the formatter below). */
class ConsoleLink {
  constructor(
    readonly parts: LinkPart[],
    readonly fire: () => void,
    /** Inside a frame: hide the expand triangle so the row keeps its width. */
    readonly inFrame: boolean,
  ) {}
}

/** Link style in the list under a frame. */
const LIST_CSS = 'color:#3b8eea'

/**
 * Last Chrome whose console lays formatted objects out inline. Newer DevTools
 * (seen in 157) wraps each one in a block-level widget `<div>`, which breaks a
 * frame row at every link; those get the link list under the frame instead.
 * DevTools ships with the browser, so the browser version tells.
 */
const INLINE_MAX_CHROME = 145

/** Can links be placed inside frame rows in this browser's devtools? */
export function inlineInFrame(g: Record<string, any> = globalThis): boolean {
  const ua: string = g.navigator?.userAgent ?? ''
  const m = /Chrome\/(\d+)/.exec(ua)
  return !!m && +m[1] <= INLINE_MAX_CHROME
}

let headerCalls = 0
let installed = false

/** How often the console has asked our formatter for a header (see module docs). */
export const formatterCalls = () => headerCalls

/** Registers the custom formatter once (next to Vue's own, if any). */
export function installFormatter(g: Record<string, any> = globalThis) {
  if (installed) return
  installed = true
  const list: unknown[] = Array.isArray(g.devtoolsFormatters) ? g.devtoolsFormatters : (g.devtoolsFormatters = [])
  list.push({
    header(o: unknown) {
      headerCalls++
      if (!(o instanceof ConsoleLink)) return null
      // in a frame, the label covers the console's expand triangle (14px + 4px margin), so the row keeps its width
      const cover = (i: number) => (o.inFrame ? ';position:relative' + (i ? '' : ';margin-left:-18px') : '')
      return ['span', {}, ...o.parts.map((p, i) => ['span', { style: p.css + ';text-decoration:underline' + cover(i) }, p.text])]
    },
    hasBody: (o: unknown) => o instanceof ConsoleLink,
    body(o: ConsoleLink) {
      o.fire()
      return ['span', { style: 'color:#888' }, '↵']
    },
  })
}

/** `ConsoleLinks` for the Turbolog encoder: each link clicks its target. */
export function inlineLinks(map: ClickMap, fire: (t: ClickTarget) => void): ConsoleLinks {
  return { cells: map.cells, slack: 0, make: (id, parts) => new ConsoleLink(parts, () => fire(map.targets[id]), true) }
}

/** Formatter mode without inline layout: one link per element under the frame, one click each. */
export function listLinks(map: ClickMap, fire: (t: ClickTarget) => void): unknown[] {
  if (!map.targets.length) return []
  return ['\nclick:', ...map.targets.map((t) => new ConsoleLink([{ text: t.label || 'button', css: LIST_CSS }], () => fire(t), false))]
}

/**
 * The fallback: `click: {1. [ Save ]: (...), 2. Quit: (...)}` appended to a frame.
 * Clicking `(...)` runs the getter, which clicks the element.
 */
export function getterLinks(map: ClickMap, fire: (t: ClickTarget) => void): unknown[] {
  if (!map.targets.length) return []
  const obj: Record<string, unknown> = {}
  // numbered: the console sorts keys, the numbers keep screen order (and make keys unique)
  map.targets.forEach((t, i) =>
    Object.defineProperty(obj, `${i + 1}. ${t.label || 'button'}`, {
      enumerable: true,
      get() {
        fire(t)
        return '✓ clicked'
      },
    }),
  )
  return ['\nclick:', obj]
}
