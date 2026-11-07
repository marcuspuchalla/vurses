/**
 * Full-screen terminal player: shows a canvas (or a running page) in the
 * terminal, forwarding mouse and keyboard input as DOM events. Uses the
 * alternate screen, raw mode, SGR mouse reporting, the kitty keyboard
 * protocol when available, and only rewrites cells that changed.
 */
import type { Canvas } from '../canvas.js'
import type { BrowserEnvironment } from '../dom.js'
import { diffCells, type ColorDepth } from '../encode/ansi.js'
import { encodeCells, MODE_RESOLUTION, type CellMode, type EncodedCells } from '../encode/cells.js'
import { detectGraphics, encodeIterm2, encodeKitty, encodeSixel, kittyDelete, type GraphicsProtocol } from '../encode/protocols.js'
import { setInterval, clearInterval, setTimeout, clearTimeout } from 'node:timers'
import { MouseEvent, WheelEvent } from '../events.js'
import { InputParser, type TermKey, type TermMouse } from './input.js'
import type { Page } from './runner.js'

export type PlayMode = CellMode | GraphicsProtocol | 'auto'

export interface PlayOptions {
  /** Rendering mode. 'auto' picks a pixel protocol when the terminal supports one, else halfblock. Default 'halfblock'. */
  mode?: PlayMode
  /** Max frames per second (default 30). */
  fps?: number
  stdout?: NodeJS.WriteStream | { write(s: string): unknown; columns?: number; rows?: number; on?: (e: string, f: () => void) => unknown; off?: (e: string, f: () => void) => unknown; isTTY?: boolean }
  stdin?: NodeJS.ReadStream | { on(e: 'data', f: (d: Buffer | string) => void): unknown; off?(e: 'data', f: (d: Buffer | string) => void): unknown; setRawMode?(b: boolean): unknown; isTTY?: boolean; resume?(): unknown; pause?(): unknown; setEncoding?(e: string): unknown }
  /** Color for transparent pixels (0xRRGGBB / CSS color); default black. */
  background?: number | string | null
  colorDepth?: ColorDepth
  /** Enable mouse reporting (default true). */
  mouse?: boolean
  /** Resize the page viewport (window.innerWidth/innerHeight) to the terminal (default true for pages). */
  fitViewport?: boolean
  /** Show a one-line status bar with mode / fps (default false). */
  status?: boolean
  /** Called after the terminal is restored. */
  onExit?: () => void
  /** Exit on ctrl+c (default true). */
  exitOnCtrlC?: boolean
}

export interface Player {
  /** Stops playback and restores the terminal. */
  stop(): void
  /** Resolves when playback stops (ctrl+c, window.close(), stop()). */
  done: Promise<void>
  /** Renders a frame immediately. */
  render(): void
}

const ESC = '\x1b['

