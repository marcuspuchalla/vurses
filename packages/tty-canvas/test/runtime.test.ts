import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Canvas, createEnvironment, Event, EventTarget, KeyboardEvent, MouseEvent } from '../src/index.js'
import { InputParser, play, runHtml, runScript } from '../src/node/index.js'
import { px } from './helpers.js'

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms))

describe('events', () => {
  it('captures, bubbles, supports once and on<type> handlers', () => {
    const parent = new EventTarget()
    const child = new EventTarget()
    child._eventParent = () => parent
    const log: string[] = []
    parent.addEventListener('x', () => log.push('parent-capture'), true)
    parent.addEventListener('x', () => log.push('parent-bubble'))
    child.addEventListener('x', () => log.push('child-once'), { once: true })
    ;(child as unknown as { onx: () => void }).onx = () => log.push('child-on')
    child.dispatchEvent(new Event('x', { bubbles: true }))
    child.dispatchEvent(new Event('x'))
    expect(log).toEqual(['parent-capture', 'child-once', 'child-on', 'parent-bubble', 'parent-capture', 'child-on'])
  })

  it('MouseEvent.offsetX is relative to the target rect', () => {
    const c = new Canvas(100, 50)
    c._rect = { x: 10, y: 20, width: 100, height: 50 }
    let got: number[] = []
    c.addEventListener('mousemove', (e: MouseEvent) => (got = [e.offsetX, e.offsetY, e.clientX]))
    c.dispatchEvent(new MouseEvent('mousemove', { clientX: 15, clientY: 30 }))
    expect(got).toEqual([5, 10, 15])
    expect(new KeyboardEvent('keydown', { key: 'a' }).keyCode).toBe(65)
  })
})

describe('browser environment', () => {
  it('provides document, window, rAF and canvas pixel-space pointer events', () => {
    const env = createEnvironment({ width: 64, height: 32 })
    const { document: doc, window: win } = env
    const c = doc.createElement('canvas') as Canvas
    doc.body.appendChild(c)
    c.id = 'c'
    expect(doc.getElementById('c')).toBe(c)
    expect(doc.querySelector('body > canvas#c')).toBe(c)
    expect(win.innerWidth).toBe(64)
    const seen: string[] = []
    for (const t of ['pointerdown', 'mousedown', 'mouseup', 'click', 'mousemove', 'wheel']) {
      c.addEventListener(t, (e: MouseEvent & { deltaY?: number }) => seen.push(`${t}:${e.offsetX},${e.offsetY}:${e.buttons}${t === 'wheel' ? ':' + e.deltaY : ''}`))
    }
    env.pointer({ action: 'down', x: 3, y: 4 })
    env.pointer({ action: 'move', x: 5, y: 6, button: 'left' })
    env.pointer({ action: 'up', x: 5, y: 6 })
    env.pointer({ action: 'wheel', x: 1, y: 1, deltaY: 100 })
    expect(seen).toEqual(['pointerdown:3,4:1', 'mousedown:3,4:1', 'mousemove:5,6:1', 'mouseup:5,6:0', 'click:5,6:0', 'wheel:1,1:0:100'])
    let frames = 0
    win.requestAnimationFrame(() => frames++)
    const id = win.requestAnimationFrame(() => frames++)
    win.cancelAnimationFrame(id)
    env.frame()
    env.frame()
    expect(frames).toBe(1)
    let resized = 0
    win.addEventListener('resize', () => resized++)
    env.resize(80, 40)
    expect(resized).toBe(1)
    expect(win.innerWidth).toBe(80)
    const keys: string[] = []
    doc.addEventListener('keydown', (e: KeyboardEvent) => keys.push(e.key + e.code))
    env.key('down', { key: 'a', code: 'KeyA' })
    expect(keys).toEqual(['aKeyA'])
    win.localStorage.setItem('k', 'v')
    expect(win.localStorage.getItem('k')).toBe('v')
    env.dispose()
  })
})

