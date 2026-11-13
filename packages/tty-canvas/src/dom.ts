/**
 * A browser-like environment (window + document) so existing canvas code runs
 * unmodified: getElementById/querySelector/createElement('canvas'),
 * requestAnimationFrame, timers, Image, storage, and DOM events delivered in
 * canvas pixel coordinates. Pure JavaScript — the host (terminal player,
 * vurses component, tests) drives frames and input through the returned
 * environment object.
 */
import { Canvas } from './canvas.js'
import { CanvasRenderingContext2D } from './context.js'
import { Element } from './element.js'
import {
  CustomEvent, Event, EventTarget, FocusEvent, KeyboardEvent, MouseEvent, PointerEvent, UIEvent, WheelEvent,
  type KeyboardEventInit,
} from './events.js'
import { Image } from './image.js'
import { ImageData } from './image-data.js'
import { DOMMatrix } from './matrix.js'
import { CanvasGradient, CanvasPattern } from './paint-style.js'
import { Path2D } from './path.js'

export interface EnvironmentOptions {
  /** Viewport size in CSS px (window.innerWidth / innerHeight). Default 300×150. */
  width?: number
  height?: number
  devicePixelRatio?: number
  /** Directory or URL that relative image URLs resolve against. */
  baseURL?: string
  /** Page URL reported by `location`. */
  url?: string
  /** Console used by scripts (default: the host console). */
  console?: Console
  /** Called when the page calls window.close(). */
  onClose?: () => void
}

export type PointerAction = 'down' | 'up' | 'move' | 'wheel'
export type MouseButtonName = 'left' | 'middle' | 'right' | 'none'

export interface PointerInput {
  action: PointerAction
  /** Position in canvas pixels. */
  x: number
  y: number
  button?: MouseButtonName
  ctrlKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
  metaKey?: boolean
  /** Wheel deltas (px). */
  deltaX?: number
  deltaY?: number
}

// host timers, captured before any environment installs its wrappers on globalThis
const hostSetTimeout = globalThis.setTimeout
const hostClearTimeout = globalThis.clearTimeout
const hostSetInterval = globalThis.setInterval
const hostClearInterval = globalThis.clearInterval
const hostQueueMicrotask = globalThis.queueMicrotask

const BUTTON_INDEX: Record<MouseButtonName, number> = { left: 0, middle: 1, right: 2, none: 0 }
const BUTTON_MASK: Record<MouseButtonName, number> = { left: 1, middle: 4, right: 2, none: 0 }

class Storage {
  private m = new Map<string, string>()
  get length() { return this.m.size }
  key(i: number) { return [...this.m.keys()][i] ?? null }
  getItem(k: string) { return this.m.has(String(k)) ? this.m.get(String(k))! : null }
  setItem(k: string, v: string) { this.m.set(String(k), String(v)) }
  removeItem(k: string) { this.m.delete(String(k)) }
  clear() { this.m.clear() }
}

export class Document extends Element {
  override readonly nodeType = 9
  readonly documentElement: Element
  readonly head: Element
  body: Element
  readyState: 'loading' | 'interactive' | 'complete' = 'loading'
  title = ''
  visibilityState = 'visible'
  hidden = false
  cookie = ''
  pointerLockElement: Element | null = null
  fullscreenElement: Element | null = null
  readonly fonts = { ready: Promise.resolve(), load: () => Promise.resolve([]), check: () => true, add() {}, delete() {}, forEach() {}, status: 'loaded' }
  /** @internal */ _activeElement: Element | null = null
  /** @internal */ _env: BrowserEnvironment

  constructor(env: BrowserEnvironment) {
    super('#document')
    this._env = env
    this.ownerDocument = null
    this.documentElement = this.appendChild(this.createElement('html'))
    this.head = this.documentElement.appendChild(this.createElement('head'))
    this.body = this.documentElement.appendChild(this.createElement('body'))
  }
  override get nodeName() { return '#document' }
  get defaultView() { return this._env.window }
  get activeElement() { return this._activeElement ?? this.body }
  get location() { return this._env.window.location }
  get URL() { return this._env.window.location.href }
  get scrollingElement() { return this.documentElement }

