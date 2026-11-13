/**
 * Loads an App-Router project from disk for the dev server, the build and
 * the terminal runner (Node only).
 *
 *   <root>/app/**            routes (or <root>/src/app, see findAppDir)
 *   <root>/middleware.ts     middleware (config.matcher)
 *   <root>/public/**         static files, served at /
 */
import { existsSync } from 'node:fs'
import { register } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { discoverRoutes, findAppDir } from '../router/discover.js'
import type { ModuleLoader, RouteManifest } from '../router/types.js'
import type { ServerApp } from './handler.js'

export interface Project extends ServerApp {
  root: string
  appDir: string
  publicDir: string | null
  manifest: RouteManifest
  load: ModuleLoader
}

let hooksRegistered = false

/** Registers the `.vue` loader hooks once (no-op when running from TypeScript sources, e.g. vitest). */
export function registerSfcHooks() {
  if (hooksRegistered) return
  hooksRegistered = true
  const hooks = new URL('../sfc/hooks.js', import.meta.url)
  if (existsSync(fileURLToPath(hooks))) register(hooks.href)
}

export async function loadProject(dir: string = process.cwd(), options: { appDir?: string } = {}): Promise<Project> {
  const root = resolve(dir)
  const appDir = options.appDir ? resolve(root, options.appDir) : await findAppDir(root)
  if (!appDir) throw new Error(`[vurses] no app directory found in ${root} (expected app/ or src/app/ with page/layout files)`)
  const manifest = await discoverRoutes(appDir)
  registerSfcHooks()
  const load: ModuleLoader = (file) => import(pathToFileURL(file).href) as Promise<Record<string, unknown>>
  const pub = join(root, 'public')
  return { root, appDir, publicDir: existsSync(pub) ? pub : null, manifest, load }
}

/** Files referenced by a manifest (pages, layouts, handlers, ...). */
export function manifestFiles(m: RouteManifest): string[] {
  const set = new Set<string>()
  const add = (f?: string) => f && set.add(f)
  for (const r of m.routes) {
    add(r.page)
    add(r.handler)
    add(r.loading)
    add(r.error)
    r.layouts.forEach(add)
    for (const s of r.segments ?? []) {
      add(s.layout)
      add(s.loading)
      add(s.error)
      add(s.notFound)
    }
  }
  add(m.middleware)
  add(m.notFound)
  add(m.rootLayout)
  if (m.root) {
    add(m.root.layout)
    add(m.root.loading)
    add(m.root.error)
    add(m.root.notFound)
  }
  return [...set]
}
