/**
 * esbuild bundling for the browser app, the frame player and server entries
 * (Node only, build / dev time).
 *
 *  - `.vue` files compile through `compileSFC` (src/sfc/compile.ts)
 *  - `vue` is aliased to this package's esm-bundler runtime build (one Vue
 *    instance; feature flags defined)
 *  - `vuecli` resolves to the browser entry (client), the full index (node
 *    server) or the request-time API subset (edge)
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, type BuildOptions, type Plugin } from 'esbuild'
import type { RouteManifest } from '../router/types.js'
import type { Project } from './project.js'
import type { Shell } from './session.js'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

/** Absolute path of one of vuecli's own modules (dist .js or src .ts). */
export function ownModule(rel: string): string {
  const base = resolve(here, rel)
  for (const ext of ['.js', '.ts']) if (existsSync(base + ext)) return base + ext
  throw new Error(`[vuecli] internal module not found: ${base}`)
}

const VUE_RUNTIME = require.resolve('vue/dist/vue.runtime.esm-bundler.js')

export function vueDefines(dev: boolean): Record<string, string> {
  return {
    __VUE_OPTIONS_API__: 'true',
    __VUE_PROD_DEVTOOLS__: 'false',
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
    'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production'),
  }
}

/** Compiles `.vue` single-file components. */
export function sfcPlugin(): Plugin {
  return {
    name: 'vuecli-sfc',
    setup(b) {
      b.onLoad({ filter: /\.vue$/ }, async (args) => {
        const { compileSFC } = await import(ownModule('../sfc/compile'))
        try {
          return { contents: compileSFC(await readFile(args.path, 'utf8'), args.path) as string, loader: 'js', resolveDir: dirname(args.path) }
        } catch (e) {
          return { errors: [{ text: (e as Error).message }] }
        }
      })
    },
  }
}

/** Resolves `vue` and `vuecli` to single, target-appropriate modules. */
export function resolvePlugin(vuecliEntry: string, vue: string | null = VUE_RUNTIME): Plugin {
  return {
    name: 'vuecli-resolve',
    setup(b) {
      b.onResolve({ filter: /^vuecli$/ }, () => ({ path: vuecliEntry }))
      if (vue) b.onResolve({ filter: /^vue$/ }, () => ({ path: vue }))
    },
  }
}

const posix = (p: string) => p.split(sep).join('/')

/** Manifest with file paths relative to the project root (stable module ids, no build-machine paths). */
export function relativeManifest(m: RouteManifest, root: string): { manifest: RouteManifest; files: Map<string, string> } {
  const files = new Map<string, string>()
  const rel = (f: string) => {
    const id = posix(relative(root, f))
    files.set(id, f)
    return id
  }
  const walk = (v: unknown, key?: string): unknown => {
    if (typeof v === 'string') return key && /^(page|handler|loading|error|notFound|layout|middleware|rootLayout)$/.test(key) ? rel(v) : v
    if (Array.isArray(v)) return v.map((x) => walk(x, key === 'layouts' ? 'layout' : undefined))
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === 'appDir' ? posix(relative(root, x as string)) || '.' : walk(x, k)]))
    return v
  }
  return { manifest: walk(m) as RouteManifest, files }
}

const q = JSON.stringify

function moduleMap(ids: Iterable<[string, string]>, extra = ''): string {
  const lines = [...ids].map(([id, file]) => `  ${q(id)}: () => import(${q(file)}),`)
  return `const modules = {\n${lines.join('\n')}\n${extra}}\nconst load = (f) => { const m = modules[f]; return m ? m() : Promise.reject(new Error('[vuecli] module not bundled: ' + f)) }\n`
}

export interface ClientBundleOptions {
  dev?: boolean
  minify?: boolean
  /** What client navigation to a server route does. */
  serverRoutes?: 'navigate' | 'unsupported'
  outfile?: string
}

/** Generated browser entry: the client manifest + lazy module map + bootBrowser(). */
export function clientEntrySource(project: Project, o: ClientBundleOptions = {}): string {
  const { manifest } = relativeManifest(project.manifest, project.root)
  const files = new Map<string, string>()
  const stubs: string[] = []
  const abs = (id: string) => join(project.root, id)
  for (const r of manifest.routes) {
    // route handlers and server pages stay on the server
    delete r.handler
    if (r.page && r.runtime === 'server') {
      const id = `vuecli:server:${r.pattern}`
      stubs.push(`  ${q(id)}: () => Promise.resolve({ default: serverRouteStub(${q(r.pattern)}, ${q(o.serverRoutes ?? 'navigate')}) }),`)
      r.page = id
    } else if (r.page) files.set(r.page, abs(r.page))
    for (const f of [...r.layouts, r.loading, r.error, ...(r.segments ?? []).flatMap((s) => [s.layout, s.loading, s.error, s.notFound])]) if (f) files.set(f, abs(f))
  }
  delete manifest.middleware
  for (const f of [manifest.notFound, manifest.rootLayout, manifest.root?.layout, manifest.root?.loading, manifest.root?.error, manifest.root?.notFound]) if (f) files.set(f, abs(f))
  manifest.routes = manifest.routes.filter((r) => r.page)
  return `import { bootBrowser, serverRouteStub } from 'vuecli'
const manifest = ${q(manifest)}
${moduleMap(files, stubs.join('\n') + '\n')}
bootBrowser({ manifest, load })
`
}

