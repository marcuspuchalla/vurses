/**
 * `<Canvas>` — an HTML-style 2D canvas inside a vuecli layout.
 *
 *   <Canvas class="grow" mode="braille" @ready="(canvas, ctx) => draw(ctx)" />
 *   <Canvas :width="160" :height="90" @frame="(ctx, dt) => animate(ctx, dt)" />
 *   <Canvas src="./demo.html" />            <!-- run an existing browser canvas page -->
 *
 * Drawing uses the full Canvas 2D API from `tty-canvas`; the pixels are
 * encoded into terminal cells (halfblock / quadrant / sextant / braille /
 * ascii) or sent as a pixel image (kitty / sixel / iterm2, with a cell
 * fallback). Mouse and keyboard input are delivered to the canvas as DOM
 * events (`canvas.addEventListener('mousemove', ...)`) in canvas pixels.
 */
import {
  defineComponent, getCurrentInstance, h, markRaw, onBeforeUnmount, onMounted, ref, shallowRef, watch,
  type PropType,
} from 'vue'
import {
  Canvas as PixelCanvas, createEnvironment, encodeCells, encodeIterm2, encodeKitty, encodeSixel, fitCells, keyToCode,
  kittyDelete, MODE_RESOLUTION, toRgbNumber,
  type BrowserEnvironment, type CanvasRenderingContext2D, type CellMode, type EncodedCells, type MouseButtonName,
} from 'tty-canvas'
import { useApp, useFocus, useTheme } from '../composables.js'
import type { KeyEvent, MouseEvent as TuiMouseEvent } from '../input/keys.js'
import type { CellPainter } from '../render/paint.js'

export type CanvasMode = CellMode | 'kitty' | 'sixel' | 'iterm2'
export type CanvasFit = 'contain' | 'fill' | 'none'

/** Assumed terminal cell size in pixels for pixel protocols (kitty / sixel / iterm2). */
const PIXEL_CELL: readonly [number, number] = [8, 16]

export const CANVAS_MODES: readonly CanvasMode[] = ['halfblock', 'quadrant', 'sextant', 'braille', 'ascii', 'kitty', 'sixel', 'iterm2']

const isPixelMode = (m: string): m is 'kitty' | 'sixel' | 'iterm2' => m === 'kitty' || m === 'sixel' || m === 'iterm2'

/**
 * Canvas pixels per terminal cell when the canvas follows the component size.
 * Pixels are kept square (cells are ~1:2), so circles stay round: halfblock
 * and braille map 1:1 to their native resolution, quadrant / sextant are
 * resampled vertically.
 */
export function pixelsPerCell(mode: CanvasMode): readonly [number, number] {
  if (isPixelMode(mode)) return PIXEL_CELL
  const cw = (MODE_RESOLUTION[mode] ?? MODE_RESOLUTION.halfblock)[0]
  return [cw, cw * 2]
}

/** Cell mode used to paint (also the fallback for pixel protocols). */
const cellModeOf = (m: CanvasMode): CellMode => (isPixelMode(m) ? 'halfblock' : (m in MODE_RESOLUTION ? m : 'halfblock'))

export interface CanvasResizeEvent {
  /** Canvas size in pixels. */
  width: number
  height: number
  /** Size of the component's content box in cells. */
  columns: number
  rows: number
}

export interface CanvasPointerEvent {
  type: 'down' | 'up' | 'move' | 'wheel'
  /** Position in canvas pixels. */
  x: number
  y: number
  button: MouseButtonName
  /** Wheel direction (wheel events). */
  direction?: 'up' | 'down' | 'left' | 'right'
}

const KEY_NAMES: Record<string, string> = {
  up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', enter: 'Enter', return: 'Enter',
  escape: 'Escape', tab: 'Tab', backspace: 'Backspace', delete: 'Delete', space: ' ', home: 'Home', end: 'End',
  pageup: 'PageUp', pagedown: 'PageDown', insert: 'Insert',
}

/** vuecli KeyEvent → KeyboardEvent init. */
function domKeyInit(e: KeyEvent) {
  let key = KEY_NAMES[e.name] ?? (/^f\d{1,2}$/.test(e.name) ? e.name.toUpperCase() : e.char || e.name)
  if (key.length === 1 && e.shift && !e.char) key = key.toUpperCase()
  return { key, code: keyToCode(key) || key, ctrlKey: e.ctrl, shiftKey: e.shift, altKey: e.meta, metaKey: false }
}

let instanceIds = 0

