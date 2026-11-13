/**
 * A headless app session: mounts an app without a terminal at a fixed size,
 * renders on demand (and live, throttled, when state changes), and drives it
 * with keys, text, mouse and resize. Backs the MCP server and the JSON-lines
 * preview protocol used by the VS Code extension.
 */
import { nextTick, type Component } from 'vue'
import { createApp, type Runtime, type TuiApp } from '../app/app.js'
import type { LogEntry } from '../app/context.js'
import { createKeyEvent, type KeyEvent, type MouseEvent } from '../input/keys.js'
import type { CellBuffer } from '../render/buffer.js'
import type { Theme } from '../style/theme.js'
import { keyFromCombo } from '../testing.js'
import { frameToAnsi, locateText, snapshotFrame, styleSpans, type FrameSnapshot, type StyleSpan } from '../devtools/frame.js'
import { componentTree, elementTree, formatComponentTree, formatElementTree, type ComponentInfo, type ElementInfo } from '../devtools/tree.js'
import { vursesError } from '../errors.js'

export interface SessionOptions {
  columns?: number
  rows?: number
  theme?: Theme | string
  props?: Record<string, unknown>
  /** Install plugins (router, ...) before mount. */
  setup?: (app: TuiApp) => void | Promise<void>
  /** Re-render automatically when state changes (timers, async data). Default true. */
  live?: boolean
  /** Max live frames per second. Default 30. */
  fps?: number
  /** Capture console.* into `logs()` instead of printing. Default true. */
  captureConsole?: boolean
}

export interface ClickOptions {
  x?: number
  y?: number
  /** Click the first occurrence of this text on screen (its first cell, or `offset` cells into it). */
  text?: string
  /** Which occurrence of `text` (0-based). */
  nth?: number
  button?: 'left' | 'right' | 'middle'
  /** Click twice. */
  double?: boolean
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0))
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

const KEY_ALIASES: Record<string, string> = {
  return: 'enter',
  esc: 'escape',
  del: 'delete',
  ins: 'insert',
  arrowup: 'up',
  arrowdown: 'down',
  arrowleft: 'left',
  arrowright: 'right',
  pgup: 'pageup',
  pgdn: 'pagedown',
  pgdown: 'pagedown',
  spacebar: 'space',
}
const MOD_ALIASES: Record<string, string> = { control: 'ctrl', cmd: 'meta', command: 'meta', option: 'alt', opt: 'alt', super: 'meta' }
const MODS = new Set(['ctrl', 'meta', 'alt', 'shift'])

/**
 * Parses a key combo ('enter', 'shift+tab', 'Ctrl+S', 'a', 'A', ' ') into a
 * KeyEvent. Throws VC115 for malformed combos.
 */
export function parseKey(combo: string): KeyEvent {
  if (typeof combo !== 'string' || combo.length === 0) throw vursesError('VC115', { key: combo })
  if ([...combo].length === 1) return keyFromCombo(combo)
  const parts = combo.split('+')
  // 'ctrl++' → ['ctrl', '', ''] means the '+' key
  if (combo.endsWith('++')) parts.splice(-2, 2, '+')
  const name = parts.pop()!
  const mods = parts.map((p) => MOD_ALIASES[p.toLowerCase()] ?? p.toLowerCase())
  if (!name || mods.some((m) => !MODS.has(m))) throw vursesError('VC115', { key: combo })
  let key = name.length === 1 ? name : name.toLowerCase()
  key = KEY_ALIASES[key] ?? key
  const ctrl = mods.includes('ctrl')
  const meta = mods.includes('meta') || mods.includes('alt')
  const shift = mods.includes('shift')
  if (key.length === 1 && ctrl) key = key.toLowerCase()
  const char = key.length === 1 && !ctrl && !meta ? key : key === 'space' && !ctrl && !meta ? ' ' : ''
  return createKeyEvent(key, { ctrl, meta, shift, char })
}

export class HeadlessSession {
  readonly app: TuiApp
  readonly runtime: Runtime
  private scheduled: ReturnType<typeof setTimeout> | null = null
  private closed = false
  private logCursor = 0

  private constructor(app: TuiApp, runtime: Runtime) {
    this.app = app
    this.runtime = runtime
  }

