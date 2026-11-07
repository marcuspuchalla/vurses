import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/server/build.js'
import { FIXTURE } from './helpers.js'

const tmp = mkdtempSync(join(tmpdir(), 'vuecli-build-'))
const out = (a: string) => join(tmp, a)
const has = (dir: string, ...files: string[]) => files.every((f) => existsSync(join(dir, f)))

describe('vuecli build adapters', () => {
  it('static: html per client route, 404.html, app bundle, public files; warns about server features', async () => {
    const r = await buildApp({ root: FIXTURE, adapter: 'static', outDir: out('static') })
    expect(has(r.outDir, 'index.html', '404.html', '_vuecli/app.js', 'robots.txt', 'vuecli-build.json')).toBe(true)
    expect(has(r.outDir, '_vuecli/player.js')).toBe(false)
    expect(has(r.outDir, 'live/index.html')).toBe(false)
    expect(r.warnings.join('\n')).toMatch(/\/live: runtime = 'server' is not supported/)
    expect(r.warnings.join('\n')).toMatch(/route handlers/)
    expect(r.warnings.join('\n')).toMatch(/middleware/)
    expect(readFileSync(join(r.outDir, 'index.html'), 'utf8')).toContain('/_vuecli/app.js')
  }, 60000)

  let nodeDir = ''
  it('node: server.mjs + server/index.mjs + static/, prerendered shells', async () => {
    const r = await buildApp({ root: FIXTURE, adapter: 'node', outDir: out('node') })
    nodeDir = r.outDir
    expect(has(r.outDir, 'server.mjs', 'server/index.mjs', 'static/_vuecli/app.js', 'static/_vuecli/player.js', 'static/robots.txt')).toBe(true)
    expect(r.prerendered.sort()).toEqual(['/cached', '/live', '/static-shell'])
  }, 60000)

  it('node build serves requests through its bundled handler', async () => {
    const mod = await import(pathToFileURL(join(nodeDir, 'server', 'index.mjs')).href)
    const handler = mod.createServerHandler({ staticDir: join(nodeDir, 'static'), live: { idleTimeout: 0 } })
    const live = await (await handler(new Request('http://x/live'))).text()
    expect(live).toContain('typed: |') // PPR shell embedded in the page
    expect(live).toMatch(/"live":true/)
    expect(await (await handler(new Request('http://x/api/hello'))).json()).toEqual({ hello: 'world' })
    expect((await handler(new Request('http://x/_vuecli/player.js'))).status).toBe(200)
    expect((await handler(new Request('http://x/old'))).status).toBe(308)
    const sse = await handler(new Request('http://x/_vuecli/stream?path=/live&cols=20&rows=2'))
    expect(sse.headers.get('content-type')).toMatch(/event-stream/)
    await sse.body!.cancel()
    handler.close()
  }, 30000)

  it('bun: adds bun.mjs (Bun.serve)', async () => {
    const r = await buildApp({ root: FIXTURE, adapter: 'bun', outDir: out('bun'), prerender: false })
    expect(has(r.outDir, 'bun.mjs', 'server.mjs', 'server/index.mjs', 'static/_vuecli/app.js')).toBe(true)
    expect(readFileSync(join(r.outDir, 'bun.mjs'), 'utf8')).toContain('Bun.serve(')
  }, 60000)

  it('vercel: Build Output API v3 layout with an edge function', async () => {
    const r = await buildApp({ root: FIXTURE, adapter: 'vercel', outDir: out('vercel') })
    expect(has(r.outDir, 'config.json', 'static/_vuecli/app.js', 'static/_vuecli/player.js', 'static/robots.txt', 'functions/index.func/index.js', 'functions/index.func/.vc-config.json')).toBe(true)
    expect(JSON.parse(readFileSync(join(r.outDir, 'config.json'), 'utf8')).version).toBe(3)
    expect(JSON.parse(readFileSync(join(r.outDir, 'functions/index.func/.vc-config.json'), 'utf8'))).toEqual({ runtime: 'edge', entrypoint: 'index.js' })
    const fn = readFileSync(join(r.outDir, 'functions/index.func/index.js'), 'utf8')
    expect(fn).not.toMatch(/yoga|WebAssembly/i) // edge bundles must not carry the WASM runtime
    expect(r.warnings.join()).toMatch(/prerendered frames only/)
    const handler = (await import(pathToFileURL(join(r.outDir, 'functions/index.func/index.js')).href)).default
    expect(await (await handler(new Request('http://x/api/users/7'))).json()).toEqual({ id: '7', sync: '7' })
    const page = await (await handler(new Request('http://x/live'))).text()
    expect(page).toContain('typed: |')
    expect(page).toMatch(/"live":false/)
    expect((await handler(new Request('http://x/_vuecli/stream?path=/live'))).status).toBe(501)
  }, 60000)

  it('cloudflare: worker module + wrangler.toml + public/', async () => {
    const r = await buildApp({ root: FIXTURE, adapter: 'cloudflare', outDir: out('cf') })
    expect(has(r.outDir, 'worker.js', 'wrangler.toml', 'public/_vuecli/app.js', 'public/robots.txt')).toBe(true)
    const toml = readFileSync(join(r.outDir, 'wrangler.toml'), 'utf8')
    expect(toml).toMatch(/main = "worker.js"/)
    expect(toml).toMatch(/\[assets\]\ndirectory = "\.\/public"/)
    const worker = (await import(pathToFileURL(join(r.outDir, 'worker.js')).href)).default
    expect(typeof worker.fetch).toBe('function')
    const res = await worker.fetch(new Request('http://x/api/hello?name=cf'), {}, {})
    expect(await res.json()).toEqual({ hello: 'cf' })
  }, 60000)
})
