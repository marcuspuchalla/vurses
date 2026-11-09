/**
 * Runs a web app built by `buildWebApp` in the terminal.
 */
import { register } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { MountOptions, TuiApp } from '../app/app.js'
import type { WebBuild } from './build.js'

export interface RunWebOptions {
  mount?: MountOptions
  route?: string
  dark?: boolean
  /** Root of the app (localStorage is persisted under node_modules/.vuecli-web-cache). */
  root: string
}

export async function runWebApp(build: WebBuild, o: RunWebOptions): Promise<TuiApp> {
  // one Vue for everyone: the app's
  register(new URL('./hooks.js', import.meta.url).href, {
    data: { appParent: pathToFileURL(join(o.root, 'package.json')).href, vueParent: pathToFileURL(join(build.vueDir, 'index.js')).href },
  })
  process.env.NODE_ENV ??= 'production'
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
    storageFile: join(o.root, 'node_modules', '.vuecli-web-cache', 'localStorage.json'),
    onMount: (app) => resolveMount(app),
  })
  current.globals = installGlobals({
    storageFile: join(o.root, 'node_modules', '.vuecli-web-cache', 'localStorage.json'),
    url: `http://localhost${o.route ?? '/'}`,
    scope: () => current.scope,
    size: () => current.runtime?.ctx.size ?? { columns: process.stdout.columns ?? 80, rows: process.stdout.rows ?? 24 },
    dark,
    onTitle: (t) => {
      if (process.stdout.isTTY) process.stdout.write(`\x1b]2;${t.replace(/[\x00-\x1f]/g, '')}\x07`)
    },
  })
  await import(pathToFileURL(build.entry).href)
  return Promise.race([
    mounted,
    new Promise<TuiApp>((_, rej) => setTimeout(() => rej(new Error('the app did not call app.mount() within 10s')), 10_000)),
  ])
}
