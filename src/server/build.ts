/**
 * `vurses build --adapter static|node|bun|vercel|cloudflare` (Node only).
 *
 * Every adapter shares the same steps:
 *   1. discover routes, bundle the client app (`_vurses/app.js`) and the
 *      frame player (`_vurses/player.js`), copy `public/`
 *   2. Partial Prerendering: render the static shell frame of every
 *      `runtime = 'server'` route without dynamic params (skip with
 *      `export const dynamic = 'force-dynamic'`); the page paints it instantly
 *      and the live session streams the dynamic part
 *   3. adapter-specific server entry around the portable fetch handler
 *
 * Output layouts:
 *
 *   static      <out>/index.html, <route>/index.html, 404.html, _vurses/app.js, public files
 *   node        <out>/server.mjs (node:http), <out>/server/index.mjs, <out>/static/**
 *   bun         <out>/bun.mjs (Bun.serve), <out>/server.mjs, <out>/server/index.mjs, <out>/static/**
 *   vercel      .vercel/output/{config.json, static/**, functions/index.func/{index.js,.vc-config.json}}
 *   cloudflare  <out>/worker.js, <out>/wrangler.toml, <out>/public/**
 */
import { randomBytes } from 'node:crypto'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { bundleClient, bundlePlayer, bundleServer } from './bundle.js'
import { renderDocument } from './html.js'
import { createLive } from './live.js'
import { loadProject, type Project } from './project.js'
import type { Shell } from './session.js'

export type Adapter = 'static' | 'node' | 'bun' | 'vercel' | 'cloudflare'
export const ADAPTERS: Adapter[] = ['static', 'node', 'bun', 'vercel', 'cloudflare']

export interface BuildOptions {
  /** Project root (contains app/). Default: cwd. */
  root?: string
  appDir?: string
  adapter?: Adapter
  /** Output directory (default per adapter, see `defaultOutDir`). */
  outDir?: string
  minify?: boolean
  /** Screen size of prerendered shells. Default 80x24. */
  screen?: { columns: number; rows: number }
  /** Skip Partial Prerendering. */
  prerender?: boolean
  log?(msg: string): void
  warn?(msg: string): void
}

export interface BuildResult {
  adapter: Adapter
  outDir: string
  buildId: string
  /** Files written, relative to outDir. */
  files: string[]
  prerendered: string[]
  warnings: string[]
}

export function defaultOutDir(root: string, adapter: Adapter) {
  if (adapter === 'vercel') return join(root, '.vercel', 'output')
  return join(root, '.vurses', adapter)
}

