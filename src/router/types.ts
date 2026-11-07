/**
 * Shared contract between the App Router (src/router), the server runtime
 * (src/server), the browser build (src/targets/browser) and MCP (src/mcp).
 *
 * File conventions (inside the app directory, default `app/`):
 *
 *   app/layout.vue              root layout (wraps everything, renders <Outlet/> or default slot)
 *   app/page.vue                "/"
 *   app/about/page.vue          "/about"
 *   app/users/[id]/page.vue     "/users/:id"
 *   app/docs/[...slug]/page.vue "/docs/*" (catch-all, params.slug = string[])
 *   app/(group)/x/page.vue      route group: "(group)" is not part of the URL
 *   app/x/loading.vue           Suspense fallback for the segment
 *   app/x/error.vue             error boundary for the segment (props: error, reset)
 *   app/not-found.vue           404 page
 *   app/api/hello/route.ts      route handler: export GET/POST/... (Request) => Response
 *   middleware.ts (next to app/) export default/middleware(req) + export const config = { matcher }
 *
 * Page/layout modules may export (from a plain `<script>` block in the SFC):
 *   export const runtime = 'server' | 'client'   (default 'client')
 *   export const revalidate = 60 | false          (seconds; ISR-style frame caching)
 *   export const metadata = { title }             (shown in title / status bar)
 */

export interface RouteEntry {
  /** vue-router style path: '/users/:id', '/docs/:slug(.*)*' */
  path: string
  /** File-system pattern: '/users/[id]' */
  pattern: string
  /** Absolute path of page.vue (absent for handler-only routes). */
  page?: string
  /** Layout files from outermost to innermost (absolute paths). */
  layouts: string[]
  /** Nearest loading.vue (absolute path). */
  loading?: string
  /** Nearest error.vue (absolute path). */
  error?: string
  /** route.ts handler module (absolute path). */
  handler?: string
  /** Dynamic param names in order. Catch-all params end with '...' removed but listed in `catchAll`. */
  params: string[]
  catchAll?: string
}

export interface RouteManifest {
  /** Absolute path of the app directory. */
  appDir: string
  routes: RouteEntry[]
  /** Absolute path of middleware.ts/js, if any. */
  middleware?: string
  /** Absolute path of app/not-found.vue, if any. */
  notFound?: string
  /** Root layout (app/layout.vue), if any. */
  rootLayout?: string
}

/** Loads a route module by absolute file path (Node: dynamic import; browser: bundled map). */
export type ModuleLoader = (file: string) => Promise<Record<string, unknown>>

export interface PageModuleMeta {
  runtime?: 'server' | 'client'
  revalidate?: number | false
  metadata?: { title?: string; description?: string }
}
