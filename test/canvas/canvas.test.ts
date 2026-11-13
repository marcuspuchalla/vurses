import { describe, expect, it } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Canvas as PixelCanvas } from 'tty-canvas'
import { render } from '../../src/testing.js'
import { Canvas, Image } from '../../src/components/index.js'
import type { CanvasRenderingContext2D } from 'tty-canvas'

const RED_BG = '48;2;255;0;0'
const RED_FG = '38;2;255;0;0'

function cellsWith(buf: { width: number; height: number; fg: string[]; bg: string[] }, sgr: string) {
  const out: [number, number][] = []
  for (let y = 0; y < buf.height; y++) for (let x = 0; x < buf.width; x++) {
    const i = y * buf.width + x
    if (buf.bg[i] === sgr || buf.fg[i] === sgr) out.push([x, y])
  }
  return out
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('<Canvas>', () => {
  it('fillRect red produces red cells, sized from the box', async () => {
    let size: number[] = []
    const App = defineComponent({
      setup: () => () =>
        h('tui-box', { width: 20, height: 6 }, [
          h(Canvas, {
            onReady: (c: PixelCanvas, ctx: CanvasRenderingContext2D) => {
              size = [c.width, c.height]
              ctx.fillStyle = 'red'
              ctx.fillRect(0, 0, 10, 12) // left half of 20×12 px
            },
          }),
        ]),
    })
    const r = await render(App, { columns: 20, rows: 6 })
    expect(size).toEqual([20, 12]) // halfblock: 1×2 px per cell
    const buf = r.buffer()
    const red = cellsWith(buf, RED_BG)
    expect(red.length).toBe(10 * 6)
    expect(red.every(([x]) => x < 10)).toBe(true)
    r.unmount()
  })

  it('braille mode uses 2×4 pixel cells', async () => {
    let size: number[] = []
    const App = defineComponent({
      setup: () => () =>
        h('tui-box', { width: 10, height: 3 }, [
          h(Canvas, {
            mode: 'braille',
            onReady: (c: PixelCanvas, ctx: CanvasRenderingContext2D) => {
              size = [c.width, c.height]
              ctx.fillStyle = 'red'
              ctx.fillRect(0, 0, 1, 12) // one pixel column
            },
          }),
        ]),
    })
    const r = await render(App, { columns: 10, rows: 3 })
    expect(size).toEqual([20, 12])
    expect(r.lastFrame().split('\n')[0][0]).toBe('⡇')
    expect(r.buffer().fg[0]).toBe(RED_FG)
    r.unmount()
  })

  it('repaints when drawn on later (via @frame or a template ref)', async () => {
    const canvasRef = ref<{ getContext(): CanvasRenderingContext2D; canvas: PixelCanvas } | null>(null)
    const App = defineComponent({
      setup: () => () => h('tui-box', { width: 8, height: 4 }, [h(Canvas, { ref: canvasRef })]),
    })
    const r = await render(App, { columns: 8, rows: 4 })
    expect(cellsWith(r.buffer(), RED_BG)).toHaveLength(0)
    const ctx = canvasRef.value!.getContext()
    expect(canvasRef.value!.canvas.width).toBe(8)
    ctx.fillStyle = '#ff0000'
    ctx.fillRect(0, 0, 8, 8)
    r.lastFrame()
    expect(cellsWith(r.buffer(), RED_BG)).toHaveLength(8 * 4)
    r.unmount()
  })

  it('emits @frame with the context for animation', async () => {
    let frames = 0
    const App = defineComponent({
      setup: () => () =>
        h('tui-box', { width: 4, height: 2 }, [
          h(Canvas, {
            fps: 100,
            onFrame: (ctx: CanvasRenderingContext2D, dt: number) => {
              frames++
              expect(dt).toBeGreaterThanOrEqual(0)
              ctx.fillStyle = frames % 2 ? 'red' : 'blue'
              ctx.fillRect(0, 0, 4, 4)
            },
          }),
        ]),
    })
    const r = await render(App, { columns: 4, rows: 2 })
    await wait(60)
    expect(frames).toBeGreaterThan(1)
    r.unmount()
  })

  it('forwards mouse events to canvas DOM listeners in pixel coordinates', async () => {
    const events: string[] = []
    const App = defineComponent({
      setup: () => () =>
        h('tui-box', { width: 30, height: 10, paddingLeft: 5, paddingTop: 2 }, [
          h(Canvas, {
            onReady: (c: PixelCanvas, ctx: CanvasRenderingContext2D) => {
              c.addEventListener('mousedown', (e: MouseEvent) => {
                events.push(`down ${e.offsetX},${e.offsetY} ${e.button}`)
                ctx.fillStyle = 'red'
                ctx.fillRect(Math.floor(e.offsetX), Math.floor(e.offsetY), 1, 1)
              })
              c.addEventListener('click', (e: MouseEvent) => events.push(`click ${e.offsetX},${e.offsetY}`))
              c.addEventListener('wheel', (e: WheelEvent) => events.push(`wheel ${e.deltaY}`))
            },
          }),
        ]),
    })
    const r = await render(App, { columns: 30, rows: 10 })
    // canvas content starts at (5, 2); cell (3, 1) inside it → pixel (3.5, 3)
    await r.click(5 + 3, 2 + 1)
    await r.wheel(6, 3, 'down')
    expect(events).toEqual(['down 3.5,3 0', 'click 3.5,3', 'wheel 100'])
    // the drawn pixel shows up at that cell (bottom half of the cell → bg of '▀' after canonicalization)
    expect(cellsWith(r.buffer(), RED_BG).concat(cellsWith(r.buffer(), RED_FG))).toEqual([[8, 3]])
    r.unmount()
  })

  it('forwards keys to the canvas when focused', async () => {
    const keys: string[] = []
    const App = defineComponent({
      setup: () => () =>
        h('tui-box', { width: 10, height: 4 }, [
          h(Canvas, {
            autoFocus: true,
            onReady: (c: PixelCanvas) => {
              c.ownerDocument.addEventListener('keydown', (e: KeyboardEvent) => keys.push(`${e.key}:${e.code}`))
            },
          }),
        ]),
    })
    const r = await render(App, { columns: 10, rows: 4 })
    await r.press('a', 'up', 'space', 'enter')
    expect(keys).toEqual(['a:KeyA', 'ArrowUp:ArrowUp', ' :Space', 'Enter:Enter'])
    r.unmount()
  })

  it('fixed pixel size: natural cell size and contain-fit scaling', async () => {
    const App = defineComponent({
      setup: () => () =>
        h('tui-box', { width: 40, height: 10 }, [
          h(Canvas, {
            width: 20, height: 20,
            onReady: (_c: PixelCanvas, ctx: CanvasRenderingContext2D) => {
              ctx.fillStyle = 'red'
              ctx.fillRect(0, 0, 20, 20)
            },
          }),
        ]),
    })
    const r = await render(App, { columns: 40, rows: 10 })
    const red = cellsWith(r.buffer(), RED_BG)
    expect(red).toHaveLength(20 * 10)
    r.unmount()
  })

  it('runs an existing HTML canvas page via src', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vurses-canvas-'))
    const file = join(dir, 'page.html')
    writeFileSync(file, `<canvas id="c"></canvas><script>
      const c = document.getElementById('c'); const ctx = c.getContext('2d')
      function size() { c.width = innerWidth; c.height = innerHeight }
      addEventListener('resize', size); size()
      function loop() { ctx.fillStyle = 'red'; ctx.fillRect(0, 0, c.width, c.height / 2); requestAnimationFrame(loop) }
      requestAnimationFrame(loop)
      c.addEventListener('mousedown', (e) => { window.hit = [Math.round(e.offsetX), Math.round(e.offsetY)] })
    </script>`)
    const pageRef = ref<{ page: { window: Record<string, unknown> } | null } | null>(null)
    const App = defineComponent({
      setup: () => () => h('tui-box', { width: 12, height: 6 }, [h(Canvas, { ref: pageRef, src: file, fps: 60 })]),
    })
    const r = await render(App, { columns: 12, rows: 6 })
    for (let i = 0; i < 40 && cellsWith(r.buffer(), RED_BG).length === 0; i++) {
      await wait(20)
      r.lastFrame()
    }
    const red = cellsWith(r.buffer(), RED_BG)
    expect(red.length).toBe(12 * 3)
    expect(red.every(([, y]) => y < 3)).toBe(true)
    await r.click(4, 5)
    expect(pageRef.value!.page!.window.hit).toEqual([5, 11])
    r.unmount()
  })

  it('shows an error for a missing page', async () => {
    const App = defineComponent({
      setup: () => () => h('tui-box', { width: 60, height: 3 }, [h(Canvas, { src: '/nonexistent/x.html' })]),
    })
    const r = await render(App, { columns: 60, rows: 3 })
    for (let i = 0; i < 20 && !r.lastFrame().includes('Canvas:'); i++) await wait(10)
    expect(r.lastFrame()).toContain('Canvas:')
    r.unmount()
  })

  it('kitty mode queues a pixel graphic and paints a cell fallback', async () => {
    const App = defineComponent({
      setup: () => () =>
        h('tui-box', { width: 4, height: 2 }, [
          h(Canvas, { mode: 'kitty', onReady: (_c: PixelCanvas, ctx: CanvasRenderingContext2D) => { ctx.fillStyle = 'red'; ctx.fillRect(0, 0, 1000, 1000) } }),
        ]),
    })
    const r = await render(App, { columns: 4, rows: 2 })
    const runtime = r.app.runtime as unknown as { painter: { graphics: { data: string; width: number }[] } }
    expect(runtime.painter.graphics).toHaveLength(1)
    expect(runtime.painter.graphics[0].data).toMatch(/^\x1b_Ga=T,f=32/)
    expect(cellsWith(r.buffer(), RED_BG)).toHaveLength(8)
    r.unmount()
  })
})