  createElement(tag: string): Element {
    const t = String(tag).toLowerCase()
    let el: Element
    if (t === 'canvas') {
      el = new Canvas()
      this._env._trackCanvas(el as Canvas)
    } else if (t === 'img') el = new this._env.Image()
    else el = new Element(t)
    el.ownerDocument = this
    return el
  }
  createElementNS(_ns: string, tag: string) { return this.createElement(tag) }
  createTextNode(text: string) {
    const el = new Element('#text')
    el.textContent = text
    return el
  }
  createDocumentFragment() { return new Element('#fragment') }
  createEvent(_kind: string) {
    const e = new Event('') as Event & { initEvent(t: string, b?: boolean, c?: boolean): void }
    e.initEvent = (t: string, b = false, c = false) => Object.assign(e, { type: t, bubbles: b, cancelable: c })
    return e
  }
  hasFocus() { return true }
  exitPointerLock() {}
  exitFullscreen() { return Promise.resolve() }
  elementFromPoint(_x: number, _y: number) { return this._env.primaryCanvas() ?? this.body }
  override _eventParent(): EventTarget | null { return this._env.window }
  override getBoundingClientRect() {
    const w = this._env.window
    return { x: 0, y: 0, width: w.innerWidth, height: w.innerHeight, left: 0, top: 0, right: w.innerWidth, bottom: w.innerHeight, toJSON() { return this } }
  }
}

/** The `window` object: an EventTarget with the usual browser globals as properties. */
export type Window = EventTarget & Record<string, any>

type Timer = ReturnType<typeof setTimeout>

export class BrowserEnvironment {
  readonly window: Window
  readonly document: Document
  readonly Image: typeof Image
  private canvases: Canvas[] = []
  private rafs = new Map<number, (t: number) => void>()
  private rafId = 0
  private timers = new Set<Timer>()
  private intervals = new Set<Timer>()
  private observers = new Set<{ cb: (entries: unknown[], obs: unknown) => void; els: Set<Element>; obs: unknown }>()
  private pressed = 0
  private last: { x: number; y: number } | null = null
  private lastClick = { t: 0, x: 0, y: 0 }
  private disposed = false
  private t0: number
  /** Called whenever a requestAnimationFrame callback is queued (hosts can start their loop). */
  onFrameRequested: (() => void) | null = null

