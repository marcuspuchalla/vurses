/**
 * Browser globals for web apps running in Node: `window` (= globalThis),
 * `document`, `location`, `history`, `localStorage` / `sessionStorage`,
 * `matchMedia`, `requestAnimationFrame`, `getComputedStyle`, ...
 *
 * They are deliberately small: enough for app code and common libraries
 * (vue-router, pinia, marked, ...) to run, backed by the terminal page where
 * that makes sense (`document.body`, `document.querySelector`,
 * `document.title`, keyboard listeners).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { TComment, TElement, TTextNode } from '../dom/nodes.js'
import { matchMedia as evalMedia } from './css.js'
import type { WebScope } from './scope.js'

type Listener = (e: unknown) => unknown

class Storage {
  private data: Map<string, string>
  constructor(
    private file?: string,
    initial?: Record<string, string>,
  ) {
    this.data = new Map(Object.entries(initial ?? {}))
  }
  get length() {
    return this.data.size
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null
  }
  getItem(k: string) {
    return this.data.has(String(k)) ? this.data.get(String(k))! : null
  }
  setItem(k: string, v: unknown) {
    this.data.set(String(k), String(v))
    this.save()
  }
  removeItem(k: string) {
    this.data.delete(String(k))
    this.save()
  }
  clear() {
    this.data.clear()
    this.save()
  }
  private save() {
    if (!this.file) return
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      writeFileSync(this.file, JSON.stringify(Object.fromEntries(this.data), null, 2))
    } catch {
      /* best effort */
    }
  }
}

function loadStorage(file?: string): Storage {
  let initial: Record<string, string> | undefined
  if (file && existsSync(file)) {
    try {
      initial = JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      /* ignore corrupt file */
    }
  }
  return new Storage(file, initial)
}

export interface GlobalsOptions {
  /** File that persists localStorage between runs. */
  storageFile?: string
  /** Page URL (location.href); the path part follows the router. */
  url?: string
  scope: () => WebScope | null
  size: () => { columns: number; rows: number }
  dark: boolean
  /** document.title setter. */
  onTitle?(title: string): void
}

export interface WebGlobals {
  /** Delivers a key event to document/window listeners. */
  dispatchKey(type: 'keydown' | 'keyup', ev: Record<string, unknown>): boolean
  dispatchWindow(type: string, ev?: Record<string, unknown>): void
}

function define(name: string, value: unknown) {
  try {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true, enumerable: true })
  } catch {
    /* non-configurable built-in: keep it */
  }
}

function emitter() {
  const map = new Map<string, Set<Listener>>()
  return {
    add(type: string, fn: Listener | { handleEvent: Listener }) {
      if (!fn) return
      let s = map.get(type)
      if (!s) map.set(type, (s = new Set()))
      s.add(typeof fn === 'function' ? fn : (e) => fn.handleEvent(e))
    },
    remove(type: string, fn: Listener) {
      map.get(type)?.delete(fn)
    },
    emit(type: string, ev: unknown) {
      for (const fn of map.get(type) ?? []) {
        try {
          fn(ev)
        } catch (e) {
          console.error(e)
        }
      }
    },
  }
}

