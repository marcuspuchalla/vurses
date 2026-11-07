import { diffBuffers } from '../render/buffer.js'
import type { ColorDepth } from '../style/colors.js'
import type { Runtime } from './app.js'
import type { FrameInfo, RenderTarget } from './target.js'

export interface ReadStreamLike {
  isTTY?: boolean
  setRawMode?(mode: boolean): unknown
  on(event: 'data', cb: (data: any) => void): unknown
  off(event: 'data', cb: (data: any) => void): unknown
  resume?(): unknown
  pause?(): unknown
  setEncoding?(enc: any): unknown
}

export interface WriteStreamLike {
  columns?: number
  rows?: number
  isTTY?: boolean
  write(data: string): unknown
  on?(event: 'resize', cb: () => void): unknown
  off?(event: 'resize', cb: () => void): unknown
}

export interface TtyTargetOptions {
  stdin?: ReadStreamLike
  stdout?: WriteStreamLike
  mouse?: boolean
  alternateScreen?: boolean
  columns?: number
  rows?: number
  colorDepth?: ColorDepth
}

const ESC = '\x1b['

/** The default target: a real terminal on stdin/stdout. */
export function ttyTarget(options: TtyTargetOptions = {}): RenderTarget & { stdout: WriteStreamLike } {
  const proc = (globalThis as any).process
  const stdin: ReadStreamLike = options.stdin ?? proc.stdin
  const stdout: WriteStreamLike = options.stdout ?? proc.stdout
  const mouse = options.mouse ?? true
  const alt = options.alternateScreen ?? true
  const fixed = options.columns !== undefined || options.rows !== undefined
  const cleanups: (() => void)[] = []
  let restored = false

  const restore = () => {
    if (restored) return
    restored = true
    let s = `${ESC}0m`
    if (mouse) s += `${ESC}?1006l${ESC}?1003l${ESC}?1002l${ESC}?1000l`
    s += `${ESC}?2004l${ESC}?25h`
    if (alt) s += `${ESC}?1049l`
    stdout.write(s)
  }

  return {
    stdout,
    columns: options.columns ?? stdout.columns ?? 80,
    rows: options.rows ?? stdout.rows ?? 24,
    colorDepth: options.colorDepth,
    start(rt: Runtime) {
      let setup = ''
      if (alt) setup += `${ESC}?1049h`
      setup += `${ESC}?25l${ESC}?2004h`
      if (mouse) setup += `${ESC}?1000h${ESC}?1002h${ESC}?1003h${ESC}?1006h`
      stdout.write(setup)
      if (proc?.on) {
        const onExit = () => restore()
        const onTerm = () => rt.exit()
        proc.on('exit', onExit)
        proc.on('SIGTERM', onTerm)
        cleanups.push(() => {
          proc.off('exit', onExit)
          proc.off('SIGTERM', onTerm)
        })
      }
      if (stdin.isTTY && stdin.setRawMode) stdin.setRawMode(true)
      stdin.setEncoding?.('utf8')
      const onData = (d: any) => rt.handleInput(typeof d === 'string' ? d : d.toString('utf8'))
      stdin.on('data', onData)
      stdin.resume?.()
      cleanups.push(() => {
        stdin.off('data', onData)
        if (stdin.isTTY && stdin.setRawMode) stdin.setRawMode(false)
        stdin.pause?.()
      })
      if (!fixed && stdout.on) {
        const onResize = () => rt.resize(stdout.columns ?? 80, stdout.rows ?? 24)
        stdout.on('resize', onResize)
        cleanups.push(() => stdout.off?.('resize', onResize))
      }
    },
    frame(next, prev, info: FrameInfo) {
      let out = diffBuffers(prev, next)
      // out-of-band pixel graphics (kitty / sixel / iTerm2)
      const prevKeys = new Map(info.prevGraphics.map((g) => [g.key, g]))
      for (const g of info.prevGraphics) {
        if (!info.graphics.some((n) => n.key === g.key) && g.clear) out += g.clear
      }
      for (const g of info.graphics) {
        const old = prevKeys.get(g.key)
        const moved = !old || old.x !== g.x || old.y !== g.y || old.version !== g.version
        if (moved || prev === null) out += `${ESC}${g.y + 1};${g.x + 1}H` + g.data
      }
      if (out) stdout.write(`${ESC}?2026h${out}${ESC}?2026l`)
      return out.length
    },
    stop() {
      restore()
      for (const c of cleanups.splice(0).reverse()) c()
    },
  }
}
