/**
 * Middleware (`middleware.ts` / `proxy.ts` next to `app/`), Next.js style.
 * Browser-safe: uses only the standard `Request` / `Response` / `URL` globals.
 *
 * ```ts
 * // middleware.ts
 * import { RouteResponse, type RouteRequest } from 'vuecli'
 *
 * export function middleware(req: RouteRequest) {
 *   if (req.nextUrl.pathname === '/old') return RouteResponse.redirect(new URL('/new', req.url))
 *   if (req.nextUrl.pathname === '/secret') return RouteResponse.rewrite(new URL('/login', req.url))
 *   return RouteResponse.next()
 * }
 * export const config = { matcher: ['/old', '/secret/:path*'] }
 * ```
 *
 * The terminal router runs middleware before every client navigation (push,
 * replace, back/forward, deep links). The HTTP server runs the same code for
 * requests via {@link matchMiddleware} + {@link runMiddleware}.
 */

// ------------------------------------------------------------------ request

/** `URL` with Next's `clone()` helper. */
export class RouteURL extends URL {
  clone(): RouteURL {
    return new RouteURL(this.href)
  }
}

export interface RequestCookie {
  name: string
  value: string
}

/** Read-only cookie accessor parsed from the `cookie` header. */
export class RequestCookies {
  private map = new Map<string, string>()
  constructor(header: string | null) {
    for (const part of (header ?? '').split(';')) {
      const i = part.indexOf('=')
      if (i < 0) continue
      const name = part.slice(0, i).trim()
      if (!name) continue
      let value = part.slice(i + 1).trim()
      try {
        value = decodeURIComponent(value)
      } catch {
        /* keep raw */
      }
      this.map.set(name, value)
    }
  }
  get(name: string): RequestCookie | undefined {
    const value = this.map.get(name)
    return value === undefined ? undefined : { name, value }
  }
  getAll(): RequestCookie[] {
    return [...this.map].map(([name, value]) => ({ name, value }))
  }
  has(name: string): boolean {
    return this.map.has(name)
  }
}

/** A `Request` with Next-style `nextUrl` and `cookies`. */
export type RouteRequest = Request & { readonly nextUrl: RouteURL; readonly cookies: RequestCookies }

/** Default origin used for terminal navigations (there is no real host). */
export const TERMINAL_ORIGIN = 'http://localhost'

/**
 * Creates a {@link RouteRequest}. `input` may be an absolute URL, a path
 * (resolved against `TERMINAL_ORIGIN`), a `URL` or an existing `Request`
 * (e.g. the server's incoming request).
 */
export function createRouteRequest(input: string | URL | Request, init?: RequestInit): RouteRequest {
  const req =
    typeof input === 'string' || input instanceof URL
      ? new Request(new URL(String(input), TERMINAL_ORIGIN), init)
      : init
        ? new Request(input, init)
        : input
  const nextUrl = new RouteURL(req.url)
  let cookies: RequestCookies | undefined
  Object.defineProperty(req, 'nextUrl', { value: nextUrl, enumerable: true })
  Object.defineProperty(req, 'cookies', { get: () => (cookies ??= new RequestCookies(req.headers.get('cookie'))), enumerable: true })
  return req as RouteRequest
}

// ----------------------------------------------------------------- response

const H_NEXT = 'x-middleware-next'
const H_REWRITE = 'x-middleware-rewrite'
const H_REDIRECT = 'location'

/**
 * `NextResponse` equivalent. A real `Response` subclass, so the server can
 * send it as-is; the terminal router only looks at next / redirect / rewrite.
 */
export class RouteResponse extends Response {
  /** Continue with the requested route. `init.headers` are added to the response (server). */
  static next(init?: ResponseInit): RouteResponse {
    const headers = new Headers(init?.headers)
    headers.set(H_NEXT, '1')
    return new RouteResponse(null, { ...init, headers })
  }

