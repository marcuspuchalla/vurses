/**
 * Offscreen test renderer.
 *
 *   const r = await render(App, { columns: 40, rows: 10 })
 *   await r.press('tab', 'enter')
 *   expect(r.lastFrame()).toContain('Saved!')
 */
import { nextTick, type Component } from 'vue'
import { createApp, type TuiApp } from './app/app.js'
import { createKeyEvent, type KeyEvent, type MouseEvent } from './input/keys.js'
import type { Theme } from './style/theme.js'
import type { CellBuffer } from './render/buffer.js'

export interface RenderOptions {
  columns?: number
  rows?: number
  props?: Record<string, unknown>
  theme?: Theme | string
  /** Install plugins / globals before mount. */
  setup?: (app: TuiApp) => void
}

export interface RenderResult {
  app: TuiApp
  /** Plain-text content of the current frame (trailing whitespace trimmed). */
  lastFrame(): string
  /** The current cell buffer (with colors and attributes). */
  buffer(): CellBuffer
  /** Press keys: 'enter', 'tab', 'shift+tab', 'ctrl+s', 'down', 'a', ... */
  press(...keys: string[]): Promise<void>
  /** Type printable text. */
  type(text: string): Promise<void>
  /** Paste text (bracketed paste). */
  paste(text: string): Promise<void>
  /** Feed raw terminal input. */
  write(raw: string): Promise<void>
  click(x: number, y: number): Promise<void>
  wheel(x: number, y: number, direction: 'up' | 'down'): Promise<void>
  /** Waits for pending updates and re-renders. */
  settle(): Promise<void>
  /** Find the cell coordinates of the first occurrence of text. */
  locate(text: string): { x: number; y: number } | null
  unmount(): void
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0))

export function keyFromCombo(combo: string): KeyEvent {
  if (combo.length === 1) {
    const upper = combo !== combo.toLowerCase()
    return createKeyEvent(combo === ' ' ? 'space' : combo, { char: combo, shift: upper })
  }
  const parts = combo.split('+')
  const name = parts.pop()!
  const mods = { ctrl: parts.includes('ctrl'), meta: parts.includes('meta') || parts.includes('alt'), shift: parts.includes('shift') }
  const printable = name.length === 1 && !mods.ctrl && !mods.meta
  return createKeyEvent(name === 'esc' ? 'escape' : name, { ...mods, char: printable ? name : name === 'space' && !mods.ctrl ? ' ' : '' })
}

export async function render(component: Component, options: RenderOptions = {}): Promise<RenderResult> {
  const columns = options.columns ?? 80
  const rows = options.rows ?? 24
  const listeners = new Set<(d: string) => void>()
  const stdin = {
    isTTY: false,
    on: (_: 'data', cb: (d: Buffer | string) => void) => listeners.add(cb as (d: string) => void),
    off: (_: 'data', cb: (d: Buffer | string) => void) => listeners.delete(cb as (d: string) => void),
  }
  const stdout = { columns, rows, write: () => true }
  const app = createApp(component, options.props)
  options.setup?.(app)
  app.mount({
    stdin,
    stdout,
    columns,
    rows,
    theme: options.theme,
    manualRender: true,
    patchConsole: false,
    colorDepth: 'truecolor',
  })
  const runtime = app.runtime!
  let buf: CellBuffer = runtime.renderFrame()

  const settle = async () => {
    let prev = ''
    for (let i = 0; i < 8; i++) {
      await nextTick()
      await tick()
      buf = runtime.renderFrame()
      const s = buf.toString()
      if (s === prev) break
      prev = s
    }
  }
  await settle()

  const result: RenderResult = {
    app,
    lastFrame: () => {
      buf = runtime.renderFrame()
      return buf.toString()
    },
    buffer: () => buf,
    async press(...keys) {
      for (const k of keys) {
        runtime.dispatchKey(keyFromCombo(k))
        await settle()
      }
    },
    async type(text) {
      for (const ch of text) runtime.dispatchKey(keyFromCombo(ch))
      await settle()
    },
    async paste(text) {
      runtime.dispatchKey(createKeyEvent('paste', { char: text, paste: true }))
      await settle()
    },
    async write(raw) {
      runtime.handleInput(raw)
      await new Promise((r) => setTimeout(r, 30))
      await settle()
    },
    async click(x, y) {
      const base = { type: 'mouse' as const, x, y, ctrl: false, meta: false, shift: false, sequence: '' }
      runtime.dispatchMouse({ ...base, action: 'down', button: 'left' } satisfies MouseEvent)
      runtime.dispatchMouse({ ...base, action: 'up', button: 'left' } satisfies MouseEvent)
      await settle()
    },
    async wheel(x, y, direction) {
      runtime.dispatchMouse({ type: 'mouse', x, y, ctrl: false, meta: false, shift: false, sequence: '', action: 'wheel', button: 'none', direction })
      await settle()
    },
    settle,
    locate(text) {
      const lines = buf.toString().split('\n')
      for (let y = 0; y < lines.length; y++) {
        const idx = lines[y].indexOf(text)
        if (idx < 0) continue
        let si = 0
        for (let x = 0; x < buf.width; x++) {
          const ch = buf.chars[y * buf.width + x]
          if (si === idx && ch !== '') return { x, y }
          si += ch.length
        }
      }
      return null
    },
    unmount: () => runtime.exit(),
  }
  return result
}

/** Renders a component once and returns the plain-text frame. */
export async function renderToString(component: Component, options: RenderOptions = {}): Promise<string> {
  const r = await render(component, options)
  const s = r.lastFrame()
  r.unmount()
  return s
}
