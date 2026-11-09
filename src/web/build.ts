/**
 * Builds an existing Vite + Vue web app for the terminal, using the app's own
 * Vite installation and config (aliases, plugins, env files all apply).
 *
 * Differences from a normal `vite build`:
 * - `vue` (and @vue/runtime-*) resolve to vuecli's shim (terminal createApp, v-model, ...)
 * - `vue-router`'s web/hash histories become memory histories
 * - one ES module (dynamic imports inlined), CSS collected into one string
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export interface WebBuild {
  /** Built ES module to import. */
  entry: string
  /** index.html source. */
  html: string
  /** CSS from the bundle, <link rel=stylesheet> and <style> in index.html. */
  css: string
  /** Absolute path of the app's `vue` package directory. */
  vueDir: string
}

const SHIM = fileURLToPath(new URL('./vue-shim.js', import.meta.url))

/** ESM entry of a package as seen from `root`. */
export function resolvePackage(root: string, name: string): string {
  const req = createRequire(join(root, 'package.json'))
  const pkgPath = req.resolve(`${name}/package.json`)
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  const pick = (e: unknown): string | undefined => {
    if (typeof e === 'string') return e
    if (e && typeof e === 'object') {
      const o = e as Record<string, unknown>
      return pick(o.import) ?? pick(o.node) ?? pick(o.default) ?? pick(o['.'])
    }
    return undefined
  }
  const rel = pick(pkg.exports?.['.'] ?? pkg.exports) ?? pkg.module ?? pkg.main ?? 'index.js'
  return join(dirname(pkgPath), rel)
}

/** The module script of index.html (`/src/main.ts`). */
export function findEntry(root: string, html: string): string {
  const m = /<script\b[^>]*type=["']module["'][^>]*\bsrc=["']([^"']+)["'][^>]*>/i.exec(html) ?? /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*type=["']module["'][^>]*>/i.exec(html)
  if (!m) throw new Error('index.html has no <script type="module" src="..."> entry')
  const src = m[1].replace(/^\//, '').split('?')[0]
  return resolve(root, src)
}

async function linkedCss(root: string, html: string, cacheDir: string): Promise<string> {
  let out = ''
  const head = html
  for (const m of head.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0]
    if (!/rel=["']?stylesheet/i.test(tag)) continue
    const href = /href=["']([^"']+)["']/i.exec(tag)?.[1]
    if (!href) continue
    try {
      if (/^(https?:)?\/\//.test(href)) {
        const url = href.startsWith('//') ? `https:${href}` : href
        const { createHash } = await import('node:crypto')
        const { mkdirSync, writeFileSync } = await import('node:fs')
        const file = join(cacheDir, 'remote-css', createHash('sha1').update(url).digest('hex') + '.css')
        if (existsSync(file)) out += readFileSync(file, 'utf8') + '\n'
        else {
          const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
          if (res.ok) {
            const text = await res.text()
            mkdirSync(dirname(file), { recursive: true })
            writeFileSync(file, text)
            out += text + '\n'
          }
        }
      } else {
        const rel = href.replace(/^\//, '').split('?')[0]
        for (const base of [join(root, 'public'), root]) {
          const f = join(base, rel)
          if (existsSync(f)) {
            out += readFileSync(f, 'utf8') + '\n'
            break
          }
        }
      }
    } catch {
      /* offline or missing: render without it */
    }
  }
  for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) out += m[1] + '\n'
  return out
}

export async function buildWebApp(root: string, options: { outDir?: string; log?: (m: string) => void } = {}): Promise<WebBuild> {
  root = resolve(root)
  const log = options.log ?? (() => {})
  const htmlPath = join(root, 'index.html')
  if (!existsSync(htmlPath)) throw new Error(`no index.html in ${root} — is this a Vite app?`)
  const html = readFileSync(htmlPath, 'utf8')
  const entry = findEntry(root, html)
  const outDir = options.outDir ?? join(root, 'node_modules', '.vuecli-web')

  let vitePath: string
  try {
    vitePath = resolvePackage(root, 'vite')
  } catch {
    throw new Error(`vite is not installed in ${root} — vuecli web builds the app with its own Vite (npm install first)`)
  }
  const vueDir = dirname(createRequire(join(root, 'package.json')).resolve('vue/package.json'))
  const vite = (await import(pathToFileURL(vitePath).href)) as { version: string; build(config: unknown): Promise<unknown> }
  const routerId = '\0vuecli-web:vue-router'

  const plugin = {
    name: 'vuecli-web',
    enforce: 'pre' as const,
    async resolveId(this: { resolve: (id: string, importer?: string, o?: { skipSelf?: boolean }) => Promise<{ id: string } | null> }, id: string) {
      if (id === 'vue' || id === '@vue/runtime-dom' || id === '@vue/runtime-core' || id === '@vue/reactivity') return { id: SHIM, external: true }
      if (id === 'vue-router') return routerId
      return null
    },
    async load(this: { resolve: (id: string, importer?: string, o?: { skipSelf?: boolean }) => Promise<{ id: string } | null> }, id: string) {
      if (id !== routerId) return null
      const real = await this.resolve('vue-router', join(root, 'index.html'), { skipSelf: true })
      if (!real) throw new Error('cannot resolve vue-router')
      const r = JSON.stringify(real.id)
      return `import { createMemoryHistory } from ${r}
export * from ${r}
// the terminal has no URL bar: web and hash histories become memory histories
export function createWebHistory(base) {
  const history = createMemoryHistory(base)
  const start = globalThis.__VUECLI_WEB__?.route
  if (start) history.replace(start)
  return history
}
export { createWebHistory as createWebHashHistory }
`
    },
  }

  log(`building ${entry.slice(root.length + 1)} with vite ${vite.version}…`)
  // one file: Vite 8 (Rolldown) calls it codeSplitting: false, older Vite inlineDynamicImports
  const major = parseInt(vite.version, 10)
  const output = {
    format: 'es' as const,
    entryFileNames: 'app.mjs',
    assetFileNames: 'assets/[name]-[hash][extname]',
    ...(major >= 8 ? { codeSplitting: false } : { inlineDynamicImports: true }),
  }
  await vite.build({
    root,
    mode: 'production',
    logLevel: 'error',
    clearScreen: false,
    base: '/',
    plugins: [plugin as never],
    define: { __VUE_PROD_DEVTOOLS__: 'false', __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false' },
    build: {
      outDir,
      emptyOutDir: true,
      copyPublicDir: false,
      minify: false,
      sourcemap: false,
      modulePreload: false,
      cssCodeSplit: false,
      target: 'esnext',
      reportCompressedSize: false,
      rollupOptions: { input: entry, output, preserveEntrySignatures: false },
    },
  })

  let css = await linkedCss(root, html, join(outDir, '..', '.vuecli-web-cache'))
  const assets = join(outDir, 'assets')
  if (existsSync(assets)) for (const f of readdirSync(assets).sort()) if (f.endsWith('.css')) css += readFileSync(join(assets, f), 'utf8') + '\n'
  for (const f of readdirSync(outDir)) if (f.endsWith('.css')) css += readFileSync(join(outDir, f), 'utf8') + '\n'
  return { entry: join(outDir, 'app.mjs'), html, css, vueDir }
}
