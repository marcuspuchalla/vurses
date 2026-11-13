import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, ref } from 'vue'
import { render, type RenderResult } from '../../src/testing.js'
import { CellBuffer } from '../../src/render/buffer.js'
import { getDevtoolsHook, installDevtoolsHook, HOOK_KEY } from '../../src/devtools/hook.js'
import type { VursesRepl } from '../../src/devtools/repl.js'
import { frameToAnsi, locateText, sgrToCss, snapshotFrame, styleSpans, changedRows } from '../../src/devtools/frame.js'
import { frameToHtml } from '../../src/devtools/html.js'
import { componentTree, elementTree, formatComponentTree, formatElementTree, serializeValue } from '../../src/devtools/tree.js'

const Item = defineComponent({
  name: 'Item',
  props: { label: { type: String, required: true } },
  template: `<Text>- {{ label }}</Text>`,
})

const App = defineComponent({
  name: 'App',
  components: { Item },
  setup() {
    const count = ref(0)
    return { count, items: ['alpha', 'beta'] }
  },
  template: `<Box class="flex-col" border="single" :width="20">
    <Text bold color="red">Count {{ count }}</Text>
    <Item v-for="i in items" :key="i" :label="i" />
    <Button label="inc" @click="count++" />
  </Box>`,
})

let r: RenderResult | null = null
const g = globalThis as Record<string, unknown>
afterEach(() => {
  r?.unmount()
  r = null
})

describe('frame serialization', () => {
  it('converts SGR colors to CSS', () => {
    expect(sgrToCss('31')).toBe('#cd3131')
    expect(sgrToCss('97')).toBe('#ffffff')
    expect(sgrToCss('48;2;1;2;3')).toBe('#010203')
    expect(sgrToCss('38;5;196')).toBe('#ff0000')
    expect(sgrToCss('38;5;232')).toBe('#080808')
    expect(sgrToCss('')).toBeUndefined()
  })

  it('snapshots runs, wide glyphs and flags', () => {
    const b = new CellBuffer(6, 2)
    b.set(0, 0, 'a', 1, '31', null, 1)
    b.set(1, 0, '世', 2, '31', null, 1)
    b.set(3, 0, 'z', 1, '', '44', 0)
    const s = snapshotFrame(b, 7)
    expect(s.frame).toBe(7)
    expect(s.rows[0][0]).toEqual({ t: 'a世', w: 3, fg: '#cd3131', f: 1 })
    expect(s.rows[0][1]).toEqual({ t: 'z', w: 1, bg: '#2472c8' })
    expect(s.lines[0]).toBe('a世z  ')
    expect(JSON.parse(JSON.stringify(s))).toEqual(s)
  })

  it('renders ANSI, style spans, locate and changed rows', () => {
    const b = new CellBuffer(5, 2)
    b.set(0, 0, 'h', 1, '32', null, 0)
    b.set(1, 0, 'i', 1, '32', null, 0)
    b.set(0, 1, '世', 2, '', null, 0)
    b.set(2, 1, 'x', 1, '', null, 0)
    expect(frameToAnsi(b)).toBe('\x1b[0;32mhi\x1b[0m\n世x')
    expect(styleSpans(b)).toEqual([{ row: 0, col: 0, width: 2, text: 'hi', fg: '#0dbc79' }])
    expect(locateText(b, 'x')).toEqual({ x: 2, y: 1 })
    expect(locateText(b, 'nope')).toBeNull()
    const c = new CellBuffer(5, 2)
    expect(changedRows(b, null)).toBe(2)
    expect(changedRows(b, c)).toBe(2)
    expect(changedRows(c, new CellBuffer(5, 2))).toBe(0)
  })

  it('renders HTML with escaping, inverse and highlight overlays', () => {
    const b = new CellBuffer(4, 1)
    b.set(0, 0, '<', 1, '', null, 16)
    b.set(1, 0, '&', 1, '31', null, 1 | 8)
    const html = frameToHtml(snapshotFrame(b))
    expect(html).toContain('&lt;')
    expect(html).toContain('color:var(--vurses-bg')
    expect(html).toContain('font-weight:bold;text-decoration:underline')
    expect(html).not.toContain('vurses-hl')
    const hl = frameToHtml(snapshotFrame(b), { highlight: { x: 1, y: 0, width: 2, height: 1 } })
    expect(hl).toContain('class="vurses-hl"')
    expect(hl).toContain('left:calc(var(--vurses-pad,4px) + 1ch)')
  })

  it('serializes arbitrary values safely', () => {
    const cyc: Record<string, unknown> = { a: 1 }
    cyc.self = cyc
    expect(serializeValue(cyc)).toEqual({ a: 1, self: '[Circular]' })
    expect(serializeValue(() => 1)).toMatch(/Function/)
    expect(serializeValue(new Map([['k', 1]]))).toEqual({ '[Map]': { k: 1 } })
    expect(serializeValue({ a: { b: { c: { d: 1 } } } }, 2)).toEqual({ a: { b: '[Object]' } })
  })
})

