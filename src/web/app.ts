/**
 * `createApp` for existing web apps (`vuecli web`).
 *
 * The page shell from `index.html` (html > head + body, static markup) is
 * built as terminal elements inside a scrollable viewport; the Vue app is
 * teleported into its mount element (`#app`, `.todoapp`, ...), exactly where
 * the browser would mount it. Styles come from the app's CSS.
 */
import { defineComponent, h, onMounted, ref, shallowRef, Teleport, type Component } from 'vue'
import { createApp as createTerminalApp, type MountOptions, type TuiApp } from '../app/app.js'
import { TElement, type TNode } from '../dom/nodes.js'
import { matchKey, type KeyEvent } from '../input/keys.js'
import { StyleSheet } from './css.js'
import { domKey } from './events.js'
import type { WebGlobals } from './globals.js'
import { parseHTML } from './html.js'
import { WebScope } from './scope.js'

export interface WebConfig {
  /** Contents of the app's index.html. */
  html: string
  /** All CSS of the app (bundled + linked + inline). */
  css: string
  mount: MountOptions
  dark: boolean
  /** Initial route (vue-router apps). */
  route?: string
  storageFile?: string
  /** Called once the app has mounted (the CLI waits on it). */
  onMount?(app: TuiApp): void
}

const KEY = '__VUECLI_WEB__'

/** The running page (one per process): read by the browser globals. */
export const current: { scope: WebScope | null; runtime: TuiApp['runtime']; globals: WebGlobals | null } = {
  scope: null,
  runtime: null,
  globals: null,
}

export function setWebConfig(cfg: WebConfig) {
  ;(globalThis as Record<string, unknown>)[KEY] = cfg
}

export function webConfig(): WebConfig {
  return ((globalThis as Record<string, unknown>)[KEY] as WebConfig | undefined) ?? { html: '', css: '', mount: {}, dark: true }
}

/** html > (head, body) from index.html; scripts are dropped. */
function buildShell(source: string): { html: TElement; body: TElement } {
  const nodes = parseHTML(source)
  let html = nodes.find((n): n is TElement => n.nodeType === 'element' && n.tag === 'html') ?? null
  if (!html) {
    html = new TElement('html')
    const body = new TElement('body')
    for (const n of nodes) body.insertBefore(n, null)
    html.insertBefore(body, null)
  }
  let body = html.children.find((n): n is TElement => n.nodeType === 'element' && n.tag === 'body') ?? null
  if (!body) {
    body = new TElement('body')
    for (const n of [...html.children]) if (!(n.nodeType === 'element' && n.tag === 'head')) body.insertBefore(n, null)
    html.insertBefore(body, null)
  }
  const strip = (el: TElement) => {
    for (const c of [...el.children]) {
      if (c.nodeType === 'element' && (c.tag === 'script' || c.tag === 'noscript')) el.removeChild(c)
      else if (c.nodeType === 'element') strip(c)
    }
  }
  strip(body)
  return { html, body }
}

