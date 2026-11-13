import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { defineComponent, h } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import { render, type RenderResult } from '../../src/testing.js'
import { compileSFC } from '../../src/sfc/compile.js'
import { discoverRoutes } from '../../src/router/discover.js'
import { createAppRouter, getAppRouter, type AppRouter, type AppRouterOptions } from '../../src/router/router.js'
import type { RouteManifest } from '../../src/router/types.js'
import * as slow from './fixtures/app/slow/page.js'
import * as boom from './fixtures/app/boom/page.js'
import * as usersLayout from './fixtures/app/users/layout.js'

const appDir = join(import.meta.dirname, 'fixtures', 'app')
// inside node_modules so `import 'vue'` in compiled output resolves to the same Vue instance
const compiledDir = join(import.meta.dirname, '..', '..', 'node_modules', '.cache', 'vurses-router-test')

/** Test loader: TS/JS via import(), .vue compiled with compileSFC into a temp module. */
async function load(file: string): Promise<Record<string, unknown>> {
  if (file.endsWith('.vue')) {
    mkdirSync(compiledDir, { recursive: true })
    const out = join(compiledDir, basename(file) + '.' + Buffer.from(file).toString('hex').slice(-12) + '.mjs')
    writeFileSync(out, compileSFC(readFileSync(file, 'utf8'), file))
    return import(pathToFileURL(out).href)
  }
  return import(file)
}

let manifest: RouteManifest
let current: RenderResult | null = null
afterEach(() => {
  current?.unmount()
  current = null
})

async function mount(initialPath = '/', opts: Partial<AppRouterOptions> = {}): Promise<{ r: RenderResult; router: AppRouter }> {
  manifest ??= await discoverRoutes(appDir)
  const router = createAppRouter({ manifest, load, initialPath, ...opts })
  const r = await render(router.component, { columns: 60, rows: 12 })
  current = r
  await router.waitForIdle()
  await r.settle()
  return { r, router }
}

async function waitFor(r: RenderResult, text: string, ms = 3000) {
  const start = Date.now()
  while (Date.now() - start < ms) {
    if (r.lastFrame().includes(text)) return
    await new Promise((res) => setTimeout(res, 5))
    await r.settle()
  }
  throw new Error(`timed out waiting for "${text}". Frame:\n${r.lastFrame()}`)
}

describe('App Router rendering', () => {
  it('renders the root layout with the home page', async () => {
    const { r, router } = await mount('/')
    expect(r.lastFrame()).toContain('ROOT')
    expect(r.lastFrame()).toContain('Home page')
    expect(router.route.pathname).toBe('/')
    expect(router.route.meta.metadata.title).toBe('Home · Fixture')
    expect(router.status.value).toBe(200)
  })

  it('deep links pass params and searchParams to the page', async () => {
    const { r, router } = await mount('/users/42?tab=posts')
    expect(r.lastFrame()).toContain('User id=42 tab=posts path=/users/42')
    expect(r.lastFrame()).toContain('Users layout')
    expect(router.route.params).toEqual({ id: '42' })
    expect(router.route.searchParams.get('tab')).toBe('posts')
    expect(router.route.meta.metadata.title).toBe('User 42 · Fixture') // generateMetadata + template
    expect(router.canGoBack.value).toBe(false)
  })

  it('renders catch-all, optional catch-all and route-group pages', async () => {
    const { r, router } = await mount('/docs/a/b')
    expect(r.lastFrame()).toContain('Docs: a|b')
    await router.push('/shop')
    await waitFor(r, 'Shop: (root)')
    await router.push('/shop/x/y')
    await waitFor(r, 'Shop: x|y')
    await router.push('/pricing')
    await waitFor(r, 'Pricing page')
    expect(r.lastFrame()).toContain('Marketing')
  })

  it('renders not-found.vue for unknown paths inside the root layout', async () => {
    const { r, router } = await mount('/does/not/exist')
    expect(r.lastFrame()).toContain('ROOT')
    expect(r.lastFrame()).toContain('Custom 404')
    expect(router.route.notFound).toBe(true)
    expect(router.status.value).toBe(404)
    expect(router.route.meta.metadata.title).toBe('404: This page could not be found. · Fixture')
  })

  it('renders not-found when a page calls notFound()', async () => {
    const { r, router } = await mount('/missing')
    await waitFor(r, 'Custom 404')
    expect(router.status.value).toBe(404)
  })

  it('follows redirect() thrown during setup', async () => {
    const { r, router } = await mount('/go-home')
    await waitFor(r, 'About page')
    expect(router.route.pathname).toBe('/about')
    expect(router.lastRedirect.value?.to).toBe('/about')
  })

  it('renders compiled .vue pages with named exports (metadata)', async () => {
    const { r, router } = await mount('/sfc?n=21')
    await waitFor(r, 'SFC page n=42')
    expect(router.route.meta.metadata.title).toBe('SFC · Fixture')
  })

  it('exposes the runtime export as route meta', async () => {
    const { router } = await mount('/about')
    expect(router.route.meta.runtime).toBe('server')
  })
})

