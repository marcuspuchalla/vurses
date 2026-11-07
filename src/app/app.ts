import { defineComponent, h, reactive, ref, shallowRef, type App, type Component } from 'vue'
import { createRoot, type TElement } from '../dom/nodes.js'
import { diffBuffers, type CellBuffer } from '../render/buffer.js'
import { Painter } from '../render/paint.js'
import { createBaseApp, trackRoot } from '../renderer.js'
import { InputParser, matchKey, type KeyEvent, type MouseEvent } from '../input/keys.js'
import { detectColorDepth, type ColorDepth } from '../style/colors.js'
import { darkTheme, themes, type Theme } from '../style/theme.js'
import { APP_CONTEXT, type AppContext, type LogEntry } from './context.js'
import { FocusManager } from './focus.js'
import { installComponents, DevTools } from '../components/index.js'
import { format } from 'node:util'

export interface ReadStreamLike {
  isTTY?: boolean
  setRawMode?(mode: boolean): unknown
  on(event: 'data', cb: (data: Buffer | string) => void): unknown
  off(event: 'data', cb: (data: Buffer | string) => void): unknown
  resume?(): unknown
  pause?(): unknown
  setEncoding?(enc: BufferEncoding): unknown
}

export interface WriteStreamLike {
  columns?: number
  rows?: number
  isTTY?: boolean
  write(data: string): unknown
  on?(event: 'resize', cb: () => void): unknown
  off?(event: 'resize', cb: () => void): unknown
}

export interface MountOptions {
  stdin?: ReadStreamLike
  stdout?: WriteStreamLike
  /** Theme object or a built-in theme name (`dark`, `light`, `dracula`). */
  theme?: Theme | string
  /** Enable mouse tracking (clicks, wheel, hover). Default: true. */
  mouse?: boolean
  /** Exit when ctrl+c is pressed. Default: true. */
  exitOnCtrlC?: boolean
  /** Use the alternate screen buffer. Default: true. */
  alternateScreen?: boolean
  /** Max frames per second. Default: 60. */
  fps?: number
  colorDepth?: ColorDepth
  /** Fixed size (otherwise taken from stdout and updated on resize). */
  columns?: number
  rows?: number
  /** Redirect console.* while running and print it after exit. Default: true. */
  patchConsole?: boolean
  /** Focus the first focusable component after mount. Default: true. */
  autoFocus?: boolean
  /** Internal: render synchronously on demand (used by the test renderer). */
  manualRender?: boolean
}

export interface TuiApp extends Omit<App<TElement>, 'mount'> {
  mount(options?: MountOptions): TuiApp
  /** Resolves when the app exits (via `exit()`, ctrl+c or unmount). */
  waitUntilExit(): Promise<void>
  /** The running runtime (after mount). */
  runtime: Runtime | null
}

const ESC = '\x1b['

export class Runtime {
  readonly root: TElement
  readonly ctx: AppContext
  readonly painter: Painter
  private prev: CellBuffer | null = null
  private scheduled: ReturnType<typeof setTimeout> | null = null
  private lastFrameAt = 0
  private readonly frameInterval: number
  private readonly parser = new InputParser()
  private escTimer: ReturnType<typeof setTimeout> | null = null
  private stdin: ReadStreamLike
  private stdout: WriteStreamLike
  private opts: Required<Pick<MountOptions, 'mouse' | 'exitOnCtrlC' | 'alternateScreen' | 'patchConsole' | 'autoFocus' | 'manualRender'>>
  private exitResolvers: { resolve: () => void; reject: (e: unknown) => void } | null = null
  readonly exited: Promise<void>
  private running = false
  private cleanups: (() => void)[] = []
  private downTarget: TElement | null = null
  private hovered: TElement[] = []
  private fpsWindow: number[] = []
  /** Last rendered buffer. */
  get buffer() {
    return this.prev
  }