  /** Redirect to `url` (default status 307). The browser URL changes. */
  static override redirect(url: string | URL, init?: number | ResponseInit): RouteResponse {
    const opts = typeof init === 'number' ? { status: init } : (init ?? {})
    const headers = new Headers(opts.headers)
    headers.set(H_REDIRECT, String(url))
    return new RouteResponse(null, { ...opts, status: opts.status ?? 307, headers })
  }

  /** Render `url` while keeping the requested URL. */
  static rewrite(url: string | URL, init?: ResponseInit): RouteResponse {
    const headers = new Headers(init?.headers)
    headers.set(H_REWRITE, String(url))
    return new RouteResponse(null, { ...init, headers })
  }

  static override json(data: unknown, init?: ResponseInit): RouteResponse {
    const headers = new Headers(init?.headers)
    if (!headers.has('content-type')) headers.set('content-type', 'application/json')
    return new RouteResponse(JSON.stringify(data), { ...init, headers })
  }
}

/** Alias for code ported from Next.js. */
export const NextResponse = RouteResponse
/** Function shortcuts: `next()`, `redirect(url)`, `rewrite(url)` (named to avoid clashing with the `redirect()` route helper). */
export const middlewareNext = RouteResponse.next
export const middlewareRedirect = RouteResponse.redirect.bind(RouteResponse)
export const middlewareRewrite = RouteResponse.rewrite

// ------------------------------------------------------------------ matcher

/** Condition on a header / cookie / query value (Next `has` / `missing`). */
export interface MatcherCondition {
  type: 'header' | 'cookie' | 'query' | 'host'
  key?: string
  /** Regular expression source the value must match (whole value). */
  value?: string
}

export interface MatcherObject {
  source: string
  has?: MatcherCondition[]
  missing?: MatcherCondition[]
}

export type Matcher = string | MatcherObject | (string | MatcherObject)[]

export interface MiddlewareConfig {
  matcher?: Matcher
}

export interface MiddlewareModule {
  default?: unknown
  middleware?: unknown
  /** Next 16 name for middleware. */
  proxy?: unknown
  config?: MiddlewareConfig
  [key: string]: unknown
}

const ESCAPE = /[.+*?^${}()|[\]\\]/g
const reCache = new Map<string, RegExp>()

/**
 * Compiles a path-to-regexp style matcher (`/about/:path*`, `/users/:id(\\d+)`,
 * `/((?!api|_next).*)`) to an anchored, case-insensitive RegExp.
 */
export function compileMatcher(source: string): RegExp {
  const hit = reCache.get(source)
  if (hit) return hit
  let re = ''
  let i = 0
  const readGroup = (start: number): number => {
    let depth = 0
    for (let j = start; j < source.length; j++) {
      const c = source[j]
      if (c === '\\') {
        j++
        continue
      }
      if (c === '(') depth++
      else if (c === ')' && --depth === 0) return j + 1
    }
    throw new Error(`[vuecli router] unbalanced "(" in matcher ${source}`)
  }
  while (i < source.length) {
    const c = source[i]
    if (c === '/' && source[i + 1] === ':') {
      // "/:name(regex)?modifier"
      let j = i + 2
      while (j < source.length && /[\w$]/.test(source[j])) j++
      let p = '[^/]+'
      if (source[j] === '(') {
        const end = readGroup(j)
        p = source.slice(j + 1, end - 1)
        j = end
      }
      const mod = /[*+?]/.test(source[j] ?? '') ? source[j++] : ''
      const many = `${p}(?:/${p})*`
      re += mod === '' ? `/(${p})` : mod === '?' ? `(?:/(${p}))?` : mod === '+' ? `/(${many})` : `(?:/(${many}))?`
      i = j
    } else if (c === '(') {
      const end = readGroup(i)
      re += source.slice(i, end)
      i = end
      if (/[*+?]/.test(source[i] ?? '')) re += source[i++]
    } else if (c === '*') {
      re += '(.*)'
      i++
    } else {
      re += c.replace(ESCAPE, '\\$&')
      i++
    }
  }
  const out = new RegExp(`^${re}/?$`, 'i')
  reCache.set(source, out)
  return out
}