const browserBase = (dev: boolean, minify: boolean): BuildOptions => ({
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify,
  sourcemap: dev ? 'inline' : false,
  define: vueDefines(dev),
  logLevel: 'silent',
  legalComments: 'none',
  write: false,
})

/** Bundles the client app. Returns the JS source. */
export async function bundleClient(project: Project, o: ClientBundleOptions = {}): Promise<string> {
  const r = await build({
    ...browserBase(!!o.dev, o.minify ?? !o.dev),
    stdin: { contents: clientEntrySource(project, o), resolveDir: project.root, sourcefile: 'vuecli-client-entry.js', loader: 'js' },
    plugins: [resolvePlugin(ownModule('../browser')), sfcPlugin()],
  })
  return r.outputFiles![0].text
}

/** Bundles the frame player (no Vue). */
export async function bundlePlayer(o: { minify?: boolean } = {}): Promise<string> {
  const r = await build({
    ...browserBase(false, o.minify ?? true),
    entryPoints: [ownModule('../player/index')],
  })
  return r.outputFiles![0].text
}

/** Bundles a plain root component for the browser (`vuecli dev App.vue`). */
export async function bundleComponent(entry: string, o: { dev?: boolean; minify?: boolean } = {}): Promise<string> {
  const contents = `import { bootBrowser } from 'vuecli'\nimport App from ${q(resolve(entry))}\nbootBrowser({ root: App })\n`
  const r = await build({
    ...browserBase(!!o.dev, o.minify ?? !o.dev),
    stdin: { contents, resolveDir: dirname(resolve(entry)), sourcefile: 'vuecli-component-entry.js', loader: 'js' },
    plugins: [resolvePlugin(ownModule('../browser')), sfcPlugin()],
  })
  return r.outputFiles![0].text
}

export interface ServerBundleOptions {
  /** node / bun: full runtime (live sessions). edge: request-time only (handlers, middleware, shells). */
  kind: 'node' | 'edge'
  shells: Record<string, Shell>
  title?: string
  outfile: string
  minify?: boolean
  /** Edge only: the default export shape. */
  edgeExport?: 'handler' | 'worker'
}

/** Generated server entry. */
export function serverEntrySource(project: Project, o: Omit<ServerBundleOptions, 'outfile'>): string {
  const { manifest, files } = relativeManifest(project.manifest, project.root)
  const own = (m: string) => q(ownModule(m))
  const needed = new Map<string, string>()
  for (const [id, file] of files) {
    // edge bundles never render: only handlers + middleware
    const isHandlerOrMw = manifest.middleware === id || manifest.routes.some((r) => r.handler === id)
    if (o.kind === 'node' || isHandlerOrMw) needed.set(id, file)
  }
  let src = `import { createHandler } from ${own('./handler')}\n`
  src += `export const manifest = ${q(manifest)}\nexport const shells = ${q(o.shells)}\n${moduleMap(needed)}export const app = { manifest, load }\n`
  if (o.kind === 'node') {
    src += `import { createLive } from ${own('./live')}\nimport { fsAssets } from ${own('./assets')}\nexport { serve, toNodeListener } from ${own('./node')}\n`
    src += `export function createServerHandler(options = {}) {
  const { staticDir, live, ...rest } = options
  return createHandler({ app, shells, title: ${q(o.title ?? 'vuecli app')}, assets: staticDir ? fsAssets([staticDir]) : undefined, live: live === false ? undefined : createLive(app, live), ...rest })
}\n`
  } else {
    const note = 'live server sessions need a long-running server (node or bun adapter); showing the prerendered frame'
    src += `const handler = createHandler({ app, shells, title: ${q(o.title ?? 'vuecli app')}, liveUnavailableNote: ${q(note)} })\n`
    src += o.edgeExport === 'worker' ? `export default { fetch: (request, env, ctx) => handler(request) }\n` : `export default handler\n`
  }
  return src
}

export async function bundleServer(project: Project, o: ServerBundleOptions): Promise<void> {
  const node = o.kind === 'node'
  await build({
    bundle: true,
    format: 'esm',
    platform: node ? 'node' : 'browser',
    conditions: node ? [] : ['workerd', 'worker', 'browser'],
    target: node ? 'node20' : 'es2022',
    minify: o.minify ?? false,
    define: vueDefines(false),
    logLevel: 'silent',
    legalComments: 'none',
    outfile: o.outfile,
    banner: node ? { js: "import { createRequire as __vuecliCreateRequire } from 'node:module'; const require = __vuecliCreateRequire(import.meta.url);" } : undefined,
    stdin: { contents: serverEntrySource(project, o), resolveDir: project.root, sourcefile: 'vuecli-server-entry.js', loader: 'js' },
    plugins: [resolvePlugin(ownModule(node ? '../index' : './edge-api')), sfcPlugin()],
  })
}