describe('runHtml / runScript', () => {
  const html = `<!doctype html><html><head><title>t</title>
    <script type="x-shader/x-fragment" id="data">payload</script></head>
    <body onload="window.loaded = true">
      <canvas id="c" width="40" height="20"></canvas>
      <script>
        var canvas = document.getElementById('c')
        var ctx = canvas.getContext('2d')
        var frames = 0
        var clicks = []
        ctx.fillStyle = 'red'
        ctx.fillRect(0, 0, 10, 10)
        canvas.addEventListener('click', function (e) { clicks.push([e.offsetX, e.offsetY]) })
        document.addEventListener('keydown', function (e) { window.lastKey = e.key })
        function loop() {
          frames++
          ctx.fillStyle = 'blue'
          ctx.fillRect(20, 0, 10, 10)
          requestAnimationFrame(loop)
        }
        requestAnimationFrame(loop)
        window.shader = document.getElementById('data').textContent
      </script>
    </body></html>`

  it('executes inline scripts that draw, with frames, events and onload', async () => {
    const page = await runHtml({ html }, { width: 40, height: 20 })
    const c = page.canvas!
    expect(c.width).toBe(40)
    expect(c.height).toBe(20)
    expect(px(c, 5, 5)).toEqual([255, 0, 0, 255])
    expect(px(c, 25, 5)[3]).toBe(0)
    page.env.frame()
    expect(px(c, 25, 5)).toEqual([0, 0, 255, 255])
    const w = page.window as Record<string, any>
    expect(w.frames).toBe(1)
    expect(w.loaded).toBe(true)
    expect(w.shader).toBe('payload')
    expect(page.document.title).toBe('t')
    page.env.pointer({ action: 'down', x: 7, y: 8 })
    page.env.pointer({ action: 'up', x: 7, y: 8 })
    expect(w.clicks).toEqual([[7, 8]])
    page.env.key('down', { key: 'x', code: 'KeyX' })
    expect(w.lastKey).toBe('x')
    expect(page.errors).toEqual([])
    page.dispose()
  })

  it('loads external classic scripts, module scripts and images relative to the page', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ttyc-page-'))
    const img = new Canvas(2, 2)
    img.getContext('2d').fillStyle = 'lime'
    img.getContext('2d').fillRect(0, 0, 2, 2)
    writeFileSync(join(dir, 'dot.png'), img.toBuffer())
    writeFileSync(join(dir, 'lib.js'), 'function paint(ctx) { ctx.fillStyle = "yellow"; ctx.fillRect(0, 0, 4, 4) }')
    writeFileSync(join(dir, 'helper.mjs'), 'export const SIZE = 6')
    writeFileSync(join(dir, 'index.html'), `
      <canvas width="16" height="8"></canvas>
      <script src="lib.js"></script>
      <script>paint(document.querySelector('canvas').getContext('2d'))</script>
      <script type="module">
        import { SIZE } from './helper.mjs'
        const ctx = document.querySelector('canvas').getContext('2d')
        const im = new Image()
        im.onload = () => { ctx.drawImage(im, 10, 0); window.imageDone = true }
        im.src = 'dot.png'
        ctx.fillStyle = 'white'
        ctx.fillRect(4, 0, SIZE - 4, 1)
      </script>`)
    const page = await runHtml(join(dir, 'index.html'))
    const c = page.canvas!
    expect(page.errors).toEqual([])
    expect(px(c, 1, 1)).toEqual([255, 255, 0, 255])
    expect(px(c, 5, 0)).toEqual([255, 255, 255, 255])
    for (let i = 0; i < 50 && !(globalThis as Record<string, unknown>).imageDone && !(page.window as Record<string, unknown>).imageDone; i++) await tick()
    expect(px(c, 11, 1)).toEqual([0, 255, 0, 255])
    page.dispose()
    expect((globalThis as Record<string, unknown>).document).toBeUndefined()
  })

  it('runScript gives sketches a full-viewport canvas', async () => {
    const page = await runScript({ code: 'const c = document.querySelector("canvas"); c.getContext("2d").fillRect(0, 0, innerWidth, innerHeight)' }, { width: 12, height: 6 })
    expect(page.canvas!.width).toBe(12)
    expect(px(page.canvas!, 11, 5)[3]).toBe(255)
    page.dispose()
  })

  it('reports script errors without throwing', async () => {
    const errors: unknown[] = []
    const quiet = { ...console, error: (e: unknown) => errors.push(e) } as Console
    const page = await runHtml({ html: '<script>throw new Error("boom")</script><script>window.after = 1</script>' }, { console: quiet })
    expect(String(page.errors[0])).toContain('boom')
    expect((page.window as Record<string, unknown>).after).toBe(1)
    page.dispose()
  })

  it('blocks remote scripts and host imports unless allowed', async () => {
    const errors: unknown[] = []
    const quiet = { ...console, error: (e: unknown) => errors.push(e) } as Console
    const remote = await runHtml({ html: '<script src="http://example.invalid/x.js"></script><script src="https://example.invalid/y.js"></script>' }, { console: quiet })
    expect(remote.errors.map(String).join(' ')).toMatch(/blocked script http:.*blocked remote script https:/s)
    remote.dispose()

    const dir = mkdtempSync(join(tmpdir(), 'ttyc-policy-'))
    writeFileSync(join(dir, 'm.js'), "import { readFileSync } from 'node:fs'\nwindow.leak = typeof readFileSync")
    writeFileSync(join(dir, 'index.html'), '<script type="module" src="./m.js"></script>')
    const blocked = await runHtml(join(dir, 'index.html'), { console: quiet })
    expect(String(blocked.errors[0])).toContain('blocked import of "node:fs"')
    expect((blocked.window as Record<string, unknown>).leak).toBeUndefined()
    blocked.dispose()

    const allowed = await runHtml(join(dir, 'index.html'), { console: quiet, allowHostImports: true })
    expect(allowed.errors).toEqual([])
    allowed.dispose()
  })
})

