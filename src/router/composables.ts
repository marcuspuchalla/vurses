import { computed, inject, type ComputedRef } from 'vue'
import { ROUTER_KEY } from './context.js'
import type { AppRoute, AppRouter, ResolvedMetadata } from './router.js'
import type { RouteParams } from './match.js'

/**
 * The App Router: `push`, `replace`, `back`, `forward`, `refresh`, `prefetch`
 * (plus `canGoBack`, `canGoForward`, `route`, ...). Next.js `useRouter()` equivalent.
 */
export function useRouter(): AppRouter {
  const router = inject(ROUTER_KEY, null)
  if (!router) throw new Error('[vurses router] useRouter() used outside of an App Router tree (mount createAppRouter(...).component)')
  return router
}

/** Like {@link useRouter} but returns null outside of an App Router tree. */
export function useOptionalRouter(): AppRouter | null {
  return inject(ROUTER_KEY, null)
}

/** The current route (reactive object: `route.pathname`, `route.params`, `route.searchParams`, ...). */
export function useRoute(): Readonly<AppRoute> {
  return useRouter().route
}

/** Current pathname, e.g. `/users/42` (the requested one, also after a middleware rewrite). */
export function usePathname(): ComputedRef<string> {
  const r = useRouter()
  return computed(() => r.route.pathname)
}

/** Dynamic params of the current route: `{ id: '42' }`, catch-alls are arrays. */
export function useParams<T extends RouteParams = RouteParams>(): ComputedRef<T> {
  const r = useRouter()
  return computed(() => r.route.params as T)
}

/** Current query string as `URLSearchParams` (treat it as read-only; navigate to change it). */
export function useSearchParams(): ComputedRef<URLSearchParams> {
  const r = useRouter()
  return computed(() => r.route.searchParams)
}

/** Resolved metadata (`title`, `description`, ...) of the current route. */
export function useMetadata(): ComputedRef<ResolvedMetadata> {
  const r = useRouter()
  return computed(() => r.route.meta.metadata)
}
