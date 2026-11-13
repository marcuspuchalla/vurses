/**
 * Loads what `vurses mcp <target>` should run (Node only):
 *  - an entry file (.vue / .js / .ts) whose default export is the root component
 *  - an App Router project / app directory (file-based routes)
 */
import { existsSync, statSync } from 'node:fs'
import { register } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Component } from 'vue'
import type { TuiApp } from '../app/app.js'
import type { RouteManifest } from '../router/types.js'
import { vursesError } from '../errors.js'

/** The subset of a vue-router `Router` the MCP tools use. */
export interface RouterLike {
  push(to: string): Promise<unknown>
  back(): void
  forward(): void
  getRoutes?(): { path: string; name?: unknown; meta?: Record<string, unknown> }[]
  currentRoute: { value: { fullPath: string; path?: string; params?: Record<string, unknown>; name?: unknown } }
  isReady?(): Promise<void>
  /** Resolves when no navigation is pending and async pages have resolved. */
  waitForIdle?(timeoutMs?: number): Promise<void>
}

export interface LoadedApp {
  mode: 'entry' | 'router'
  component: Component
  /** Installs plugins before mount. */
  setup?: (app: TuiApp) => void | Promise<void>
  /** Router mode: the route manifest. */
  manifest?: RouteManifest
  /** Runs after mount (router mode: waits for the first navigation). */
  afterMount?: () => Promise<void>
  /** Router mode: returns the app's router once mounted. */
  getRouter?: (app: TuiApp) => RouterLike | null
  /** The resolved file / directory. */
  target: string
}

let hooksRegistered = false

/** Registers the `.vue` loader hooks once per process. */
export async function registerSfcHooks() {
  if (hooksRegistered) return
  hooksRegistered = true
  const { hooksUrl } = await import('../cli/shared.js')
  register(hooksUrl)
}

/** Imports an entry module and returns its default export. */
export async function loadEntry(entry: string): Promise<Component> {
  const file = resolve(entry)
  if (!existsSync(file)) throw vursesError('VC110', { entry })
  if (/\.vue$/.test(file)) await registerSfcHooks()
  const mod = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as { default?: Component }
  if (!mod.default) throw vursesError('VC111', { entry })
  return mod.default
}

// The router module is developed separately; resolve it at runtime so this
// file builds (and degrades gracefully) without it.
const ROUTER_MODULE = '../router/index.js'

type RouterModule = {
  discoverRoutes?: (appDir: string) => Promise<RouteManifest>
  findAppDir?: (dir: string) => Promise<string | null>
  createNodeLoader?: () => Promise<(file: string) => Promise<Record<string, unknown>>>
  createAppRouter?: (options: { manifest: RouteManifest; load: (file: string) => Promise<Record<string, unknown>>; initialPath?: string; terminalTitle?: boolean }) => AppRouterLike
  getAppRouter?: (app: unknown) => AppRouterLike | undefined
}

/** The parts of `AppRouter` (src/router) used here. */
interface AppRouterLike {
  component: Component
  vueRouter?: { currentRoute: RouterLike['currentRoute']; getRoutes?: RouterLike['getRoutes'] }
  push(href: string): Promise<unknown>
  back(): void
  forward(): void
  isReady?(): Promise<void>
  waitForIdle?(timeoutMs?: number): Promise<void>
  install?(app: unknown): void
}

async function importRouter(): Promise<RouterModule | null> {
  try {
    return (await import(/* @vite-ignore */ ROUTER_MODULE)) as RouterModule
  } catch {
    return null
  }
}

/** Adapts an App Router to the vue-router-like interface the MCP tools use. */
export function adaptAppRouter(r: AppRouterLike): RouterLike {
  if (!r.vueRouter) throw vursesError('VC065', { file: 'createAppRouter()', reason: 'return an AppRouter with a vueRouter' })
  const vr = r.vueRouter
  return {
    push: (to) => r.push(to),
    back: () => r.back(),
    forward: () => r.forward(),
    currentRoute: vr.currentRoute,
    getRoutes: vr.getRoutes?.bind(vr),
    isReady: r.isReady?.bind(r),
    waitForIdle: r.waitForIdle?.bind(r),
  }
}

/**
 * Prepares an App Router app from a project or app directory, using
 * `discoverRoutes`, `createAppRouter` and `getAppRouter` from `src/router`.
 */
export async function loadRouterApp(dir: string, opts: { initialPath?: string } = {}): Promise<LoadedApp> {
  const mod = await importRouter()
  if (!mod?.discoverRoutes || !mod.createAppRouter) throw vursesError('VC112', { tool: 'Running an app directory' })
  const appDir = (await mod.findAppDir?.(dir)) ?? null
  if (!appDir || !existsSync(appDir)) throw vursesError('VC062', { dir })
  await registerSfcHooks()
  const manifest = await mod.discoverRoutes(appDir)
  const load = (await mod.createNodeLoader?.()) ?? ((file: string) => import(/* @vite-ignore */ pathToFileURL(file).href))
  const router = mod.createAppRouter({ manifest, load, initialPath: opts.initialPath ?? '/', terminalTitle: false })
  if (!router?.component) throw vursesError('VC065', { file: 'createAppRouter()', reason: 'return a router with a root component' })
  const adapted = adaptAppRouter(router)
  return {
    mode: 'router',
    component: router.component,
    manifest,
    target: appDir,
    setup: async (app) => {
      // the root component provides the router; install() is optional
      if (typeof router.install === 'function') app.use(router as never)
    },
    afterMount: async () => {
      await router.isReady?.().catch(() => {})
      await router.waitForIdle?.(3000).catch(() => {})
    },
    getRouter: (app) => {
      const r = mod.getAppRouter?.(app)
      return r ? adaptAppRouter(r) : adapted
    },
  }
}

/** Loads an entry file or an App Router directory. */
export async function loadApp(target: string, opts: { initialPath?: string } = {}): Promise<LoadedApp> {
  const abs = resolve(target)
  if (!existsSync(abs)) throw vursesError('VC110', { entry: target })
  if (statSync(abs).isDirectory()) return loadRouterApp(abs, opts)
  return { mode: 'entry', component: await loadEntry(abs), target: abs }
}
