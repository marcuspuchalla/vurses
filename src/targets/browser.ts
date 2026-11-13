/**
 * Browser console target ("Turbolog"): the whole app renders INSIDE the
 * devtools console.
 *
 *   commit -> layout -> paint into CellBuffer (core runtime)
 *          -> dirty gate (row hashes) -> run-length `%c` encode
 *          -> ONE `console.log` per changed frame, appended >= 66 ms apart
 *
 * Input comes from one hidden `<textarea>` (keys, paste, IME); clicking the
 * page focuses it. Optionally the same frames are mirrored into a DOM `<pre>`
 * (`dom: true` or an element), which also accepts mouse input.
 *
 * Clickable elements (buttons, links, focusable controls) can be clicked in
 * the console itself, see ./console-links.
 */
import type { Runtime } from '../app/app.js'
import type { RenderTarget } from '../app/target.js'
import type { CellBuffer } from '../render/buffer.js'
import type { Palette } from './css.js'
import { DomView } from './dom-view.js'
import { clickMap, formatterCalls, getterLinks, inlineInFrame, inlineLinks, installFormatter, listLinks, type ClickTarget } from './console-links.js'
import { attachHiddenInput } from './input.js'
import { resolveScreenSize, type ScreenSizeOptions } from './size.js'
import { Turbolog, type ConsoleLike, type TurbologStats } from './turbolog.js'

export interface BrowserTargetOptions extends ScreenSizeOptions {
  /** Render into the devtools console. Pass a console-like object to redirect. Default: true. */
  console?: boolean | ConsoleLike
  /** Mirror frames into a `<pre>` appended to this element (`true` = `document.body`). Default: false. */
  dom?: boolean | HTMLElement
  /** Capture keyboard input through a hidden textarea. Default: true (when a document exists). */
  input?: boolean
  /** Minimum ms between console frames. Default: 66. */
  minInterval?: number
  /**
   * Make clickable elements clickable in the console: inline links when
   * devtools custom formatters are enabled, a `click: {…}` object of getters
   * otherwise. Default: true.
   */
  consoleLinks?: boolean
  palette?: Palette
  /** Extra CSS for every console span (e.g. `font-size:13px`). */
  baseCss?: string
  /** Follow window resizes (when the size is not fixed). Default: true. */
  resize?: boolean
}

export interface BrowserTarget extends RenderTarget {
  readonly turbolog: Turbolog | null
  readonly view: DomView | null
  /** Console presenter statistics. */
  readonly stats: TurbologStats | null
  /** Show / hide the DOM `<pre>` mirror at runtime. */
  setDomView(on: boolean, parent?: HTMLElement): void
}