describe('terminal input parser', () => {
  it('parses keys, kitty protocol and SGR mouse', () => {
    const p = new InputParser()
    const evs = p.feed('a\x1b[A\x03\x1b[<0;5;3M\x1b[<32;6;3M\x1b[<0;6;3m\x1b[<65;1;1M')
    expect(evs.map((e) => (e.type === 'key' ? `${e.key}/${e.code}/${e.ctrlKey}` : e.type === 'mouse' ? `${e.action}:${e.button}@${e.x},${e.y}${e.wheel ?? ''}` : ''))).toEqual([
      'a/KeyA/false', 'ArrowUp/ArrowUp/false', 'c/KeyC/true', 'down:left@4,2', 'move:left@5,2', 'up:left@5,2', 'wheel:none@0,0down',
    ])
    const k = p.feed('\x1b[97;1:3u\x1b[1;2:1A\x1b[57441;2u')
    expect(k).toMatchObject([{ key: 'a', action: 'up' }, { key: 'ArrowUp', shiftKey: true, action: 'down' }, { key: 'Shift', code: 'ShiftLeft' }])
    expect(p.reportsRelease).toBe(true)
    expect(p.feed('\x1b')).toEqual([])
    expect(p.flush()).toMatchObject([{ key: 'Escape' }])
  })
})

describe('play()', () => {
  it('renders frames, forwards mouse input and restores the terminal', async () => {
    let out = ''
    const listeners: ((d: string) => void)[] = []
    const stdout = { columns: 20, rows: 10, write: (s: string) => ((out += s), true), on() {}, off() {} }
    const stdin = { on: (_: string, f: (d: string) => void) => listeners.push(f), off() {}, isTTY: false }
    const page = await runHtml({ html: `<canvas width="20" height="20"></canvas><script>
      const c = document.querySelector('canvas'); const ctx = c.getContext('2d')
      c.addEventListener('mousedown', (e) => { ctx.fillStyle = 'red'; ctx.fillRect(Math.floor(e.offsetX), Math.floor(e.offsetY), 1, 1) })
    </script>` })
    const player = play(page, { stdout, stdin, fps: 60, fitViewport: false })
    expect(out).toContain('\x1b[?1049h')
    // canvas 20×20 px → 20 cols × 10 rows in halfblock; click cell (3,2) → pixel (3.5, 5)
    listeners[0]('\x1b[<0;4;3M')
    player.render()
    expect(px(page.canvas!, 3, 5)).toEqual([255, 0, 0, 255])
    expect(out).toMatch(/[34]8;2;255;0;0/)
    listeners[0]('\x03') // ctrl+c
    await player.done
    expect(out).toContain('\x1b[?1049l')
    page.dispose()
  })
})