  constructor(opts: EnvironmentOptions = {}) {
    const env = this
    const hostConsole = opts.console ?? console
    const perf = typeof performance !== 'undefined' ? performance : { now: () => Date.now() }
    this.t0 = perf.now()
    this.Image = class extends Image {
      static override baseURL = opts.baseURL
      constructor(w?: number, h?: number) {
        super(w, h)
        this.ownerDocument = env.document
      }
    }
    const win = new EventTarget() as Window
    this.window = win
    this.document = new Document(this)
    const width = opts.width ?? 300
    const height = opts.height ?? 150
    const url = opts.url ?? 'about:blank'
    let parsed: URL | null = null
    try { parsed = new URL(url) } catch { /* about:blank */ }
    const location = {
      href: url, protocol: parsed?.protocol ?? 'about:', host: parsed?.host ?? '', hostname: parsed?.hostname ?? '',
      port: parsed?.port ?? '', pathname: parsed?.pathname ?? 'blank', search: parsed?.search ?? '', hash: parsed?.hash ?? '',
      origin: parsed?.origin ?? 'null', reload() {}, assign() {}, replace() {}, toString() { return url },
    }
    const track = <T extends Timer>(set: Set<Timer>, t: T) => (set.add(t), t)
    const g = globalThis as Record<string, any>
    const props: Record<string, unknown> = {
      window: win, self: win, top: win, parent: win, frames: win, opener: null, closed: false, name: '',
      document: this.document, location, history: { length: 1, state: null, pushState() {}, replaceState() {}, back() {}, forward() {}, go() {} },
      navigator: {
        userAgent: 'Mozilla/5.0 (tty-canvas) AppleWebKit/537.36 (KHTML, like Gecko)', language: 'en-US', languages: ['en-US', 'en'],
        platform: 'tty', vendor: 'tty-canvas', hardwareConcurrency: 4, maxTouchPoints: 0, onLine: true, cookieEnabled: false,
        getGamepads: () => [], vibrate: () => false, clipboard: { writeText: () => Promise.resolve(), readText: () => Promise.resolve('') },
        mediaDevices: undefined, userActivation: { isActive: true, hasBeenActive: true },
      },
      screen: { width, height, availWidth: width, availHeight: height, colorDepth: 24, pixelDepth: 24, orientation: { type: 'landscape-primary', angle: 0 } },
      innerWidth: width, innerHeight: height, outerWidth: width, outerHeight: height,
      devicePixelRatio: opts.devicePixelRatio ?? 1,
      scrollX: 0, scrollY: 0, pageXOffset: 0, pageYOffset: 0, scrollTo() {}, scrollBy() {}, scroll() {},
      focus() {}, blur() {}, print() {}, stop() {}, moveTo() {}, resizeTo() {},
      close: () => opts.onClose?.(),
      alert: (m?: unknown) => hostConsole.log(String(m ?? '')), confirm: () => false, prompt: () => null,
      open: () => null, postMessage() {},
      getComputedStyle: (el: Element) => {
        const r = el.getBoundingClientRect()
        const st = el.style as Record<string, any>
        return new Proxy({}, {
          get: (_t, k) => {
            if (k === 'width') return `${r.width}px`
            if (k === 'height') return `${r.height}px`
            if (k === 'getPropertyValue') return (n: string) => (n === 'width' ? `${r.width}px` : n === 'height' ? `${r.height}px` : st.getPropertyValue(n))
            return st[k as string] ?? ''
          },
        })
      },
      matchMedia: (q: string) => ({
        matches: /prefers-color-scheme:\s*dark/.test(q), media: q, onchange: null,
        addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true,
      }),
      requestAnimationFrame: (cb: (t: number) => void) => {
        const id = ++this.rafId
        this.rafs.set(id, cb)
        this.onFrameRequested?.()
        return id
      },
      cancelAnimationFrame: (id: number) => void this.rafs.delete(id),
      requestIdleCallback: (cb: (d: unknown) => void) => {
        const t = hostSetTimeout(() => cb({ didTimeout: false, timeRemaining: () => 10 }), 1)
        return track(this.timers, t)
      },
      cancelIdleCallback: (t: Timer) => hostClearTimeout(t),
      setTimeout: (fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => {
        if (typeof fn !== 'function') return 0
        const t: Timer = hostSetTimeout(() => {
          this.timers.delete(t)
          if (!this.disposed) safeCall(fn, args, hostConsole)
        }, ms)
        return track(this.timers, t)
      },
      clearTimeout: (t: Timer) => {
        hostClearTimeout(t)
        this.timers.delete(t)
      },
      setInterval: (fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => {
        if (typeof fn !== 'function') return 0
        return track(this.intervals, hostSetInterval(() => !this.disposed && safeCall(fn, args, hostConsole), ms))
      },
      clearInterval: (t: Timer) => {
        hostClearInterval(t)
        this.intervals.delete(t)
      },
      queueMicrotask: (fn: () => void) => hostQueueMicrotask(fn),
      performance: { now: () => perf.now() - this.t0, timeOrigin: Date.now(), mark() {}, measure() {}, getEntriesByName: () => [] },
      console: hostConsole,
      localStorage: new Storage(), sessionStorage: new Storage(),
      // DOM classes
      Node: Element, Element, HTMLElement: Element, HTMLCanvasElement: Canvas, HTMLImageElement: this.Image, Image: this.Image,
      HTMLDivElement: Element, HTMLBodyElement: Element, Document,
      OffscreenCanvas: class OffscreenCanvas extends Canvas {
        convertToBlob() { return Promise.resolve(new (g.Blob ?? Object)([this.toBuffer()], { type: 'image/png' })) }
        transferToImageBitmap() { return bitmapOf(this) }
      },
      ImageData, Path2D, DOMMatrix, CanvasRenderingContext2D, CanvasGradient, CanvasPattern,
      OffscreenCanvasRenderingContext2D: CanvasRenderingContext2D,
      DOMPoint: class DOMPoint { constructor(public x = 0, public y = 0, public z = 0, public w = 1) {} },
      DOMRect: class DOMRect {
        constructor(public x = 0, public y = 0, public width = 0, public height = 0) {}
        get left() { return this.x } get top() { return this.y } get right() { return this.x + this.width } get bottom() { return this.y + this.height }
      },
      Event, CustomEvent, UIEvent, MouseEvent, PointerEvent, WheelEvent, KeyboardEvent, FocusEvent, EventTarget,
      createImageBitmap: async (src: any) => {
        if (src && src.tagName === 'IMG' && !src.complete) await src.decode()
        return bitmapOf(src)
      },
      ResizeObserver: class ResizeObserver {
        private entry: { cb: (e: unknown[], o: unknown) => void; els: Set<Element>; obs: unknown }
        constructor(cb: (e: unknown[], o: unknown) => void) {
          this.entry = { cb, els: new Set(), obs: this }
          env.observers.add(this.entry)
        }
        observe(el: Element) {
          this.entry.els.add(el)
          queueMicrotask(() => env._notifyResize(this.entry, [el]))
        }
        unobserve(el: Element) { this.entry.els.delete(el) }
        disconnect() { this.entry.els.clear(); env.observers.delete(this.entry) }
      },
      MutationObserver: class MutationObserver { observe() {} disconnect() {} takeRecords() { return [] } },
      IntersectionObserver: class IntersectionObserver {
        constructor(private cb: (e: unknown[], o: unknown) => void) {}
        observe(el: Element) { queueMicrotask(() => this.cb([{ target: el, isIntersecting: true, intersectionRatio: 1 }], this)) }
        unobserve() {} disconnect() {}
      },
      FontFace: class FontFace {
        status = 'loaded'
        constructor(public family: string) {}
        load() { return Promise.resolve(this) }
      },
      Audio: class Audio extends EventTarget {
        volume = 1; loop = false; currentTime = 0; paused = true; src = ''
        play() { this.paused = false; return Promise.resolve() }
        pause() { this.paused = true }
        load() {}
      },
    }
    // host globals that behave the same in a browser
    for (const k of ['URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder', 'atob', 'btoa', 'structuredClone', 'AbortController', 'AbortSignal', 'Blob', 'crypto', 'fetch', 'Headers', 'Request', 'Response', 'FormData', 'WebAssembly', 'BroadcastChannel', 'MessageChannel', 'Intl']) {
      if (g[k] !== undefined) props[k] = g[k]
    }
    for (const [k, v] of Object.entries(props)) win[k] = v
    win._eventParent = () => null
  }

  /** @internal */
  _trackCanvas(c: Canvas) {
    this.canvases.push(c)
  }

  /** @internal */
  _notifyResize(entry: { cb: (e: unknown[], o: unknown) => void; els: Set<Element>; obs: unknown }, els: Iterable<Element>) {
    const entries = [...els].map((el) => {
      const r = el.getBoundingClientRect()
      const size = [{ inlineSize: r.width, blockSize: r.height }]
      return { target: el, contentRect: r, contentBoxSize: size, borderBoxSize: size, devicePixelContentBoxSize: size }
    })
    if (entries.length) safeCall(entry.cb, [entries, entry.obs], console)
  }

  /** Names of all globals scripts should see. */
  globals(): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(this.window)) if (!k.startsWith('_')) out[k] = this.window[k]
    for (const k of ['addEventListener', 'removeEventListener', 'dispatchEvent']) out[k] = (this.window[k] as (...a: unknown[]) => unknown).bind(this.window)
    return out
  }

