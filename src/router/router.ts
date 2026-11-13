/**
 * The terminal App Router runtime (browser-safe: no Node imports).
 *
 * Built on vue-router for history (memory by default, web/hash history in a
 * browser) and navigation guards. URL matching uses `matchRoute` from
 * ./match.ts so the server resolves URLs identically.
 */
import { safeTitle } from '../render/sanitize.js'
import {
  Fragment,
  Suspense,
  defineComponent,
  getCurrentInstance,
  h,
  inject,
  onErrorCaptured,
  onUnmounted,
  provide,
  ref,
  shallowReactive,
  shallowRef,
  watch,
  type App,
  type Component,
  type PropType,
  type Ref,
  type VNode,
  type VNodeChild,
} from 'vue'
import { createMemoryHistory, createRouter, type RouteLocationNormalized, type Router, type RouterHistory } from 'vue-router'
import { APP_CONTEXT } from '../app/context.js'
import { matchKey } from '../input/keys.js'
import { Button } from '../components/inputs.js'
import { useInput } from '../composables.js'
import { OUTLET_KEY, ROUTER_KEY } from './context.js'
import { getRedirectInfo, isNotFoundError, isRedirectError } from './errors.js'
import { matchRoute, type RouteParams } from './match.js'
import { TERMINAL_ORIGIN, createRouteRequest, matchMiddleware, runMiddleware, type MiddlewareModule } from './middleware.js'
import type { Metadata, ModuleLoader, RouteEntry, RouteManifest, RouteSegment } from './types.js'

// ------------------------------------------------------------------- types

/** Resolved metadata (titles are plain strings after template resolution). */
export interface ResolvedMetadata {
  title?: string
  description?: string
  [key: string]: unknown
}

/** The current location as seen by the App Router. */
export interface AppRoute {
  /** Path + search + hash as requested, e.g. `/users/42?tab=1`. */
  href: string
  /** Requested pathname (what `usePathname()` returns, even after a middleware rewrite). */
  pathname: string
  /** `?a=1` or '' */
  search: string
  /** `#x` or '' */
  hash: string
  /** Pathname that was rendered (differs from `pathname` after a middleware rewrite). */
  renderedPathname: string
  /** Dynamic params of the matched route. */
  params: RouteParams
  searchParams: URLSearchParams
  /** `searchParams` as a plain object (repeated keys become arrays); passed to pages as `searchParams`. */
  query: Record<string, string | string[]>
  /** Matched manifest entry, or null when no page matches (not-found). */
  route: RouteEntry | null
  /** True when no route matched. */
  notFound: boolean
  meta: {
    runtime?: 'server' | 'client'
    revalidate?: number | false
    metadata: ResolvedMetadata
  }
}

export type Href = string | { pathname?: string; query?: Record<string, string | number | (string | number)[] | undefined>; hash?: string }

export interface NavigateOptions {
  /** Ignored in the terminal (kept for Next.js API compatibility). */
  scroll?: boolean
}

export interface AppRouterOptions {
  manifest: RouteManifest
  /** Loads route modules by absolute file path (Node: dynamic import; browser: bundled map). */
  load: ModuleLoader
  /** Deep link to open first. Default: the history's current location, or '/'. */
  initialPath?: string
  /** vue-router history. Default `createMemoryHistory()` (terminal/server); use `createWebHistory()` in a browser. */
  history?: RouterHistory
  /** alt+left / alt+right for back / forward. Default true. */
  keyboard?: boolean
  /** Write the resolved `metadata.title` as the terminal window title (OSC 0). Default false. */
  terminalTitle?: boolean | ((title: string) => string)
  /** Origin for middleware `Request`s. Default `http://localhost`. */
  origin?: string
  /** Extra headers for middleware requests (e.g. a `cookie` header for auth demos). */
  requestHeaders?: Record<string, string>
}

