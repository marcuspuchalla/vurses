/**
 * File-system route discovery (Node only).
 *
 *   const manifest = await discoverRoutes('/abs/path/to/app')
 *
 * Node built-ins are imported lazily inside the functions, so importing this
 * module from a browser bundle does not pull them in (calling it there throws).
 *
 * Conventions (see ./types.ts):
 *  - `page`, `layout`, `loading`, `error`, `not-found` with any of the
 *    {@link PAGE_EXTENSIONS}; `route.(ts|js|mjs|mts)` handlers
 *  - `[id]` dynamic, `[...slug]` catch-all, `[[...slug]]` optional catch-all
 *  - `(group)` route groups (not part of the URL)
 *  - `_private` folders, dot folders, `node_modules` and `@slot` / `(.)intercept`
 *    folders are ignored; `%5Fname` produces a literal `_name` segment
 *  - `middleware.*` or `proxy.*` next to the app dir
 */
import type { RouteEntry, RouteManifest, RouteSegment } from './types.js'
import { isGroupSegment, parsePattern, sortRoutes, toRouterPath } from './match.js'

/** Extensions recognized for page / layout / loading / error / not-found files (in priority order). */
export const PAGE_EXTENSIONS = ['.vue', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.mts']
/** Extensions recognized for `route.*` handlers and `middleware.*`. */
export const HANDLER_EXTENSIONS = ['.ts', '.js', '.mjs', '.mts']

const SPECIAL = ['page', 'layout', 'loading', 'error', 'not-found'] as const
type Special = (typeof SPECIAL)[number]

export interface DiscoverOptions {
  /** Override page extensions (default {@link PAGE_EXTENSIONS}). */
  pageExtensions?: string[]
  /**
   * Directory searched for `middleware.*` / `proxy.*`. Default: the parent of
   * the app dir (`<project>/middleware.ts` or `<project>/src/middleware.ts`).
   */
  middlewareDir?: string | false
}

type Fs = typeof import('node:fs/promises')
type Path = typeof import('node:path')
// variable specifiers keep bundlers from resolving Node built-ins
const nodeImport = <T>(id: string): Promise<T> => import(/* @vite-ignore */ id) as Promise<T>

/**
 * Scans `appDir` and returns the route manifest, with routes sorted by
 * specificity (static > dynamic > catch-all > optional catch-all).
 * Throws when two files resolve to the same URL.
 */
export async function discoverRoutes(appDir: string, options: DiscoverOptions = {}): Promise<RouteManifest> {
  const fs = await nodeImport<Fs>('node:fs/promises')
  const path = await nodeImport<Path>('node:path')
  const root = path.resolve(appDir)
  const pageExt = options.pageExtensions ?? PAGE_EXTENSIONS
  const stat = await fs.stat(root).catch(() => null)
  if (!stat?.isDirectory()) throw new Error(`[vuecli router] app directory not found: ${appDir}`)

  const routes: RouteEntry[] = []
  const byUrl = new Map<string, string>()
  let rootSegment: RouteSegment | undefined

  const pick = (names: Set<string>, base: string, exts: string[]) => {
    for (const e of exts) if (names.has(base + e)) return base + e
    return undefined
  }

  async function walk(dir: string, rel: string[], urlParts: string[], parents: RouteSegment[], params: string[]) {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    const files = new Set(entries.filter((e) => e.isFile() || e.isSymbolicLink()).map((e) => e.name))
    const found: Partial<Record<Special, string>> = {}
    for (const s of SPECIAL) {
      const f = pick(files, s, pageExt)
      if (f) found[s] = path.join(dir, f)
    }
    const handlerName = pick(files, 'route', HANDLER_EXTENSIONS)
    const handlerFile = handlerName && path.join(dir, handlerName)
    const relDir = rel.join('/')
    let segments = parents
    if (found.layout || found.loading || found.error || found['not-found'] || rel.length === 0) {
      const seg: RouteSegment = { dir: relDir, params: [...params] }
      if (found.layout) seg.layout = found.layout
      if (found.loading) seg.loading = found.loading
      if (found.error) seg.error = found.error
      if (found['not-found']) seg.notFound = found['not-found']
      segments = [...parents, seg]
      if (rel.length === 0) rootSegment = seg
    }
    const pattern = '/' + urlParts.join('/')
    const segs = parsePattern(pattern)
    if (found.page || handlerFile) {
      const key = toRouterPath(segs.map((s) => (s.kind === 'static' ? s : { ...s, name: '_' })))
      const file = found.page ?? handlerFile!
      const prev = byUrl.get(key)
      if (prev) throw new Error(`[vuecli router] conflicting routes for "${pattern}":\n  ${prev}\n  ${file}`)
      byUrl.set(key, file)
      if (found.page && handlerFile) {
        throw new Error(`[vuecli router] ${pattern}: a segment cannot have both page and route handler:\n  ${found.page}\n  ${handlerFile}`)
      }
      const last = segs[segs.length - 1]
      const entry: RouteEntry = {
        path: toRouterPath(segs),
        pattern,
        layouts: segments.map((s) => s.layout).filter((x): x is string => !!x),
        params: segs.filter((s) => s.kind !== 'static').map((s) => (s as { name: string }).name),
        segments,
      }
      if (found.page) entry.page = found.page
      if (handlerFile) entry.handler = handlerFile
      const loading = [...segments].reverse().find((s) => s.loading)?.loading
      const error = [...segments].reverse().find((s) => s.error)?.error
      if (loading) entry.loading = loading
      if (error) entry.error = error
      if (last && (last.kind === 'catchAll' || last.kind === 'optionalCatchAll')) {
        entry.catchAll = last.name
        if (last.kind === 'optionalCatchAll') entry.optionalCatchAll = true
      }
      const src = await fs.readFile(file, 'utf8').catch(() => '')
      if (found.page) Object.assign(entry, scanPageExports(src))
      else entry.methods = scanHandlerMethods(src)
      routes.push(entry)
    }
    const dirs = entries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))
    for (const d of dirs) {
      const name = d.name
      if (name.startsWith('_') || name.startsWith('.') || name.startsWith('@') || name === 'node_modules') continue
      if (/^\(\.{1,3}\)/.test(name) || name.startsWith('(...)')) continue // intercepting routes: unsupported
      const literal = name.replace(/^%5F/i, '_')
      const group = isGroupSegment(name)
      const childParams = [...params]
      const dyn = name.match(/^\[{1,2}(?:\.\.\.)?([^\]]+)\]{1,2}$/)
      if (dyn) {
        if (childParams.includes(dyn[1])) throw new Error(`[vuecli router] duplicate param "${dyn[1]}" in ${path.join(dir, name)}`)
        childParams.push(dyn[1])
      }
      await walk(path.join(dir, name), [...rel, name], group ? urlParts : [...urlParts, literal], segments, childParams)
    }
  }

  await walk(root, [], [], [], [])
  sortRoutes(routes)

  const manifest: RouteManifest = { appDir: root, routes, root: rootSegment }
  if (rootSegment?.layout) manifest.rootLayout = rootSegment.layout
  if (rootSegment?.notFound) manifest.notFound = rootSegment.notFound
  if (options.middlewareDir !== false) {
    const mwDir = options.middlewareDir ? path.resolve(options.middlewareDir) : path.dirname(root)
    const names = new Set(await fs.readdir(mwDir).catch(() => [] as string[]))
    const mw = pick(names, 'middleware', HANDLER_EXTENSIONS) ?? pick(names, 'proxy', HANDLER_EXTENSIONS)
    if (mw) manifest.middleware = path.join(mwDir, mw)
  }
  return manifest
}