function conditionHolds(c: MatcherCondition, req: Request | undefined, url: URL): boolean {
  let value: string | null | undefined
  if (c.type === 'host') value = url.hostname
  else if (c.type === 'query') value = c.key ? url.searchParams.get(c.key) : null
  else if (c.type === 'header') value = c.key ? (req?.headers.get(c.key) ?? null) : null
  else if (c.type === 'cookie') value = c.key && req ? (new RequestCookies(req.headers.get('cookie')).get(c.key)?.value ?? null) : null
  if (value === null || value === undefined) return false
  return c.value === undefined || new RegExp(`^(?:${c.value})$`).test(value)
}

/**
 * True when middleware should run for `pathname` according to `config.matcher`
 * (no config / matcher = run for every path). Pass `request` to evaluate
 * `has` / `missing` conditions.
 */
export function matchMiddleware(pathname: string, config?: MiddlewareConfig | null, request?: Request): boolean {
  const matcher = config?.matcher
  if (matcher === undefined || matcher === null) return true
  const list = Array.isArray(matcher) ? matcher : [matcher]
  const url = request ? new URL(request.url) : new URL(pathname, TERMINAL_ORIGIN)
  for (const m of list) {
    const source = typeof m === 'string' ? m : m.source
    if (!compileMatcher(source).test(pathname)) continue
    if (typeof m === 'object') {
      if (m.has && !m.has.every((c) => conditionHolds(c, request, url))) continue
      if (m.missing && m.missing.some((c) => conditionHolds(c, request, url))) continue
    }
    return true
  }
  return false
}

// ------------------------------------------------------------------- runner

/** Normalized outcome of running middleware. */
export type MiddlewareResult =
  | { type: 'next'; response?: Response }
  | { type: 'redirect'; url: string; status: number; response: Response }
  | { type: 'rewrite'; url: string; response: Response }
  /** Middleware answered the request itself (server only; the terminal treats this as `next`). */
  | { type: 'response'; response: Response }

/** Middleware function of a module (`middleware`, `proxy` or `default` export). */
export function getMiddlewareFunction(mod: MiddlewareModule): ((req: RouteRequest, event: unknown) => unknown) | null {
  const fn = mod.middleware ?? mod.proxy ?? mod.default
  return typeof fn === 'function' ? (fn as (req: RouteRequest, event: unknown) => unknown) : null
}

/**
 * Runs a middleware module for a request and normalizes its return value.
 * Does NOT check `config.matcher`; call {@link matchMiddleware} first.
 * Relative redirect / rewrite URLs are resolved against the request URL.
 */
export async function runMiddleware(mod: MiddlewareModule, request: Request | RouteRequest | string): Promise<MiddlewareResult> {
  const req = typeof request === 'string' || !('nextUrl' in request) ? createRouteRequest(request) : request
  const fn = getMiddlewareFunction(mod)
  if (!fn) return { type: 'next' }
  const pending: Promise<unknown>[] = []
  const event = { waitUntil: (p: Promise<unknown>) => void pending.push(p), request: req }
  const res = await fn(req, event)
  if (res === undefined || res === null) return { type: 'next' }
  if (!(res instanceof Response)) {
    throw new TypeError('[vuecli router] middleware must return a Response (RouteResponse.next/redirect/rewrite) or nothing')
  }
  const abs = (u: string) => new URL(u, req.url).href
  const rewrite = res.headers.get(H_REWRITE)
  if (rewrite) return { type: 'rewrite', url: abs(rewrite), response: res }
  const location = res.headers.get(H_REDIRECT)
  if (location && res.status >= 300 && res.status < 400) return { type: 'redirect', url: abs(location), status: res.status, response: res }
  if (res.headers.get(H_NEXT)) return { type: 'next', response: res }
  return { type: 'response', response: res }
}
