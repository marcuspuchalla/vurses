import { join } from 'node:path'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { discoverRoutes, findAppDir, scanHandlerMethods, scanPageExports } from '../../src/router/discover.js'
import { buildPath, compareSpecificity, matchPattern, matchRoute } from '../../src/router/match.js'

const fixtures = join(import.meta.dirname, 'fixtures')
const appDir = join(fixtures, 'app')

describe('discoverRoutes', async () => {
  const m = await discoverRoutes(appDir)
  const byPattern = Object.fromEntries(m.routes.map((r) => [r.pattern, r]))

  it('finds pages, handlers, root layout, not-found and middleware', () => {
    expect(m.appDir).toBe(appDir)
    expect(m.rootLayout).toBe(join(appDir, 'layout.ts'))
    expect(m.notFound).toBe(join(appDir, 'not-found.ts'))
    expect(m.middleware).toBe(join(fixtures, 'middleware.ts'))
    expect(m.root?.dir).toBe('')
    expect(Object.keys(byPattern).sort()).toEqual(
      [
        '/',
        '/about',
        '/api/hello',
        '/boom',
        '/docs/[...slug]',
        '/go-home',
        '/missing',
        '/pricing',
        '/sfc',
        '/shop/[[...path]]',
        '/slow',
        '/users/[id]',
        '/users/[id]/settings',
        '/users/new',
      ].sort(),
    )
  })

  it('ignores private (_x) and parallel (@x) folders', () => {
    expect(m.routes.some((r) => r.page?.includes('_private') || r.page?.includes('@modal'))).toBe(false)
  })

  it('builds vue-router style paths and params', () => {
    expect(byPattern['/users/[id]'].path).toBe('/users/:id')
    expect(byPattern['/users/[id]'].params).toEqual(['id'])
    expect(byPattern['/docs/[...slug]'].path).toBe('/docs/:slug(.*)+')
    expect(byPattern['/docs/[...slug]'].catchAll).toBe('slug')
    expect(byPattern['/shop/[[...path]]'].path).toBe('/shop/:path(.*)*')
    expect(byPattern['/shop/[[...path]]'].optionalCatchAll).toBe(true)
  })

  it('collects layouts outermost first, through route groups', () => {
    expect(byPattern['/users/[id]/settings'].layouts).toEqual([join(appDir, 'layout.ts'), join(appDir, 'users/layout.ts')])
    expect(byPattern['/pricing'].layouts).toEqual([join(appDir, 'layout.ts'), join(appDir, '(marketing)/layout.ts')])
    expect(byPattern['/pricing'].segments!.map((s) => s.dir)).toEqual(['', '(marketing)'])
  })

  it('records nearest loading / error and per-segment params', () => {
    expect(byPattern['/slow'].loading).toBe(join(appDir, 'slow/loading.ts'))
    expect(byPattern['/boom'].error).toBe(join(appDir, 'boom/error.ts'))
    expect(byPattern['/about'].loading).toBeUndefined()
    const segs = byPattern['/users/[id]'].segments!
    expect(segs.map((s) => [s.dir, s.params])).toEqual([
      ['', []],
      ['users', []],
    ])
  })

  it('detects runtime exports and handler methods statically', () => {
    expect(byPattern['/about'].runtime).toBe('server')
    expect(byPattern['/api/hello'].handler).toBe(join(appDir, 'api/hello/route.ts'))
    expect(byPattern['/api/hello'].page).toBeUndefined()
    expect(byPattern['/api/hello'].methods).toEqual(['GET', 'POST'])
  })

  it('sorts routes by specificity', () => {
    const order = m.routes.map((r) => r.pattern)
    expect(order.indexOf('/users/new')).toBeLessThan(order.indexOf('/users/[id]'))
    expect(order.indexOf('/users/[id]')).toBeLessThan(order.indexOf('/users/[id]/settings'))
  })

  it('matches URLs like Next.js', () => {
    const at = (p: string) => {
      const r = matchRoute(m, p)
      return r && [r.route.pattern, r.params]
    }
    expect(at('/')).toEqual(['/', {}])
    expect(at('/users/new')).toEqual(['/users/new', {}])
    expect(at('/users/42')).toEqual(['/users/[id]', { id: '42' }])
    expect(at('/users/42/')).toEqual(['/users/[id]', { id: '42' }])
    expect(at('/users/a%20b')).toEqual(['/users/[id]', { id: 'a b' }])
    expect(at('/docs')).toBeNull()
    expect(at('/docs/a/b/c')).toEqual(['/docs/[...slug]', { slug: ['a', 'b', 'c'] }])
    expect(at('/shop')).toEqual(['/shop/[[...path]]', {}])
    expect(at('/shop/x/y')).toEqual(['/shop/[[...path]]', { path: ['x', 'y'] }])
    expect(at('/pricing')).toEqual(['/pricing', {}])
    expect(at('/nope')).toBeNull()
    expect(at('/api/hello')).toBeNull() // handler-only route is not a page
    expect(matchRoute(m, '/api/hello', { kind: 'handler' })?.route.pattern).toBe('/api/hello')
  })
})

