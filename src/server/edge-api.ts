/**
 * What `import ... from 'vuecli'` resolves to inside edge bundles (Vercel
 * Edge / Cloudflare Workers adapters): only the request-time APIs that route
 * handlers and middleware use. The terminal runtime (Vue renderer + Yoga
 * WASM) is deliberately absent — WASM compiled from bytes is not allowed on
 * those platforms.
 */
export {
  RouteResponse,
  NextResponse,
  RouteURL,
  RequestCookies,
  createRouteRequest,
  matchMiddleware,
  runMiddleware,
  middlewareNext,
  middlewareRedirect,
  middlewareRewrite,
} from '../router/middleware.js'
export type { RouteRequest, MiddlewareConfig, Matcher } from '../router/middleware.js'
export { cache, unstable_cache, cached, revalidateTag, revalidatePath, updateTag, setCacheStore, getCacheStore, createMemoryStore } from '../cache/index.js'
export type { CacheStore, CacheEntry, CacheOptions } from '../cache/index.js'
