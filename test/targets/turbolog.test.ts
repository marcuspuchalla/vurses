import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { CellBuffer } from '../../src/render/buffer.js'
import { encodeTurbolog, Turbolog } from '../../src/targets/turbolog.js'
import { sgrColor, styleCss } from '../../src/targets/css.js'
import { browserTarget } from '../../src/targets/browser.js'
import { createApp } from '../../src/app/app.js'

function grid(w: number, h: number) {
  return new CellBuffer(w, h)
}
function write(b: CellBuffer, x: number, y: number, s: string, fg = '', bg = '', flags = 0) {
  for (const ch of s) b.set(x++, y, ch, 1, fg, bg, flags)
}

describe('css', () => {
  it('resolves SGR colors', () => {
    expect(sgrColor('31')).toBe('#cd3131')
    expect(sgrColor('97')).toBe('#ffffff')
    expect(sgrColor('38;2;1;2;255')).toBe('#0102ff')
    expect(sgrColor('48;5;196')).toBe('#ff0000')
    expect(sgrColor('48;5;232')).toBe('#080808')
    expect(sgrColor('')).toBeNull()
  })
  it('builds console CSS', () => {
    expect(styleCss('38;2;255;0;0', '', 1)).toBe('color:#ff0000;background:#1e1e1e;font-weight:bold')
    expect(styleCss('', '', 8 | 32 | 4)).toBe('color:#d4d4d4;background:#1e1e1e;font-style:italic;text-decoration:underline line-through')
    // inverse swaps
    expect(styleCss('31', '42', 16)).toBe('color:#0dbc79;background:#cd3131')
  })
})

describe('encodeTurbolog', () => {
  it('run-length encodes cells into %c spans', () => {
    const b = grid(10, 2)
    write(b, 0, 0, 'ab', '31')
    write(b, 2, 0, 'cd', '32', '', 1)
    const f = encodeTurbolog(b)
    // spans: "ab" red, "cd" bold green, rest of row 0 + newline + row 1 default
    expect(f.styles).toHaveLength(3)
    expect(f.format).toBe('%cab%ccd%c      \n          ')
    expect(f.styles[1]).toBe('color:#0dbc79;background:#1e1e1e;font-weight:bold')
  })
  it('merges runs across rows and escapes %', () => {
    const b = grid(4, 3)
    write(b, 0, 1, '50%')
    const f = encodeTurbolog(b)
    expect(f.styles).toHaveLength(1)
    expect(f.format).toBe('%c    \n50%% \n    ')
  })
  it('skips wide-glyph continuation cells', () => {
    const b = grid(4, 1)
    b.set(0, 0, '界', 2, '', '', 0)
    expect(encodeTurbolog(b).format).toBe('%c界  ')
  })
  it('encodes a real 80x40 app screen compactly', async () => {
    const App = defineComponent(() => () =>
      h('tui-box', { flexDirection: 'column', width: 80, height: 40, border: 'round', title: 'Turbolog' },
        Array.from({ length: 30 }, (_, i) => h('tui-text', { color: i % 3 ? 'primary' : 'accent', bold: i % 2 === 0 }, `row ${i} ` + 'x'.repeat(i)))),
    )
    const app = createApp(App).mount({ manualRender: true, columns: 80, rows: 40, autoFocus: false })
    const buf = app.runtime!.renderFrame()
    const f = encodeTurbolog(buf)
    expect(f.format.split('%c').length - 1).toBe(f.styles.length)
    expect(f.styles.length).toBeGreaterThan(10)
    expect(f.styles.length).toBeLessThan(400) // 3,200 cells -> a few hundred spans at most
    app.runtime!.exit()
  })
})

describe('Turbolog presenter', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('drops identical frames (dirty gate) and never clears', () => {
    const log = vi.fn()
    const t = new Turbolog({ console: { log, clear: vi.fn() } as any, now: () => Date.now() })
    const a = grid(5, 2)
    write(a, 0, 0, 'hi')
    expect(t.present(a)).toBe(true)
    expect(log).toHaveBeenCalledTimes(1)
    const copy = grid(5, 2)
    write(copy, 0, 0, 'hi')
    vi.advanceTimersByTime(1000)
    expect(t.present(copy)).toBe(false)
    expect(log).toHaveBeenCalledTimes(1)
    expect(t.stats.unchanged).toBe(1)
  })

  it('throttles to >= 66ms and coalesces to the latest frame', () => {
    const log = vi.fn()
    const t = new Turbolog({ console: { log }, now: () => Date.now() })
    const frames = ['a', 'b', 'c', 'd'].map((s) => {
      const g = grid(3, 1)
      write(g, 0, 0, s)
      return g
    })
    t.present(frames[0])
    expect(log).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(10)
    t.present(frames[1])
    vi.advanceTimersByTime(10)
    t.present(frames[2])
    expect(log).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(45) // 65ms since first emit
    expect(log).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(log).toHaveBeenCalledTimes(2)
    expect(log.mock.calls[1][0]).toBe('%cc  ')
    expect(t.stats.coalesced).toBe(1)
    vi.advanceTimersByTime(100)
    t.present(frames[3])
    expect(log).toHaveBeenCalledTimes(3)
  })
})

describe('browserTarget', () => {
  it('renders an app into console.log with %c spans', async () => {
    const log = vi.fn()
    const count = ref(0)
    const App = defineComponent(() => () => h('tui-text', { color: 'primary' }, `count ${count.value}`))
    const target = browserTarget({ console: { log }, columns: 20, rows: 3, input: false, minInterval: 0 })
    const app = createApp(App).mount({ target, autoFocus: false })
    await new Promise((r) => setTimeout(r, 40))
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0][0]).toContain('count 0')
    expect(log.mock.calls[0][0].startsWith('%c')).toBe(true)
    count.value++
    await new Promise((r) => setTimeout(r, 40))
    expect(log).toHaveBeenCalledTimes(2)
    expect(log.mock.calls[1][0]).toContain('count 1')
    app.runtime!.exit()
  })
})
