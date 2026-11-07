/**
 * The server's / browser entry's seam to the App Router (src/router, owned by
 * the router stream). Browser-safe.
 */
import type { Component } from 'vue'
import { createMemoryHistory, createWebHistory } from 'vue-router'
import { createAppRouter, type AppRouter } from '../router/router.js'
import type { ModuleLoader, RouteManifest } from '../router/types.js'

export interface RouteRootOptions {
  manifest: RouteManifest
  load: ModuleLoader
  /** Initial URL path (with search/hash). */
  path: string
  /** 'memory' for server sessions / snapshots, 'web' for the browser (the URL follows navigation). */
  history: 'memory' | 'web'
  /** Incoming request (server sessions): its origin and cookies are used for middleware during client navigations. */
  request?: Request
}

/** Root component rendering the App Router at `path`. */
export async function createRouteRoot(o: RouteRootOptions): Promise<Component> {
  return createRouteRouter(o).component
}

/** The App Router for `path` (`.component` is the root; `.waitForIdle()` resolves once data has loaded). */
export function createRouteRouter(o: RouteRootOptions): AppRouter {
  let origin: string | undefined
  let requestHeaders: Record<string, string> | undefined
  if (o.request) {
    origin = new URL(o.request.url).origin
    const cookie = o.request.headers.get('cookie')
    if (cookie) requestHeaders = { cookie }
  }
  return createAppRouter({
    manifest: o.manifest,
    load: o.load,
    initialPath: o.path,
    history: o.history === 'web' ? createWebHistory() : createMemoryHistory(),
    origin,
    requestHeaders,
  })
}