describe('<Image>', () => {
  it('loads a PNG and renders it with the right colors and fit', async () => {
    const src = new PixelCanvas(4, 4)
    const c = src.getContext('2d')
    c.fillStyle = 'red'
    c.fillRect(0, 0, 2, 4)
    c.fillStyle = 'blue'
    c.fillRect(2, 0, 2, 4)
    const dir = mkdtempSync(join(tmpdir(), 'vurses-img-'))
    const file = join(dir, 'img.png')
    writeFileSync(file, src.toBuffer())
    const App = defineComponent({ setup: () => () => h('tui-box', { flexDirection: 'column' }, [h(Image, { src: file })]) })
    const r = await render(App, { columns: 10, rows: 4 })
    for (let i = 0; i < 20 && !cellsWith(r.buffer(), RED_BG).length; i++) {
      await wait(10)
      r.lastFrame()
    }
    // natural size: 4 px wide → 4 columns, 4 px tall → 2 rows
    expect(cellsWith(r.buffer(), RED_BG)).toEqual([[0, 0], [1, 0], [0, 1], [1, 1]])
    expect(cellsWith(r.buffer(), '48;2;0;0;255')).toEqual([[2, 0], [3, 0], [2, 1], [3, 1]])
    r.unmount()
  })

  it('shows alt text when loading fails', async () => {
    const App = defineComponent({ setup: () => () => h(Image, { src: '/no/such.png', alt: 'logo', width: 40, height: 1 }) })
    const r = await render(App, { columns: 40, rows: 2 })
    for (let i = 0; i < 20 && !r.lastFrame().includes('logo:'); i++) await wait(10)
    expect(r.lastFrame()).toContain('logo:')
    r.unmount()
  })
})