describe('trees', () => {
  it('walks the component tree with props and rects', async () => {
    r = await render(App, { columns: 30, rows: 8 })
    const tree = componentTree(r.app.runtime!)
    expect(tree).toHaveLength(1)
    expect(tree[0].name).toBe('App')
    expect(tree[0].rect).toEqual({ x: 0, y: 0, width: 20, height: 8 })
    const box = tree[0].children[0]
    expect(box.name).toBe('Box')
    expect(box.children.map((c) => c.name)).toEqual(['Text', 'Item', 'Item', 'Button'])
    const item = box.children[1]
    expect(item.props.label).toBe('alpha')
    expect(item.rect).toEqual({ x: 1, y: 2, width: 18, height: 1 })
    expect(formatComponentTree(tree)).toMatch(/<App#\d+> \[0,0 20x8\]\n {2}<Box#\d+> \[0,0 20x8\]\n {4}<Text#\d+>/)
    // DevTools overlay and the VursesRoot wrapper are hidden
    expect(JSON.stringify(tree)).not.toContain('VursesRoot')
  })

  it('walks the element tree', async () => {
    r = await render(App, { columns: 30, rows: 8 })
    const t = elementTree(r.app.runtime!.root)
    expect(t.tag).toBe('tui-root')
    const s = formatElementTree(t)
    expect(s).toContain('"Count 0"')
    expect(s).toMatch(/@click/)
    expect(elementTree(r.app.runtime!.root, { depth: 0 }).children).toEqual([])
  })
})

describe('devtools hook', () => {
  it('installs and uninstalls the global hook and REPL', async () => {
    r = await render(App, { columns: 30, rows: 8 })
    const off = installDevtoolsHook(r.app.runtime!, { repl: true })
    const hook = getDevtoolsHook()!
    expect(hook).toBe(g[HOOK_KEY])
    expect(hook.runtime).toBe(r.app.runtime)
    expect(Object.keys(g)).not.toContain(HOOK_KEY)
    expect(typeof (g.vurses as VursesRepl).pause).toBe('function')
    off()
    expect(g[HOOK_KEY]).toBeUndefined()
    expect(g.vurses).toBeUndefined()
  })

  it('records a frame timeline and serves frames and trees', async () => {
    r = await render(App, { columns: 30, rows: 8 })
    const off = installDevtoolsHook(r.app.runtime!)
    const hook = getDevtoolsHook()!
    const seen: number[] = []
    hook.onFrame((f) => seen.push(f.frame))
    await r.click(...Object.values(r.locate('inc')!) as [number, number])
    expect(r.lastFrame()).toContain('Count 1')
    const tl = hook.getTimeline()
    expect(tl.length).toBeGreaterThan(0)
    expect(seen.length).toBe(tl.length)
    expect(tl.at(-1)).toMatchObject({ frame: expect.any(Number), ms: expect.any(Number), bytes: 0, changedRows: expect.any(Number) })
    expect(hook.getTimeline(1)).toHaveLength(1)
    expect(hook.getFrameText()).toContain('Count 1')
    expect(hook.getFrame()!.lines[1]).toContain('Count 1')
    expect(hook.getFrameAnsi()).toContain('\x1b[0;1;31mCount 1')
    expect(hook.getComponentTree()[0].name).toBe('App')
    const appId = hook.getComponentTree()[0].id
    const details = hook.getComponent(appId)!
    expect(details.setupState.count).toBe(1)
    expect(details.childCount).toBe(1)
    expect(hook.getElementTree()!.tag).toBe('tui-root')
    expect(hook.stats().frames).toBeGreaterThan(0)
    hook.clearTimeline()
    expect(hook.getTimeline()).toEqual([])
    expect(JSON.parse(JSON.stringify(hook.getState()))).toMatchObject({ paused: false, columns: 30, rows: 8, apps: 1 })
    off()
  })

  it('highlights a component by inverting its rect', async () => {
    r = await render(App, { columns: 30, rows: 8 })
    const off = installDevtoolsHook(r.app.runtime!)
    const hook = getDevtoolsHook()!
    const item = hook.getComponentTree()[0].children[0].children[1]
    const rect = hook.highlight(item.id, 0)
    expect(rect).toEqual({ x: 1, y: 2, width: 18, height: 1 })
    r.lastFrame()
    const buf = r.buffer()
    expect(buf.flags[2 * buf.width + 1] & 16).toBe(16)
    expect(buf.flags[1 * buf.width + 1] & 16).toBe(0)
    expect(hook.getState().highlight).toEqual(rect)
    hook.highlight(null)
    r.lastFrame()
    expect(r.buffer().flags[2 * buf.width + 1] & 16).toBe(0)
    // highlight by explicit rect, auto-clears
    vi.useFakeTimers()
    hook.highlight({ x: 0, y: 0, width: 2, height: 1 }, 100)
    vi.advanceTimersByTime(150)
    vi.useRealTimers()
    expect(hook.getState().highlight).toBeNull()
    expect(hook.highlight(999999)).toBeNull()
    off()
  })

  it('pause / step / resume / wireframe / resize', async () => {
    r = await render(App, { columns: 30, rows: 8 })
    const off = installDevtoolsHook(r.app.runtime!)
    const hook = getDevtoolsHook()!
    hook.pause()
    expect(hook.getState().paused).toBe(true)
    const before = hook.getTimeline().length
    const rec = hook.step()!
    expect(rec.frame).toBeGreaterThan(0)
    expect(hook.getTimeline().length).toBe(before + 1)
    hook.setWireframe(true)
    expect(hook.getState().wireframe).toBe(true)
    hook.resume()
    expect(hook.getState().paused).toBe(false)
    hook.resize(40, 10)
    expect(hook.getState()).toMatchObject({ columns: 40, rows: 10 })
    await hook.press('tab')
    off()
  })

  it('keeps the most recent runtime active and removes the hook on exit', async () => {
    r = await render(App, { columns: 30, rows: 8 })
    const r2 = await render(App, { columns: 20, rows: 8 })
    installDevtoolsHook(r.app.runtime!)
    installDevtoolsHook(r2.app.runtime!)
    expect(getDevtoolsHook()!.runtimes).toHaveLength(2)
    expect(getDevtoolsHook()!.runtime).toBe(r2.app.runtime)
    r2.unmount()
    expect(getDevtoolsHook()!.runtime).toBe(r.app.runtime)
    r.unmount()
    r = null
    expect(getDevtoolsHook()).toBeNull()
  })
})

describe('REPL', () => {
  it('pauses, resizes, wireframes, copies and prints', async () => {
    r = await render(App, { columns: 30, rows: 8 })
    const writeText = vi.fn(() => Promise.resolve())
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const off = installDevtoolsHook(r.app.runtime!, { repl: true })
    const repl = g.vurses as VursesRepl
    try {
      expect(repl.pause()).toBe('paused')
      expect(repl.hook.getState().paused).toBe(true)
      expect(repl.step()).toMatch(/^frame \d+: /)
      expect(repl.resume()).toBe('resumed')
      expect(repl.resize(50, 12)).toBe('50x12')
      expect(repl.wireframe()).toBe(true)
      expect(repl.wireframe()).toBe(false)
      expect(repl.wireframe(true)).toBe(true)
      const text = repl.copy()
      expect(text).toContain('Count 0')
      expect(writeText).toHaveBeenCalledWith(text)
      expect(repl.frame()).toBe(text)
      expect(repl.ansi()).toContain('\x1b[')
      expect(repl.tree()[0].name).toBe('App')
      expect(log.mock.calls.at(-1)![0]).toMatch(/<App#/)
      expect(repl.elements()).toContain('tui-root')
      expect(await repl.type('x')).toContain('Count')
      expect(repl.stats().frames).toBeGreaterThan(0)
      expect(repl.help()).toContain('vurses.pause()')
    } finally {
      off()
      log.mockRestore()
      vi.unstubAllGlobals()
    }
  })

  it('copy() works without a clipboard (Node)', async () => {
    r = await render(App, { columns: 30, rows: 8 })
    const off = installDevtoolsHook(r.app.runtime!, { repl: true })
    expect((g.vurses as VursesRepl).copy()).toContain('Count 0')
    off()
  })
})