  constructor(
    private app: App<TElement>,
    options: MountOptions = {},
  ) {
    this.stdin = options.stdin ?? process.stdin
    this.stdout = options.stdout ?? process.stdout
    this.opts = {
      mouse: options.mouse ?? true,
      exitOnCtrlC: options.exitOnCtrlC ?? true,
      alternateScreen: options.alternateScreen ?? true,
      patchConsole: options.patchConsole ?? true,
      autoFocus: options.autoFocus ?? true,
      manualRender: options.manualRender ?? false,
    }
    this.frameInterval = 1000 / (options.fps ?? 60)
    this.exited = new Promise((resolve, reject) => (this.exitResolvers = { resolve, reject }))
    this.exited.catch(() => {})

    const theme = shallowRef(resolveTheme(options.theme))
    const depth = options.colorDepth ?? detectColorDepth()
    this.painter = new Painter({ theme: theme.value, depth })
    this.root = createRoot({ requestRender: () => this.requestRender() })
    const fixed = options.columns !== undefined || options.rows !== undefined
    const size = reactive({
      columns: options.columns ?? this.stdout.columns ?? 80,
      rows: options.rows ?? this.stdout.rows ?? 24,
    })
    this.ctx = {
      root: this.root,
      theme,
      size,
      focus: new FocusManager(() => this.root),
      inputHandlers: new Set(),
      logs: reactive<LogEntry[]>([]),
      stats: { frames: 0, lastFrameMs: 0, lastFrameBytes: 0, fps: 0 },
      devtools: ref(false),
      exit: (err?: unknown) => this.exit(err),
      requestRender: () => this.requestRender(),
      setTheme: (t) => {
        theme.value = resolveTheme(t)
        this.painter.setOptions({ theme: theme.value, depth })
        this.requestRender()
      },
      writeRaw: (d) => this.stdout.write(d),
    }
    this.syncRootSize()
    if (!fixed) {
      const onResize = () => {
        size.columns = this.stdout.columns ?? size.columns
        size.rows = this.stdout.rows ?? size.rows
        this.syncRootSize()
        this.prev = null
        this.requestRender()
      }
      this.stdout.on?.('resize', onResize)
      this.cleanups.push(() => this.stdout.off?.('resize', onResize))
    }
  }

  private syncRootSize() {
    this.root.setProp('width', this.ctx.size.columns)
    this.root.setProp('height', this.ctx.size.rows)
  }

  start() {
    this.running = true
    this.cleanups.push(trackRoot(this.root))
    const out = this.stdout
    if (!this.opts.manualRender) {
      let setup = ''
      if (this.opts.alternateScreen) setup += `${ESC}?1049h`
      setup += `${ESC}?25l${ESC}?2004h`
      if (this.opts.mouse) setup += `${ESC}?1000h${ESC}?1002h${ESC}?1003h${ESC}?1006h`
      out.write(setup)
      const restore = () => this.restoreTerminal()
      process.on('exit', restore)
      this.cleanups.push(() => process.off('exit', restore))
      const onSignal = () => this.exit()
      process.on('SIGTERM', onSignal)
      this.cleanups.push(() => process.off('SIGTERM', onSignal))
    }
    if (this.opts.patchConsole) this.patchConsole()

    const stdin = this.stdin
    if (stdin.isTTY && stdin.setRawMode) stdin.setRawMode(true)
    stdin.setEncoding?.('utf8')
    const onData = (d: Buffer | string) => this.handleInput(typeof d === 'string' ? d : d.toString('utf8'))
    stdin.on('data', onData)
    stdin.resume?.()
    this.cleanups.push(() => {
      stdin.off('data', onData)
      if (stdin.isTTY && stdin.setRawMode) stdin.setRawMode(false)
      stdin.pause?.()
    })
    if (this.opts.autoFocus) {
      setTimeout(() => {
        if (this.running && !this.ctx.focus.current.value) this.ctx.focus.focusFirst()
      }, 0)
    }
  }

  private terminalRestored = false
  private restoreTerminal() {
    if (this.terminalRestored || this.opts.manualRender) return
    this.terminalRestored = true
    let s = `${ESC}0m`
    if (this.opts.mouse) s += `${ESC}?1006l${ESC}?1003l${ESC}?1002l${ESC}?1000l`
    s += `${ESC}?2004l${ESC}?25h`
    if (this.opts.alternateScreen) s += `${ESC}?1049l`
    this.stdout.write(s)
  }

  // ------------------------------------------------------------------ rendering

