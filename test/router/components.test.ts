import { defineComponent, h } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import { render, type RenderResult } from '../../src/testing.js'
import { createAppRouter } from '../../src/router/router.js'
import { Link, NavLink, Outlet } from '../../src/components/router.js'
import { useParams, usePathname, useRouter, useSearchParams } from '../../src/router/composables.js'
import type { RouteManifest } from '../../src/router/types.js'

let r: RenderResult | null = null
afterEach(() => {
  r?.unmount()
  r = null
})

const until = async (cond: () => boolean, ms = 2000) => {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timeout:\n' + r?.lastFrame())
    await new Promise((res) => setTimeout(res, 5))
    await r?.settle()
  }
}

function setup(initialPath = '/') {
  const Layout = defineComponent({
    setup: () => () =>
      h('tui-box', { flexDirection: 'column' }, [
        h(NavLink, { href: '/', label: 'Home', exact: true }),
        h(NavLink, { href: '/items', label: 'Items', hint: '^I' }),
        h(Link, { href: '/items/2?sort=asc', activeClass: 'underline', label: 'Second' }),
        h(Outlet),
      ]),
  })
  const Home = defineComponent({ setup: () => () => h('tui-text', null, 'HOME') })
  const Item = defineComponent({
    setup() {
      const params = useParams<{ id: string }>()
      const sp = useSearchParams()
      const pathname = usePathname()
      const router = useRouter()
      return () =>
        h('tui-box', { flexDirection: 'column' }, [
          h('tui-text', null, `ITEM ${params.value.id} sort=${sp.value.get('sort')} at ${pathname.value}`),
          h(Link, { href: { pathname: '/items/3', query: { sort: 'desc' } } }, { default: ({ focused }: { focused: boolean }) => (focused ? '[next]' : 'next') }),
          h('tui-box', { onClick: () => router.back() }, [h('tui-text', null, '<back>')]),
        ])
    },
  })
  const files: Record<string, Record<string, unknown>> = {
    '/layout': { default: Layout, metadata: { title: { template: '%s | T', default: 'T' } } },
    '/home': { default: Home },
    '/items': { default: Home },
    '/item': { default: Item, generateMetadata: ({ params }: { params: { id: string } }) => ({ title: `Item ${params.id}` }) },
  }
  const manifest: RouteManifest = {
    appDir: '/',
    rootLayout: '/layout',
    routes: [
      { path: '/', pattern: '/', page: '/home', layouts: ['/layout'], params: [] },
      { path: '/items', pattern: '/items', page: '/items', layouts: ['/layout'], params: [] },
      { path: '/items/:id', pattern: '/items/[id]', page: '/item', layouts: ['/layout'], params: ['id'] },
    ],
  }
  const router = createAppRouter({ manifest, load: async (f) => files[f], initialPath, terminalTitle: (t) => `vc: ${t}` })
  return { router }
}

describe('Link / NavLink / Outlet', () => {
  it('marks the active NavLink and renders hints', async () => {
    const { router } = setup('/')
    r = await render(router.component, { columns: 40, rows: 8 })
    await until(() => r!.lastFrame().includes('HOME'))
    const lines = r.lastFrame().split('\n')
    expect(lines[0]).toMatch(/^▌ Home/)
    expect(lines[1]).toMatch(/^ {2}Items +\^I/)
    await router.push('/items/2?sort=asc')
    await until(() => r!.lastFrame().includes('ITEM 2'))
    const after = r.lastFrame().split('\n')
    expect(after[0]).toMatch(/^ {2}Home/) // exact: not active on /items/2
    expect(after[1]).toMatch(/^▌ Items/) // prefix match
    expect(r.lastFrame()).toContain('ITEM 2 sort=asc at /items/2')
    // activeClass applied to the active Link
    const p = r.locate('Second')!
    const buf = r.buffer()
    expect(buf.flags[p.y * buf.width + p.x] & 8).toBe(8)
  })

  it('object hrefs, slot props and click navigation; metadata templates', async () => {
    const { router } = setup('/items/2')
    r = await render(router.component, { columns: 40, rows: 8 })
    await until(() => r!.lastFrame().includes('ITEM 2'))
    expect(router.route.meta.metadata.title).toBe('Item 2 | T')
    const p = r.locate('next')!
    await r.click(p.x, p.y)
    await until(() => r!.lastFrame().includes('ITEM 3 sort=desc'))
    // the page remounted (new pathname); tab to the link to see the `focused` slot prop
    for (let i = 0; i < 6 && !r.lastFrame().includes('[next]'); i++) await r.press('tab')
    expect(r.lastFrame()).toContain('[next]')
    expect(router.route.href).toBe('/items/3?sort=desc')
    const b = r.locate('<back>')!
    await r.click(b.x, b.y)
    await until(() => r!.lastFrame().includes('ITEM 2'))
  })

  it('Link outside of a router renders and warns instead of throwing', async () => {
    r = await render(defineComponent({ setup: () => () => h(Link, { href: '/x' }, () => 'orphan') }), { columns: 20, rows: 2 })
    expect(r.lastFrame()).toContain('orphan')
  })
})
