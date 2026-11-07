/**
 * Optional DOM fallback: paints a cell grid into a `<pre>` (one `<div>` per
 * row, only changed rows are rewritten) and maps mouse events on it back to
 * cell coordinates. Shared by the browser console target and the frame player.
 */
import { defaultPalette, resolveStyle, type Palette } from './css.js'
import { hashRow, type CellGrid } from './grid.js'
import { mouseSequence } from './input.js'

export interface DomViewOptions {
  palette?: Palette
  /** Receives SGR mouse sequences for clicks / wheel / motion over the view. */
  onMouse?(seq: string): void
  /** Report mouse motion (hover). Default: true. */
  motion?: boolean
}

const esc = (s: string) => s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'))

function rowHtml(g: CellGrid, y: number, p: Palette): string {
  let html = ''
  let key = ''
  let text = ''
  let css = ''
  const close = () => {
    if (text) html += `<span style="${css}">${esc(text)}</span>`
    text = ''
  }
  for (let x = 0; x < g.width; x++) {
    const i = y * g.width + x
    const ch = g.chars[i]
    if (ch === '') continue
    const k = g.fg[i] + '|' + g.bg[i] + '|' + g.flags[i]
    if (k !== key) {
      close()
      key = k
      const s = resolveStyle(g.fg[i], g.bg[i], g.flags[i], p)
      css = `color:${s.color};background:${s.background}`
      if (s.bold) css += ';font-weight:bold'
      if (s.italic) css += ';font-style:italic'
      if (s.underline || s.strike) css += `;text-decoration:${[s.underline && 'underline', s.strike && 'line-through'].filter(Boolean).join(' ')}`
    }
    text += ch
  }
  close()
  return html || ' '
}

export class DomView {
  readonly el: HTMLPreElement
  private rows: HTMLDivElement[] = []
  private hashes: number[] = []
  private width = 0
  private readonly palette: Palette
  private cleanup: (() => void)[] = []

  constructor(
    parent: HTMLElement,
    private options: DomViewOptions = {},
  ) {
    this.palette = options.palette ?? defaultPalette
    const doc = parent.ownerDocument
    this.el = doc.createElement('pre')
    this.el.className = 'vuecli-screen'
    this.el.style.cssText = `margin:0;display:inline-block;font:14px/1.15 ui-monospace,Menlo,Consolas,monospace;background:${this.palette.bg};color:${this.palette.fg};user-select:none;cursor:default`
    parent.appendChild(this.el)
    if (options.onMouse) this.wireMouse(options.onMouse)
  }

  /** Paints a grid; only rows whose hash changed are rewritten. */
  paint(g: CellGrid) {
    const doc = this.el.ownerDocument
    if (g.width !== this.width || g.height !== this.rows.length) {
      this.el.textContent = ''
      this.rows = []
      this.hashes = []
      this.width = g.width
      for (let y = 0; y < g.height; y++) {
        const d = doc.createElement('div')
        this.el.appendChild(d)
        this.rows.push(d)
        this.hashes.push(-1)
      }
    }
    for (let y = 0; y < g.height; y++) {
      const h = hashRow(g, y)
      if (h === this.hashes[y]) continue
      this.hashes[y] = h
      this.rows[y].innerHTML = rowHtml(g, y, this.palette)
    }
  }

  /** Cell under a client (viewport) position. */
  cellAt(clientX: number, clientY: number): { x: number; y: number } | null {
    if (!this.rows.length || !this.width) return null
    const r = this.el.getBoundingClientRect()
    const cw = r.width / this.width
    const ch = r.height / this.rows.length
    const x = Math.floor((clientX - r.left) / cw)
    const y = Math.floor((clientY - r.top) / ch)
    if (x < 0 || y < 0 || x >= this.width || y >= this.rows.length) return null
    return { x, y }
  }

  private wireMouse(onMouse: (seq: string) => void) {
    const el = this.el
    let down = -1
    let last = ''
    const mods = (e: MouseEvent) => ({ shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey })
    const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      el.addEventListener(type, fn as EventListener, opts)
      this.cleanup.push(() => el.removeEventListener(type, fn as EventListener))
    }
    on('mousedown', (e) => {
      const c = this.cellAt(e.clientX, e.clientY)
      if (!c) return
      down = e.button
      onMouse(mouseSequence('down', c.x, c.y, e.button, mods(e)))
    })
    on('mouseup', (e) => {
      const c = this.cellAt(e.clientX, e.clientY)
      down = -1
      if (c) onMouse(mouseSequence('up', c.x, c.y, e.button, mods(e)))
    })
    on('mousemove', (e) => {
      if (this.options.motion === false && down < 0) return
      const c = this.cellAt(e.clientX, e.clientY)
      if (!c) return
      const k = `${c.x},${c.y},${down}`
      if (k === last) return
      last = k
      onMouse(mouseSequence(down >= 0 ? 'drag' : 'move', c.x, c.y, Math.max(0, down), mods(e)))
    })
    on(
      'wheel',
      (e) => {
        const c = this.cellAt(e.clientX, e.clientY)
        if (!c) return
        e.preventDefault()
        onMouse(mouseSequence(e.deltaY < 0 ? 'wheel-up' : 'wheel-down', c.x, c.y, 0, mods(e)))
      },
      { passive: false },
    )
    on('contextmenu', (e) => e.preventDefault())
  }

  /** Approximate size of one cell in CSS pixels (for fitting the screen to the window). */
  cellSize(): { width: number; height: number } {
    const probe = this.el.ownerDocument.createElement('span')
    probe.textContent = 'MMMMMMMMMM'
    probe.style.visibility = 'hidden'
    probe.style.position = 'absolute'
    this.el.appendChild(probe)
    const r = probe.getBoundingClientRect()
    probe.remove()
    return { width: r.width / 10 || 8, height: r.height || 17 }
  }

  dispose() {
    for (const c of this.cleanup.splice(0)) c()
    this.el.remove()
  }
}
