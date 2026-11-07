/**
 * Integration: real node:http servers, SSE over the network, and (when
 * Playwright + Chromium are available) a real browser rendering into
 * console.log with %c spans.
 */
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { serve, type RunningServer } from '../../src/server/node.js'
import { startDevServer } from '../../src/server/dev.js'
import { fixtureHandler } from './helpers.js'
import { FIXTURE } from './helpers.js'
import { ScreenState } from '../../src/targets/protocol.js'
import { gridText } from '../../src/targets/grid.js'

function loadPlaywright(): any {
  const req = createRequire(import.meta.url)
  for (const id of ['playwright', join(dirname(dirname(process.execPath)), 'lib', 'node_modules', 'playwright')]) {
    try {
      return req(id)
    } catch {
      /* next */
    }
  }
  return null
}

describe('node server: SSE stream + POST input over HTTP', () => {
  let server: RunningServer
  beforeAll(async () => {
    const { handler } = await fixtureHandler()
    server = await serve(handler, { port: 0, host: '127.0.0.1' })
  })
  afterAll(() => server.close())

  it('streams frames, applies input, cleans up on disconnect', async () => {
    const ac = new AbortController()
    const res = await fetch(`${server.url}/_vuecli/stream?path=/live&cols=40&rows=5`, { signal: ac.signal })
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/)
    const reader = res.body!.getReader()
    const dec = new TextDecoder()
    const st = new ScreenState()
    let sid = ''
    let buf = ''
    const until = async (cond: () => boolean) => {
      const deadline = Date.now() + 5000
      while (!cond()) {
        if (Date.now() > deadline) throw new Error('timeout: ' + gridText(st.screen))
        const { value, done } = await reader.read()
        if (done) throw new Error('stream closed')
        buf += dec.decode(value, { stream: true })
        let i
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i)
          buf = buf.slice(i + 2)
          const ev = /^event: (\w+)/m.exec(block)?.[1]
          const data = block.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n')
          if (ev === 'hello') sid = JSON.parse(data).sid
          if (ev === 'frame') st.apply(JSON.parse(data))
        }
      }
    }
    await until(() => gridText(st.screen).includes('typed: |'))
    const post = await fetch(`${server.url}/_vuecli/input`, { method: 'POST', body: JSON.stringify({ sid, data: 'xyz' }) })
    expect(post.status).toBe(204)
    await until(() => gridText(st.screen).includes('typed: xyz|'))
    ac.abort()
    await new Promise((r) => setTimeout(r, 100))
    const gone = await fetch(`${server.url}/_vuecli/input`, { method: 'POST', body: JSON.stringify({ sid, data: 'a' }) })
    expect(gone.status).toBe(404) // session ended with the connection
  })
})

const pw = loadPlaywright()
describe.skipIf(!pw)('real browser (Chromium via Playwright)', () => {
  let server: RunningServer
  let browser: any
  beforeAll(async () => {
    server = await startDevServer({ entry: FIXTURE, port: 0, host: '127.0.0.1', log: () => {} })
    browser = await pw.chromium.launch()
  }, 60000)
  afterAll(async () => {
    await browser?.close()
    await server?.close()
  })

  async function open(path: string) {
    const page = await browser.newPage({ viewport: { width: 900, height: 500 }, deviceScaleFactor: 1 })
    const frames: { text: string; args: number; styles: string[] }[] = []
    const errors: string[] = []
    page.on('pageerror', (e: Error) => errors.push(e.message))
    page.on('console', async (m: any) => {
      if (m.type() !== 'log' || m.args().length < 2) return
      frames.push({ text: m.text(), args: m.args().length, styles: [] })
    })
    await page.goto(server.url + path)
    return { page, frames, errors }
  }
  const waitFor = async (cond: () => boolean, ms = 5000) => {
    const end = Date.now() + ms
    while (!cond()) {
      if (Date.now() > end) throw new Error('timeout')
      await new Promise((r) => setTimeout(r, 50))
    }
  }

  it('client route: renders into console.log with %c spans; typing reaches the app', async () => {
    const { page, frames, errors } = await open('/echo')
    await waitFor(() => frames.some((f) => f.text.includes('echo:|')))
    const f = frames.find((x) => x.text.includes('echo:|'))!
    expect(f.text.startsWith('%c')).toBe(true)
    expect(f.args).toBe((f.text.match(/%c/g) ?? []).length + 1) // one CSS arg per %c
    await page.click('body')
    await page.keyboard.type('hi!')
    await page.keyboard.press('Enter')
    await waitFor(() => frames.some((x) => x.text.includes('echo:hi!<enter>|')))
    // dirty gate: an idle app stops logging
    const n = frames.length
    await new Promise((r) => setTimeout(r, 400))
    expect(frames.length).toBe(n)
    expect(errors).toEqual([])
    await page.close()
  }, 30000)

  it('console spans carry CSS colors and weights', async () => {
    const { page, frames } = await open('/echo')
    await waitFor(() => frames.length > 0)
    // intercept the next console frame inside the page to inspect its CSS arguments
    const styles: string[] = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const orig = console.log
          console.log = (...a: unknown[]) => {
            console.log = orig
            resolve(a.slice(1) as string[])
          }
          document.querySelector('textarea')!.focus()
          document.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        }),
    )
    expect(styles.length).toBeGreaterThan(0)
    expect(styles.every((s) => /^color:#[0-9a-f]{6};background:#[0-9a-f]{6}/.test(s))).toBe(true)
    expect(styles.some((s) => s.includes('font-weight:bold'))).toBe(true)
    await page.close()
  }, 30000)

  it('server route: frame player paints the shell, streams the session, input round-trips', async () => {
    const { page, frames, errors } = await open('/live?view=dom')
    await waitFor(() => frames.some((f) => f.text.includes('typed: |')))
    await page.click('body')
    await page.keyboard.type('abc')
    await waitFor(() => frames.some((f) => f.text.includes('typed: abc|')))
    // the DOM view (?view=dom) mirrors the same screen
    await page.waitForFunction(() => document.querySelector('pre.vuecli-screen')?.textContent?.includes('typed: abc|'))
    expect(errors).toEqual([])
    await page.close()
  }, 30000)
})