describe('discovery edge cases', () => {
  it('throws on conflicting routes (route groups resolving to the same URL)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vurses-router-'))
    try {
      for (const g of ['(a)', '(b)']) {
        await mkdir(join(dir, 'app', g, 'x'), { recursive: true })
        await writeFile(join(dir, 'app', g, 'x', 'page.ts'), 'export default {}')
      }
      await expect(discoverRoutes(join(dir, 'app'))).rejects.toThrow(/conflicting routes/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('finds the app dir (app/, src/app/, or the dir itself) and proxy.ts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vurses-router-'))
    try {
      await mkdir(join(dir, 'src', 'app'), { recursive: true })
      await writeFile(join(dir, 'src', 'app', 'page.vue'), '<template><Text>hi</Text></template>')
      await writeFile(join(dir, 'src', 'proxy.ts'), 'export function proxy() {}')
      expect(await findAppDir(dir)).toBe(join(dir, 'src', 'app'))
      expect(await findAppDir(join(dir, 'src', 'app'))).toBe(join(dir, 'src', 'app'))
      expect(await findAppDir(join(dir, 'src'))).toBe(join(dir, 'src', 'app'))
      expect(await findAppDir(join(dir, 'nope'))).toBeNull()
      const m = await discoverRoutes(join(dir, 'src', 'app'))
      expect(m.middleware).toBe(join(dir, 'src', 'proxy.ts'))
      expect(m.routes.map((r) => r.page)).toEqual([join(dir, 'src', 'app', 'page.vue')])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects a missing app dir', async () => {
    await expect(discoverRoutes('/definitely/not/here')).rejects.toThrow(/not found/)
  })
})

describe('pattern helpers', () => {
  it('compares specificity', () => {
    const sorted = ['/[[...all]]', '/[...all]', '/[id]', '/about', '/'].sort(compareSpecificity)
    expect(sorted).toEqual(['/', '/about', '/[id]', '/[...all]', '/[[...all]]'])
  })
  it('matches and builds paths', () => {
    expect(matchPattern('/a/[b]/[...c]', '/a/1/2/3')).toEqual({ b: '1', c: ['2', '3'] })
    expect(buildPath('/users/[id]', { id: 'a b' })).toBe('/users/a%20b')
    expect(buildPath('/docs/[...slug]', { slug: ['x', 'y'] })).toBe('/docs/x/y')
    expect(buildPath('/shop/[[...p]]')).toBe('/shop')
    expect(() => buildPath('/users/[id]')).toThrow(/missing param/)
  })
  it('scans module exports', () => {
    expect(scanPageExports(`export const runtime = 'client'\nexport const revalidate = 60`)).toEqual({ runtime: 'client', revalidate: 60 })
    expect(scanPageExports(`export const revalidate = false`)).toEqual({ revalidate: false })
    expect(scanHandlerMethods(`export function GET(){}\nconst DELETE=1\nexport { DELETE, x as PUT }`)).toEqual(['GET', 'PUT', 'DELETE'])
  })
})

describe('scanPageExports (integration fix)', () => {
  it('ignores template text and comments in SFCs', async () => {
    const { scanPageExports } = await import('../../src/router/discover.js')
    const sfc = `<script setup>const x = 1 // export const runtime = 'server'</script>
<template><Text>Write export const runtime = 'server' in your page</Text></template>`
    expect(scanPageExports(sfc)).toEqual({})
    const real = `<script>export const runtime = 'server'; export const revalidate = 30</script><template><Text/></template>`
    expect(scanPageExports(real)).toEqual({ runtime: 'server', revalidate: 30 })
  })
})
