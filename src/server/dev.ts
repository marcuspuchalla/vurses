/**
 * Dev server (Node only).
 *
 * `vuecli dev` runs a supervisor process that watches the project and
 * (re)starts a worker running `startDevServer()`: on every change the worker
 * is replaced, so server modules, routes and the browser bundle are always
 * fresh. Pages keep an EventSource on `/_vuecli/reload`; when it reconnects to
 * a worker with a new build id, the page reloads.
 *
 * A single `.vue` / `.ts` entry (no app/ directory) is served as a
 * client-only app.
 */
import { randomBytes } from 'node:crypto'
import { existsSync, statSync, watch, type FSWatcher } from 'node:fs'
import { spawn, type ChildProcess } from 'node:child_process'
import { relative, resolve } from 'node:path'
import { chainAssets, fsAssets, memoryAssets } from './assets.js'
import { bundleClient, bundleComponent, bundlePlayer } from './bundle.js'
import { createHandler, type FetchHandler } from './handler.js'
import { renderDocument, INTERNAL_PREFIX } from './html.js'
import { createLive } from './live.js'
import { serve, type RunningServer } from './node.js'
import { loadProject } from './project.js'
import { createSSE, SSE_HEADERS } from './sse.js'

export interface DevServerOptions {
  /** Project root or a single component entry. */
  entry?: string
  port?: number
  host?: string
  appDir?: string
  log?(msg: string): void
}

const escHtml = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)

/** Error page that still live-reloads (so fixing the file recovers). */
function errorHandler(error: unknown, buildId: string): FetchHandler {
  const msg = error instanceof Error ? (error.stack ?? error.message) : String(error)
  return async (req) => {
    const url = new URL(req.url)
    if (url.pathname === `${INTERNAL_PREFIX}reload`) {
      const sse = createSSE({ retry: 300 })
      sse.send('hello', JSON.stringify({ id: buildId }))
      return new Response(sse.stream, { headers: SSE_HEADERS })
    }
    const html = `<!doctype html><meta charset="utf-8"><title>vuecli: build error</title>
<body style="background:#1e1e1e;color:#f14c4c;font:14px ui-monospace,monospace;padding:16px"><h3>vuecli dev: build failed</h3><pre>${escHtml(msg)}</pre>
<script>let id;new EventSource('${INTERNAL_PREFIX}reload').addEventListener('hello',e=>{const n=JSON.parse(e.data).id;if(id&&n!==id)location.reload();id=n})</script>`
    console.error(`[vuecli] ${msg}`)
    return new Response(html, { status: 500, headers: { 'content-type': 'text/html; charset=utf-8' } })
  }
}

/** Builds everything in memory and serves it. One call = one build. */
export async function startDevServer(options: DevServerOptions = {}): Promise<RunningServer & { buildId: string }> {
  const log = options.log ?? ((m: string) => console.log(m))
  const buildId = randomBytes(6).toString('hex')
  const target = resolve(options.entry ?? '.')
  let handler: FetchHandler
  try {
    const files = new Map<string, string>()
    files.set(`${INTERNAL_PREFIX}player.js`, await bundlePlayer({ minify: false }))
    if (existsSync(target) && statSync(target).isFile()) {
      files.set(`${INTERNAL_PREFIX}app.js`, await bundleComponent(target, { dev: true }))
      const page = renderDocument({ title: relative(process.cwd(), target), boot: { mode: 'client', path: '/', reload: `${INTERNAL_PREFIX}reload` }, script: `${INTERNAL_PREFIX}app.js` })
      const assets = memoryAssets(files)
      handler = async (req) => {
        const url = new URL(req.url)
        if (url.pathname === `${INTERNAL_PREFIX}reload`) {
          const sse = createSSE({ retry: 300 })
          sse.send('hello', JSON.stringify({ id: buildId }))
          return new Response(sse.stream, { headers: SSE_HEADERS })
        }
        return (await assets(url.pathname, req)) ?? new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8' } })
      }
    } else {
      const project = await loadProject(target, { appDir: options.appDir })
      files.set(`${INTERNAL_PREFIX}app.js`, await bundleClient(project, { dev: true }))
      handler = createHandler({
        app: project,
        assets: chainAssets(memoryAssets(files), project.publicDir ? fsAssets([project.publicDir]) : null),
        live: createLive(project, { exposeErrors: true, onError: (e) => console.error('[vuecli] session error:', e) }),
        dev: { buildId },
        onError: (e) => console.error('[vuecli]', e),
      })
      const routes = project.manifest.routes
      log(`  ${routes.filter((r) => r.page).length} page(s), ${routes.filter((r) => r.handler).length} route handler(s)${project.manifest.middleware ? ', middleware' : ''}`)
    }
  } catch (e) {
    handler = errorHandler(e, buildId)
  }
  const server = await serve(guardHost(handler, options.host), { port: options.port ?? 3000, host: options.host })
  return Object.assign(server, { buildId })
}