export const Canvas = defineComponent({
  name: 'Canvas',
  props: {
    /** Cell encoding (`halfblock`, `quadrant`, `sextant`, `braille`, `ascii`) or pixel protocol (`kitty`, `sixel`, `iterm2`). */
    mode: { type: String as PropType<CanvasMode>, default: 'halfblock' },
    /** Fixed canvas width in pixels. Without width/height the canvas tracks the component's size (cells × mode resolution). */
    width: Number,
    /** Fixed canvas height in pixels. */
    height: Number,
    /** How a fixed-size canvas (or a page's canvas) is scaled into the box. */
    fit: { type: String as PropType<CanvasFit>, default: 'contain' },
    /** Frame rate of the `@frame` loop / page animation frames. 0 disables the loop. */
    fps: { type: Number, default: 30 },
    /** Repaint automatically whenever the canvas is drawn on (default true). Otherwise call `redraw()`. */
    autoRedraw: { type: Boolean, default: true },
    /** Color behind transparent pixels (CSS color). Defaults to the theme background. */
    background: String,
    /** Run an existing browser page (`.html`) or canvas script (`.js` / `.ts`) in this canvas. Paths resolve from the working directory. */
    src: String,
    /** A script file to run (like `src`), or a function called once with `(ctx, canvas)`. */
    script: [String, Function] as PropType<string | ((ctx: CanvasRenderingContext2D, canvas: PixelCanvas) => void)>,
    /** Keep the pixels when the component is resized (default true). Browsers clear on resize; set false for that behavior. */
    preserve: { type: Boolean, default: true },
    /** Take part in focus navigation and receive keyboard events (default true). */
    focusable: { type: Boolean, default: true },
    autoFocus: Boolean,
  },
  emits: {
    /** The canvas has its initial size: draw here. */
    ready: (_canvas: PixelCanvas, _ctx: CanvasRenderingContext2D) => true,
    /** Animation frame (when `fps > 0`): `dt` in seconds since the previous frame, `time` in ms. */
    frame: (_ctx: CanvasRenderingContext2D, _dt: number, _time: number) => true,
    /** The canvas was resized to follow the component. */
    resize: (_e: CanvasResizeEvent) => true,
    /** Pointer input in canvas pixel coordinates. */
    pointer: (_e: CanvasPointerEvent) => true,
    /** A page (`src` / `script` file) failed to load. */
    error: (_err: unknown) => true,
  },
  setup(props, { emit, expose }) {
    const instance = getCurrentInstance()!
    const app = useApp()
    const theme = useTheme()
    const id = ++instanceIds
    const kittyId = 0x7c000000 + id

    // own canvas, living in a tiny browser environment so DOM-style pointer events (click, buttons, focus) behave like a browser
    const env = markRaw(createEnvironment({ width: 1, height: 1 }))
    const own = markRaw(env.document.createElement('canvas') as PixelCanvas)
    own.width = 1
    own.height = 1
    env.document.body.appendChild(own)
    const ctx = own.getContext('2d')
    /** The running page (src / script file), if any. */
    const page = shallowRef<{ env: BrowserEnvironment; readonly canvas: PixelCanvas | null; errors: unknown[]; dispose(): void } | null>(null)
    const error = ref<string | null>(null)
    let ready = false
    let disposed = false
    let pageToken = 0

    const display = (): PixelCanvas => page.value?.canvas ?? own
    const activeEnv = (): BrowserEnvironment => page.value?.env ?? env

    // ------------------------------------------------------------ repaint scheduling

    let unsubscribe: (() => void) | null = null
    let subscribed: PixelCanvas | null = null
    const watchCanvas = (c: PixelCanvas) => {
      if (subscribed === c) return
      unsubscribe?.()
      subscribed = c
      unsubscribe = c.subscribe(() => {
        if (props.autoRedraw) app.requestRender()
      })
    }
    watchCanvas(own)

    // ------------------------------------------------------------ painting

    let size: { columns: number; rows: number } | null = null
    /** Where the image was drawn last frame (absolute cells) — used to map mouse positions. */
    let placed = { x: 0, y: 0, columns: 0, rows: 0 }
    let cache: { key: string; cells: EncodedCells; graphic: string | null } | null = null
    const autoSize = () => props.width === undefined && props.height === undefined

    const backgroundColor = (): number | null => {
      if (props.background) return toRgbNumber(props.background)
      let bg: string | undefined = theme.value.background
      for (let i = 0; i < 4 && bg && theme.value[bg] !== undefined; i++) bg = theme.value[bg]
      return bg ? toRgbNumber(bg) : null
    }

    const sizeCanvas = (columns: number, rows: number) => {
      const [cw, ch] = pixelsPerCell(props.mode)
      const pw = Math.max(1, columns * cw)
      const ph = Math.max(1, rows * ch)
      const first = !size
      const changed = !size || size.columns !== columns || size.rows !== rows
      size = { columns, rows }
      if (page.value) {
        if (changed) page.value.env.resize(pw, ph)
      } else if (autoSize()) {
        if (own.width !== pw || own.height !== ph) {
          if (props.preserve && !first) own._resizeKeep(pw, ph)
          else {
            own.width = pw
            own.height = ph
          }
          if (!first) emit('resize', { width: pw, height: ph, columns, rows })
        }
      } else {
        const w = props.width ?? Math.round(((props.height ?? 1) * pw) / ph)
        const hgt = props.height ?? Math.round(((props.width ?? 1) * ph) / pw)
        if (own.width !== w || own.height !== hgt) {
          if (props.preserve && !first) own._resizeKeep(w, hgt)
          else {
            own.width = w
            own.height = hgt
          }
        }
      }
      env.resize(own.width, own.height)
      if (first) {
        ready = true
        if (typeof props.script === 'function') props.script(ctx, own)
        emit('ready', own, ctx)
        if (props.src || typeof props.script === 'string') void loadPage()
      }
    }

    const paintCells = (p: CellPainter) => {
      const { width: columns, height: rows } = p
      if (columns <= 0 || rows <= 0) return
      sizeCanvas(columns, rows)
      const c = display()
      watchCanvas(c)
      if (error.value) {
        p.text(0, 0, error.value.slice(0, columns), 'error')
        return
      }
      if (!c.width || !c.height) return
      const mode = props.mode
      const cellMode = cellModeOf(mode)
      const box = c === own && autoSize() ? { x: 0, y: 0, columns, rows } : fitCells(c.width, c.height, columns, rows, props.fit, cellMode)
      placed = { x: p.x + box.x, y: p.y + box.y, columns: box.columns, rows: box.rows }
      const bg = backgroundColor()
      const key = `${c.version}|${c.width}x${c.height}|${box.columns}x${box.rows}|${mode}|${bg}`
      if (!cache || cache.key !== key || cache.cells.columns !== box.columns) {
        const cells = encodeCells(c.data, c.width, c.height, { mode: cellMode, columns: box.columns, rows: box.rows, background: bg })
        let graphic: string | null = null
        if (mode === 'kitty') graphic = encodeKitty(c.data, c.width, c.height, { id: kittyId, columns: box.columns, rows: box.rows })
        else if (mode === 'iterm2') graphic = encodeIterm2(c.data, c.width, c.height, { columns: box.columns, rows: box.rows, preserveAspectRatio: false })
        else if (mode === 'sixel') graphic = encodeSixel(c.data, c.width, c.height, { background: bg })
        cache = { key, cells, graphic }
      }
      const { cells } = cache
      for (let y = 0; y < cells.rows; y++) {
        for (let x = 0; x < cells.columns; x++) {
          const cell = cells.cells[y * cells.columns + x]
          p.set(box.x + x, box.y + y, cell.ch, cell.fg, cell.bg)
        }
      }
      if (cache.graphic) {
        p.graphic({
          key: `tty-canvas-${id}`, version: c.version * 4096 + box.columns * 64 + box.rows, data: cache.graphic,
          clear: mode === 'kitty' ? kittyDelete(kittyId) : undefined,
          x: box.x, y: box.y, width: box.columns, height: box.rows,
        })
      }
    }

    // ------------------------------------------------------------ pages (src / script file)

    async function loadPage() {
      const token = ++pageToken
      page.value?.dispose()
      page.value = null
      error.value = null
      const file = props.src ?? (typeof props.script === 'string' ? props.script : null)
      if (!file || !size) return
      const [cw, ch] = pixelsPerCell(props.mode)
      try {
        // non-literal specifier: keeps browser bundlers from following this Node-only import
        const nodeEntry = 'tty-canvas/node'
        const node = (await import(/* @vite-ignore */ nodeEntry)) as typeof import('tty-canvas/node')
        const path = file.startsWith('file:') ? new URL(file) : file
        const opts = { width: size.columns * cw, height: size.rows * ch }
        const loaded = /\.html?$/i.test(file) ? await node.runHtml(path, opts) : await node.runScript(path, opts)
        if (token !== pageToken || disposed) {
          loaded.dispose()
          return
        }
        page.value = markRaw(loaded)
        if (loaded.errors.length) emit('error', loaded.errors[0])
        startLoop()
        app.requestRender()
      } catch (err) {
        if (token !== pageToken) return
        error.value = `Canvas: ${(err as Error)?.message ?? String(err)}`
        emit('error', err)
        app.requestRender()
      }
    }

    // ------------------------------------------------------------ animation loop

    let timer: ReturnType<typeof setInterval> | null = null
    let last = 0
    const hasFrameListener = () => !!(instance.vnode.props as Record<string, unknown> | null)?.onFrame
    function startLoop() {
      if (timer || props.fps <= 0 || disposed) return
      if (!hasFrameListener() && !page.value) return
      last = performance.now()
      timer = setInterval(() => {
        const now = performance.now()
        const dt = (now - last) / 1000
        last = now
        if (!ready) return
        page.value?.env.frame(now)
        if (hasFrameListener()) emit('frame', ctx, dt, now)
      }, 1000 / props.fps)
    }
    function stopLoop() {
      if (timer) clearInterval(timer)
      timer = null
    }
    watch(() => props.fps, () => {
      stopLoop()
      startLoop()
    })
    watch(() => [props.src, props.script], () => {
      if (ready) void loadPage()
    })
    watch(() => [props.width, props.height, props.mode], () => {
      cache = null
      if (size) {
        const s = size
        size = { columns: -1, rows: -1 }
        sizeCanvas(s.columns, s.rows)
        if (autoSize() && !page.value) emit('resize', { width: own.width, height: own.height, columns: s.columns, rows: s.rows })
      }
      app.requestRender()
    })
    onMounted(startLoop)
    onBeforeUnmount(() => {
      disposed = true
      stopLoop()
      unsubscribe?.()
      page.value?.dispose()
      env.dispose()
      for (const t of keyTimers.values()) clearTimeout(t)
    })

    // ------------------------------------------------------------ input

    const toPixels = (ev: { x: number; y: number }) => {
      const c = display()
      const cols = placed.columns || 1
      const rows = placed.rows || 1
      return { x: ((ev.x - placed.x + 0.5) * c.width) / cols, y: ((ev.y - placed.y + 0.5) * c.height) / rows }
    }
    const pointer = (action: CanvasPointerEvent['type'], ev: TuiMouseEvent) => {
      const { x, y } = toPixels(ev)
      const button: MouseButtonName = ev.button ?? 'none'
      const mods = { ctrlKey: ev.ctrl, shiftKey: ev.shift, altKey: ev.meta }
      const target = display()
      const e = activeEnv()
      if (action === 'wheel') {
        const d = ev.direction
        e.pointer({ action, x, y, deltaY: d === 'up' ? -100 : d === 'down' ? 100 : 0, deltaX: d === 'left' ? -100 : d === 'right' ? 100 : 0, ...mods }, target)
      } else e.pointer({ action, x, y, button: action === 'move' && button === 'none' ? 'none' : button, ...mods }, target)
      emit('pointer', { type: action, x, y, button, direction: ev.direction })
    }

    // terminals report no key releases: synthesize keyup when auto-repeat stops
    const keyTimers = new Map<string, ReturnType<typeof setTimeout>>()
    const focus = useFocus({
      autoFocus: props.autoFocus,
      disabled: () => !props.focusable,
      onKey(e: KeyEvent) {
        if (e.paste) return
        const init = domKeyInit(e)
        const target = activeEnv()
        const held = keyTimers.has(init.code)
        const dom = target.key('down', { ...init, repeat: held })
        clearTimeout(keyTimers.get(init.code))
        keyTimers.set(init.code, setTimeout(() => {
          keyTimers.delete(init.code)
          target.key('up', init)
        }, held ? 120 : 550))
        if (dom?.defaultPrevented) {
          e.preventDefault()
          e.stopPropagation()
        }
      },
    })

    const redraw = () => {
      cache = null
      app.requestRender()
    }

    expose({
      /** The pixel canvas (an HTMLCanvasElement work-alike). For `src` pages: the page's canvas. */
      get canvas() { return display() },
      getContext: () => (page.value?.canvas?.getContext('2d') ?? ctx),
      /** Repaints the component (needed only with `:auto-redraw="false"`). */
      redraw,
      /** The running page for `src` / `script` files (`{ env, window, document, canvas }`), or null. */
      get page() { return page.value },
      get pixelWidth() { return display().width },
      get pixelHeight() { return display().height },
    })

    return () => {
      // with both width and height the box takes the canvas' natural size (square pixels)
      const [cw, ch] = pixelsPerCell(props.mode)
      const natural = props.width !== undefined && props.height !== undefined
        ? { width: Math.max(1, Math.ceil(props.width / cw)), height: Math.max(1, Math.ceil(props.height / ch)), maxWidth: '100%', maxHeight: '100%' }
        : { flexGrow: 1, minHeight: 1, minWidth: 1 }
      void error.value
      return h('tui-box', {
        ref: focus.el,
        ...natural,
        flexShrink: 1,
        paintCells,
        onMouseDown: (e: TuiMouseEvent) => pointer('down', e),
        onMouseUp: (e: TuiMouseEvent) => pointer('up', e),
        onMouseMove: (e: TuiMouseEvent) => pointer('move', e),
        onWheel: (e: TuiMouseEvent) => pointer('wheel', e),
      })
    }
  },
})