/** Public router API (`useRouter()`, `getAppRouter(app)`, `app.config.globalProperties.$router`). */
export interface AppRouter {
  /** Root component: renders layouts, pages, loading, error and not-found UI. */
  readonly component: Component
  /** The underlying vue-router instance (guards, raw history). */
  readonly vueRouter: Router
  readonly manifest: RouteManifest
  /** Reactive current route (also returned by `useRoute()`). */
  readonly route: Readonly<AppRoute>
  /** Ref of the committed route (null before the first navigation). */
  readonly current: Readonly<Ref<AppRoute | null>>
  readonly canGoBack: Readonly<Ref<boolean>>
  readonly canGoForward: Readonly<Ref<boolean>>
  /** HTTP-style status of what is on screen: 200, 404 (not found) or 500 (error boundary). */
  readonly status: Readonly<Ref<number>>
  /** Last redirect performed by middleware or `redirect()`. */
  readonly lastRedirect: Readonly<Ref<{ from: string; to: string; status: number } | null>>
  /** Navigate to `href`, adding a history entry. Resolves when the navigation is committed. */
  push(href: Href, options?: NavigateOptions): Promise<void>
  /** Navigate to `href`, replacing the current history entry. */
  replace(href: Href, options?: NavigateOptions): Promise<void>
  back(): void
  forward(): void
  go(delta: number): void
  /** Re-mounts the current page (re-runs its setup / data loading) and re-resolves metadata. */
  refresh(): Promise<void>
  /** Loads the modules of `href` ahead of time so navigating there is instant. */
  prefetch(href: Href): Promise<void>
  /** Resolves an href to its route entry and params without navigating. */
  resolve(href: Href): { pathname: string; route: RouteEntry | null; params: RouteParams }
  /** Resolves after the first navigation is committed. */
  isReady(): Promise<void>
  /** Resolves when no navigation is pending and every Suspense boundary has resolved. */
  waitForIdle(timeoutMs?: number): Promise<void>
  /** Registers a callback for committed navigations. Returns an unsubscribe function. */
  onNavigate(cb: (to: AppRoute, from: AppRoute | null) => void): () => void
  /** Vue plugin install (optional: the root component provides the router itself). */
  install(app: App): void
}

// ------------------------------------------------------------ module cache

type Mod = Record<string, unknown>

class ModuleCache {
  private entries = new Map<string, { promise: Promise<Mod>; mod?: Mod; error?: unknown }>()
  constructor(private loader: ModuleLoader) {}
  load(file: string): Promise<Mod> {
    let e = this.entries.get(file)
    if (!e || e.error !== undefined) {
      const entry: { promise: Promise<Mod>; mod?: Mod; error?: unknown } = { promise: null as never }
      entry.promise = Promise.resolve()
        .then(() => this.loader(file))
        .then(
          (m) => (entry.mod = m),
          (err) => {
            entry.error = err ?? new Error(`failed to load ${file}`)
            throw err
          },
        )
      entry.promise.catch(() => {})
      this.entries.set(file, (e = entry))
    }
    return e.promise
  }
  get(file: string): Mod | undefined {
    return this.entries.get(file)?.mod
  }
  /** Forget failed loads (so they are retried). */
  clearErrors() {
    for (const [k, e] of this.entries) if (e.error !== undefined) this.entries.delete(k)
  }
}

const CACHE_KEY = Symbol('vurses-router-cache') as import('vue').InjectionKey<ModuleCache>

function defaultExport(mod: Mod, file: string): Component {
  const c = (mod.default ?? mod.Page ?? mod.Layout) as Component | undefined
  if (!c) throw new Error(`[vurses router] ${file} has no default export (a Vue component)`)
  return c
}

const camel = (s: string) => s.replace(/-(\w)/g, (_, c: string) => c.toUpperCase())

/** Only pass route props the component declares (so they don't fall through onto its root element). */
function pickProps(comp: Component, all: Record<string, unknown>): Record<string, unknown> {
  if (typeof comp === 'function') return all
  const opt = (comp as { props?: unknown }).props
  if (!opt) return {}
  const names = new Set((Array.isArray(opt) ? (opt as string[]) : Object.keys(opt as object)).map(camel))
  const out: Record<string, unknown> = {}
  for (const k in all) if (names.has(k)) out[k] = all[k]
  return out
}

// --------------------------------------------------------- view components