  /** Copies the browser globals onto `target` (default: globalThis). Returns a function that restores the previous values. */
  installGlobals(target: Record<string, any> = globalThis as Record<string, any>): () => void {
    const saved = new Map<string, PropertyDescriptor | undefined>()
    for (const [k, v] of Object.entries(this.globals())) {
      if (k === 'console' || k === 'performance' || target[k] === v) continue
      saved.set(k, Object.getOwnPropertyDescriptor(target, k))
      try {
        Object.defineProperty(target, k, { value: v, configurable: true, writable: true, enumerable: false })
      } catch {
        saved.delete(k)
      }
    }
    return () => {
      for (const [k, d] of saved) {
        try {
          if (d) Object.defineProperty(target, k, d)
          else delete target[k]
        } catch { /* ignore */ }
      }
    }
  }

  /**
   * The canvas to display: the first `<canvas>` in the document, else the
   * first canvas created with createElement / new OffscreenCanvas that has a context.
   */
  primaryCanvas(): Canvas | null {
    const inDoc = this.document.getElementsByTagName('canvas')
    let best: Canvas | null = null
    for (const el of inDoc) {
      const c = el as Canvas
      if (!best || c.width * c.height > best.width * best.height) best = c
    }
    if (best) return best
    return this.canvases.find((c) => c._ctx) ?? this.canvases[0] ?? null
  }