export function installGlobals(o: GlobalsOptions): WebGlobals {
  const g = globalThis as Record<string, unknown>
  const win = emitter()
  const doc = emitter()
  const url = new URL(o.url ?? 'http://localhost/')
  let title = ''

  const location = {
    get href() {
      return url.href
    },
    set href(v: string) {
      url.href = new URL(v, url).href
    },
    get origin() {
      return url.origin
    },
    get protocol() {
      return url.protocol
    },
    get host() {
      return url.host
    },
    get hostname() {
      return url.hostname
    },
    get port() {
      return url.port
    },
    get pathname() {
      return url.pathname
    },
    get search() {
      return url.search
    },
    get hash() {
      return url.hash
    },
    assign(v: string) {
      url.href = new URL(v, url).href
    },
    replace(v: string) {
      url.href = new URL(v, url).href
    },
    reload() {},
    toString() {
      return url.href
    },
  }

  const history = {
    length: 1,
    state: null as unknown,
    scrollRestoration: 'auto',
    pushState(state: unknown, _t: string, u?: string) {
      history.state = state
      if (u) location.assign(u)
    },
    replaceState(state: unknown, _t: string, u?: string) {
      history.state = state
      if (u) location.replace(u)
    },
    back() {},
    forward() {},
    go() {},
  }

  const page = () => o.scope()
  const findTag = (tag: string) => {
    const s = page()
    if (!s) return null
    for (const el of s.root.walk()) if (el.tag === tag) return el
    return null
  }

  const document = {
    nodeType: 9,
    readyState: 'complete',
    visibilityState: 'visible',
    hidden: false,
    cookie: '',
    referrer: '',
    characterSet: 'UTF-8',
    get title() {
      return title
    },
    set title(v: string) {
      title = String(v)
      o.onTitle?.(title)
    },
    get documentElement() {
      return findTag('html') ?? new TElement('html')
    },
    get body() {
      return findTag('body') ?? new TElement('body')
    },
    get head() {
      return findTag('head') ?? new TElement('head')
    },
    get activeElement() {
      return page()?.focusedElement() ?? findTag('body')
    },
    get defaultView() {
      return globalThis
    },
    get location() {
      return location
    },
    querySelector(sel: string) {
      return page()?.querySelector(sel) ?? null
    },
    querySelectorAll(sel: string) {
      return page()?.querySelectorAll(sel) ?? []
    },
    getElementById(id: string) {
      const s = page()
      if (!s) return null
      for (const el of s.root.walk()) if (el.props.id === id) return el
      return null
    },
    getElementsByTagName(tag: string) {
      const s = page()
      return s ? [...s.root.walk()].filter((el) => el.tag === tag.toLowerCase()) : []
    },
    getElementsByClassName(c: string) {
      const s = page()
      return s ? [...s.root.walk()].filter((el) => String(el.props.class ?? '').split(/\s+/).includes(c)) : []
    },
    createElement(tag: string) {
      return new TElement(String(tag).toLowerCase())
    },
    createElementNS(_ns: string, tag: string) {
      return new TElement(String(tag).toLowerCase())
    },
    createTextNode(text: string) {
      return new TTextNode(String(text))
    },
    createComment(text: string) {
      return new TComment(String(text))
    },
    createDocumentFragment() {
      return new TElement('template')
    },
    addEventListener: (t: string, fn: Listener) => doc.add(t, fn),
    removeEventListener: (t: string, fn: Listener) => doc.remove(t, fn),
    dispatchEvent: (ev: { type: string }) => (doc.emit(ev.type, ev), true),
    hasFocus: () => true,
    execCommand: () => false,
  }

  define('window', globalThis)
  define('self', globalThis)
  define('document', document)
  define('location', location)
  define('history', history)
  define('localStorage', loadStorage(o.storageFile))
  define('sessionStorage', new Storage())
  define('addEventListener', (t: string, fn: Listener) => win.add(t, fn))
  define('removeEventListener', (t: string, fn: Listener) => win.remove(t, fn))
  define('dispatchEvent', (ev: { type: string }) => (win.emit(ev.type, ev), true))
  define('requestAnimationFrame', (cb: (t: number) => void) => setTimeout(() => cb(performance.now()), 16) as unknown as number)
  define('cancelAnimationFrame', (id: number) => clearTimeout(id as unknown as NodeJS.Timeout))
  define('requestIdleCallback', (cb: (d: unknown) => void) => setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 10 }), 1))
  define('cancelIdleCallback', (id: number) => clearTimeout(id as unknown as NodeJS.Timeout))
  define('matchMedia', (q: string) => {
    const { columns, rows } = o.size()
    return {
      media: q,
      matches: evalMedia(q, { width: columns * 8, height: rows * 16, dark: o.dark }),
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    }
  })
  define('getComputedStyle', (el: TElement) => {
    const s = el?.computedStyle ?? {}
    const map: Record<string, string> = { display: s.display === 'none' ? 'none' : 'block', visibility: 'visible', opacity: s.dim ? '0.5' : '1' }
    return new Proxy(
      { getPropertyValue: (p: string) => map[p] ?? '' },
      { get: (t, k: string) => (k in t ? (t as Record<string, unknown>)[k] : (map[k] ?? '')) },
    )
  })
  define('scrollTo', () => {})
  define('scrollBy', () => {})
  define('scroll', () => {})
  define('alert', (msg: unknown) => console.warn(`[alert] ${String(msg)}`))
  define('confirm', (msg: unknown) => {
    console.warn(`[confirm] ${String(msg)} → yes`)
    return true
  })
  define('prompt', () => null)
  define('open', (u: string) => {
    console.info(`[window.open] ${u}`)
    return null
  })
  for (const [name, get] of [
    ['innerWidth', () => o.size().columns * 8],
    ['innerHeight', () => o.size().rows * 16],
    ['outerWidth', () => o.size().columns * 8],
    ['outerHeight', () => o.size().rows * 16],
  ] as const) {
    try {
      Object.defineProperty(globalThis, name, { get, configurable: true })
    } catch {
      /* ignore */
    }
  }
  define('devicePixelRatio', 1)
  define('scrollX', 0)
  define('scrollY', 0)
  define('pageXOffset', 0)
  define('pageYOffset', 0)
  // element classes for `instanceof` checks
  for (const name of ['Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLButtonElement', 'HTMLAnchorElement', 'HTMLFormElement', 'HTMLImageElement', 'HTMLDivElement', 'SVGElement']) {
    if (!(name in g)) define(name, TElement)
  }
  if (!('Text' in g)) define('Text', TTextNode)
  if (!('Comment' in g)) define('Comment', TComment)
  if (!('MutationObserver' in g)) define('MutationObserver', class { observe() {} disconnect() {} takeRecords() { return [] } })
  if (!('ResizeObserver' in g)) define('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  if (!('IntersectionObserver' in g))
    define(
      'IntersectionObserver',
      class {
        constructor(private cb: (entries: unknown[]) => void) {}
        observe(el: unknown) {
          // everything is "visible": infinite lists load their first page
          setTimeout(() => this.cb([{ isIntersecting: true, intersectionRatio: 1, target: el }]), 0)
        }
        unobserve() {}
        disconnect() {}
      },
    )

  return {
    dispatchKey(type, ev) {
      const e = { type, defaultPrevented: false, preventDefault() { e.defaultPrevented = true }, stopPropagation() {}, ...ev }
      doc.emit(type, e)
      win.emit(type, e)
      return !e.defaultPrevented
    },
    dispatchWindow(type, ev = {}) {
      win.emit(type, { type, ...ev })
    },
  }
}