export function createWebApp(rootComponent: Component, rootProps?: Record<string, unknown> | null): TuiApp {
  const cfg = webConfig()
  const shell = buildShell(cfg.html || '<body><div id="app"></div></body>')
  const scroll = ref(0)
  let selector = '#app'
  let scope: WebScope | null = null
  let container: TElement | null = null
  let app: TuiApp

  const Page = defineComponent({
    name: 'VueCliWebPage',
    setup() {
      const page = shallowRef<TElement | null>(null)
      const ready = ref(false)
      onMounted(() => {
        const el = page.value
        const runtime = app.runtime
        if (!el || !runtime) return
        const sheet = new StyleSheet(cfg.css)
        scope = current.scope = new WebScope(el, {
          sheet,
          focus: runtime.ctx.focus,
          size: () => runtime.ctx.size,
          dark: cfg.dark,
          requestRender: () => runtime.requestRender(),
          navigate: (href) => navigate(href),
          onError: (e) => console.error(e),
        })
        el.insertBefore(shell.html, null)
        container = scope.querySelector(selector)
        if (!container) {
          container = new TElement('div')
          container.props.id = 'app'
          shell.body.insertBefore(container, null)
        }
        for (const c of [...container.children]) container.removeChild(c)
        ready.value = true
      })
      return () => [
        h('tui-box', { width: '100%', height: '100%', flexDirection: 'column', overflow: 'hidden', scrollTop: scroll.value }, [
          h('tui-box', { ref: page, flexDirection: 'column', flexShrink: 0, width: '100%', minHeight: '100%' }),
        ]),
        ready.value && container ? h(Teleport, { to: container }, [h(rootComponent as never, rootProps ?? null)]) : null,
      ]
    },
  })

  app = createTerminalApp(Page, null, { components: false })

  const navigate = (href: string) => {
    const router = app.config.globalProperties.$router as { push(to: string): Promise<unknown> } | undefined
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('http://localhost')) {
      console.info(`[link] ${href}`)
      return
    }
    const path = href.startsWith('#') ? href.slice(1) || '/' : href
    if (router) router.push(path).catch((e) => console.error(e))
  }

  // errors are logged (F12 shows them) instead of tearing the page down
  app.config.errorHandler = (err, _instance, info) => console.error(`[vue] ${info}:`, err)
  app.config.warnHandler = () => {}

  const baseMount = app.mount
  app.mount = ((target?: unknown) => {
    if (typeof target === 'string') selector = target
    // like a browser: nothing is focused until Tab (or an autofocus attribute)
    const opts: MountOptions = { autoFocus: false, ...cfg.mount }
    baseMount(opts)
    const runtime = app.runtime!
    current.runtime = runtime
    const globals = current.globals
    const rows = () => runtime.ctx.size.rows
    const pageEl = () => scope?.root ?? null
    const maxScroll = () => Math.max(0, (pageEl()?.layout.height ?? 0) - rows())
    const scrollTo = (v: number) => {
      const next = Math.max(0, Math.min(maxScroll(), Math.round(v)))
      if (next !== scroll.value) scroll.value = next
    }
    const scrollBy = (n: number) => scrollTo(scroll.value + n)
    runtime.mouseHook = (e, target) => scope?.handleMouse(e, target, scrollBy) ?? false

    // page keys: scrolling + document/window keyboard listeners
    runtime.ctx.inputHandlers.add({
      priority: -100,
      order: 0,
      active: () => true,
      handler(e: KeyEvent) {
        const init = domKey(e) as Record<string, unknown>
        const ok = globals ? globals.dispatchKey('keydown', init) : true
        globals?.dispatchKey('keyup', init)
        if (!ok) return
        const page = rows()
        if (matchKey(e, 'pagedown') || (matchKey(e, 'space') && !scope?.focusedElement())) scrollBy(page - 2)
        else if (matchKey(e, 'pageup')) scrollBy(-(page - 2))
        else if (matchKey(e, 'down')) scrollBy(1)
        else if (matchKey(e, 'up')) scrollBy(-1)
        else if (matchKey(e, 'home') && !scope?.focusedElement()) scrollTo(0)
        else if (matchKey(e, 'end') && !scope?.focusedElement()) scrollTo(maxScroll())
      },
    })

    // keep the focused element on screen (only when focus moves)
    let lastFocus: TElement | null = null
    runtime.events.on('frame', () => {
      if (scroll.value > maxScroll()) scrollTo(maxScroll())
      const f = scope?.focusedElement() ?? null
      if (f === lastFocus) return
      lastFocus = f
      if (!f) return
      const { y, height } = f.layout
      if (y < 0) scrollBy(y - 1)
      else if (y + height > rows()) scrollBy(Math.min(y, y + height - rows() + 1))
    })
    runtime.events.on('resize', () => globals?.dispatchWindow('resize'))
    cfg.onMount?.(app)
    return app
  }) as TuiApp['mount']
  return app
}

export type { TNode }
