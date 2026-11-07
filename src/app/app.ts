import { defineComponent, h, reactive, ref, shallowRef, type App, type Component } from 'vue'
import { createRoot, type TElement } from '../dom/nodes.js'
import type { CellBuffer } from '../render/buffer.js'
import { Painter, type Graphic } from '../render/paint.js'
import { Emitter, type RenderTarget, type RuntimeEvents } from './target.js'
import { ttyTarget, type ReadStreamLike, type WriteStreamLike } from './tty.js'
import { createBaseApp, trackRoot } from '../renderer.js'
import { InputParser, matchKey, type KeyEvent, type MouseEvent } from '../input/keys.js'
import { detectColorDepth, type ColorDepth } from '../style/colors.js'
import { darkTheme, themes, type Theme } from '../style/theme.js'
import { APP_CONTEXT, type AppContext, type LogEntry } from './context.js'
import { FocusManager } from './focus.js'
import { installComponents, DevTools } from '../components/index.js'
import { formatArgs } from './format.js'

export type { ReadStreamLike, WriteStreamLike } from './tty.js'

export interface MountOptions {
  /** Where frames go / input comes from. Default: the process terminal (`ttyTarget`). */
  target?: RenderTarget | null
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
  /** Fixed size (otherwise taken from the target and updated on resize). */
  columns?: number
  rows?: number
  /** Redirect console.* while running and print it after exit. Default: true for the tty target. */
  patchConsole?: boolean
  /** Focus the first focusable component after mount. Default: true. */
  autoFocus?: boolean
  /** Render synchronously on demand only (tests, MCP, server sessions). Implies no target. */
  manualRender?: boolean
}

export interface TuiApp extends Omit<App<TElement>, 'mount'> {
  mount(options?: MountOptions): TuiApp
  /** Resolves when the app exits (via `exit()`, ctrl+c or unmount). */
  waitUntilExit(): Promise<void>
  /** The running runtime (after mount). */
  runtime: Runtime | null
}

export class Runtime {
  readonly root: TElement
  readonly ctx: AppContext
  readonly painter: Painter
  readonly events = new Emitter<RuntimeEvents>()
  readonly target: RenderTarget | null
  private prev: CellBuffer | null = null
  private prevGraphics: Graphic[] = []
  private scheduled: ReturnType<typeof setTimeout> | null = null
  private lastFrameAt = 0
  private readonly frameInterval: number
  private readonly parser = new InputParser()
  private escTimer: ReturnType<typeof setTimeout> | null = null
  private opts: Required<Pick<MountOptions, 'exitOnCtrlC' | 'patchConsole' | 'autoFocus' | 'manualRender'>>
  private exitResolvers: { resolve: () => void; reject: (e: unknown) => void } | null = null
  readonly exited: Promise<void>
  private running = false
  private paused = false
  private cleanups: (() => void)[] = []
  private downTarget: TElement | null = null
  private hovered: TElement[] = []
  private fpsWindow: number[] = []
  private depth: ColorDepth
  private wireframe = false
  /** Last rendered buffer. */
  get buffer() {
    return this.prev
  }
  get isRunning() {
    return this.running
  }
  get isPaused() {
    return this.paused
  }

  constructor(
    private app: App<TElement>,
    options: MountOptions = {},
  ) {
    const manual = options.manualRender ?? false
    this.target =
      options.target !== undefined
        ? options.target
        : manual
          ? null
          : ttyTarget({
              stdin: options.stdin,
              stdout: options.stdout,
              mouse: options.mouse,
              alternateScreen: options.alternateScreen,
              columns: options.columns,
              rows: options.rows,
            })
    const isTty = !manual && options.target === undefined
    this.opts = {
      exitOnCtrlC: options.exitOnCtrlC ?? true,
      patchConsole: options.patchConsole ?? isTty,
      autoFocus: options.autoFocus ?? true,
      manualRender: manual,
    }
    this.frameInterval = 1000 / (options.fps ?? 60)
    this.exited = new Promise((resolve, reject) => (this.exitResolvers = { resolve, reject }))
    this.exited.catch(() => {})

    const theme = shallowRef(resolveTheme(options.theme))
    this.depth = options.colorDepth ?? this.target?.colorDepth ?? detectColorDepth()
    this.painter = new Painter({ theme: theme.value, depth: this.depth })
    this.root = createRoot({ requestRender: () => this.requestRender() })
    const size = reactive({
      columns: options.columns ?? this.target?.columns ?? 80,
      rows: options.rows ?? this.target?.rows ?? 24,
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
        this.painter.setOptions({ theme: theme.value, depth: this.depth, wireframe: this.wireframe })
        this.requestRender()
      },
      writeRaw: (d) => (this.target as { stdout?: WriteStreamLike } | null)?.stdout?.write(d),
      runtime: this,
    }
    this.syncRootSize()
  }