describe('App Router navigation', () => {
  it('push / back / forward with history state', async () => {
    const { r, router } = await mount('/')
    await router.push('/about')
    await waitFor(r, 'About page')
    expect(router.canGoBack.value).toBe(true)
    expect(router.canGoForward.value).toBe(false)
    router.back()
    await waitFor(r, 'Home page')
    expect(router.canGoForward.value).toBe(true)
    router.forward()
    await waitFor(r, 'About page')
    await router.replace('/users/3')
    await waitFor(r, 'User id=3')
    router.back()
    await waitFor(r, 'Home page') // /about was replaced
  })

  it('alt+left / alt+right navigate history', async () => {
    const { r, router } = await mount('/')
    await router.push('/about')
    await waitFor(r, 'About page')
    await r.press('alt+left')
    await waitFor(r, 'Home page')
    await r.press('alt+right')
    await waitFor(r, 'About page')
    // raw escape sequence from a real terminal (xterm: ESC [ 1 ; 3 D)
    await r.write('\x1b[1;3D')
    await waitFor(r, 'Home page')
  })

  it('Link click and enter navigate; active link is highlighted', async () => {
    const { r, router } = await mount('/')
    const pos = r.locate('About')!
    await r.click(pos.x, pos.y)
    await waitFor(r, 'About page')
    expect(router.route.pathname).toBe('/about')
    // the active link is bold + primary
    const p = r.locate('About')!
    const buf = r.buffer()
    expect(buf.flags[p.y * buf.width + p.x] & 1).toBe(1)
    // clicking focused the About link; shift+tab moves to Home, enter activates it
    await r.press('shift+tab')
    await r.press('enter')
    await waitFor(r, 'Home page')
  })

  it('keeps layout state across sibling navigations and remounts pages', async () => {
    const { r, router } = await mount('/users/1')
    const before = usersLayout.usersLayoutMounts
    await router.push('/users/2')
    await waitFor(r, 'User id=2')
    await router.push('/users/new')
    await waitFor(r, 'New user form')
    expect(usersLayout.usersLayoutMounts).toBe(before) // layout not remounted
    await router.push('/about')
    await waitFor(r, 'About page')
    expect(r.lastFrame()).not.toContain('Users layout')
  })

  it('shows loading.vue while an async page resolves', async () => {
    const { r, router } = await mount('/')
    void router.push('/slow')
    await waitFor(r, 'Loading slow...')
    expect(r.lastFrame()).toContain('ROOT') // layout stays visible
    slow.gate.release!()
    await waitFor(r, 'Slow page: slow data')
    await router.waitForIdle()
    expect(r.lastFrame()).not.toContain('Loading slow...')
  })

  it('error.vue catches errors and reset() retries', async () => {
    boom.state.fail = true
    const { r, router } = await mount('/boom')
    await waitFor(r, 'Boom error: kaboom')
    expect(r.lastFrame()).toContain('ROOT')
    expect(router.status.value).toBe(500)
    boom.state.fail = false
    const p = r.locate('[retry]')!
    await r.click(p.x, p.y)
    await waitFor(r, 'Boom recovered')
    expect(router.status.value).toBe(200)
  })

  it('error boundaries reset on navigation', async () => {
    boom.state.fail = true
    const { r, router } = await mount('/boom')
    await waitFor(r, 'Boom error')
    boom.state.fail = false
    await router.push('/about')
    await waitFor(r, 'About page')
    await router.push('/boom')
    await waitFor(r, 'Boom recovered')
  })

  it('refresh() remounts the current page', async () => {
    boom.state.fail = false
    const { r, router } = await mount('/boom')
    await waitFor(r, 'Boom recovered')
    boom.state.fail = true
    await router.refresh()
    await waitFor(r, 'Boom error: kaboom')
    boom.state.fail = false
  })

  it('prefetch and resolve', async () => {
    const { router } = await mount('/')
    await router.prefetch('/users/9')
    expect(router.resolve('/users/9?x=1')).toMatchObject({ pathname: '/users/9', params: { id: '9' } })
    expect(router.resolve('/nope').route).toBeNull()
  })
})

