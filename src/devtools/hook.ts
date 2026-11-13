/**
 * Devtools hook for a running app.
 *
 *  - `globalThis.__VURSES_DEVTOOLS_HOOK__`: component / element trees, frame
 *    snapshots, a frame timeline, highlight, pause / resume / step. Used by the
 *    Chrome DevTools extension (via `inspectedWindow.eval`) and other tools.
 *    Every method returns JSON-serializable data.
 *  - `globalThis.vurses` (with `{ repl: true }`): a console REPL to pause,
 *    resize, wireframe and copy the running app.
 *
 * Browser- and Node-safe: no DOM or Node APIs are assumed.
 */
import { nextTick } from 'vue'
import type { Runtime } from '../app/app.js'
import type { CellBuffer } from '../render/buffer.js'
import { keyFromCombo } from '../testing.js'
import { changedRows, frameToAnsi, snapshotFrame, type FrameSnapshot } from './frame.js'
import {
  componentName,
  componentTree,
  elementTree,
  findComponent,
  formatComponentTree,
  formatElementTree,
  hostElements,
  idOf,
  rectForId,
  serializeValue,
  unionRect,
  type ComponentInfo,
  type ElementInfo,
  type Rect,
  type TreeOptions,
} from './tree.js'
import { createRepl, type VursesRepl } from './repl.js'

export const HOOK_KEY = '__VURSES_DEVTOOLS_HOOK__'
export const REPL_KEY = 'vurses'

export interface FrameRecord {
  frame: number
  /** Epoch ms when the frame was presented. */
  time: number
  /** Layout + paint + present duration. */
  ms: number
  /** Bytes written by the target. */
  bytes: number
  /** Rows that changed compared to the previous frame. */
  changedRows: number
}

export interface DevtoolsState {
  paused: boolean
  wireframe: boolean
  columns: number
  rows: number
  frames: number
  fps: number
  highlight: Rect | null
  apps: number
}

export interface ComponentDetails extends Omit<ComponentInfo, 'children'> {
  /** Reactive state returned from setup() (refs unwrapped), serialized. */
  setupState: Record<string, unknown>
  childCount: number
}

export interface DevtoolsHook {
  readonly version: 1
  /** All runtimes registered with the hook (most recent last). */
  readonly runtimes: Runtime[]
  /** The runtime the methods operate on (the most recently installed one). */
  readonly runtime: Runtime | null
  getState(): DevtoolsState
  /** Current frame as a JSON snapshot (CSS colors). */
  getFrame(): FrameSnapshot | null
  getFrameText(): string
  getFrameAnsi(): string
  getComponentTree(opts?: TreeOptions): ComponentInfo[]
  getElementTree(opts?: TreeOptions): ElementInfo | null
  getComponent(id: number): ComponentDetails | null
  formatComponentTree(): string
  formatElementTree(): string
  /** Recent frames (oldest first). */
  getTimeline(limit?: number): FrameRecord[]
  clearTimeline(): void
  /** Subscribe to frames (in-page consumers). Returns an unsubscribe function. */
  onFrame(fn: (record: FrameRecord) => void): () => void
  /**
   * Highlights an element / component (by id) or a rect: its cells are drawn
   * inverse for `ms` milliseconds (default 1500, 0 = until cleared). `null` clears.
   */
  highlight(target: number | Rect | null, ms?: number): Rect | null
  pause(): void
  resume(): void
  /** Renders and presents exactly one frame (works while paused). */
  step(): FrameRecord | null
  setWireframe(on: boolean): void
  resize(columns: number, rows: number): void
  press(...keys: string[]): Promise<void>
  type(text: string): Promise<void>
  stats(): { frames: number; fps: number; lastFrameMs: number; lastFrameBytes: number; avgMs: number; avgBytes: number }
}

const TIMELINE_LIMIT = 600
const INVERSE = 16

interface Attached {
  runtime: Runtime
  dispose: () => void
}

interface HookInternals extends DevtoolsHook {
  _attached: Attached[]
  _timeline: FrameRecord[]
  _listeners: Set<(r: FrameRecord) => void>
  _wireframe: WeakMap<Runtime, boolean>
  _highlight: { rect: Rect; until: number; timer: ReturnType<typeof setTimeout> | null } | null
}

const g = globalThis as Record<string, unknown>