/** Renders one route module (page / layout / loading / error / not-found). Async setup while the module loads. */
const RouteModule = defineComponent({
  name: 'RouteModule',
  props: {
    file: { type: String, required: true },
    routeProps: { type: Object as PropType<Record<string, unknown>>, default: () => ({}) },
  },
  setup(props, { slots }) {
    const cache = inject(CACHE_KEY)!
    const file = props.file
    const render = () => {
      const C = defaultExport(cache.get(file)!, file)
      return h(C, pickProps(C, props.routeProps), slots)
    }
    if (cache.get(file)) return render
    return cache.load(file).then(() => render)
  },
})

/** Throws the given error during setup (surfaces navigation/middleware errors in a boundary). */
const Thrower = defineComponent({
  name: 'RouteThrower',
  props: { error: { type: null, required: true } },
  setup(props) {
    throw props.error
  },
})

/** Built-in fallback when no `error.vue` handles an error. */
export const DefaultRouteError = defineComponent({
  name: 'DefaultRouteError',
  props: { error: { type: null }, reset: { type: Function as PropType<() => void> } },
  setup(props) {
    return () => {
      const err = props.error as { message?: string; stack?: string } | undefined
      const msg = err?.message ?? String(err)
      const stack = (err?.stack ?? '').split('\n').slice(1, 4).map((l) => l.trim())
      return h('tui-box', { flexDirection: 'column', border: 'round', borderColor: 'error', title: 'Application error', paddingX: 1, flexShrink: 0 }, [
        h('tui-text', { color: 'error', bold: true }, msg),
        ...stack.map((l) => h('tui-text', { color: 'muted', wrap: 'truncate' }, l)),
        props.reset ? h('tui-box', { marginTop: 1 }, [h(Button, { label: 'Try again', variant: 'primary', onClick: props.reset })]) : null,
      ])
    }
  },
})

/** Built-in 404 page used when the app has no `not-found.vue`. */
export const DefaultNotFound = defineComponent({
  name: 'DefaultNotFound',
  setup() {
    const router = inject(ROUTER_KEY, null)
    return () =>
      h('tui-box', { flexDirection: 'column', padding: 1, flexShrink: 0 }, [
        h('tui-text', null, [h('tui-text', { bold: true, color: 'warning' }, '404'), h('tui-text', { color: 'muted' }, ' │ '), 'This page could not be found.']),
        router ? h('tui-text', { color: 'muted' }, router.route.pathname) : null,
      ])
  },
})

const OutletHost = defineComponent({
  name: 'RouteLayout',
  props: {
    file: { type: String, required: true },
    routeProps: { type: Object as PropType<Record<string, unknown>>, required: true },
    inner: { type: Function as PropType<() => VNodeChild>, required: true },
  },
  setup(props) {
    provide(OUTLET_KEY, () => props.inner())
    return () => h(RouteModule, { file: props.file, routeProps: props.routeProps }, { default: () => props.inner() })
  },
})

// ----------------------------------------------------------------- helpers

function toHrefString(href: Href): string {
  if (typeof href === 'string') return href
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(href.query ?? {})) {
    if (v === undefined) continue
    for (const x of Array.isArray(v) ? v : [v]) sp.append(k, String(x))
  }
  const q = sp.toString()
  const hash = href.hash ? (href.hash.startsWith('#') ? href.hash : '#' + href.hash) : ''
  return (href.pathname ?? '/') + (q ? '?' + q : '') + hash
}

function queryObject(sp: URLSearchParams): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  for (const [k, v] of sp) {
    const prev = out[k]
    out[k] = prev === undefined ? v : Array.isArray(prev) ? [...prev, v] : [prev, v]
  }
  return out
}

/** Segments of a route; derived from layouts/loading/error for hand-written manifests. */
function segmentsFor(manifest: RouteManifest, entry: RouteEntry | null): RouteSegment[] {
  const root: RouteSegment = manifest.root ?? { dir: '', params: [], layout: manifest.rootLayout, notFound: manifest.notFound }
  if (!entry) return [root]
  if (entry.segments?.length) return entry.segments
  const layouts = entry.layouts.filter((l) => l !== root.layout)
  const segs: RouteSegment[] = [{ ...root }, ...layouts.map((layout, i) => ({ dir: String(i + 1), layout, params: entry.params }))]
  const last = segs[segs.length - 1]
  if (entry.loading && !last.loading) last.loading = entry.loading
  if (entry.error && !last.error) last.error = entry.error
  return segs
}