describe('middleware on client navigations', () => {
  it('redirects', async () => {
    const { r, router } = await mount('/old')
    await waitFor(r, 'About page')
    expect(router.route.pathname).toBe('/about')
    expect(router.lastRedirect.value).toMatchObject({ from: '/old', to: '/about', status: 307 })
    await router.push('/admin/users')
    await waitFor(r, 'Home page')
    expect(router.route.href).toBe('/?denied=1')
  })

  it('rewrites keep the URL but render another route', async () => {
    const { r, router } = await mount('/')
    await router.push('/rewritten')
    await waitFor(r, 'User id=7 tab=rw path=/rewritten')
    expect(router.route.pathname).toBe('/rewritten')
    expect(router.route.renderedPathname).toBe('/users/7')
  })
})

describe('integration', () => {
  it('getAppRouter(app) and $router', async () => {
    const { r, router } = await mount('/')
    expect(getAppRouter(r.app)).toBe(router)
    expect(r.app.config.globalProperties.$router).toBe(router)
  })

  it('works with a hand-written manifest and in-memory modules (browser-style loader)', async () => {
    const Layout = defineComponent({ setup: (_, { slots }) => () => h('tui-box', { flexDirection: 'column' }, [h('tui-text', null, 'MEM'), slots.default?.()]) })
    const A = defineComponent({ props: ['params'], setup: (p) => () => h('tui-text', null, `A ${(p.params as { x: string }).x}`) })
    const mods: Record<string, Record<string, unknown>> = { '/l': { default: Layout }, '/a': { default: A } }
    const router = createAppRouter({
      manifest: { appDir: '/', rootLayout: '/l', routes: [{ path: '/a/:x', pattern: '/a/[x]', page: '/a', layouts: ['/l'], params: ['x'] }] },
      load: async (f) => mods[f],
      initialPath: '/a/hello',
    })
    const r = await render(router.component, { columns: 60, rows: 10 })
    current = r
    await router.waitForIdle()
    await waitFor(r, 'A hello')
    expect(r.lastFrame()).toContain('MEM')
    await router.push('/zzz')
    await waitFor(r, 'This page could not be found')
  })

  it('shows the built-in error UI when no error.vue handles the error', async () => {
    const Bad = defineComponent({
      setup() {
        throw new Error('no handler')
      },
    })
    const router = createAppRouter({
      manifest: { appDir: '/', routes: [{ path: '/', pattern: '/', page: '/p', layouts: [], params: [] }] },
      load: async () => ({ default: Bad }),
    })
    const r = await render(router.component, { columns: 50, rows: 8 })
    current = r
    await waitFor(r, 'no handler')
    expect(r.lastFrame()).toContain('Application error')
    expect(r.lastFrame()).toContain('Try again')
  })
})