function createHook(): HookInternals {
  const hook: HookInternals = {
    version: 1,
    _attached: [],
    _timeline: [],
    _listeners: new Set(),
    _wireframe: new WeakMap(),
    _highlight: null,
    get runtimes() {
      return hook._attached.map((a) => a.runtime)
    },
    get runtime() {
      return hook._attached.at(-1)?.runtime ?? null
    },
    getState() {
      const rt = hook.runtime
      return {
        paused: rt?.isPaused ?? false,
        wireframe: rt ? (hook._wireframe.get(rt) ?? false) : false,
        columns: rt?.ctx.size.columns ?? 0,
        rows: rt?.ctx.size.rows ?? 0,
        frames: rt?.ctx.stats.frames ?? 0,
        fps: rt?.ctx.stats.fps ?? 0,
        highlight: hook._highlight?.rect ?? null,
        apps: hook._attached.length,
      }
    },
    getFrame() {
      const rt = hook.runtime
      const buf = rt ? currentBuffer(rt) : null
      return buf ? snapshotFrame(buf, rt!.ctx.stats.frames) : null
    },
    getFrameText() {
      const rt = hook.runtime
      return rt ? (currentBuffer(rt)?.toString() ?? '') : ''
    },
    getFrameAnsi() {
      const rt = hook.runtime
      const buf = rt ? currentBuffer(rt) : null
      return buf ? frameToAnsi(buf) : ''
    },
    getComponentTree(opts) {
      return hook.runtime ? componentTree(hook.runtime, opts) : []
    },
    getElementTree(opts) {
      return hook.runtime ? elementTree(hook.runtime.root, opts) : null
    },
    getComponent(id) {
      const rt = hook.runtime
      const i = rt ? findComponent(rt, id) : null
      if (!rt || !i) return null
      const els = hostElements(i.subTree)
      const setupState: Record<string, unknown> = {}
      const raw = (i as unknown as { setupState?: Record<string, unknown> }).setupState ?? {}
      for (const k of Object.keys(raw)) {
        if (k.startsWith('__')) continue
        try {
          setupState[k] = serializeValue(raw[k], 2)
        } catch {
          setupState[k] = '[Unreadable]'
        }
      }
      const props: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(i.props ?? {})) props[k] = serializeValue(v, 3)
      const file = (i.type as { __file?: string }).__file
      return {
        id: idOf(i),
        name: componentName(i),
        ...(file && { file }),
        props,
        rect: unionRect(els),
        elements: els.map(idOf),
        setupState,
        childCount: countChildren(i),
      }
    },
    formatComponentTree() {
      return formatComponentTree(hook.getComponentTree())
    },
    formatElementTree() {
      const t = hook.getElementTree()
      return t ? formatElementTree(t) : ''
    },
    getTimeline(limit) {
      return limit ? hook._timeline.slice(-limit) : hook._timeline.slice()
    },
    clearTimeline() {
      hook._timeline.length = 0
    },
    onFrame(fn) {
      hook._listeners.add(fn)
      return () => hook._listeners.delete(fn)
    },
    highlight(target, ms = 1500) {
      const rt = hook.runtime
      if (hook._highlight?.timer) clearTimeout(hook._highlight.timer)
      hook._highlight = null
      let rect: Rect | null = null
      if (rt && target !== null) rect = typeof target === 'number' ? rectForId(rt, target) : target
      if (rect && rect.width > 0 && rect.height > 0) {
        const timer = ms > 0 ? setTimeout(() => hook.highlight(null), ms) : null
        ;(timer as { unref?: () => void } | null)?.unref?.()
        hook._highlight = { rect, until: ms > 0 ? Date.now() + ms : Infinity, timer }
      } else rect = null
      if (rt) repaint(rt)
      return rect
    },
    pause() {
      hook.runtime?.pause()
    },
    resume() {
      hook.runtime?.resume()
    },
    step() {
      const rt = hook.runtime
      if (!rt) return null
      rt.renderFrame()
      return hook._timeline.at(-1) ?? null
    },
    setWireframe(on) {
      const rt = hook.runtime
      if (!rt) return
      hook._wireframe.set(rt, on)
      rt.setWireframe(on)
      if (rt.isPaused) rt.renderFrame()
    },
    resize(columns, rows) {
      const rt = hook.runtime
      if (!rt) return
      rt.resize(Math.max(1, Math.floor(columns)), Math.max(1, Math.floor(rows)))
      if (rt.isPaused) rt.renderFrame()
    },
    async press(...keys) {
      const rt = hook.runtime
      if (!rt) return
      for (const k of keys.flat()) {
        rt.dispatchKey(keyFromCombo(k))
        await nextTick()
      }
    },
    async type(text) {
      const rt = hook.runtime
      if (!rt) return
      for (const ch of text) rt.dispatchKey(keyFromCombo(ch))
      await nextTick()
    },
    stats() {
      const st = hook.runtime?.ctx.stats ?? { frames: 0, fps: 0, lastFrameMs: 0, lastFrameBytes: 0 }
      const tl = hook._timeline.slice(-60)
      const avg = (f: (r: FrameRecord) => number) => (tl.length ? tl.reduce((a, r) => a + f(r), 0) / tl.length : 0)
      return {
        frames: st.frames,
        fps: st.fps,
        lastFrameMs: round(st.lastFrameMs),
        lastFrameBytes: st.lastFrameBytes,
        avgMs: round(avg((r) => r.ms)),
        avgBytes: Math.round(avg((r) => r.bytes)),
      }
    },
  }
  // keep internals out of JSON / console enumeration
  for (const k of ['_attached', '_timeline', '_listeners', '_wireframe', '_highlight']) {
    Object.defineProperty(hook, k, { enumerable: false, writable: true, value: (hook as unknown as Record<string, unknown>)[k] })
  }
  return hook
}