  /** Mounts a component headlessly and waits for the first stable frame. */
  static async mount(component: Component, options: SessionOptions = {}): Promise<HeadlessSession> {
    const columns = options.columns ?? 80
    const rows = options.rows ?? 24
    const app = createApp(component, options.props)
    // don't let app errors kill the host process; surface them as logs
    app.config.errorHandler = (err, _instance, info) => {
      const msg = err instanceof Error ? (err.stack ?? err.message) : String(err)
      app.runtime?.ctx.logs.push({ level: 'error', message: `[${info}] ${msg}`, time: Date.now() })
    }
    await options.setup?.(app)
    app.mount({
      columns,
      rows,
      theme: options.theme,
      manualRender: true,
      patchConsole: options.captureConsole ?? true,
      colorDepth: 'truecolor',
      exitOnCtrlC: false,
    })
    const runtime = app.runtime!
    const session = new HeadlessSession(app, runtime)
    if (options.live !== false) session.enableLive(options.fps ?? 30)
    runtime.renderFrame()
    await session.settle()
    return session
  }

  /** Re-render on state changes (manualRender normally ignores them). */
  private enableLive(fps: number) {
    const rt = this.runtime
    const interval = 1000 / Math.max(1, fps)
    let last = 0
    ;(rt as { requestRender: () => void }).requestRender = () => {
      if (this.closed || this.scheduled || !rt.isRunning || rt.isPaused) return
      const wait = Math.max(0, last + interval - Date.now())
      this.scheduled = setTimeout(() => {
        this.scheduled = null
        if (this.closed || !rt.isRunning || rt.isPaused) return
        last = Date.now()
        rt.renderFrame()
      }, wait)
    }
  }

  get isClosed() {
    return this.closed || !this.runtime.isRunning
  }

  get size() {
    return { columns: this.runtime.ctx.size.columns, rows: this.runtime.ctx.size.rows }
  }

  /** Waits for pending updates (nextTick + timers) and re-renders until the frame is stable. */
  async settle(): Promise<CellBuffer> {
    let prev = ''
    let buf = this.runtime.buffer ?? this.runtime.renderFrame()
    for (let i = 0; i < 8; i++) {
      await nextTick()
      await tick()
      if (this.isClosed) return buf
      buf = this.runtime.renderFrame()
      const s = buf.toString()
      if (s === prev) break
      prev = s
    }
    return buf
  }

  /** Renders now and returns the buffer. */
  buffer(): CellBuffer {
    if (this.isClosed) return this.runtime.buffer ?? this.runtime.renderFrame()
    return this.runtime.renderFrame()
  }

  text(): string {
    return this.buffer().toString()
  }

  ansi(): string {
    return frameToAnsi(this.buffer())
  }

  styles(): StyleSpan[] {
    return styleSpans(this.buffer())
  }

  snapshot(): FrameSnapshot {
    return snapshotFrame(this.buffer(), this.runtime.ctx.stats.frames)
  }

  // ------------------------------------------------------------------ input

  async press(keys: string | string[]): Promise<void> {
    const list = Array.isArray(keys) ? keys : [keys]
    const events = list.map(parseKey) // validate all before sending any
    for (const e of events) {
      this.runtime.dispatchKey(e)
      await this.settle()
    }
  }

  async type(text: string): Promise<void> {
    for (const ch of text) {
      if (ch === '\n' || ch === '\r') this.runtime.dispatchKey(createKeyEvent('enter'))
      else if (ch === '\t') this.runtime.dispatchKey(createKeyEvent('tab'))
      else this.runtime.dispatchKey(keyFromCombo(ch))
    }
    await this.settle()
  }

  async paste(text: string): Promise<void> {
    this.runtime.dispatchKey(createKeyEvent('paste', { char: text, paste: true }))
    await this.settle()
  }

  /** Feeds raw terminal input (escape sequences). */
  async write(raw: string): Promise<void> {
    this.runtime.handleInput(raw)
    await sleep(30)
    await this.settle()
  }

  /** Resolves a click target to cell coordinates. */
  locate(text: string, nth = 0): { x: number; y: number } | null {
    return locateText(this.buffer(), text, nth)
  }

  private resolvePoint(o: { x?: number; y?: number; text?: string; nth?: number }): { x: number; y: number } {
    if (o.text !== undefined) {
      const p = this.locate(o.text, o.nth ?? 0)
      if (!p) throw vursesError('VC113', { text: o.text })
      return p
    }
    if (typeof o.x !== 'number' || typeof o.y !== 'number') throw vursesError('VC113', { text: '(no x/y or text given)' })
    return { x: Math.floor(o.x), y: Math.floor(o.y) }
  }

