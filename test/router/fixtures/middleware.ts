import { RouteResponse, type RouteRequest } from '../../../src/router/middleware.js'

export function middleware(req: RouteRequest) {
  const p = req.nextUrl.pathname
  if (p === '/old') return RouteResponse.redirect(new URL('/about', req.url))
  if (p === '/rewritten') return RouteResponse.rewrite(new URL('/users/7?tab=rw', req.url))
  if (p.startsWith('/admin')) return RouteResponse.redirect(new URL('/?denied=1', req.url))
  return RouteResponse.next()
}

export const config = { matcher: ['/old', '/rewritten', '/admin/:path*'] }