const hasParams = (pattern: string) => /\[/.test(pattern)

async function projectTitle(root: string) {
  try {
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
    return typeof pkg.name === 'string' ? pkg.name : 'vurses app'
  } catch {
    return 'vurses app'
  }
}

/** Renders PPR shells for static server routes. */
export async function prerenderShells(project: Project, o: { screen?: { columns: number; rows: number }; warn?(m: string): void } = {}): Promise<Record<string, Shell>> {
  const shells: Record<string, Shell> = {}
  const live = createLive(project, { sessions: false })
  for (const r of project.manifest.routes) {
    if (!r.page || r.runtime !== 'server' || hasParams(r.pattern)) continue
    const src = await readFile(r.page, 'utf8').catch(() => '')
    if (/export\s+const\s+dynamic\s*=\s*['"]force-dynamic['"]/.test(src)) continue
    const path = r.pattern.split('/').filter((s) => s && !/^\(.*\)$/.test(s)).join('/')
    const url = '/' + path
    try {
      shells[url] = await live.renderShell!(url, o.screen ?? { columns: 80, rows: 24 })
    } catch (e) {
      o.warn?.(`prerender of ${url} failed (served without a shell): ${(e as Error).message}`)
    }
  }
  return shells
}

export async function buildApp(options: BuildOptions = {}): Promise<BuildResult> {
  const root = resolve(options.root ?? process.cwd())
  const adapter = options.adapter ?? 'node'
  if (!ADAPTERS.includes(adapter)) throw new Error(`[vurses] unknown adapter "${adapter}" (expected ${ADAPTERS.join(', ')})`)
  const log = options.log ?? (() => {})
  const warnings: string[] = []
  const warn = (m: string) => {
    warnings.push(m)
    ;(options.warn ?? log)(m)
  }
  const project = await loadProject(root, { appDir: options.appDir })
  const outDir = resolve(options.outDir ?? defaultOutDir(project.root, adapter))
  const buildId = randomBytes(6).toString('hex')
  const minify = options.minify ?? true
  const title = await projectTitle(project.root)
  const files: string[] = []
  const write = async (rel: string, content: string | Uint8Array) => {
    const file = join(outDir, rel)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, content)
    files.push(rel)
  }

  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })

  const serverRoutes = project.manifest.routes.filter((r) => r.page && r.runtime === 'server')
  const staticDir = adapter === 'static' ? '' : adapter === 'cloudflare' ? 'public' : 'static'
  const at = (p: string) => (staticDir ? `${staticDir}/${p}` : p)

  // 1. client app, player, public/
  log(`bundling client app…`)
  await write(at('_vurses/app.js'), await bundleClient(project, { minify, serverRoutes: adapter === 'static' ? 'unsupported' : 'navigate' }))
  if (adapter !== 'static') await write(at('_vurses/player.js'), await bundlePlayer({ minify }))
  if (project.publicDir) {
    await cp(project.publicDir, join(outDir, staticDir), { recursive: true })
    files.push(at('(public files)'))
  }

  // 2. Partial Prerendering
  let shells: Record<string, Shell> = {}
  if (adapter !== 'static' && options.prerender !== false && serverRoutes.length) {
    log(`prerendering ${serverRoutes.length} server route(s)…`)
    shells = await prerenderShells(project, { screen: options.screen, warn })
  }

  // 3. adapter
  switch (adapter) {
    case 'static': {
      for (const r of serverRoutes) warn(`${r.pattern}: runtime = 'server' is not supported by the static adapter (needs node or bun); the route shows a notice`)
      for (const r of project.manifest.routes) if (r.handler) warn(`${r.pattern}: route handlers are not supported by the static adapter`)
      if (project.manifest.middleware) warn('middleware is not supported by the static adapter')
      for (const r of project.manifest.routes) {
        if (!r.page || r.runtime === 'server' || hasParams(r.pattern)) continue
        const p = r.pattern.split('/').filter((s) => s && !/^\(.*\)$/.test(s)).join('/')
        const html = renderDocument({ title, boot: { mode: 'client', path: '/' + p }, script: '/_vurses/app.js' })
        await write(p ? `${p}/index.html` : 'index.html', html)
      }
      // dynamic routes and unknown paths: the client router resolves them from 404.html
      await write('404.html', renderDocument({ title, boot: { mode: 'client', path: '/' }, script: '/_vurses/app.js' }))
      break
    }
    case 'node':
    case 'bun': {
      log('bundling server…')
      await bundleServer(project, { kind: 'node', shells, title, outfile: join(outDir, 'server', 'index.mjs'), minify: false })
      files.push('server/index.mjs')
      await write('server.mjs', NODE_LAUNCHER)
      if (adapter === 'bun') await write('bun.mjs', BUN_LAUNCHER)
      break
    }
    case 'vercel': {
      log('bundling edge function…')
      const fn = 'functions/index.func'
      await bundleServer(project, { kind: 'edge', shells, title, outfile: join(outDir, fn, 'index.js'), minify, edgeExport: 'handler' })
      files.push(`${fn}/index.js`)
      await write(`${fn}/.vc-config.json`, JSON.stringify({ runtime: 'edge', entrypoint: 'index.js' }, null, 2) + '\n')
      await write(
        'config.json',
        JSON.stringify({ version: 3, routes: [{ handle: 'filesystem' }, { src: '/(.*)', dest: '/index' }] }, null, 2) + '\n',
      )
      if (serverRoutes.length) warn("vercel: runtime = 'server' routes are served as prerendered frames only (no live sessions: functions are short-lived and not sticky)")
      break
    }
    case 'cloudflare': {
      log('bundling worker…')
      await bundleServer(project, { kind: 'edge', shells, title, outfile: join(outDir, 'worker.js'), minify, edgeExport: 'worker' })
      files.push('worker.js')
      const name = title.replace(/[^a-z0-9-]/gi, '-').toLowerCase().replace(/^-+|-+$/g, '') || 'vurses-app'
      await write(
        'wrangler.toml',
        `# generated by vurses build --adapter cloudflare\nname = "${name}"\nmain = "worker.js"\ncompatibility_date = "2025-01-01"\n\n[assets]\ndirectory = "./public"\nbinding = "ASSETS"\n`,
      )
      if (serverRoutes.length) warn("cloudflare: runtime = 'server' routes are served as prerendered frames only (no live sessions: isolates are not sticky and cannot compile Yoga's WASM at runtime; a Durable Object port is future work)")
      break
    }
  }
  await write('vurses-build.json', JSON.stringify({ adapter, buildId, createdAt: new Date().toISOString(), prerendered: Object.keys(shells), routes: project.manifest.routes.map((r) => ({ pattern: r.pattern, runtime: r.runtime ?? (r.page ? 'client' : undefined), handler: !!r.handler })) }, null, 2) + '\n')
  return { adapter, outDir, buildId, files, prerendered: Object.keys(shells), warnings }
}

/** True when `dir` holds a node/bun build. */
export function isNodeBuild(dir: string) {
  return existsSync(join(dir, 'server', 'index.mjs'))
}

const NODE_LAUNCHER = `// generated by vurses build — run with: node server.mjs  (PORT, HOST env vars)
import { fileURLToPath } from 'node:url'
import { createServerHandler, serve } from './server/index.mjs'

const staticDir = fileURLToPath(new URL('./static', import.meta.url))
const handler = createServerHandler({ staticDir })
const server = await serve(handler, { port: Number(process.env.PORT ?? 3000), host: process.env.HOST })
console.log(\`vurses server listening on \${server.url}\`)
const stop = () => server.close().then(() => process.exit(0))
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
`

const BUN_LAUNCHER = `// generated by vurses build --adapter bun — run with: bun bun.mjs  (PORT, HOST env vars)
import { createServerHandler } from './server/index.mjs'

const staticDir = new URL('./static', import.meta.url).pathname
const handler = createServerHandler({ staticDir })
// idleTimeout: SSE sessions are long-lived (keep-alive pings every 15 s)
const server = Bun.serve({ port: Number(process.env.PORT ?? 3000), hostname: process.env.HOST, idleTimeout: 255, fetch: handler })
console.log(\`vurses server (bun) listening on \${server.url}\`)
`