  /** True when requestAnimationFrame callbacks are waiting. */
  get hasPendingFrame() {
    return this.rafs.size > 0
  }

  /** Runs the queued requestAnimationFrame callbacks (one browser frame). */
  frame(now?: number) {
    if (this.disposed || !this.rafs.size) return
    const t = now ?? (this.window.performance as { now(): number }).now()
    const cbs = [...this.rafs.values()]
    this.rafs.clear()
    for (const cb of cbs) safeCall(cb, [t], this.window.console as Console)
  }

  /** Updates the viewport size and fires `resize` (+ ResizeObserver callbacks). */
  resize(width: number, height: number) {
    const w = this.window
    if (w.innerWidth === width && w.innerHeight === height) return
    w.innerWidth = w.outerWidth = width
    w.innerHeight = w.outerHeight = height
    Object.assign(w.screen, { width, height, availWidth: width, availHeight: height })
    w.dispatchEvent(new UIEvent('resize'))
    for (const o of this.observers) this._notifyResize(o, o.els)
  }

  /** Fires DOMContentLoaded and load (call after the page's scripts ran). */
  load() {
    const d = this.document
    d.readyState = 'interactive'
    d.dispatchEvent(new Event('readystatechange'))
    d.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true }))
    d.readyState = 'complete'
    d.dispatchEvent(new Event('readystatechange'))
    this.window.dispatchEvent(new Event('load'))
  }

  /** Delivers pointer input (canvas pixel coordinates) as pointer + mouse (+ click / wheel / contextmenu) events. */
  pointer(input: PointerInput, target: Canvas | null = this.primaryCanvas()) {
    if (this.disposed) return
    const el: Element = target ?? this.document.body
    const rect = el.getBoundingClientRect()
    const cw = (target?.width || rect.width) || 1
    const ch = (target?.height || rect.height) || 1
    const clientX = rect.left + (input.x * rect.width) / cw
    const clientY = rect.top + (input.y * rect.height) / ch
    const btn = input.button ?? (input.action === 'move' ? 'none' : 'left')
    if (input.action === 'down') this.pressed |= BUTTON_MASK[btn]
    if (input.action === 'up') this.pressed &= ~BUTTON_MASK[btn]
    const prev = this.last ?? { x: clientX, y: clientY }
    this.last = { x: clientX, y: clientY }
    const base = {
      bubbles: true, cancelable: true, composed: true, view: this.window, clientX, clientY, screenX: clientX, screenY: clientY,
      movementX: clientX - prev.x, movementY: clientY - prev.y,
      button: input.action === 'move' ? -1 : BUTTON_INDEX[btn], buttons: this.pressed,
      ctrlKey: !!input.ctrlKey, shiftKey: !!input.shiftKey, altKey: !!input.altKey, metaKey: !!input.metaKey,
      pointerId: 1, pointerType: 'mouse', isPrimary: true,
    }
    switch (input.action) {
      case 'move':
        el.dispatchEvent(new PointerEvent('pointermove', { ...base, button: -1 }))
        el.dispatchEvent(new MouseEvent('mousemove', { ...base, button: 0 }))
        break
      case 'down': {
        if (target && this.document._activeElement !== target) {
          target.ownerDocument ??= this.document
          target.focus()
        }
        const ok = el.dispatchEvent(new PointerEvent('pointerdown', base))
        if (ok) el.dispatchEvent(new MouseEvent('mousedown', { ...base, detail: 1 }))
        break
      }
      case 'up': {
        const ok = el.dispatchEvent(new PointerEvent('pointerup', base))
        if (ok) el.dispatchEvent(new MouseEvent('mouseup', { ...base, detail: 1 }))
        if (btn === 'left') {
          const now = Date.now()
          const dbl = now - this.lastClick.t < 400 && Math.abs(this.lastClick.x - clientX) < 4 && Math.abs(this.lastClick.y - clientY) < 4
          el.dispatchEvent(new MouseEvent('click', { ...base, detail: dbl ? 2 : 1 }))
          if (dbl) el.dispatchEvent(new MouseEvent('dblclick', { ...base, detail: 2 }))
          this.lastClick = dbl ? { t: 0, x: 0, y: 0 } : { t: now, x: clientX, y: clientY }
        } else if (btn === 'right') el.dispatchEvent(new MouseEvent('contextmenu', base))
        else if (btn === 'middle') el.dispatchEvent(new MouseEvent('auxclick', base))
        break
      }
      case 'wheel':
        el.dispatchEvent(new WheelEvent('wheel', { ...base, button: 0, deltaX: input.deltaX ?? 0, deltaY: input.deltaY ?? 0, deltaMode: 0 }))
        break
    }
  }

  /** Delivers a key press/release to the focused element (bubbling to document and window). */
  key(action: 'down' | 'up', init: KeyboardEventInit) {
    if (this.disposed) return
    const el = this.document._activeElement ?? this.document.body
    const ev = new KeyboardEvent(action === 'down' ? 'keydown' : 'keyup', { bubbles: true, cancelable: true, composed: true, view: this.window, ...init })
    const ok = el.dispatchEvent(ev)
    if (action === 'down' && ok && init.key && init.key.length === 1 && !init.ctrlKey && !init.metaKey) {
      el.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true, cancelable: true, view: this.window, ...init }))
    }
    return ev
  }

  /** Stops all timers and animation frames. */
  dispose() {
    this.disposed = true
    for (const t of this.timers) hostClearTimeout(t)
    for (const t of this.intervals) hostClearInterval(t)
    this.timers.clear()
    this.intervals.clear()
    this.rafs.clear()
    this.window.dispatchEvent(new Event('beforeunload'))
    this.window.dispatchEvent(new Event('pagehide'))
  }
}

