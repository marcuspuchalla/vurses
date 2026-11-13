/**
 * The portable server core: a fetch handler `(request: Request) => Promise<Response>`.
 *
 * Every deploy adapter is a thin wrapper around it (node:http, `Bun.serve`,
 * Vercel functions, Cloudflare Workers). It only uses web-standard globals;
 * filesystem access (static files) and the Vue runtime (live sessions,
 * on-demand first frames) are injected, so an edge bundle can leave them out.
 *
 * Request pipeline:
 *
 *   /_vurses/stream   SSE: open a live server session (server routes)
 *   /_vurses/input    POST: keys / resize for a session
 *   /_vurses/reload   SSE: dev live reload
 *   /_vurses/*        built assets (app bundle, player)
 *   ─ middleware.ts   (config.matcher) redirect / rewrite / respond / next(+headers)
 *   ─ static files    public/ (+ build output)
 *   ─ route handlers  app/**\/route.ts  GET POST PUT PATCH DELETE HEAD OPTIONS
 *   ─ pages           HTML shell -> app bundle (client routes) or frame player (server routes)
 *   ─ 404             not-found
 */
import { clientAddress } from './client.js'
import { cached, pathTag } from '../cache/index.js'
import { createRouteRequest, matchMiddleware, runMiddleware, type MiddlewareModule } from '../router/middleware.js'
import { matchRoute, type RouteMatch } from '../router/match.js'
import type { ModuleLoader, RouteEntry, RouteManifest } from '../router/types.js'
import { INTERNAL_PREFIX, renderDocument, type BootData } from './html.js'
import type { SessionManager, Shell } from './session.js'
import { createSSE, SSE_HEADERS } from './sse.js'

export type FetchHandler = (request: Request) => Promise<Response>

export interface ServerApp {
  manifest: RouteManifest
  /** Loads a route module by the file path used in the manifest. */
  load: ModuleLoader
}

/** Vue-runtime powered capabilities (node / bun). Omit on edge platforms. */
export interface LiveRenderer {
  /** Live sessions for `runtime = 'server'` routes. */
  sessions?: SessionManager
  /** Renders a route's first frame offscreen (route-level `revalidate`, text clients). */
  renderShell?(path: string, size: { columns: number; rows: number }): Promise<Shell>
}

export interface HandlerOptions {
  app: ServerApp
  /** Static files (public/ and build output). Return null when not found. */
  assets?: (pathname: string, request: Request) => Promise<Response | null> | Response | null
  /** URL of the client app bundle. null: client routes are not available. Default: `/_vurses/app.js`. */
  clientScript?: string | null
  /** URL of the frame player. Default: `/_vurses/player.js`. */
  playerScript?: string
  live?: LiveRenderer
  /** Build-time prerendered shells (Partial Prerendering), keyed by pathname. */
  shells?: Record<string, Shell>
  /** Screen size for shells rendered on demand. Default 80x24. */
  screen?: { columns: number; rows: number }
  /** Default document title. */
  title?: string
  /** Dev mode: live reload endpoint, error details. */
  dev?: { buildId: string } | false
  /** Note shown in server-route pages when no live session is possible. */
  liveUnavailableNote?: string
  onError?(error: unknown, request: Request): void
}

const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']