export function browserTarget(options: BrowserTargetOptions = {}): BrowserTarget {
  const g = globalThis as any
  const doc: Document | undefined = g.document
  const size = resolveScreenSize(options, g)
  const consoleOut: ConsoleLike | null =
    options.console === false ? null : typeof options.console === 'object' ? options.console : g.console
  const links = !!consoleOut && options.consoleLinks !== false
  /** Devtools draws our custom formatter: links are one click (in the frame or listed under it). */
  let inline = false
  const inFrame = inlineInFrame(g)
  let reemit: ReturnType<typeof setTimeout> | null = null
  const watched: ConsoleLike | null = consoleOut && links
    ? {
        log(...args: unknown[]) {
          const before = formatterCalls()
          consoleOut.log(...args)
          if (!args.some((a) => typeof a === 'object' && a !== null)) return
          const live = formatterCalls() > before
          if (live !== inline) {
            // the viewer can (no longer) see formatted links: log this frame again in the other mode
            inline = live
            refresh(0)
          }
        },
      }
    : consoleOut
  const turbolog = watched
    ? new Turbolog({ console: watched, minInterval: options.minInterval, palette: options.palette, baseCss: options.baseCss })
    : null
  let view: DomView | null = null
  let runtime: Runtime | null = null
  let last: CellBuffer | null = null
  const cleanups: (() => void)[] = []

  const send = (s: string) => runtime?.handleInput(s)

  const present = (buf: CellBuffer) => {
    if (!turbolog) return
    if (!links || !runtime) return void turbolog.present(buf)
    const map = clickMap(runtime, buf)
    if (!map.targets.length) return void turbolog.present(buf)
    if (inline && inFrame) turbolog.present(buf, { links: inlineLinks(map, click) })
    else if (inline) turbolog.present(buf, { trailing: listLinks(map, click) })
    else turbolog.present(buf, { trailing: getterLinks(map, click) })
  }
  /** Log the current frame again (fresh links: each formatter link fires only once). */
  const refresh = (delay: number) => {
    if (reemit) clearTimeout(reemit)
    reemit = setTimeout(() => {
      reemit = null
      if (!last || !turbolog) return
      turbolog.reset()
      present(last)
    }, delay)
  }
  /** A console link was clicked: click the element where it is now. */
  const click = (t: ClickTarget) =>
    setTimeout(() => {
      const rt = runtime
      if (!rt || !last) return
      const now = clickMap(rt, last).targets.find((x) => x.el === t.el)
      if (!now) return
      const emitted = turbolog?.stats.emitted ?? 0
      for (const action of ['down', 'up'] as const)
        rt.dispatch({ type: 'mouse', action, button: 'left', x: now.x, y: now.y, ctrl: false, meta: false, shift: false, sequence: '' })
      // nothing changed on screen: log the frame again so its links work again
      setTimeout(() => {
        if ((turbolog?.stats.emitted ?? 0) === emitted) refresh(0)
      }, 150)
    }, 0)
  const makeView = (parent: HTMLElement) => {
    view = new DomView(parent, { palette: options.palette, onMouse: send })
    if (last) view.paint(last)
  }

  const target: BrowserTarget = {
    columns: size.columns,
    rows: size.rows,
    colorDepth: 'truecolor',
    get turbolog() {
      return turbolog
    },
    get view() {
      return view
    },
    get stats() {
      return turbolog?.stats ?? null
    },
    setDomView(on, parent) {
      if (on && !view && doc) makeView(parent ?? doc.body)
      else if (!on && view) {
        view.dispose()
        view = null
      }
    },
    start(rt) {
      runtime = rt
      if (!doc) return
      if (options.dom) makeView(options.dom === true ? doc.body : options.dom)
      if (options.input !== false && doc.body) {
        const input = attachHiddenInput({ document: doc, onData: send })
        cleanups.push(() => input.dispose())
      }
      if (links) installFormatter(g)
      if (consoleOut) consoleHint(g, links)
      if (!size.fixed && options.resize !== false && g.addEventListener) {
        let t: ReturnType<typeof setTimeout> | null = null
        const onResize = () => {
          if (t) clearTimeout(t)
          t = setTimeout(() => {
            const s = resolveScreenSize({ ...options, cell: view?.cellSize() ?? options.cell }, g)
            rt.resize(s.columns, s.rows)
          }, 100)
        }
        g.addEventListener('resize', onResize)
        cleanups.push(() => g.removeEventListener('resize', onResize))
      }
    },
    frame(next) {
      last = next
      view?.paint(next)
      if (!turbolog) return 0
      const before = turbolog.stats.emitted
      present(next)
      return turbolog.stats.emitted > before ? turbolog.stats.chars : 0
    },
    stop() {
      if (reemit) clearTimeout(reemit)
      reemit = null
      turbolog?.flush()
      turbolog?.dispose()
      for (const c of cleanups.splice(0)) c()
      runtime = null
    },
  }
  return target
}

/** One-time hint: keys typed into the console prompt never reach the page. */
function consoleHint(g: Record<string, any>, links: boolean) {
  const click = links
    ? "Buttons and links: expand `click: {…}` under a frame and click (...) — or turn on DevTools → Settings → Console → 'Enable custom formatters' for one-click links. "
    : ''
  g.console?.info?.(
    `vurses: ${click}To type, click this page (not the console), or drive it from the console: await vurses.press('tab', 'enter'), vurses.type('hello'), vurses.help()`,
  )
}