/** Statically detects `export const runtime` / `revalidate` in a page source. */
export function scanPageExports(source: string): Pick<RouteEntry, 'runtime' | 'revalidate'> {
  const out: Pick<RouteEntry, 'runtime' | 'revalidate'> = {}
  const rt = source.match(/export\s+const\s+runtime\s*(?::[^=]+)?=\s*['"`](server|client)['"`]/)
  if (rt) out.runtime = rt[1] as 'server' | 'client'
  const rv = source.match(/export\s+const\s+revalidate\s*(?::[^=]+)?=\s*(false|\d+(?:\.\d+)?)/)
  if (rv) out.revalidate = rv[1] === 'false' ? false : Number(rv[1])
  return out
}

const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']

/** Statically detects exported HTTP method handlers in a `route.ts` source. */
export function scanHandlerMethods(source: string): string[] {
  const found = new Set<string>()
  const re = /export\s+(?:async\s+)?(?:function\s*\*?\s*|const\s+|let\s+|var\s+)([A-Z]+)\b/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source))) if (METHODS.includes(m[1])) found.add(m[1])
  const list = source.match(/export\s*\{([^}]*)\}/g) ?? []
  for (const block of list) {
    for (const part of block.replace(/export\s*\{|\}/g, '').split(',')) {
      const name = part.split(/\s+as\s+/).pop()!.trim()
      if (METHODS.includes(name)) found.add(name)
    }
  }
  return METHODS.filter((x) => found.has(x))
}

/**
 * Finds the app directory for a project path: `<dir>/app`, `<dir>/src/app`,
 * or `<dir>` itself when it contains a page or layout file. Returns null otherwise.
 */
export async function findAppDir(dir: string): Promise<string | null> {
  const fs = await nodeImport<Fs>('node:fs/promises')
  const path = await nodeImport<Path>('node:path')
  const base = path.resolve(dir)
  const isDir = async (p: string) => !!(await fs.stat(p).catch(() => null))?.isDirectory()
  if (!(await isDir(base))) return null
  for (const c of [path.join(base, 'app'), path.join(base, 'src', 'app')]) if (await isDir(c)) return c
  const names = new Set(await fs.readdir(base))
  for (const s of ['page', 'layout']) for (const e of PAGE_EXTENSIONS) if (names.has(s + e)) return base
  return null
}

/**
 * Node {@link ModuleLoader}: `import(pathToFileURL(file))`. `.vue` files need
 * the SFC loader hooks (`vuecli/register`), which the CLI registers.
 */
export async function createNodeLoader(): Promise<(file: string) => Promise<Record<string, unknown>>> {
  const { pathToFileURL } = await nodeImport<typeof import('node:url')>('node:url')
  return (file) => import(/* @vite-ignore */ pathToFileURL(file).href) as Promise<Record<string, unknown>>
}