const text = (body: string, status = 200, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', ...headers } })

/** `ctx.params` works both as an object and as a promise (Next 15 style `await params`). */
function awaitableParams<T extends object>(params: T): T & Promise<T> {
  return Object.assign(Promise.resolve(params), params)
}

/** Adds `nextUrl` / `cookies` once (the same request may pass middleware and a handler). */
const routeRequest = (r: Request) => ('nextUrl' in r ? r : createRouteRequest(r))

function titleOf(mod: Record<string, unknown> | null): string | undefined {
  const m = mod?.metadata as { title?: unknown } | undefined
  const t = m?.title
  if (typeof t === 'string') return t
  if (t && typeof t === 'object') return ((t as { absolute?: string }).absolute ?? (t as { default?: string }).default) || undefined
  return undefined
}

export interface VursesHandler extends FetchHandler {
  readonly options: HandlerOptions
  /** Closes live sessions (server shutdown). */
  close(): void
}

export function createHandler(options: HandlerOptions): VursesHandler {
  const { manifest, load } = options.app
  const clientScript = options.clientScript === undefined ? `${INTERNAL_PREFIX}app.js` : options.clientScript
  const playerScript = options.playerScript ?? `${INTERNAL_PREFIX}player.js`
  const screen = options.screen ?? { columns: 80, rows: 24 }
  const live = options.live ?? {}
  const dev = options.dev || null
  let middleware: Promise<MiddlewareModule | null> | null = null
  const getMiddleware = () =>
    (middleware ??= manifest.middleware ? (load(manifest.middleware) as Promise<MiddlewareModule>) : Promise.resolve(null))

  const fail = (e: unknown, request: Request) => {
    options.onError?.(e, request)
    const msg = dev ? `500 — ${e instanceof Error ? (e.stack ?? e.message) : String(e)}` : '500 — internal server error'
    return text(msg, 500)
  }

  // ------------------------------------------------------------ middleware

  type MwOutcome = { response: Response } | { url: URL; headers: Headers | null }

  async function applyMiddleware(request: Request, url: URL): Promise<MwOutcome> {
    const mod = await getMiddleware()
    if (!mod || !matchMiddleware(url.pathname, mod.config, request)) return { url, headers: null }
    const r = await runMiddleware(mod, routeRequest(request))
    if (r.type === 'redirect' || r.type === 'response') return { response: r.response }
    const headers = r.response ? passHeaders(r.response.headers) : null
    if (r.type === 'rewrite') return { url: new URL(r.url), headers }
    return { url, headers }
  }

  function passHeaders(h: Headers): Headers | null {
    const out = new Headers()
    let any = false
    h.forEach((v, k) => {
      if (k.startsWith('x-middleware-')) return
      out.set(k, v)
      any = true
    })
    return any ? out : null
  }

  // ------------------------------------------------------------ routes

  async function callHandler(request: Request, m: RouteMatch): Promise<Response> {
    const mod = (await load(m.route.handler!)) as Record<string, unknown>
    const method = request.method.toUpperCase()
    const allowed = METHODS.filter((x) => typeof mod[x] === 'function')
    if (allowed.includes('GET') && !allowed.includes('HEAD')) allowed.push('HEAD')
    let fn = mod[method] as ((req: Request, ctx: unknown) => unknown) | undefined
    if (typeof fn !== 'function') {
      if (method === 'HEAD' && typeof mod.GET === 'function') fn = mod.GET as unknown as typeof fn
      else if (method === 'OPTIONS') return new Response(null, { status: 204, headers: { allow: [...allowed, 'OPTIONS'].join(', ') } })
      else return text('405 — method not allowed', 405, { allow: allowed.join(', ') })
    }
    const res = await fn!(routeRequest(request), { params: awaitableParams(m.params) })
    if (!(res instanceof Response)) throw new TypeError(`[vurses] route handler ${m.route.pattern} ${method} must return a Response`)
    if (method === 'HEAD') return new Response(null, { status: res.status, statusText: res.statusText, headers: res.headers })
    return res
  }

  async function shellFor(route: RouteEntry, url: URL): Promise<Shell | null> {
    const built = options.shells?.[url.pathname]
    if (built) return built
    if (!live.renderShell) return null
    const path = url.pathname + url.search
    const rv = route.revalidate
    if (typeof rv === 'number' && rv > 0) {
      return cached(`vurses:frame:${path}:${screen.columns}x${screen.rows}`, () => live.renderShell!(path, screen), {
        revalidate: rv,
        tags: [pathTag(url.pathname)],
      })
    }
    return null
  }

  async function page(request: Request, url: URL, m: RouteMatch | null, status = 200): Promise<Response> {
    const method = request.method.toUpperCase()
    if (method !== 'GET' && method !== 'HEAD') return text('405 — method not allowed', 405, { allow: 'GET, HEAD' })
    const route = m?.route
    const isServer = route?.runtime === 'server'
    const headers: Record<string, string> = { 'content-type': 'text/html; charset=utf-8' }
    let html: string
    if (route && isServer) {
      // edge bundles do not ship page modules: metadata is optional there
      const mod = route.page ? ((await load(route.page).catch(() => null)) as Record<string, unknown> | null) : null
      let shell = await shellFor(route, url)
      const wantsText = /^text\/plain/.test(request.headers.get('accept') ?? '') || url.searchParams.has('_text')
      if (wantsText) {
        if (!shell && live.renderShell) shell = await live.renderShell(url.pathname + url.search, screen)
        return text(shell ? shell.text + '\n' : '', status)
      }
      const boot: BootData = {
        mode: 'server',
        path: url.pathname + url.search,
        live: !!live.sessions,
        stream: `${INTERNAL_PREFIX}stream`,
        input: `${INTERNAL_PREFIX}input`,
        shell: shell?.frame ?? null,
        reload: dev ? `${INTERNAL_PREFIX}reload` : undefined,
        note: live.sessions ? undefined : (options.liveUnavailableNote ?? 'live server sessions are not available on this deployment'),
      }
      html = renderDocument({ title: titleOf(mod) ?? options.title, boot, script: playerScript, shellText: shell?.text })
      const rv = route.revalidate
      headers['cache-control'] = typeof rv === 'number' && rv > 0 ? `public, s-maxage=${rv}, stale-while-revalidate` : 'no-store'
    } else {
      if (!clientScript) return text(status === 404 ? '404 — not found' : '500 — client bundle missing', status === 404 ? 404 : 500)
      const boot: BootData = { mode: 'client', path: url.pathname + url.search, reload: dev ? `${INTERNAL_PREFIX}reload` : undefined }
      html = renderDocument({ title: options.title, boot, script: clientScript })
    }
    return new Response(method === 'HEAD' ? null : html, { status, headers })
  }

  async function route(request: Request, url: URL): Promise<Response> {
    const method = request.method.toUpperCase()
    if ((method === 'GET' || method === 'HEAD') && options.assets) {
      const a = await options.assets(url.pathname, request)
      if (a) return a
    }
    const h = matchRoute(manifest, url.pathname, { kind: 'handler' })
    if (h) return callHandler(request, h)
    const p = matchRoute(manifest, url.pathname)
    if (p) return page(request, url, p)
    return page(request, url, null, 404)
  }

  // ------------------------------------------------------------ internal endpoints

  async function stream(request: Request, url: URL): Promise<Response> {
    if (!live.sessions) return text('501 — live server sessions need the node or bun adapter', 501)
    const path = url.searchParams.get('path') ?? '/'
    let target = new URL(path, url)
    if (target.origin !== url.origin) return text('400 — bad path', 400)
    // run middleware for the streamed path too (auth must not be bypassable via the stream)
    const mwReq = new Request(target, { headers: request.headers })
    const mw = await applyMiddleware(mwReq, target)
    if ('response' in mw) {
      const loc = mw.response.headers.get('location')
      if (loc && mw.response.status >= 300 && mw.response.status < 400) {
        const sse = createSSE({ keepAlive: 0 })
        sse.send('redirect', JSON.stringify({ url: new URL(loc, target).href }))
        sse.close()
        return new Response(sse.stream, { headers: SSE_HEADERS })
      }
      return mw.response
    }
    target = mw.url
    const m = matchRoute(manifest, target.pathname)
    if (!m || m.route.runtime !== 'server') return text('404 — not a server route', 404)
    return live.sessions.open(target.pathname + target.search, {
      columns: Number(url.searchParams.get('cols')),
      rows: Number(url.searchParams.get('rows')),
      request,
      signal: request.signal,
      client: clientAddress(request),
    })
  }

  async function input(request: Request): Promise<Response> {
    if (request.method !== 'POST') return text('405', 405, { allow: 'POST' })
    if (!live.sessions) return text('501', 501)
    const body = await request.text()
    if (body.length > 1 << 16) return text('413', 413)
    let msg: { sid?: string; data?: string; cols?: number; rows?: number }
    try {
      msg = JSON.parse(body)
    } catch {
      return text('400 — bad json', 400)
    }
    const s = msg.sid ? live.sessions.get(msg.sid) : undefined
    if (!s) return text('404 — no such session', 404)
    if (typeof msg.data === 'string' && msg.data) s.input(msg.data)
    if (msg.cols && msg.rows) s.resize(msg.cols, msg.rows)
    return new Response(null, { status: 204 })
  }

  function reload(): Response {
    if (!dev) return text('404', 404)
    const sse = createSSE({ retry: 300 })
    sse.send('hello', JSON.stringify({ id: dev.buildId }))
    return new Response(sse.stream, { headers: SSE_HEADERS })
  }

  // ------------------------------------------------------------ entry

  const handler = (async (request: Request): Promise<Response> => {
    let url: URL
    try {
      url = new URL(request.url)
    } catch {
      return text('400 — bad url', 400)
    }
    try {
      if (url.pathname.startsWith(INTERNAL_PREFIX)) {
        const name = url.pathname.slice(INTERNAL_PREFIX.length)
        if (name === 'stream') return await stream(request, url)
        if (name === 'input') return await input(request)
        if (name === 'reload') return reload()
        const a = options.assets ? await options.assets(url.pathname, request) : null
        return a ?? text('404 — not found', 404)
      }
      const mw = await applyMiddleware(request, url)
      if ('response' in mw) return mw.response
      let res: Response
      if (mw.url.origin !== url.origin) {
        res = await fetch(new Request(mw.url, request)) // external rewrite = proxy
      } else res = await route(mw.url.href === url.href ? request : new Request(mw.url, request), mw.url)
      if (mw.headers) {
        res = new Response(res.body, res)
        mw.headers.forEach((v, k) => res.headers.set(k, v))
      }
      return res
    } catch (e) {
      return fail(e, request)
    }
  }) as VursesHandler
  Object.defineProperty(handler, 'options', { value: options })
  handler.close = () => live.sessions?.closeAll()
  return handler
}