function round(n: number) {
  return Math.round(n * 100) / 100
}

function countChildren(i: unknown): number {
  const sub = (i as { subTree?: unknown }).subTree
  let n = 0
  const walk = (v: unknown) => {
    if (!v || typeof v !== 'object') return
    const vn = v as { component?: unknown; children?: unknown }
    if (vn.component) {
      n++
      return
    }
    if (Array.isArray(vn.children)) vn.children.forEach(walk)
  }
  walk(sub)
  return n
}

/** Last presented buffer; renders one if there is none yet (after a resize / in manual mode). */
function currentBuffer(rt: Runtime): CellBuffer | null {
  if (rt.buffer) return rt.buffer
  return rt.isRunning ? rt.renderFrame() : null
}

function repaint(rt: Runtime) {
  if (rt.isPaused) rt.renderFrame()
  else rt.invalidate()
}

/** Returns the installed hook, if any. */
export function getDevtoolsHook(): DevtoolsHook | null {
  return (g[HOOK_KEY] as DevtoolsHook | undefined) ?? null
}

export interface InstallDevtoolsOptions {
  /** Also expose the `globalThis.vurses` console REPL. */
  repl?: boolean
}

/**
 * Installs the devtools hook for a running app. Returns an uninstall function.
 * Safe to call in any environment and more than once (each runtime is
 * registered; the most recent one is the active one).
 */
export function installDevtoolsHook(runtime: Runtime, options: InstallDevtoolsOptions = {}): () => void {
  let hook = g[HOOK_KEY] as HookInternals | undefined
  if (!hook || hook.version !== 1 || !Array.isArray(hook._attached)) {
    hook = createHook()
    try {
      Object.defineProperty(g, HOOK_KEY, { value: hook, configurable: true, writable: true, enumerable: false })
    } catch {
      g[HOOK_KEY] = hook
    }
  }
  const h = hook

  // highlight overlay: post-process painted buffers of this runtime
  const painter = runtime.painter as { paint: (...a: unknown[]) => CellBuffer }
  const origPaint = painter.paint
  painter.paint = function (this: unknown, ...args: unknown[]) {
    const buf = origPaint.apply(this, args)
    const hl = h._highlight
    if (hl && h.runtime === runtime) {
      if (Date.now() > hl.until) h._highlight = null
      else applyHighlight(buf, hl.rect)
    }
    return buf
  }

  const offFrame = runtime.events.on('frame', (e) => {
    const rec: FrameRecord = { frame: e.frame, time: Date.now(), ms: round(e.ms), bytes: e.bytes, changedRows: changedRows(e.buffer, e.prev) }
    h._timeline.push(rec)
    if (h._timeline.length > TIMELINE_LIMIT) h._timeline.splice(0, h._timeline.length - TIMELINE_LIMIT)
    for (const fn of [...h._listeners]) {
      try {
        fn(rec)
      } catch {
        // listeners must not break rendering
      }
    }
  })

  let repl: VursesRepl | null = null
  if (options.repl) {
    repl = createRepl(h)
    try {
      Object.defineProperty(g, REPL_KEY, { value: repl, configurable: true, writable: true, enumerable: false })
    } catch {
      g[REPL_KEY] = repl
    }
  }

  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    offFrame()
    offExit()
    if (painter.paint !== origPaint) painter.paint = origPaint
    const idx = h._attached.findIndex((a) => a.runtime === runtime)
    if (idx >= 0) h._attached.splice(idx, 1)
    if (repl && g[REPL_KEY] === repl) delete g[REPL_KEY]
    if (!h._attached.length) {
      if (h._highlight?.timer) clearTimeout(h._highlight.timer)
      h._highlight = null
      if (g[HOOK_KEY] === h) delete g[HOOK_KEY]
    }
  }
  const offExit = runtime.events.on('exit', dispose)
  h._attached.push({ runtime, dispose })
  return dispose
}

function applyHighlight(buf: CellBuffer, r: Rect) {
  const x2 = Math.min(buf.width, r.x + r.width)
  const y2 = Math.min(buf.height, r.y + r.height)
  for (let y = Math.max(0, r.y); y < y2; y++)
    for (let x = Math.max(0, r.x); x < x2; x++) buf.flags[y * buf.width + x] ^= INVERSE
}