  requestRender() {
    if (!this.running || this.scheduled || this.opts.manualRender) return
    const wait = Math.max(0, this.lastFrameAt + this.frameInterval - Date.now())
    this.scheduled = setTimeout(() => {
      this.scheduled = null
      this.renderFrame()
    }, wait)
  }

  /** Renders a frame immediately. Returns the buffer. */
  renderFrame(): CellBuffer {
    const t0 = performance.now()
    const { columns, rows } = this.ctx.size
    const buf = this.painter.paint(this.root, columns, rows)
    const out = diffBuffers(this.prev, buf)
    this.prev = buf
    if (out && !this.opts.manualRender) this.stdout.write(`${ESC}?2026h${out}${ESC}?2026l`)
    const now = Date.now()
    this.lastFrameAt = now
    const st = this.ctx.stats
    st.frames++
    st.lastFrameMs = performance.now() - t0
    st.lastFrameBytes = out.length
    this.fpsWindow.push(now)
    while (this.fpsWindow.length && this.fpsWindow[0] < now - 1000) this.fpsWindow.shift()
    st.fps = this.fpsWindow.length
    return buf
  }

  // ------------------------------------------------------------------ input

  handleInput(data: string) {
    if (this.escTimer) {
      clearTimeout(this.escTimer)
      this.escTimer = null
    }
    for (const ev of this.parser.feed(data)) this.dispatch(ev)
    if (this.parser.hasPending) {
      this.escTimer = setTimeout(() => {
        this.escTimer = null
        for (const ev of this.parser.flush()) this.dispatch(ev)
      }, 25)
    }
  }

  dispatch(ev: KeyEvent | MouseEvent) {
    if (ev.type === 'mouse') this.dispatchMouse(ev)
    else this.dispatchKey(ev)
  }

  dispatchKey(e: KeyEvent) {
    if (this.opts.exitOnCtrlC && matchKey(e, 'ctrl+c')) {
      this.exit()
      return
    }
    if (matchKey(e, 'f12')) {
      this.ctx.devtools.value = !this.ctx.devtools.value
      return
    }
    const focus = this.ctx.focus
    focus.dispatchKey(e)
    if (e.propagationStopped) return
    if (!e.defaultPrevented && e.name === 'tab' && !e.ctrl && !e.meta) {
      if (e.shift) focus.focusPrevious()
      else focus.focusNext()
      return
    }
    // higher priority first, then most recently registered first
    const handlers = [...this.ctx.inputHandlers].sort((a, b) => b.priority - a.priority || b.order - a.order)
    for (const h of handlers) {
      if (!h.active()) continue
      h.handler(e)
      if (e.propagationStopped) break
    }
  }

  private bubble(target: TElement | null, event: string, payload: Record<string, unknown>) {
    let stopped = false
    const ev = {
      ...payload,
      target,
      currentTarget: target,
      localX: 0,
      localY: 0,
      stopPropagation() {
        stopped = true
      },
    }
    let n = target
    while (n && !stopped) {
      const ls = n.getListeners(event)
      if (ls.length) {
        ev.currentTarget = n
        ev.localX = (payload.x as number) - n.layout.x
        ev.localY = (payload.y as number) - n.layout.y
        for (const l of ls) l(ev)
      }
      n = n.parent
    }
  }

  dispatchMouse(e: MouseEvent) {
    const target = this.painter.hitTest(e.x, e.y)
    const payload = { ...e }
    switch (e.action) {
      case 'down': {
        this.downTarget = target
        const entry = this.ctx.focus.entryFor(target)
        if (entry) this.ctx.focus.focus(entry)
        this.bubble(target, 'mouseDown', payload)
        break
      }
      case 'up': {
        this.bubble(target, 'mouseUp', payload)
        const down = this.downTarget
        this.downTarget = null
        if (down && target && down.contains(target) && e.button === 'left') this.bubble(target, 'click', payload)
        else if (down && target && target.contains(down) && e.button === 'left') this.bubble(down, 'click', payload)
        break
      }
      case 'wheel':
        this.bubble(target, 'wheel', payload)
        break
      case 'move':
      case 'drag':
        this.updateHover(target, payload)
        this.bubble(target, 'mouseMove', payload)
        break
    }
  }

