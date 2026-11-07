/**
 * vuecli App Router — file-system routes and layouts for terminal Vue apps
 * (Next.js App Router conventions; see ./types.ts for the file conventions).
 *
 * ## Public API
 *
 * Discovery (Node only; Node built-ins are imported lazily, so this module stays bundle-safe):
 * - `discoverRoutes(appDir, opts?) → Promise<RouteManifest>` — scan `app/`, routes sorted by specificity
 * - `findAppDir(dir) → Promise<string | null>` — `<dir>/app`, `<dir>/src/app` or `<dir>` itself
 * - `createNodeLoader() → Promise<ModuleLoader>` — `import(pathToFileURL(file))`
 *
 * Runtime (browser-safe; runs in the terminal, on the server and in a browser bundle):
 * - `createAppRouter({ manifest, load, initialPath?, history?, keyboard?, terminalTitle? }) → AppRouter`
 *   `createApp(router.component).mount()`; `router.push/replace/back/forward/go/refresh/prefetch`,
 *   `router.route` (reactive), `router.canGoBack/canGoForward/status`, `router.waitForIdle()`
 * - `getAppRouter(app)` — router of a mounted app (also `app.config.globalProperties.$router`)
 * - Composables: `useRouter()`, `useRoute()`, `usePathname()`, `useParams()`, `useSearchParams()`, `useMetadata()`
 * - Components (auto-registered): `<Link href>`, `<NavLink href>`, `<Outlet/>`
 * - Control flow: `redirect(url)`, `permanentRedirect(url)`, `notFound()` (+ `isRedirectError`, `isNotFoundError`)
 *
 * Matching (browser-safe; shared with the server):
 * - `matchRoute(manifest, pathname, { kind: 'page' | 'handler' | 'any' }) → { route, params } | null`
 * - `parsePattern`, `matchPattern`, `compareSpecificity`, `sortRoutes`, `buildPath`
 *
 * Middleware (`middleware.ts` / `proxy.ts` next to `app/`):
 * - `RouteResponse` (alias `NextResponse`): `.next()`, `.redirect(url)`, `.rewrite(url)`, `.json()`
 * - `createRouteRequest(url | Request) → RouteRequest` (adds `nextUrl`, `cookies`)
 * - `matchMiddleware(pathname, config, request?) → boolean` — `config.matcher` (path-to-regexp style, has/missing)
 * - `runMiddleware(mod, request) → Promise<MiddlewareResult>` — `{ type: 'next' | 'redirect' | 'rewrite' | 'response' }`
 *
 * Keyboard: alt+left / alt+right go back / forward.
 */
export type {
  RouteEntry,
  RouteManifest,
  RouteSegment,
  ModuleLoader,
  PageModuleMeta,
  Metadata,
} from './types.js'

export { discoverRoutes, findAppDir, createNodeLoader, scanPageExports, scanHandlerMethods, PAGE_EXTENSIONS, HANDLER_EXTENSIONS } from './discover.js'
export type { DiscoverOptions } from './discover.js'

export { createAppRouter, getAppRouter, DefaultNotFound, DefaultRouteError } from './router.js'
export type { AppRouter, AppRouterOptions, AppRoute, Href, NavigateOptions, ResolvedMetadata } from './router.js'

export { useRouter, useOptionalRouter, useRoute, usePathname, useParams, useSearchParams, useMetadata } from './composables.js'

export {
  redirect,
  permanentRedirect,
  notFound,
  isRedirectError,
  isNotFoundError,
  getRedirectInfo,
  RedirectError,
  NotFoundError,
} from './errors.js'
export type { RedirectType } from './errors.js'

export { matchRoute, matchPattern, parsePattern, compareSpecificity, sortRoutes, buildPath, splitPath, toRouterPath, isGroupSegment } from './match.js'
export type { RouteMatch, RouteParams, PatternSegment, MatchRouteOptions } from './match.js'

export {
  RouteResponse,
  NextResponse,
  RouteURL,
  RequestCookies,
  createRouteRequest,
  compileMatcher,
  matchMiddleware,
  runMiddleware,
  getMiddlewareFunction,
  middlewareNext,
  middlewareRedirect,
  middlewareRewrite,
  TERMINAL_ORIGIN,
} from './middleware.js'
export type { RouteRequest, MiddlewareConfig, MiddlewareModule, MiddlewareResult, Matcher, MatcherObject, MatcherCondition } from './middleware.js'

export { ROUTER_KEY, OUTLET_KEY } from './context.js'