function resolveTitle(chain: Metadata[]): ResolvedMetadata {
  const out: ResolvedMetadata = {}
  let template: string | undefined
  for (const m of chain) {
    const { title, ...rest } = m
    Object.assign(out, rest)
    if (typeof title === 'string') out.title = template ? template.replace('%s', title) : title
    else if (title && typeof title === 'object') {
      if (title.absolute) out.title = title.absolute
      else if (title.default) out.title = template ? template.replace('%s', title.default) : title.default
      if (title.template) template = title.template
    }
  }
  return out
}

const APP_META = '__vursesAppRoute'
const apps = new WeakMap<object, AppRouter>()

/** The {@link AppRouter} of a mounted app (MCP, devtools, tests). */
export function getAppRouter(app: App | { config: unknown }): AppRouter | undefined {
  return apps.get(app as object)
}

// ------------------------------------------------------------------ router

/**
 * Creates the App Router.
 *
 * ```ts
 * const router = createAppRouter({ manifest, load: (f) => import(pathToFileURL(f).href) })
 * createApp(router.component).mount()
 * ```
 */
export function createAppRouter(options: AppRouterOptions): AppRouter {
  const { manifest } = options
  const cache = new ModuleCache(options.load)
  const origin = options.origin ?? TERMINAL_ORIGIN

  // history position tracking (for canGoBack / canGoForward)
  const base = options.history ?? createMemoryHistory()
  const canGoBack = ref(false)
  const canGoForward = ref(false)
  let pos = 0
  let len = 1
  const sync = () => {
    canGoBack.value = pos > 0
    canGoForward.value = pos < len - 1
  }
  const history = new Proxy(base, {
    get(t, k) {
      if (k === 'push')
        return (...a: Parameters<RouterHistory['push']>) => {
          pos++
          len = pos + 1
          sync()
          return t.push(...a)
        }
      if (k === 'go')
        return (delta: number, trigger?: boolean) => {
          pos = Math.max(0, Math.min(len - 1, pos + delta))
          sync()
          return t.go(delta, trigger)
        }
      return Reflect.get(t, k)
    },
  })

  const vr = createRouter({ history, routes: [{ path: '/:path(.*)*', name: 'app', component: { render: () => null } }] })

  const current = shallowRef<AppRoute | null>(null)
  const route = shallowReactive<AppRoute>({
    href: '/',
    pathname: '/',
    search: '',
    hash: '',
    renderedPathname: '/',
    params: {},
    searchParams: new URLSearchParams(),
    query: {},
    route: null,
    notFound: false,
    meta: { metadata: {} },
  })
  const status = ref(200)
  const lastRedirect = shallowRef<{ from: string; to: string; status: number } | null>(null)
  const refreshKey = ref(0)
  const listeners = new Set<(to: AppRoute, from: AppRoute | null) => void>()
  let pendingNavigations = 0
  const pendingSuspense = new Set<number>()
  let errorCount = 0
  let readyResolve!: () => void
  const ready = new Promise<void>((r) => (readyResolve = r))

  function modulesOf(app: Pick<AppRoute, 'route'>): string[] {
    const files: string[] = []
    for (const s of segmentsFor(manifest, app.route)) for (const f of [s.layout, s.loading, s.error, s.notFound]) if (f) files.push(f)
    if (app.route?.page) files.push(app.route.page)
    else if (!app.route && manifest.notFound) files.push(manifest.notFound)
    return files
  }

  async function resolveMetadata(app: AppRoute): Promise<ResolvedMetadata> {
    const chain: Metadata[] = []
    const files = segmentsFor(manifest, app.route).map((s) => s.layout).filter((f): f is string => !!f)
    const page = app.route?.page ?? (app.route ? undefined : manifest.notFound)
    if (page) files.push(page)
    const ctx = { params: app.params, searchParams: app.query }
    let pageHasMeta = false
    for (const f of files) {
      const mod = cache.get(f)
      if (!mod) continue
      try {
        let m: Metadata | undefined
        if (typeof mod.generateMetadata === 'function') m = ((await mod.generateMetadata(ctx)) ?? {}) as Metadata
        else if (mod.metadata && typeof mod.metadata === 'object') m = mod.metadata as Metadata
        if (m) chain.push(m)
        if (m?.title && f === page) pageHasMeta = true
      } catch {
        /* metadata errors never break navigation */
      }
    }
    if (!app.route && !pageHasMeta) chain.push({ title: '404: This page could not be found.' })
    return resolveTitle(chain)
  }

  function buildRoute(to: Pick<RouteLocationNormalized, 'path' | 'fullPath' | 'hash'>, renderedUrl: URL): AppRoute {
    const reqUrl = new URL(to.fullPath, origin)
    const match = matchRoute(manifest, renderedUrl.pathname)
    const entry = match?.route ?? null
    const searchParams = new URLSearchParams(renderedUrl.search)
    return {
      href: reqUrl.pathname + reqUrl.search + reqUrl.hash,
      pathname: reqUrl.pathname,
      search: reqUrl.search,
      hash: reqUrl.hash,
      renderedPathname: renderedUrl.pathname,
      params: match?.params ?? {},
      searchParams,
      query: queryObject(searchParams),
      route: entry,
      notFound: !entry,
      meta: { runtime: entry?.runtime, revalidate: entry?.revalidate, metadata: {} },
    }
  }

  /** Errors thrown by middleware, rendered through the error boundary of the route. */
  const navErrors = new WeakMap<AppRoute, unknown>()
  let redirects = 0

  vr.beforeEach(async (to) => {
    pendingNavigations++
    try {
      let middlewareError: unknown
      let rendered = new URL(to.fullPath, origin)
      if (manifest.middleware) {
        try {
          const mod = (await cache.load(manifest.middleware)) as MiddlewareModule
          const req = createRouteRequest(new URL(to.fullPath, origin), { headers: options.requestHeaders })
          if (matchMiddleware(to.path, mod.config, req)) {
            const res = await runMiddleware(mod, req)
            if (res.type === 'redirect' || res.type === 'rewrite') {
              const u = new URL(res.url)
              if (u.origin !== new URL(origin).origin) {
                console.warn(`[vurses router] ignoring external ${res.type} to ${res.url}`)
                return false
              }
              if (res.type === 'redirect') {
                if (++redirects > 20) {
                  redirects = 0
                  throw new Error(`[vurses router] too many middleware redirects (at ${to.fullPath})`)
                }
                lastRedirect.value = { from: to.fullPath, to: u.pathname + u.search + u.hash, status: res.status }
                return u.pathname + u.search + u.hash
              }
              rendered = u
            }
          }
        } catch (err) {
          middlewareError = err
        }
      }
      const app = buildRoute(to, rendered)
      if (middlewareError !== undefined) navErrors.set(app, middlewareError)
      await Promise.allSettled(modulesOf(app).map((f) => cache.load(f)))
      // module-level `runtime` / `revalidate` exports win over static detection
      const pageMod = app.route?.page ? cache.get(app.route.page) : undefined
      if (pageMod?.runtime === 'server' || pageMod?.runtime === 'client') app.meta.runtime = pageMod.runtime
      if (typeof pageMod?.revalidate === 'number' || pageMod?.revalidate === false) app.meta.revalidate = pageMod.revalidate
      app.meta.metadata = await resolveMetadata(app)
      ;(to.meta as Record<string, unknown>)[APP_META] = app
      return true
    } finally {
      pendingNavigations--
    }
  })

  vr.afterEach((to, _from, failure) => {
    if (failure) return
    const app = (to.meta as Record<string, unknown>)[APP_META] as AppRoute | undefined
    if (!app) return
    const prev = current.value
    Object.assign(route, app)
    current.value = app
    status.value = app.notFound ? 404 : 200
    errorCount = 0
    redirects = 0
    readyResolve()
    for (const cb of listeners) cb(app, prev)
  })

  vr.onError((err) => {
    console.error('[vurses router] navigation error:', err)
  })

  const navigate = async (href: Href, replace: boolean) => {
    const target = toHrefString(href)
    if (/^[a-z][a-z\d+.-]*:/i.test(target) && !target.startsWith(origin)) {
      console.warn(`[vurses router] cannot open external URL ${target} in the terminal`)
      return
    }
    await (replace ? vr.replace(target) : vr.push(target))
  }

  const resolve = (href: Href) => {
    const u = new URL(toHrefString(href), origin)
    const m = matchRoute(manifest, u.pathname)
    return { pathname: u.pathname, route: m?.route ?? null, params: m?.params ?? {} }
  }

  let suspenseIds = 0

  /** Suspense boundary that reports pending state to `waitForIdle()`. */
  const RouteSuspense = defineComponent({
    name: 'RouteSuspense',
    props: { loading: String, timeout: Number },
    setup(props, { slots }) {
      const id = ++suspenseIds
      onUnmounted(() => pendingSuspense.delete(id))
      return () =>
        h(
          Suspense,
          {
            timeout: props.timeout,
            onPending: () => pendingSuspense.add(id),
            onResolve: () => pendingSuspense.delete(id),
          },
          {
            default: () => slots.default?.(),
            fallback: () => (props.loading ? h(RouteModule, { file: props.loading }) : null),
          },
        )
    },
  })

  /** Error / not-found / redirect boundary of a segment. */
  const RouteBoundary = defineComponent({
    name: 'RouteBoundary',
    props: { errorFile: String, notFoundFile: String, root: Boolean },
    setup(props, { slots }) {
      const state = shallowRef<{ kind: 'error' | 'notFound'; error: unknown } | null>(null)
      const resetKey = ref(0)
      const reset = () => {
        state.value = null
        resetKey.value++
        status.value = current.value?.notFound ? 404 : 200
      }
      onErrorCaptured((err) => {
        if (isRedirectError(err)) {
          const info = getRedirectInfo(err)!
          lastRedirect.value = { from: route.href, to: info.url, status: info.status }
          // defer: we may be inside a render / setup
          Promise.resolve().then(() => navigate(info.url, info.type !== 'push'))
          return false
        }
        if (state.value) return true // error inside our own fallback: let the parent handle it
        if (isNotFoundError(err)) {
          if (!props.notFoundFile && !props.root) return true
          state.value = { kind: 'notFound', error: err }
          status.value = 404
          return false
        }
        if (!props.errorFile && !props.root) return true
        if (++errorCount > 50) return true // safety net against error loops
        state.value = { kind: 'error', error: err }
        status.value = 500
        return false
      })
      watch(
        () => route.href,
        () => state.value && reset(),
      )
      return () => {
        const s = state.value
        if (s?.kind === 'notFound') return props.notFoundFile ? h(RouteModule, { file: props.notFoundFile, key: 'nf' }) : h(DefaultNotFound, { key: 'nf' })
        if (s?.kind === 'error') {
          const p = { error: s.error, reset }
          return props.errorFile ? h(RouteModule, { file: props.errorFile, routeProps: p, key: 'err' }) : h(DefaultRouteError, { ...p, key: 'err' })
        }
        return h(Fragment, { key: resetKey.value }, slots.default?.() ?? [])
      }
    },
  })

  function renderTree(app: AppRoute): VNode {
    const segs = segmentsFor(manifest, app.route)
    const routeProps = { params: app.params, searchParams: app.query }
    const pageFile = app.route ? app.route.page : manifest.notFound
    const pageKey = `page:${pageFile ?? '404'}:${app.renderedPathname}:${refreshKey.value}`
    const navError = navErrors.get(app)
    const page = (): VNode =>
      navError !== undefined
        ? h(Thrower, { error: navError, key: 'mw-error' })
        : pageFile
          ? h(RouteModule, { file: pageFile, routeProps, key: pageKey })
          : h(DefaultNotFound, { key: pageKey })

    const segment = (i: number): VNode => {
      const seg = segs[i]
      const inner = () => innerOf(i)
      if (!seg.layout) return inner()
      const key = `layout:${seg.layout}:${seg.params.map((p) => JSON.stringify(app.params[p] ?? '')).join(',')}`
      return h(OutletHost, { key, file: seg.layout, routeProps: { params: pickParams(app.params, seg.params) }, inner })
    }
    const innerOf = (i: number): VNode => {
      const seg = segs[i]
      let node = i === segs.length - 1 ? page() : segment(i + 1)
      if (seg.loading) {
        const child = node
        node = h(RouteSuspense, { key: `suspense:${seg.dir}`, loading: seg.loading, timeout: 0 }, { default: () => child })
      }
      if (seg.error || seg.notFound) {
        const child = node
        node = h(RouteBoundary, { key: `boundary:${seg.dir}`, errorFile: seg.error, notFoundFile: seg.notFound }, { default: () => child })
      }
      return node
    }
    return h(RouteBoundary, { root: true, notFoundFile: manifest.root?.notFound ?? manifest.notFound }, {
      default: () => h(RouteSuspense, null, { default: () => segment(0) }),
    })
  }

  const Root = defineComponent({
    name: 'AppRouter',
    setup() {
      provide(ROUTER_KEY, router)
      provide(CACHE_KEY, cache)
      const inst = getCurrentInstance()
      if (inst) register(inst.appContext.app)
      const ctx = inject(APP_CONTEXT, null)
      if (ctx && options.keyboard !== false) {
        useInput(
          (e) => {
            if (matchKey(e, 'alt+left')) {
              e.stopPropagation()
              router.back()
            } else if (matchKey(e, 'alt+right')) {
              e.stopPropagation()
              router.forward()
            }
          },
          { priority: -10 },
        )
      }
      if (ctx) {
        // The runtime auto-focuses right after mount, before the first route is
        // committed; repeat that once the first page is on screen.
        const autoFocus = (ctx.runtime as unknown as { opts?: { autoFocus?: boolean } } | undefined)?.opts?.autoFocus !== false
        const stop = watch(current, () => {
          stop()
          if (autoFocus) setTimeout(() => !ctx.focus.current.value && ctx.focus.focusFirst(), 0)
        })
      }
      if (ctx && options.terminalTitle) {
        const fmt = typeof options.terminalTitle === 'function' ? options.terminalTitle : (t: string) => t
        watch(
          () => current.value?.meta.metadata.title,
          (t) => t && ctx.writeRaw(`\x1b]0;${safeTitle(fmt(t))}\x07`),
          { immediate: true },
        )
      }
      return () => (current.value ? renderTree(current.value) : null)
    },
  })

  function register(app: App) {
    apps.set(app, router)
    const gp = app.config.globalProperties as Record<string, unknown>
    gp.$router = router
    gp.$route = route
    gp.$appRouter = router
  }

  const router: AppRouter = {
    component: Root,
    vueRouter: vr,
    manifest,
    route,
    current,
    canGoBack,
    canGoForward,
    status,
    lastRedirect,
    push: (href) => navigate(href, false),
    replace: (href) => navigate(href, true),
    back: () => vr.back(),
    forward: () => vr.forward(),
    go: (d) => vr.go(d),
    async refresh() {
      cache.clearErrors()
      const app = current.value
      if (!app) return
      await Promise.allSettled(modulesOf(app).map((f) => cache.load(f)))
      const metadata = await resolveMetadata(app)
      const next = { ...app, meta: { ...app.meta, metadata } }
      if (navErrors.has(app)) navErrors.set(next, navErrors.get(app))
      Object.assign(route, next)
      current.value = next
      refreshKey.value++
    },
    async prefetch(href) {
      const r = resolve(href)
      await Promise.allSettled(modulesOf({ route: r.route }).map((f) => cache.load(f)))
    },
    resolve,
    isReady: () => ready,
    async waitForIdle(timeoutMs = 10000) {
      const start = Date.now()
      let stable = 0
      while (Date.now() - start < timeoutMs) {
        await new Promise((r) => setTimeout(r, 2))
        const idle = pendingNavigations === 0 && pendingSuspense.size === 0 && current.value !== null
        stable = idle ? stable + 1 : 0
        if (stable >= 3) return
      }
      throw new Error('[vurses router] waitForIdle timed out')
    },
    onNavigate(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    install(app) {
      app.provide(ROUTER_KEY, router)
      register(app)
    },
  }

  // first navigation (replace: a deep link has no "back")
  const initial = options.initialPath ?? (options.history ? base.location : '/') ?? '/'
  vr.replace(initial || '/').catch((err) => console.error('[vurses router] initial navigation failed:', err))
  return router
}

function pickParams(params: RouteParams, names: string[]): RouteParams {
  const out: RouteParams = {}
  for (const n of names) if (params[n] !== undefined) out[n] = params[n]
  return out
}
