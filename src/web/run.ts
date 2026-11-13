/**
 * Runs a web app built by `buildWebApp` in the terminal.
 */
import { safeTitle } from '../render/sanitize.js'
import { register } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { MountOptions, TuiApp } from '../app/app.js'
import type { WebBuild } from './build.js'

export interface RunWebOptions {
  mount?: MountOptions
  route?: string
  dark?: boolean
  /** Root of the app (localStorage is persisted under node_modules/.vurses-web-cache). */
  root: string
  /** Where relative fetch() URLs go when no Vite proxy rule matches (`--origin`). */
  origin?: string
}

export async function runWebApp(build: WebBuild, o: RunWebOptions): Promise<TuiApp> {
  // one Vue for everyone: the app's
  register(new URL('./hooks.js', import.meta.url).href, {
    data: { appParent: pathToFileURL(join(o.root, 'package.json')).href, vueParent: pathToFileURL(join(build.vueDir, 'index.js')).href },
  })
  process.env.NODE_ENV ??= 'production'
  // like a browser tab: an error thrown in a timer or an unhandled rejection is logged,
  // the page keeps running (in Node it would end the process)
  process.on('uncaughtException', (e) => console.error('[vurses web] uncaught error:', e))
  process.on('unhandledRejection', (e) => console.error('[vurses web] unhandled rejection:', e))
  const { setWebConfig, current } = await import('./app.js')
  const { installGlobals } = await import('./globals.js')
  const dark = o.dark ?? true
  let resolveMount!: (app: TuiApp) => void
  const mounted = new Promise<TuiApp>((r) => (resolveMount = r))
  setWebConfig({
    html: build.html,
    css: build.css,
    mount: o.mount ?? {},
    dark,
    route: o.route,
    storageFile: join(o.root, 'node_modules', '.vurses-web-cache', 'localStorage.json'),
    onMount: (app) => resolveMount(app),
  })
  current.globals = installGlobals({
    storageFile: join(o.root, 'node_modules', '.vurses-web-cache', 'localStorage.json'),
    url: `http://localhost${o.route ?? '/'}`,
    scope: () => current.scope,
    proxy: build.proxy,
    origin: o.origin,
    size: () => current.runtime?.ctx.size ?? { columns: process.stdout.columns ?? 80, rows: process.stdout.rows ?? 24 },
    dark,
    onTitle: (t) => {
      if (process.stdout.isTTY) process.stdout.write(`\x1b]2;${safeTitle(t)}\x07`)
    },
  })
  await import(pathToFileURL(build.entry).href)
  return Promise.race([
    mounted,
    new Promise<TuiApp>((_, rej) => setTimeout(() => rej(new Error('the app did not call app.mount() within 10s')), 10_000)),
  ])
}
