import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fixtureHandler, readEvents } from './helpers.js'
import type { VuecliHandler } from '../../src/server/handler.js'
import { ScreenState, type FrameDelta } from '../../src/targets/protocol.js'
import { gridText } from '../../src/targets/grid.js'
import { revalidatePath } from '../../src/cache/index.js'

let handler: VuecliHandler
const req = (path: string, init?: RequestInit) => handler(new Request('http://test.local' + path, init))

beforeAll(async () => {
  ;({ handler } = await fixtureHandler())
})
afterAll(() => handler.close())

describe('fetch handler routing', () => {
  it('serves client pages as an HTML shell loading the app bundle', async () => {
    const res = await req('/')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/html/)
    const html = await res.text()
    expect(html).toContain('<script type="module" src="/_vuecli/app.js">')
    expect(html).toMatch(/"mode":"client"/)
  })

  it('serves server pages with the frame player', async () => {
    const res = await req('/live')
    const html = await res.text()
    expect(html).toContain('src="/_vuecli/player.js"')
    expect(html).toMatch(/"mode":"server"/)
    expect(html).toMatch(/"live":true/)
    expect(html).toContain('<title>Live</title>')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('runs route handlers with params, HEAD, OPTIONS and 405', async () => {
    let res = await req('/api/hello?name=vue')
    expect(await res.json()).toEqual({ hello: 'vue' })
    expect(res.headers.get('x-mw')).toBe('yes') // middleware next() headers
    res = await req('/api/hello', { method: 'POST', body: 'echo!' })
    expect(res.status).toBe(201)
    expect(await res.text()).toBe('echo!')
    res = await req('/api/users/42')
    expect(await res.json()).toEqual({ id: '42', sync: '42' })
    res = await req('/api/users/42', { method: 'HEAD' })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('')
    res = await req('/api/users/42', { method: 'OPTIONS' })
    expect(res.status).toBe(204)
    expect(res.headers.get('allow')).toBe('GET, DELETE, HEAD, OPTIONS')
    res = await req('/api/users/42', { method: 'PUT' })
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('GET, DELETE, HEAD')
  })

  it('applies middleware: redirect, response, rewrite, matcher', async () => {
    let res = await req('/old')
    expect(res.status).toBe(308)
    expect(res.headers.get('location')).toBe('http://test.local/')
    res = await req('/secret')
    expect(res.status).toBe(401)
    res = await req('/rewritten')
    expect(await res.json()).toEqual({ hello: 'rewrite' })
    res = await req('/') // not matched by config.matcher
    expect(res.headers.get('x-mw')).toBeNull()
  })

  it('serves static files from public/ and 404s', async () => {
    let res = await req('/robots.txt')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/plain/)
    expect(await res.text()).toContain('User-agent')
    const etag = res.headers.get('etag')!
    res = await req('/robots.txt', { headers: { 'if-none-match': etag } })
    expect(res.status).toBe(304)
    res = await req('/../package.json')
    expect(res.status).toBe(404)
    res = await req('/nope/nothing')
    expect(res.status).toBe(404)
    expect(await res.text()).toContain('/_vuecli/app.js') // client shell renders not-found
    res = await req('/_vuecli/missing.js')
    expect(res.status).toBe(404)
  })

  it('renders text snapshots for text clients', async () => {
    const res = await req('/static-shell', { headers: { accept: 'text/plain' } })
    expect(await res.text()).toContain('shell page')
  })
})

describe('server sessions over SSE', () => {
  it('streams hello + frames and applies POSTed input', async () => {
    const res = await req('/_vuecli/stream?path=/live&cols=30&rows=4')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/event-stream; charset=utf-8')
    expect(res.headers.get('cache-control')).toMatch(/no-cache/)
    const st = new ScreenState()
    let applied = 0
    const r1 = await readEvents(res, (ev) => {
      for (; applied < ev.length; applied++) if (ev[applied].event === 'frame') st.apply(JSON.parse(ev[applied].data) as FrameDelta)
      return gridText(st.screen).includes('typed: |')
    })
    const hello = JSON.parse(r1.events[0].data)
    expect(r1.events[0].event).toBe('hello')
    expect(hello).toMatchObject({ columns: 30, rows: 4, path: '/live' })
    expect(gridText(st.screen)).toContain('[layout]')
    expect(st.screen.width).toBe(30)
    // input
    const post = await req('/_vuecli/input', { method: 'POST', body: JSON.stringify({ sid: hello.sid, data: 'hi\r' }) })
    expect(post.status).toBe(204)
    await r1.cancel()
  })

  it('end to end: input changes subsequent frames', async () => {
    const res = await req('/_vuecli/stream?path=/live&cols=30&rows=4')
    const st = new ScreenState()
    const reader = res.body!.getReader()
    const dec = new TextDecoder()
    let buf = ''
    let sid = ''
    const pump = async (until: () => boolean) => {
      while (!until()) {
        const { value, done } = await reader.read()
        if (done) throw new Error('closed')
        buf += dec.decode(value, { stream: true })
        let i
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i)
          buf = buf.slice(i + 2)
          const ev = /event: (\w+)/.exec(block)?.[1]
          const data = block.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n')
          if (ev === 'hello') sid = JSON.parse(data).sid
          if (ev === 'frame') st.apply(JSON.parse(data))
        }
      }
    }
    await pump(() => gridText(st.screen).includes('typed: |'))
    await req('/_vuecli/input', { method: 'POST', body: JSON.stringify({ sid, data: 'abc' }) })
    await pump(() => gridText(st.screen).includes('typed: abc|'))
    await req('/_vuecli/input', { method: 'POST', body: JSON.stringify({ sid, cols: 20, rows: 3 }) })
    await pump(() => st.screen.width === 20)
    expect(gridText(st.screen)).toContain('typed: abc|')
    await reader.cancel()
    await new Promise((r) => setTimeout(r, 10))
    expect((handler.options.live!.sessions!).get(sid)).toBeUndefined() // cleaned up on disconnect
  })

  it('rejects streams for client routes, unknown sessions, and runs middleware', async () => {
    expect((await req('/_vuecli/stream?path=/')).status).toBe(404)
    expect((await req('/_vuecli/input', { method: 'POST', body: '{"sid":"x","data":"a"}' })).status).toBe(404)
    const denied = await req('/_vuecli/stream?path=/live', { headers: { 'x-deny': '1' } })
    expect(denied.status).toBe(401)
  })
})

describe('route-level revalidate', () => {
  it('caches the server-rendered first frame and revalidatePath refreshes it', async () => {
    const a = await (await req('/cached')).text()
    expect(a).toContain('render #1')
    expect(a).toMatch(/"shell":\{/)
    const b = await (await req('/cached')).text()
    expect(b).toContain('render #1')
    revalidatePath('/cached')
    const c = await (await req('/cached')).text()
    expect(c).toContain('render #2')
    const res = await req('/cached')
    expect(res.headers.get('cache-control')).toBe('public, s-maxage=60, stale-while-revalidate')
  })

  it('uses build-time shells (PPR) and works without live sessions', async () => {
    const { handler: edge } = await fixtureHandler({ shells: { '/static-shell': { frame: { n: 1, w: 10, h: 1, full: 1, r: [[0, 0, 0, 'prerendered']] }, text: 'prerendered', columns: 10, rows: 1, createdAt: 0 } } }, false)
    const html = await (await edge(new Request('http://x/static-shell'))).text()
    expect(html).toContain('prerendered')
    expect(html).toMatch(/"live":false/)
    const s = await edge(new Request('http://x/_vuecli/stream?path=/static-shell'))
    expect(s.status).toBe(501)
  })
})