/**
 * DNS rebinding protection: a web page on some domain can point that domain at
 * 127.0.0.1 and read the dev server's responses (route handlers, stack traces, live
 * sessions). Requests must name the server by `localhost`, an IP address, or the
 * configured host.
 */
export function guardHost(handler: FetchHandler, configured?: string): FetchHandler {
  return async (req) => {
    if (!allowedHost(req.headers.get('host'), configured))
      return new Response('Blocked request: unknown Host header (vuecli dev only answers to localhost, IP addresses and --host).\n', {
        status: 403,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      })
    return handler(req)
  }
}

export function allowedHost(header: string | null, configured?: string): boolean {
  if (!header) return true // HTTP/1.0 clients; browsers always send Host
  const name = header.replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase()
  if (name === 'localhost' || name.endsWith('.localhost')) return true
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(name) || name.includes(':')) return true // IPv4 / IPv6 literal
  return !!configured && name === configured.toLowerCase()
}

const IGNORED = /(^|[\\/])(node_modules|\.git|\.vuecli|\.vercel|dist|\.wrangler)([\\/]|$)/
/** Files whose changes trigger a reload (sources and public assets; not logs or build output). */
const WATCHED = /\.(vue|[cm]?[jt]sx?|json|html|css|svg|png|jpe?g|gif|webp|avif|ico|txt|md|wasm|woff2?)$/i

export interface SupervisorOptions {
  /** Directory to watch. */
  watchDir: string
  /** argv for the worker (`process.execPath` is prepended). */
  args: string[]
  /** Inherit the terminal (terminal mode: the worker owns stdin/stdout). */
  terminal?: boolean
  log?(msg: string): void
}

/**
 * Runs `node <args>` and restarts it whenever a file under `watchDir`
 * changes (debounced). Resolves when the worker exits on its own (not
 * because of a restart), e.g. ctrl+c in terminal mode.
 */
export function supervise(o: SupervisorOptions): Promise<number> {
  const log = o.log ?? ((m: string) => process.stderr.write(m + '\n'))
  let child: ChildProcess | null = null
  let restarting = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let watcher: FSWatcher | null = null
  return new Promise((resolveExit) => {
    const start = () => {
      child = spawn(process.execPath, o.args, { stdio: 'inherit', env: { ...process.env, VUECLI_DEV_WORKER: '1' } })
      child.on('exit', (code) => {
        if (restarting) {
          restarting = false
          log(`[vuecli] ${changed} changed — reloading`)
          start()
          return
        }
        if (code !== 0) {
          log(`[vuecli] dev server exited (${code}); waiting for changes…`)
          return
        }
        watcher?.close()
        resolveExit(code ?? 0)
      })
    }
    let changed = ''
    const restart = (file: string) => {
      changed = file
      if (child && child.exitCode === null && child.signalCode === null) {
        restarting = true
        child.kill('SIGTERM')
      } else {
        log(`[vuecli] ${file} changed — restarting`)
        start()
      }
    }
    watcher = watch(o.watchDir, { recursive: true }, (_ev, file) => {
      const name = String(file ?? '')
      if (!name || IGNORED.test(name) || !WATCHED.test(name)) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => restart(name), 80)
    })
    const stop = () => {
      watcher?.close()
      child?.kill('SIGTERM')
      process.exit(0)
    }
    if (!o.terminal) {
      process.on('SIGINT', stop)
      process.on('SIGTERM', stop)
    } else process.on('SIGTERM', stop)
    start()
  })
}
