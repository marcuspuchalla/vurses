import { describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { CellBuffer } from '../../src/render/buffer.js'
import { DeltaEncoder, ScreenState, type FrameDelta } from '../../src/targets/protocol.js'
import { streamTarget } from '../../src/targets/stream.js'
import { createApp } from '../../src/app/app.js'

function same(a: { width: number; height: number; chars: ArrayLike<string>; fg: ArrayLike<string>; bg: ArrayLike<string>; flags: ArrayLike<number> }, b: typeof a) {
  expect(b.width).toBe(a.width)
  expect(b.height).toBe(a.height)
  expect(Array.from(b.chars)).toEqual(Array.from(a.chars))
  expect(Array.from(b.fg)).toEqual(Array.from(a.fg))
  expect(Array.from(b.bg)).toEqual(Array.from(a.bg))
  expect(Array.from(b.flags)).toEqual(Array.from(a.flags))
}

const wire = (d: FrameDelta) => JSON.parse(JSON.stringify(d)) as FrameDelta

describe('delta protocol', () => {
  it('first frame is full, omits blank rows, interns styles', () => {
    const b = new CellBuffer(10, 4)
    b.set(1, 2, 'x', 1, '31', '', 1)
    const enc = new DeltaEncoder()
    const d = enc.encode(b)!
    expect(d.full).toBe(1)
    expect(d.reset).toBe(1)
    expect(d.r).toEqual([[2, 1, 0, 'x']])
    expect(d.s).toEqual([[0, '31', '', 1]])
    const st = new ScreenState()
    st.apply(wire(d))
    same(b, st.screen)
  })

  it('unchanged frames produce no delta; changes produce row spans only', () => {
    const enc = new DeltaEncoder()
    const a = new CellBuffer(8, 2)
    enc.encode(a)
    expect(enc.encode(new CellBuffer(8, 2))).toBeNull()
    const b = new CellBuffer(8, 2)
    b.set(3, 1, 'Q', 1, '', '44', 0)
    const d = enc.encode(b)!
    expect(d.full).toBeUndefined()
    expect(d.r).toEqual([[1, 3, 0, 'Q']])
    expect(d.s).toEqual([[0, '', '44', 0]])
  })

  it('wide glyphs and astral graphemes travel as explicit cells', () => {
    const enc = new DeltaEncoder()
    const st = new ScreenState()
    const b = new CellBuffer(6, 1)
    b.set(0, 0, '界', 2, '', '', 0)
    b.set(2, 0, '👍', 2, '', '', 0)
    b.set(4, 0, 'a', 1, '', '', 0)
    const d = enc.encode(b)!
    expect(d.r[0]).toEqual([0, 0, 0, ['界', '', '👍', '', 'a']])
    st.apply(wire(d))
    same(b, st.screen)
  })

  it('round-trips random mutations exactly', () => {
    const enc = new DeltaEncoder()
    const st = new ScreenState()
    let seed = 7
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n)
    const glyphs = ['a', 'b', ' ', '█', '─', '界', '%']
    const colors = ['', '31', '38;2;1;2;3', '48;5;17', '44']
    let b = new CellBuffer(30, 10)
    for (let f = 0; f < 60; f++) {
      const next = new CellBuffer(f === 30 ? 20 : b.width, f === 30 ? 8 : b.height)
      // copy then mutate
      if (next.width === b.width) for (let i = 0; i < b.chars.length; i++) {
        next.chars[i] = b.chars[i]; next.fg[i] = b.fg[i]; next.bg[i] = b.bg[i]; next.flags[i] = b.flags[i]
      }
      for (let k = 0; k < 15; k++) {
        const ch = glyphs[rnd(glyphs.length)]
        next.set(rnd(next.width), rnd(next.height), ch, ch === '界' ? 2 : 1, colors[rnd(5)], colors[rnd(5)], rnd(64))
      }
      const d = enc.encode(next)
      if (d) st.apply(wire(d))
      same(next, st.screen)
      b = next
    }
  })

  it('streamTarget streams a live app', async () => {
    const sent: FrameDelta[] = []
    const n = ref(0)
    const App = defineComponent(() => () => h('tui-text', null, `n=${n.value}`))
    const target = streamTarget({ columns: 12, rows: 2, send: (d) => sent.push(wire(d)) })
    const app = createApp(App).mount({ target, autoFocus: false, fps: 1000 })
    await new Promise((r) => setTimeout(r, 20))
    n.value = 42
    await nextTick()
    await new Promise((r) => setTimeout(r, 20))
    const st = new ScreenState()
    for (const d of sent) st.apply(d)
    same(app.runtime!.buffer!, st.screen)
    expect(sent.length).toBe(2)
    expect(sent[1].r).toEqual([[0, 2, 0, '42']])
    app.runtime!.exit()
  })
})
