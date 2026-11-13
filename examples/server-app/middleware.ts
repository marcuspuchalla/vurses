import { RouteResponse, type RouteRequest } from 'vurses'

export function middleware(req: RouteRequest) {
  if (req.nextUrl.pathname === '/dashboard') return RouteResponse.redirect(new URL('/live', req.url))
  return RouteResponse.next({ headers: { 'x-powered-by': 'vurses' } })
}

export const config = { matcher: ['/dashboard', '/api/:path*'] }
