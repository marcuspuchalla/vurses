import { afterEach, describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { HeadlessSession, parseKey } from '../../src/mcp/session.js'
import { lineSplitter, servePreview } from '../../src/mcp/jsonl.js'
import { loadApp, loadEntry } from '../../src/mcp/load.js'
import { isVuecliError } from '../../src/errors.js'
import FixtureApp from './fixtures/app.js'

const fixture = fileURLToPath(new URL('./fixtures/app.js', import.meta.url))
let session: HeadlessSession | null = null
afterEach(() => {
  session?.close()
  session = null
})

describe('parseKey', () => {
  it('parses names, modifiers and aliases', () => {
    expect(parseKey('enter')).toMatchObject({ name: 'enter', ctrl: false })
    expect(parseKey('Return').name).toBe('enter')
    expect(parseKey('esc').name).toBe('escape')
    expect(parseKey('ArrowUp').name).toBe('up')
    expect(parseKey('shift+tab')).toMatchObject({ name: 'tab', shift: true })
    expect(parseKey('Ctrl+S')).toMatchObject({ name: 's', ctrl: true, char: '' })
    expect(parseKey('cmd+k')).toMatchObject({ name: 'k', meta: true })
    expect(parseKey('A')).toMatchObject({ name: 'A', char: 'A', shift: true })
    expect(parseKey(' ')).toMatchObject({ name: 'space', char: ' ' })
    expect(parseKey('+')).toMatchObject({ char: '+' })
    expect(parseKey('ctrl++')).toMatchObject({ name: '+', ctrl: true })
  })
  it('rejects malformed combos with VC115', () => {
    for (const k of ['', 'ctrl+', 'hyper+x']) {
      try {
        parseKey(k)
        expect.unreachable()
      } catch (e) {
        expect(isVuecliError(e, 'VC115')).toBe(true)
      }
    }
  })
})

describe('HeadlessSession', () => {
  it('renders live when state changes (timers)', async () => {
    session = await HeadlessSession.mount(FixtureApp, { columns: 50, rows: 10 })
    const frames: string[] = []
    session.onFrame((b) => frames.push(b.toString()))
    await new Promise((r) => setTimeout(r, 150))
    expect(frames.some((f) => f.includes('Loaded later'))).toBe(true)
  })

  it('does not render live with live: false', async () => {
    session = await HeadlessSession.mount(FixtureApp, { columns: 50, rows: 10, live: false })
    let n = 0
    session.onFrame(() => n++)
    await new Promise((r) => setTimeout(r, 120))
    expect(n).toBe(0)
    expect(session.text()).toContain('Loaded later')
  })

  it('captures console output and restores console on close', async () => {
    const original = console.log
    session = await HeadlessSession.mount(FixtureApp, { columns: 50, rows: 10 })
    expect(console.log).not.toBe(original)
    expect(session.logs().map((l) => l.message)).toContain('fixture mounted')
    session.close()
    expect(console.log).toBe(original)
    expect(session.isClosed).toBe(true)
  })

  it('types newlines as enter and writes raw input', async () => {
    session = await HeadlessSession.mount(FixtureApp, { columns: 50, rows: 10 })
    await session.type('Bo\n')
    expect(session.text()).toContain('Submitted: Bo')
    await session.write('x')
    expect(session.text()).toContain('Bo')
  })

  it('surfaces component errors as logs instead of crashing', async () => {
    const { defineComponent, h, ref } = await import('vue')
    const Bad = defineComponent({
      setup() {
        const boom = ref(false)
        return () => h('box', { onClick: () => (boom.value = true) }, [boom.value ? (null as any).x : h('text', null, 'ok')])
      },
    })
    session = await HeadlessSession.mount(Bad, { columns: 10, rows: 2 })
    await session.click({ text: 'ok' })
    expect(session.logs({ level: 'error' })[0].message).toMatch(/TypeError/)
  })
})

describe('JSON-lines preview protocol', () => {
  it('splits lines across chunks', () => {
    const lines: string[] = []
    const feed = lineSplitter((l) => lines.push(l))
    feed('{"a":1}\n{"b"')
    feed(':2}\r\n\n')
    expect(lines).toEqual(['{"a":1}', '{"b":2}'])
  })

  it('sends ready + frames and handles commands', async () => {
    session = await HeadlessSession.mount(FixtureApp, { columns: 50, rows: 10 })
    const out: any[] = []
    let feed: (l: string) => void = () => {}
    const stop = servePreview(session, { send: (l) => out.push(JSON.parse(l)), onLine: (fn) => ((feed = fn), () => {}) })
    expect(out[0]).toEqual({ type: 'ready', columns: 50, rows: 10 })
    expect(out[1].type).toBe('frame')
    expect(out[1].frame.lines[0]).toMatch(/^Hello MCP/)
    const wait = () => new Promise((r) => setTimeout(r, 80))
    feed(JSON.stringify({ type: 'type', text: 'Zed' }))
    feed(JSON.stringify({ type: 'key', keys: ['enter'] }))
    await wait()
    const frames = out.filter((m) => m.type === 'frame')
    expect(frames.at(-1).frame.lines.join('\n')).toContain('Submitted: Zed')
    feed('not json')
    feed(JSON.stringify({ type: 'key', keys: 'bogus+key' }))
    feed(JSON.stringify({ type: 'tree' }))
    feed(JSON.stringify({ type: 'resize', columns: 30, rows: 5 }))
    await wait()
    expect(out).toContainEqual(expect.objectContaining({ type: 'error', message: expect.stringMatching(/invalid JSON/) }))
    expect(out).toContainEqual(expect.objectContaining({ type: 'error', code: 'VC115' }))
    expect(out.find((m) => m.type === 'tree').tree[0].name).toBe('FixtureApp')
    expect(out.filter((m) => m.type === 'frame').at(-1).frame.width).toBe(30)
    expect(out.some((m) => m.type === 'log' && m.message === 'fixture mounted')).toBe(false) // logged before serve started
    feed(JSON.stringify({ type: 'exit' }))
    await wait()
    expect(out.at(-1)).toEqual({ type: 'exit' })
    stop()
  })
})

describe('loader', () => {
  it('loads an entry module default export', async () => {
    const c = await loadEntry(fixture)
    expect((c as { name: string }).name).toBe('FixtureApp')
    const app = await loadApp(fixture)
    expect(app.mode).toBe('entry')
  })
  it('fails with coded errors', async () => {
    await expect(loadApp('/nope/missing.vue')).rejects.toMatchObject({ code: 'VC110' })
    const noDefault = fileURLToPath(new URL('./fixtures/no-default.js', import.meta.url))
    await expect(loadEntry(noDefault)).rejects.toMatchObject({ code: 'VC111' })
  })
})
