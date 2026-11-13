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
import type { ProxyRule } from './build.js'
import { EVENT_CLASSES } from './event-classes.js'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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
      // web apps keep auth tokens in localStorage: only the user may read the file
      mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 })
      writeFileSync(this.file, JSON.stringify(Object.fromEntries(this.data), null, 2), { mode: 0o600 })
      chmodSync(this.file, 0o600) // also for files created by older versions
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
  /** Where relative fetch('/api/…') goes: the app's Vite proxy rules, then `origin`. */
  proxy?: Record<string, ProxyRule>
  origin?: string
}

/**
 * Resolves a fetch URL the way the app's dev server would: absolute URLs stay, relative
 * ones go through the Vite `server.proxy` rules, then to `origin`. Returns null when a
 * relative URL has nowhere to go.
 */
export function resolveFetchUrl(url: string, proxy: Record<string, ProxyRule> | undefined, origin: string | undefined): string | null {
  if (/^[a-z][a-z\d+.-]*:/i.test(url) || url.startsWith('//')) return url
  const path = url.startsWith('/') ? url : '/' + url
  for (const [key, rule] of Object.entries(proxy ?? {})) {
    const hit = key.startsWith('^') ? new RegExp(key).test(path) : path.startsWith(key)
    if (!hit) continue
    const target = typeof rule === 'string' ? rule : rule.target
    if (!target) continue
    const rewritten = typeof rule === 'object' && rule.rewrite ? rule.rewrite(path) : path
    return target.replace(/\/$/, '') + rewritten
  }
  return origin ? origin.replace(/\/$/, '') + path : null
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
  /** original listener (function or handleEvent object) → the function we call */
  const wrapped = new Map<string, Map<unknown, Listener>>()
  return {
    add(type: string, fn: Listener | { handleEvent: Listener }, opts?: boolean | { once?: boolean }) {
      if (!fn) return
      let s = map.get(type)
      if (!s) map.set(type, (s = new Set()))
      let w = wrapped.get(type)
      if (!w) wrapped.set(type, (w = new Map()))
      if (w.has(fn)) return // the same listener is added once
      const call: Listener = typeof fn === 'function' ? fn : (e) => fn.handleEvent(e)
      const once = typeof opts === 'object' && !!opts?.once
      const listener: Listener = once
        ? (e) => {
            s!.delete(listener)
            w!.delete(fn)
            return call(e)
          }
        : call
      w.set(fn, listener)
      s.add(listener)
    },
    remove(type: string, fn: unknown) {
      const listener = wrapped.get(type)?.get(fn)
      if (!listener) return
      wrapped.get(type)!.delete(fn)
      map.get(type)?.delete(listener)
    },
    emit(type: string, ev: unknown) {
      for (const fn of [...(map.get(type) ?? [])]) {
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

  /** location.href = …: same-origin URLs go through the app's router, others can't open here. */
  const navigate = (v: string, replace: boolean) => {
    const next = new URL(String(v), url)
    const router = (g.__VURSES_WEB__ as { router?: { push(p: string): unknown; replace(p: string): unknown } } | undefined)?.router
    if (next.origin === url.origin && router) {
      const path = next.pathname + next.search + next.hash
      void (replace ? router.replace(path) : router.push(path))
      return
    }
    if (next.origin !== url.origin) console.info(`[location] ${next.href} (external pages can't open in the terminal)`)
    url.href = next.href
  }
  const location = {
    get href() {
      return url.href
    },
    set href(v: string) {
      navigate(v, false)
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
      navigate(v, false)
    },
    replace(v: string) {
      navigate(v, true)
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

  const cookies = new Map<string, string>()
  const document = {
    nodeType: 9,
    readyState: 'complete',
    visibilityState: 'visible',
    hidden: false,
    get cookie() {
      return [...cookies].map(([k, v]) => `${k}=${v}`).join('; ')
    },
    set cookie(v: string) {
      // a cookie jar like the browser's: one cookie per assignment, attributes decide its life
      const [pair, ...attrs] = String(v).split(';')
      const eq = pair.indexOf('=')
      const name = (eq < 0 ? '' : pair.slice(0, eq)).trim()
      const value = (eq < 0 ? pair : pair.slice(eq + 1)).trim()
      const expired = attrs.some((a) => {
        const [k, val = ''] = a.split('=').map((x) => x.trim().toLowerCase())
        return (k === 'max-age' && Number(val) <= 0) || (k === 'expires' && Date.parse(val) <= Date.now())
      })
      if (expired) cookies.delete(name)
      else cookies.set(name, value)
    },
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
      if (!s || id === undefined || id === null || id === '') return null
      id = String(id)
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
    addEventListener: (t: string, fn: Listener, opts?: boolean | { once?: boolean }) => doc.add(t, fn, opts),
    removeEventListener: (t: string, fn: Listener) => doc.remove(t, fn),
    dispatchEvent: (ev: { type: string }) => (doc.emit(ev.type, ev), true),
    hasFocus: () => true,
    execCommand: () => false,
  }

  // fetch: relative URLs resolve like in the browser (through the app's dev proxy / --origin)
  const nodeFetch = g.fetch as typeof fetch | undefined
  if (nodeFetch && !(nodeFetch as { __vurses?: boolean }).__vurses) {
    const wrapped = (input: unknown, init?: RequestInit) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as { url?: string })?.url
      if (typeof raw === 'string' && !/^[a-z][a-z\d+.-]*:/i.test(raw)) {
        const abs = resolveFetchUrl(raw, o.proxy, o.origin)
        if (!abs)
          return Promise.reject(
            new TypeError(`vurses web: fetch('${raw}') has no server here (the page isn't served by a browser). Add a Vite server.proxy rule for it, or pass --origin https://your-site.example`),
          )
        return nodeFetch(typeof input === 'string' || input instanceof URL ? abs : new Request(abs, input as Request), init)
      }
      return nodeFetch(input as RequestInfo, init)
    }
    ;(wrapped as { __vurses?: boolean }).__vurses = true
    define('fetch', wrapped)
  }
  define('window', globalThis)
  define('self', globalThis)
  define('document', document)
  define('location', location)
  define('history', history)
  define('localStorage', loadStorage(o.storageFile))
  define('sessionStorage', new Storage())
  define('addEventListener', (t: string, fn: Listener, opts?: boolean | { once?: boolean }) => win.add(t, fn, opts))
  define('removeEventListener', (t: string, fn: Listener) => win.remove(t, fn))
  define('dispatchEvent', (ev: { type: string }) => (win.emit(ev.type, ev), true))
  // a throwing callback must not kill the process (there is no browser to swallow it)
  const guarded = (what: string, cb: (...a: never[]) => void) => (...a: never[]) => {
    try {
      cb(...a)
    } catch (e) {
      console.error(`[vurses web] error in ${what}:`, e)
    }
  }
  define('requestAnimationFrame', (cb: (t: number) => void) => setTimeout(guarded('requestAnimationFrame', () => cb(performance.now())), 16) as unknown as number)
  define('cancelAnimationFrame', (id: number) => clearTimeout(id as unknown as NodeJS.Timeout))
  define('requestIdleCallback', (cb: (d: unknown) => void) => setTimeout(guarded('requestIdleCallback', () => cb({ didTimeout: false, timeRemaining: () => 10 })), 1))
  define('cancelIdleCallback', (id: number) => clearTimeout(id as unknown as NodeJS.Timeout))
  define('matchMedia', (q: string) => {
    const { columns, rows } = o.size()
    return {
      media: q,
      matches: evalMedia(q, { width: columns * 8, height: rows * 16, dark: page()?.prefersDark ?? o.dark }),
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
    const vars = (s as { vars?: Map<string, string> }).vars
    return new Proxy(
      { getPropertyValue: (p: string) => (p.startsWith('--') ? (vars?.get(p) ?? '') : (map[p] ?? '')) },
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
  // Storage and the DOM event classes (VueUse checks `storage instanceof Storage`)
  if (!('Storage' in g)) define('Storage', Storage)
  for (const [name, cls] of Object.entries(EVENT_CLASSES)) if (!(name in g)) define(name, cls)
  // navigator: online, a clipboard (kept in memory), language
  const nav = (g.navigator ?? {}) as Record<string, unknown>
  if (!('navigator' in g)) define('navigator', nav)
  let clip = ''
  for (const [k, v] of Object.entries({
    onLine: true,
    cookieEnabled: true,
    language: nav.language ?? 'en-US',
    languages: nav.languages ?? ['en-US'],
    clipboard: { writeText: async (t: string) => void (clip = String(t)), readText: async () => clip },
  }))
    if (!(k in nav) || nav[k] === undefined)
      try {
        Object.defineProperty(nav, k, { value: v, configurable: true })
      } catch {
        /* read-only navigator */
      }
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
