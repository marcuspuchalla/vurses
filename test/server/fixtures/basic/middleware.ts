export function middleware(req: Request & { nextUrl: URL }) {
  const p = req.nextUrl.pathname
  if (p === '/old') return Response.redirect(new URL('/', req.url), 308)
  if (p === '/secret' || p === '/live' && req.headers.get('x-deny')) return new Response('nope', { status: 401 })
  if (p === '/rewritten') {
    const h = new Headers({ 'x-middleware-rewrite': new URL('/api/hello?name=rewrite', req.url).href })
    return new Response(null, { headers: h })
  }
  return new Response(null, { headers: { 'x-middleware-next': '1', 'x-mw': 'yes' } })
}
export const config = { matcher: ['/old', '/secret', '/rewritten', '/live', '/api/:path*'] }