  async click(o: ClickOptions): Promise<{ x: number; y: number }> {
    const p = this.resolvePoint(o)
    const button = o.button ?? 'left'
    const base = { type: 'mouse' as const, x: p.x, y: p.y, ctrl: false, meta: false, shift: false, sequence: '' }
    for (let i = 0; i < (o.double ? 2 : 1); i++) {
      this.runtime.dispatchMouse({ ...base, action: 'move', button: 'none' } satisfies MouseEvent)
      this.runtime.dispatchMouse({ ...base, action: 'down', button } satisfies MouseEvent)
      this.runtime.dispatchMouse({ ...base, action: 'up', button } satisfies MouseEvent)
    }
    await this.settle()
    return p
  }

  /** Mouse wheel at a position (default: screen center). */
  async scroll(o: { direction: 'up' | 'down' | 'left' | 'right'; amount?: number; x?: number; y?: number; text?: string }) {
    const p =
      o.text !== undefined || (o.x !== undefined && o.y !== undefined)
        ? this.resolvePoint(o)
        : { x: Math.floor(this.size.columns / 2), y: Math.floor(this.size.rows / 2) }
    const n = Math.max(1, Math.min(100, Math.floor(o.amount ?? 1)))
    for (let i = 0; i < n; i++) {
      this.runtime.dispatchMouse({
        type: 'mouse', action: 'wheel', button: 'none', direction: o.direction,
        x: p.x, y: p.y, ctrl: false, meta: false, shift: false, sequence: '',
      })
    }
    await this.settle()
    return p
  }

  async resize(columns: number, rows: number): Promise<void> {
    this.runtime.resize(Math.max(1, Math.floor(columns)), Math.max(1, Math.floor(rows)))
    await this.settle()
  }

  /**
   * Waits until `text` appears (or disappears with `gone`). Resolves with the
   * frame text; throws VC114 on timeout.
   */
  async waitFor(text: string, { timeout = 5000, gone = false, interval = 50 } = {}): Promise<string> {
    const deadline = Date.now() + timeout
    for (;;) {
      await this.settle()
      const frame = this.text()
      if (frame.includes(text) !== gone) return frame
      if (Date.now() >= deadline || this.isClosed) throw vursesError('VC114', { text, timeout, gone })
      await sleep(Math.min(interval, Math.max(1, deadline - Date.now())))
    }
  }

  // ------------------------------------------------------------------ inspection

  componentTree(): ComponentInfo[] {
    this.buffer()
    return componentTree(this.runtime)
  }

  elementTree(depth?: number): ElementInfo {
    this.buffer()
    return elementTree(this.runtime.root, { depth })
  }

  formatTree(kind: 'components' | 'elements' = 'components', depth?: number): string {
    return kind === 'elements' ? formatElementTree(this.elementTree(depth)) : formatComponentTree(this.componentTree())
  }

  /** Captured console output. `since: 'last'` returns only entries not returned by a previous call with 'last'. */
  logs(opts: { level?: LogEntry['level'] | LogEntry['level'][]; since?: 'last' | number; clear?: boolean } = {}): LogEntry[] {
    const all = this.runtime.ctx.logs
    let list = [...all]
    if (opts.since === 'last') list = list.slice(Math.min(this.logCursor, list.length))
    else if (typeof opts.since === 'number') list = list.filter((l) => l.time >= (opts.since as number))
    if (opts.level) {
      const levels = new Set(Array.isArray(opts.level) ? opts.level : [opts.level])
      list = list.filter((l) => levels.has(l.level))
    }
    this.logCursor = all.length
    if (opts.clear) {
      all.splice(0, all.length)
      this.logCursor = 0
    }
    return list.map((l) => ({ ...l }))
  }

  /** Subscribe to presented frames. */
  onFrame(fn: (buf: CellBuffer) => void): () => void {
    return this.runtime.events.on('frame', (e) => fn(e.buffer))
  }

  onExit(fn: (error?: unknown) => void): () => void {
    return this.runtime.events.on('exit', (e) => fn(e.error))
  }

  close() {
    if (this.closed) return
    this.closed = true
    if (this.scheduled) clearTimeout(this.scheduled)
    this.scheduled = null
    this.runtime.exit()
  }
}