  private updateHover(target: TElement | null, payload: Record<string, unknown>) {
    const chain: TElement[] = []
    for (let n = target; n; n = n.parent) chain.push(n)
    const prev = new Set(this.hovered)
    const next = new Set(chain)
    for (const el of this.hovered) if (!next.has(el)) el.getListeners('mouseLeave').forEach((l) => l({ ...payload, target: el }))
    for (const el of chain) if (!prev.has(el)) el.getListeners('mouseEnter').forEach((l) => l({ ...payload, target: el }))
    this.hovered = chain
  }

  // ------------------------------------------------------------------ console

  private patchConsole() {
    const levels = ['log', 'info', 'warn', 'error', 'debug'] as const
    const original: Record<string, (...a: unknown[]) => void> = {}
    for (const level of levels) {
      original[level] = console[level]
      console[level] = (...args: unknown[]) => {
        this.ctx.logs.push({ level, message: format(...args), time: Date.now() })
        if (this.ctx.logs.length > 1000) this.ctx.logs.splice(0, this.ctx.logs.length - 1000)
      }
    }
    this.cleanups.push(() => {
      for (const level of levels) console[level] = original[level] as never
    })
  }

  // ------------------------------------------------------------------ lifecycle

  exit(error?: unknown) {
    if (!this.running) return
    this.running = false
    if (this.scheduled) clearTimeout(this.scheduled)
    if (this.escTimer) clearTimeout(this.escTimer)
    try {
      this.app.unmount()
    } catch {
      // ignore
    }
    this.restoreTerminal()
    for (const c of this.cleanups.splice(0).reverse()) c()
    if (this.opts.patchConsole && !this.opts.manualRender) {
      for (const l of this.ctx.logs) {
        const stream = l.level === 'error' || l.level === 'warn' ? process.stderr : process.stdout
        stream.write(l.message + '\n')
      }
    }
    if (error) {
      if (!this.opts.manualRender) {
        const msg = error instanceof Error ? (error.stack ?? error.message) : String(error)
        process.stderr.write(`\n[vuecli] app crashed:\n${msg}\n`)
        process.exitCode = 1
      }
      this.exitResolvers?.reject(error)
    } else this.exitResolvers?.resolve()
  }
}

function resolveTheme(t: Theme | string | undefined): Theme {
  if (!t) return darkTheme
  if (typeof t === 'string') return themes[t] ?? darkTheme
  return t
}

/**
 * Creates a terminal Vue app. Same API as Vue's `createApp`, but `mount()`
 * takes terminal options instead of a DOM container.
 *
 *   createApp(App).mount()
 */
export function createApp(rootComponent: Component, rootProps?: Record<string, unknown> | null): TuiApp {
  // wrap the user's root so built-in overlays (devtools) are always available
  const Root = defineComponent({
    name: 'VueCliRoot',
    setup() {
      return () => [h(rootComponent as any, rootProps ?? null), h(DevTools)]
    },
  })
  const app = createBaseApp(Root) as unknown as TuiApp
  installComponents(app as unknown as App)
  const baseMount = (app as unknown as App<TElement>).mount
  let runtime: Runtime | null = null
  app.runtime = null
  let exitPromise: Promise<void> | null = null

  app.mount = (options: MountOptions = {}) => {
    runtime = new Runtime(app as unknown as App<TElement>, options)
    app.runtime = runtime
    app.provide(APP_CONTEXT, runtime.ctx)
    // surface errors instead of silently corrupting the screen
    if (!app.config.errorHandler) {
      app.config.errorHandler = (err) => {
        runtime?.exit(err)
      }
    }
    runtime.start()
    baseMount(runtime.root)
    exitPromise = runtime.exited
    runtime.requestRender()
    return app
  }
  app.waitUntilExit = () => exitPromise ?? Promise.reject(new Error('[vuecli] app is not mounted'))
  return app
}

/** Shorthand: create, mount and return the app. */
export function run(rootComponent: Component, options: MountOptions & { props?: Record<string, unknown> } = {}) {
  const { props, ...mountOptions } = options
  return createApp(rootComponent, props).mount(mountOptions)
}
