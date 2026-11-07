import { describe, expect, it } from 'vitest'
import {
  NextResponse,
  RouteResponse,
  compileMatcher,
  createRouteRequest,
  matchMiddleware,
  runMiddleware,
  type RouteRequest,
} from '../../src/router/middleware.js'

describe('matcher', () => {
  const m = (source: string, path: string) => compileMatcher(source).test(path)
  it('supports path-to-regexp params and modifiers', () => {
    expect(m('/about', '/about')).toBe(true)
    expect(m('/about', '/about/')).toBe(true)
    expect(m('/about', '/about/x')).toBe(false)
    expect(m('/about/:path*', '/about')).toBe(true)
    expect(m('/about/:path*', '/about/a/b')).toBe(true)
    expect(m('/about/:path+', '/about')).toBe(false)
    expect(m('/about/:path+', '/about/a/b')).toBe(true)
    expect(m('/users/:id', '/users/1')).toBe(true)
    expect(m('/users/:id', '/users/1/x')).toBe(false)
    expect(m('/users/:id?', '/users')).toBe(true)
    expect(m('/users/:id(\\d+)', '/users/12')).toBe(true)
    expect(m('/users/:id(\\d+)', '/users/ab')).toBe(false)
  })
  it('supports raw regex groups (negative lookahead)', () => {
    const src = '/((?!api|_next/static|favicon.ico).*)'
    expect(m(src, '/')).toBe(true)
    expect(m(src, '/dashboard')).toBe(true)
    expect(m(src, '/api/hello')).toBe(false)
  })
  it('matchMiddleware handles configs, arrays and has/missing', () => {
    expect(matchMiddleware('/x')).toBe(true)
    expect(matchMiddleware('/x', {})).toBe(true)
    expect(matchMiddleware('/x', { matcher: '/y' })).toBe(false)
    expect(matchMiddleware('/y', { matcher: ['/x', '/y'] })).toBe(true)
    const req = createRouteRequest('/p?preview=1', { headers: { cookie: 'session=abc; theme=dark' } })
    expect(matchMiddleware('/p', { matcher: [{ source: '/p', has: [{ type: 'query', key: 'preview' }] }] }, req)).toBe(true)
    expect(matchMiddleware('/p', { matcher: [{ source: '/p', missing: [{ type: 'cookie', key: 'session' }] }] }, req)).toBe(false)
    expect(matchMiddleware('/p', { matcher: [{ source: '/p', has: [{ type: 'cookie', key: 'theme', value: 'dark|light' }] }] }, req)).toBe(true)
  })
})

describe('requests and responses', () => {
  it('creates Next-style requests', () => {
    const req = createRouteRequest('/users/1?x=2', { headers: { cookie: 'a=1; b=hello%20world' } })
    expect(req).toBeInstanceOf(Request)
    expect(req.nextUrl.pathname).toBe('/users/1')
    expect(req.nextUrl.searchParams.get('x')).toBe('2')
    expect(req.nextUrl.clone().href).toBe(req.nextUrl.href)
    expect(req.cookies.get('b')?.value).toBe('hello world')
    expect(req.cookies.has('c')).toBe(false)
    // wraps an existing server Request without copying
    const raw = new Request('https://example.com/a')
    expect(createRouteRequest(raw).nextUrl.host).toBe('example.com')
  })
  it('RouteResponse is a Response with Next semantics', async () => {
    expect(NextResponse).toBe(RouteResponse)
    const r = RouteResponse.redirect('https://x.dev/a')
    expect(r).toBeInstanceOf(Response)
    expect(r.status).toBe(307)
    expect(RouteResponse.redirect('/a', 308).status).toBe(308)
    expect(await RouteResponse.json({ a: 1 }).json()).toEqual({ a: 1 })
  })
})

describe('runMiddleware', () => {
  const mod = {
    middleware(req: RouteRequest) {
      const p = req.nextUrl.pathname
      if (p === '/r') return RouteResponse.redirect(new URL('/login?from=r', req.url))
      if (p === '/w') return RouteResponse.rewrite(new URL('/other', req.url))
      if (p === '/n') return RouteResponse.next({ headers: { 'x-a': '1' } })
      if (p === '/j') return Response.json({ ok: true }, { status: 401 })
      return undefined
    },
  }
  it('normalizes results', async () => {
    expect(await runMiddleware(mod, '/nothing')).toEqual({ type: 'next' })
    const r = await runMiddleware(mod, '/r')
    expect(r.type === 'redirect' && [r.url, r.status]).toEqual(['http://localhost/login?from=r', 307])
    const w = await runMiddleware(mod, createRouteRequest('/w'))
    expect(w.type === 'rewrite' && w.url).toBe('http://localhost/other')
    const n = await runMiddleware(mod, '/n')
    expect(n.type).toBe('next')
    expect(n.response?.headers.get('x-a')).toBe('1')
    const j = await runMiddleware(mod, '/j')
    expect(j.type === 'response' && j.response.status).toBe(401)
  })
  it('accepts default / proxy exports, async functions and plain server Requests', async () => {
    const r = await runMiddleware({ default: async () => RouteResponse.rewrite('/x') }, new Request('https://site.dev/a'))
    expect(r.type === 'rewrite' && r.url).toBe('https://site.dev/x')
    expect((await runMiddleware({ proxy: () => RouteResponse.redirect('/b') }, '/a')).type).toBe('redirect')
    expect(await runMiddleware({}, '/a')).toEqual({ type: 'next' })
    await expect(runMiddleware({ middleware: () => 42 }, '/a')).rejects.toThrow(/must return a Response/)
  })
})
