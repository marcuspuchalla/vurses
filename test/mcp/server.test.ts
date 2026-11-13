import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { ResourceUpdatedNotificationSchema } from '@modelcontextprotocol/sdk/types.js'
import { defineComponent, h } from 'vue'
import { createRouter, createMemoryHistory, RouterView, type Router } from 'vue-router'
import { createMcpServer, type VursesMcpServer } from '../../src/mcp/server.js'
import FixtureApp from './fixtures/app.js'

type ToolResult = { content: { type: string; text: string }[]; isError?: boolean }

let mcp: VursesMcpServer
let client: Client

async function connect(opts: Parameters<typeof createMcpServer>[0]) {
  mcp = await createMcpServer(opts)
  const [a, b] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: 'test', version: '1.0.0' })
  await Promise.all([mcp.server.connect(a), client.connect(b)])
}

async function call(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  return (await client.callTool({ name, arguments: args })) as ToolResult
}
const textOf = (r: ToolResult) => r.content.map((c) => c.text).join('\n')

afterEach(async () => {
  await client?.close()
  await mcp?.close()
})

describe('MCP server (entry mode)', () => {
  beforeEach(() => connect({ component: FixtureApp, columns: 50, rows: 10 }))

  it('lists tools and resources', async () => {
    const { tools } = await client.listTools()
    const names = tools.map((t) => t.name).sort()
    expect(names).toEqual(['click', 'get_logs', 'get_tree', 'paste', 'press', 'read_frame', 'resize', 'scroll', 'type', 'wait_for'])
    expect(tools.find((t) => t.name === 'press')!.inputSchema.properties).toHaveProperty('keys')
    const { resources } = await client.listResources()
    expect(resources.map((r) => r.uri).sort()).toEqual(['vurses://frame', 'vurses://frame.ansi', 'vurses://tree'])
    expect(client.getInstructions()).toContain('read_frame')
  })

  it('reads the frame as text, ANSI and styled spans', async () => {
    const plain = textOf(await call('read_frame'))
    expect(plain).toMatch(/^--- frame 50x10 ---\nHello MCP/)
    expect(plain).toContain('Count: 0')
    const ansi = textOf(await call('read_frame', { ansi: true }))
    expect(ansi).toContain('\x1b[0;1;31mCount: 0')
    const styled = await call('read_frame', { with_styles: true })
    const json = JSON.parse(styled.content[1].text)
    expect(json.size).toEqual({ columns: 50, rows: 10 })
    expect(json.spans).toContainEqual(expect.objectContaining({ row: 1, col: 0, text: 'Count: 0', fg: '#cd3131', bold: true }))
  })

  it('types, presses keys and returns the new frame', async () => {
    const t = textOf(await call('type', { text: 'Ada' }))
    expect(t).toMatch(/^typed "Ada"\n--- frame/)
    expect(t).toContain('Ada')
    const p = textOf(await call('press', { keys: 'enter' }))
    expect(p).toContain('Submitted: Ada')
    const quiet = textOf(await call('press', { keys: ['backspace'], times: 3, frame: false }))
    expect(quiet).toBe('pressed backspace, backspace, backspace')
    expect(textOf(await call('read_frame'))).not.toContain('Ada ')
  })

  it('rejects invalid keys with a coded error', async () => {
    const r = await call('press', { keys: ['tab', 'hyper+x'] })
    expect(r.isError).toBe(true)
    expect(textOf(r)).toMatch(/^VC115: Invalid key "hyper\+x"/)
    expect(textOf(r)).toContain('docs/errors.md#vc115')
  })

  it('pastes text', async () => {
    const r = textOf(await call('paste', { text: 'pasted!' }))
    expect(r).toContain('pasted 7 characters')
    expect(r).toContain('pasted!')
  })

  it('clicks by text and by coordinates', async () => {
    const r = textOf(await call('click', { text: 'Add' }))
    expect(r).toMatch(/clicked "Add" at \d+,\d+/)
    expect(r).toContain('Count: 2')
    const [, x, y] = /at (\d+),(\d+)/.exec(r)!
    expect(textOf(await call('click', { x: Number(x), y: Number(y) }))).toContain('Count: 4')
    const missing = await call('click', { text: 'Nope' })
    expect(missing.isError).toBe(true)
    expect(textOf(missing)).toContain('VC113')
  })

  it('scrolls at a text position', async () => {
    const r = textOf(await call('scroll', { direction: 'down', amount: 3, text: 'Scroll:' }))
    expect(r).toContain('Scroll: 3')
  })

  it('resizes', async () => {
    const r = textOf(await call('resize', { columns: 30, rows: 6 }))
    expect(r).toContain('--- frame 30x6 ---')
  })

  it('waits for text to appear and times out with VC114', async () => {
    const ok = textOf(await call('wait_for', { text: 'Loaded later', timeout_ms: 2000 }))
    expect(ok).toMatch(/"Loaded later" found after \d+ms/)
    const gone = textOf(await call('wait_for', { text: 'nothing like this', gone: true, frame: false }))
    expect(gone).toMatch(/gone/)
    const timeout = await call('wait_for', { text: 'never', timeout_ms: 100 })
    expect(timeout.isError).toBe(true)
    expect(textOf(timeout)).toContain('VC114')
  })

  it('returns the component and element trees', async () => {
    const tree = textOf(await call('get_tree'))
    expect(tree).toMatch(/^<FixtureApp#\d+> \[0,0 40x\d+\]/m)
    expect(tree).toMatch(/<Counter#\d+> \[0,1 40x3\] step=2/)
    const json = JSON.parse(textOf(await call('get_tree', { format: 'json' })))
    expect(json[0].name).toBe('FixtureApp')
    const els = textOf(await call('get_tree', { kind: 'elements', depth: 2 }))
    expect(els).toMatch(/^tui-root#\d+ \[0,0 50x10\]/)
  })

  it('returns captured console logs', async () => {
    const logs = textOf(await call('get_logs'))
    expect(logs).toMatch(/log {3}fixture mounted/)
    expect(logs).toMatch(/warn {2}a warning/)
    expect(textOf(await call('get_logs', { level: ['warn'] }))).not.toContain('fixture mounted')
    await call('get_logs', { since_last: true })
    expect(textOf(await call('get_logs', { since_last: true }))).toBe('(no logs)')
    await call('get_logs', { clear: true })
    expect(textOf(await call('get_logs'))).toBe('(no logs)')
  })

  it('serves the frame resource and notifies subscribers', async () => {
    const res = await client.readResource({ uri: 'vurses://frame' })
    expect((res.contents[0] as { text: string }).text).toContain('Hello MCP')
    const tree = await client.readResource({ uri: 'vurses://tree' })
    expect((tree.contents[0] as { text: string }).text).toContain('<Counter#')
    const updated = new Promise<string>((resolve) =>
      client.setNotificationHandler(ResourceUpdatedNotificationSchema, (n) => resolve(n.params.uri)),
    )
    await client.subscribeResource({ uri: 'vurses://frame' })
    await call('click', { text: 'Add', frame: false })
    expect(await updated).toBe('vurses://frame')
  })

  it('does not register router tools without a router', async () => {
    const r = await call('navigate', { path: '/' })
    expect(r.isError).toBe(true)
  })
})

describe('MCP server (router mode)', () => {
  let router: Router
  beforeEach(async () => {
    const page = (title: string) => defineComponent({ name: title, render: () => h('text', null, `Page ${title}`) })
    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: page('Home') },
        { path: '/about', component: page('About') },
        { path: '/users/:id', component: defineComponent({ name: 'User', render() { return h('text', null, `User ${this.$route.params.id}`) } }) },
      ],
    })
    const Root = defineComponent({ name: 'Root', render: () => h(RouterView) })
    await connect({
      component: Root,
      columns: 30,
      rows: 4,
      setup: async (app) => {
        app.use(router)
        await router.push('/')
      },
      getRouter: () => router,
      manifest: {
        appDir: '/app',
        routes: [
          { path: '/', pattern: '/', page: '/app/page.vue', layouts: [], params: [] },
          { path: '/about', pattern: '/about', page: '/app/about/page.vue', layouts: [], params: [] },
          { path: '/users/:id', pattern: '/users/[id]', page: '/app/users/[id]/page.vue', layouts: [], params: ['id'] },
        ],
      } as never,
    })
  })

  it('lists routes', async () => {
    const r = textOf(await call('list_routes'))
    expect(r).toBe(['current: /', '/  (page: /)', '/about  (page: /about)', '/users/:id  (page: /users/[id], params: id)'].join('\n'))
  })

  it('navigates, goes back and forward', async () => {
    expect(textOf(await call('read_frame'))).toContain('Page Home')
    expect(textOf(await call('navigate', { path: '/about' }))).toContain('Page About')
    const u = textOf(await call('navigate', { path: '/users/42' }))
    expect(u).toMatch(/^navigated to \/users\/42/)
    expect(u).toContain('User 42')
    const back = textOf(await call('back'))
    expect(back).toMatch(/^back: \/about/)
    expect(back).toContain('Page About')
    const fwd = textOf(await call('forward'))
    expect(fwd).toContain('User 42')
  })
})