function bitmapOf(src: any) {
  const d = src?._data && src._data.data ? src._data : src?._data instanceof Uint8ClampedArray ? { width: src.width, height: src.height, data: src._data } : src
  if (!d || !d.data) throw new TypeError('createImageBitmap: unsupported source')
  return { width: d.width, height: d.height, data: new Uint8ClampedArray(d.data), close() {} }
}

function safeCall(fn: (...a: any[]) => unknown, args: unknown[], c: Console) {
  try {
    fn(...args)
  } catch (err) {
    c.error(err)
  }
}

/** Creates a browser-like environment. See {@link BrowserEnvironment}. */
export function createEnvironment(opts: EnvironmentOptions = {}) {
  return new BrowserEnvironment(opts)
}

/** Maps a key name (`KeyboardEvent.key`) to its `KeyboardEvent.code`. */
export function keyToCode(key: string): string {
  if (key.length === 1) {
    const u = key.toUpperCase()
    if (u >= 'A' && u <= 'Z') return 'Key' + u
    if (key >= '0' && key <= '9') return 'Digit' + key
    const punct: Record<string, string> = {
      ' ': 'Space', '-': 'Minus', _: 'Minus', '=': 'Equal', '+': 'Equal', '[': 'BracketLeft', '{': 'BracketLeft', ']': 'BracketRight', '}': 'BracketRight',
      '\\': 'Backslash', '|': 'Backslash', ';': 'Semicolon', ':': 'Semicolon', "'": 'Quote', '"': 'Quote', ',': 'Comma', '<': 'Comma',
      '.': 'Period', '>': 'Period', '/': 'Slash', '?': 'Slash', '`': 'Backquote', '~': 'Backquote',
      '!': 'Digit1', '@': 'Digit2', '#': 'Digit3', $: 'Digit4', '%': 'Digit5', '^': 'Digit6', '&': 'Digit7', '*': 'Digit8', '(': 'Digit9', ')': 'Digit0',
    }
    return punct[key] ?? ''
  }
  if (key === 'Shift' || key === 'Control' || key === 'Alt' || key === 'Meta') return key + 'Left'
  return key
}