/** Plays a Canvas, a BrowserEnvironment or a Page (from runHtml/runScript) full-screen. */
export function play(source: Canvas | BrowserEnvironment | Page, opts: PlayOptions = {}): Player {
  const stdout = (opts.stdout ?? process.stdout) as NonNullable<PlayOptions['stdout']> & { columns?: number; rows?: number }
  const stdin = (opts.stdin ?? process.stdin) as NonNullable<PlayOptions['stdin']>
  const env: BrowserEnvironment | null = 'primaryCanvas' in source ? source : 'env' in source ? source.env : null
  const getCanvas = (): Canvas | null => (env ? env.primaryCanvas() : (source as Canvas))
  const mode: CellMode | GraphicsProtocol = !opts.mode ? 'halfblock' : opts.mode === 'auto' ? detectGraphics().best ?? 'halfblock' : opts.mode
  const pixelMode = !(mode in MODE_RESOLUTION)
  const fps = Math.max(1, Math.min(240, opts.fps ?? 30))
  const background = opts.background === undefined ? 0x000000 : opts.background
  const depth = opts.colorDepth ?? 'truecolor'
  const parser = new InputParser()
  let cellPx = { w: 8, h: 16 }
  let prev: EncodedCells | null = null
  let lastVersion = -1
  let lastCanvas: Canvas | null = null
  let box = { x: 0, y: 0, columns: 0, rows: 0 }
  let stopped = false
  let frames = 0
  let fpsShown = 0
  let fpsT = Date.now()
  let resolveDone!: () => void
  const done = new Promise<void>((r) => (resolveDone = r))
  const keyTimers = new Map<string, ReturnType<typeof setTimeout>>()

  const size = () => ({ columns: Math.max(1, stdout.columns ?? 80), rows: Math.max(1, (stdout.rows ?? 24) - (opts.status ? 1 : 0)) })

  const viewport = () => {
    const { columns, rows } = size()
    if (pixelMode) return { w: columns * cellPx.w, h: rows * cellPx.h }
    const [cw] = MODE_RESOLUTION[mode as CellMode]
    // square pixels: a cell is cw pixels wide and 2·cw pixels tall
    return { w: columns * cw, h: rows * 2 * cw }
  }

  const layout = (c: Canvas) => {
    const { columns, rows } = size()
    // contain-fit with square pixels (cells are 1:2)
    const pxPerCol = pixelMode ? cellPx.w : MODE_RESOLUTION[mode as CellMode][0]
    const pxPerRow = pixelMode ? cellPx.h : MODE_RESOLUTION[mode as CellMode][0] * 2
    const s = Math.min(columns / (c.width / pxPerCol), rows / (c.height / pxPerRow))
    const cols = Math.max(1, Math.min(columns, Math.round((c.width / pxPerCol) * s)))
    const rws = Math.max(1, Math.min(rows, Math.round((c.height / pxPerRow) * s)))
    return { x: Math.floor((columns - cols) / 2), y: Math.floor((rows - rws) / 2), columns: cols, rows: rws }
  }

  const write = (s: string) => {
    if (s) stdout.write(s)
  }

  const render = () => {
    if (stopped) return
    const c = getCanvas()
    if (!c || !c.width || !c.height) return
    const nb = layout(c)
    const moved = nb.x !== box.x || nb.y !== box.y || nb.columns !== box.columns || nb.rows !== box.rows || c !== lastCanvas
    if (moved) {
      write(`${ESC}0m${ESC}2J`)
      if (pixelMode && mode === 'kitty') write(kittyDelete(1))
      prev = null
      box = nb
      lastCanvas = c
    }
    if (!moved && c.version === lastVersion) return
    lastVersion = c.version
    frames++
    let out = ''
    if (pixelMode) {
      const at = `${ESC}${box.y + 1};${box.x + 1}H`
      if (mode === 'kitty') out = at + encodeKitty(c.data, c.width, c.height, { id: 1, columns: box.columns, rows: box.rows })
      else if (mode === 'iterm2') out = at + encodeIterm2(c.data, c.width, c.height, { columns: box.columns, rows: box.rows, preserveAspectRatio: false })
      else out = at + encodeSixel(c.data, c.width, c.height, { background: typeof background === 'number' ? background : null })
    } else {
      const enc = encodeCells(c.data, c.width, c.height, { mode: mode as CellMode, columns: box.columns, rows: box.rows, background })
      out = diffCells(prev, enc, { x: box.x, y: box.y, colorDepth: depth })
      prev = enc
    }
    if (opts.status) {
      const now = Date.now()
      if (now - fpsT >= 1000) {
        fpsShown = Math.round((frames * 1000) / (now - fpsT))
        frames = 0
        fpsT = now
      }
      const { rows, columns } = size()
      const text = ` tty-canvas · ${mode} · ${c.width}×${c.height}px · ${fpsShown} fps · ctrl+c to quit`.slice(0, columns)
      out += `${ESC}${rows + 1};1H${ESC}0;7m${text.padEnd(columns)}${ESC}0m`
    }
    if (out) write(`${ESC}?2026h${out}${ESC}?2026l`)
  }

  // ---------------------------------------------------------------- input

  const toCanvas = (m: TermMouse) => {
    const c = getCanvas()
    if (!c) return { x: 0, y: 0 }
    return { x: ((m.x - box.x + 0.5) * c.width) / box.columns, y: ((m.y - box.y + 0.5) * c.height) / box.rows }
  }

  const dispatchPointer = (m: TermMouse) => {
    const c = getCanvas()
    if (!c) return
    const { x, y } = toCanvas(m)
    const mods = { ctrlKey: m.ctrlKey, shiftKey: m.shiftKey, altKey: m.altKey }
    if (env) {
      if (m.action === 'wheel') {
        const d = m.wheel === 'up' ? -100 : m.wheel === 'down' ? 100 : 0
        const dx = m.wheel === 'left' ? -100 : m.wheel === 'right' ? 100 : 0
        env.pointer({ action: 'wheel', x, y, deltaX: dx, deltaY: d, ...mods }, c)
      } else env.pointer({ action: m.action, x, y, button: m.button, ...mods }, c)
    } else {
      // bare canvas: deliver DOM-style events straight to it
      const button = m.button === 'right' ? 2 : m.button === 'middle' ? 1 : 0
      const init = { clientX: x, clientY: y, offsetX: x, offsetY: y, bubbles: true, cancelable: true, button, ...mods }
      if (m.action === 'wheel') c.dispatchEvent(new WheelEvent('wheel', { ...init, deltaY: m.wheel === 'up' ? -100 : m.wheel === 'down' ? 100 : 0 }))
      else c.dispatchEvent(new MouseEvent(m.action === 'down' ? 'mousedown' : m.action === 'up' ? 'mouseup' : 'mousemove', init))
    }
  }

  const held = new Set<string>()
  const keyDown = (k: TermKey) => {
    if (!env) return
    const init = { key: k.key, code: k.code, ctrlKey: k.ctrlKey, shiftKey: k.shiftKey, altKey: k.altKey, metaKey: k.metaKey }
    const id = k.code || k.key
    if (k.action === 'up') {
      clearTimeout(keyTimers.get(id))
      keyTimers.delete(id)
      held.delete(id)
      env.key('up', init)
      return
    }
    const repeat = held.has(id) || k.action === 'repeat'
    held.add(id)
    env.key('down', { ...init, repeat })
    if (!k.reportsRelease) {
      // legacy terminals have no key-up: synthesize one when the auto-repeat stops
      clearTimeout(keyTimers.get(id))
      keyTimers.set(id, setTimeout(() => {
        keyTimers.delete(id)
        held.delete(id)
        env.key('up', init)
      }, repeat ? 120 : 550))
    }
  }

  let escTimer: ReturnType<typeof setTimeout> | null = null
  const handle = (events: ReturnType<InputParser['feed']>) => {
    for (const ev of events) {
      if (ev.type === 'report') {
        const m = /^6;(\d+);(\d+)t$/.exec(ev.data)
        if (m) {
          cellPx = { w: +m[2] || 8, h: +m[1] || 16 }
          if (env && opts.fitViewport !== false) env.resize(viewport().w, viewport().h)
          box = { x: -1, y: 0, columns: 0, rows: 0 }
        }
        continue
      }
      if (ev.type === 'key') {
        if ((opts.exitOnCtrlC ?? true) && ev.ctrlKey && ev.key.toLowerCase() === 'c' && ev.action !== 'up') {
          stop()
          return
        }
        keyDown(ev)
        continue
      }
      dispatchPointer(ev)
    }
  }
  const onData = (d: Buffer | string) => {
    if (escTimer) clearTimeout(escTimer)
    handle(parser.feed(typeof d === 'string' ? d : d.toString('utf8')))
    if (parser.hasPending) escTimer = setTimeout(() => handle(parser.flush()), 30)
  }

  const onResize = () => {
    if (env && opts.fitViewport !== false) {
      const v = viewport()
      env.resize(v.w, v.h)
    }
    box = { x: -1, y: 0, columns: 0, rows: 0 }
    render()
  }

  // ---------------------------------------------------------------- lifecycle

  const restore = () => {
    let s = `${ESC}0m`
    if (mode === 'kitty') s += kittyDelete(1)
    s += `${ESC}<u${ESC}?1000l${ESC}?1002l${ESC}?1003l${ESC}?1006l${ESC}?25h${ESC}?1049l`
    stdout.write(s)
    if (stdin.isTTY && stdin.setRawMode) stdin.setRawMode(false)
  }
  const onExitSignal = () => stop()
  const onProcessExit = () => {
    if (!stopped) restore()
  }

  function stop() {
    if (stopped) return
    stopped = true
    clearInterval(timer)
    for (const t of keyTimers.values()) clearTimeout(t)
    stdin.off?.('data', onData)
    stdout.off?.('resize', onResize)
    process.off('SIGINT', onExitSignal)
    process.off('SIGTERM', onExitSignal)
    process.off('exit', onProcessExit)
    restore()
    stdin.pause?.()
    opts.onExit?.()
    resolveDone()
  }

  let setup = `${ESC}?1049h${ESC}?25l${ESC}2J`
  if (opts.mouse !== false) setup += `${ESC}?1000h${ESC}?1002h${ESC}?1003h${ESC}?1006h`
  setup += `${ESC}>11u` // kitty keyboard: disambiguate + event types + all keys as escapes
  if (pixelMode) setup += `${ESC}16t` // ask for the cell size in pixels
  stdout.write(setup)
  if (stdin.isTTY && stdin.setRawMode) stdin.setRawMode(true)
  stdin.setEncoding?.('utf8')
  stdin.on('data', onData)
  stdin.resume?.()
  stdout.on?.('resize', onResize)
  process.on('SIGINT', onExitSignal)
  process.on('SIGTERM', onExitSignal)
  process.on('exit', onProcessExit)
  if (env) {
    if (opts.fitViewport !== false) {
      const v = viewport()
      env.resize(v.w, v.h)
    }
    const prevClose = env.window.close
    env.window.close = () => {
      if (typeof prevClose === 'function') prevClose()
      stop()
    }
  }
  const timer = setInterval(() => {
    env?.frame()
    render()
  }, 1000 / fps)
  render()

  return { stop, done, render }
}