  private syncRootSize() {
    this.root.setProp('width', this.ctx.size.columns)
    this.root.setProp('height', this.ctx.size.rows)
  }

  start() {
    this.running = true
    this.cleanups.push(trackRoot(this.root))
    this.target?.start?.(this)
    if (this.opts.patchConsole) this.patchConsole()
    if (this.opts.autoFocus) {
      setTimeout(() => {
        if (this.running && !this.ctx.focus.current.value) this.ctx.focus.focusFirst()
      }, 0)
    }
  }

  // ------------------------------------------------------------------ control

  /** Resize the virtual screen (targets call this on terminal / window resize). */
  resize(columns: number, rows: number) {
    if (columns === this.ctx.size.columns && rows === this.ctx.size.rows) return
    this.ctx.size.columns = columns
    this.ctx.size.rows = rows
    this.syncRootSize()
    this.prev = null
    this.events.emit('resize', { columns, rows })
    this.requestRender()
  }

  /** Stop presenting frames (state keeps updating). */
  pause() {
    this.paused = true
    this.events.emit('pause', true)
  }

  resume() {
    this.paused = false
    this.prev = null
    this.events.emit('pause', false)
    this.requestRender()
  }

  /** Debug view: outline every box. */
  setWireframe(on: boolean) {
    this.wireframe = on
    this.painter.setOptions({ theme: this.ctx.theme.value, depth: this.depth, wireframe: on })
    this.requestRender()
  }

  /** Forces a full repaint on the next frame. */
  invalidate() {
    this.prev = null
    this.requestRender()
  }

  // ------------------------------------------------------------------ rendering

  requestRender() {
    if (!this.running || this.scheduled || this.opts.manualRender || this.paused) return
    const wait = Math.max(0, this.lastFrameAt + this.frameInterval - Date.now())
    this.scheduled = setTimeout(() => {
      this.scheduled = null
      if (this.running && !this.paused) this.renderFrame()
    }, wait)
  }

  /** Renders (and presents) a frame immediately. Returns the buffer. */
  renderFrame(): CellBuffer {
    const t0 = performance.now()
    const { columns, rows } = this.ctx.size
    const buf = this.painter.paint(this.root, columns, rows)
    const graphics = this.painter.graphics
    const prev = this.prev
    let bytes = 0
    if (this.target && !this.opts.manualRender) {
      bytes = Number(this.target.frame(buf, prev, { graphics, prevGraphics: this.prevGraphics }) ?? 0)
    }
    this.prev = buf
    this.prevGraphics = graphics
    const now = Date.now()
    this.lastFrameAt = now
    const st = this.ctx.stats
    st.frames++
    st.lastFrameMs = performance.now() - t0
    st.lastFrameBytes = bytes
    this.fpsWindow.push(now)
    while (this.fpsWindow.length && this.fpsWindow[0] < now - 1000) this.fpsWindow.shift()
    st.fps = this.fpsWindow.length
    this.events.emit('frame', { buffer: buf, prev, ms: st.lastFrameMs, bytes, frame: st.frames })
    return buf
  }

  // ------------------------------------------------------------------ input

  /** Feed raw terminal input (escape sequences, text). */
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
    this.events.emit('input', ev)
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
        this.ctx.logs.push({ level, message: formatArgs(args), time: Date.now() })
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
    this.target?.stop?.(this)
    for (const c of this.cleanups.splice(0).reverse()) c()
    const proc = (globalThis as any).process
    const isTty = this.target && !this.opts.manualRender && proc?.stdout
    if (this.opts.patchConsole && isTty) {
      for (const l of this.ctx.logs) {
        const stream = l.level === 'error' || l.level === 'warn' ? proc.stderr : proc.stdout
        stream.write(l.message + '\n')
      }
    }
    this.events.emit('exit', { error })
    if (error) {
      if (isTty) {
        const msg = error instanceof Error ? (error.stack ?? error.message) : String(error)
        proc.stderr.write(`\n[vuecli] app crashed:\n${msg}\n`)
        proc.exitCode = 1
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
