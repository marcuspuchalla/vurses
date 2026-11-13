import { RouteResponse, type RouteRequest } from 'vurses'

// Runs before every navigation (terminal) and every request (server).
export function middleware(request: RouteRequest) {
  const { pathname } = request.nextUrl
  if (pathname === '/home') return RouteResponse.redirect(new URL('/', request.url))
  const m = pathname.match(/^\/people\/(\d+)$/)
  if (m) return RouteResponse.redirect(new URL(`/users/${m[1]}`, request.url))
  return RouteResponse.next()
}

export const config = { matcher: ['/home', '/people/:id'] }
