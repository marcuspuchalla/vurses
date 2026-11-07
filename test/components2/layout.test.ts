import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { render } from '../../src/testing.js'
import { parseTracks, resolveTracks } from '../../src/components/layout.js'
import { drag, tpl } from './helpers.js'

describe('Grid', () => {
  it('parses and resolves track templates', () => {
    expect(resolveTracks(parseTracks('1fr 2fr 6'), 40, 1)).toEqual([11, 21, 6])
    expect(resolveTracks(parseTracks(3), 30, 0)).toEqual([10, 10, 10])
    expect(resolveTracks(parseTracks('repeat(2, 1fr) 25%'), 40, 0)).toEqual([15, 15, 10])
    expect(resolveTracks(parseTracks([10, '1fr']), 30, 2)).toEqual([10, 18])
  })

  it('places cells in order with gaps and col-span', async () => {
    const r = await render(
      tpl(`<Grid columns="1fr 2fr 6" :gap="1">
        <Box border="round">a</Box><Box border="round">b</Box><Box border="round">c</Box>
        <Box border="round" :col-span="2">wide</Box><Text>e</Text>
      </Grid>`),
      { columns: 40, rows: 8 },
    )
    const lines = r.lastFrame().split('\n')
    expect(lines[0]).toBe('╭─────────╮ ╭───────────────────╮ ╭────╮')
    expect(lines[1]).toBe('│a        │ │b                  │ │c   │')
    expect(lines[3]).toBe('')
    expect(lines[4]).toBe('╭───────────────────────────────╮ e')
    expect(lines[5]).toContain('│wide')
  })

  it('wraps rows when items exceed the column count (v-for)', async () => {
    const r = await render(tpl(`<Grid :columns="3"><Text v-for="i in 7" :key="i">#{{ i }}</Text></Grid>`), { columns: 30, rows: 4 })
    expect(r.lastFrame()).toBe('#1        #2        #3\n#4        #5        #6\n#7')
  })

  it('supports fixed row templates', async () => {
    const r = await render(tpl(`<Grid :columns="2" rows="2 1"><Text>a</Text><Text>b</Text><Text>c</Text><Text>d</Text></Grid>`), { columns: 10, rows: 4 })
    expect(r.lastFrame()).toBe('a    b\n\nc    d')
  })
})

describe('Stack', () => {
  it('lays out in a direction with a gap', async () => {
    const r = await render(tpl(`<Stack direction="row" :gap="3"><Text>a</Text><Text>b</Text></Stack><Stack :gap="1"><Text>c</Text><Text>d</Text></Stack>`), { columns: 20, rows: 5 })
    expect(r.lastFrame()).toBe('a   b\nc\n\nd')
  })

  it('reverses', async () => {
    const r = await render(tpl(`<Stack direction="horizontal" reverse :gap="1"><Text>a</Text><Text>b</Text></Stack>`), { columns: 5, rows: 1 })
    expect(r.lastFrame()).toBe('  b a')
  })
})

describe('SplitPane', () => {
  const app = (size: ReturnType<typeof ref<number | string>>, extra = '') =>
    tpl(
      `<SplitPane v-model:size="size" ${extra}><template #first><Text>left</Text></template><template #second><Text>right</Text></template></SplitPane>`,
      () => ({ size }),
    )

  it('renders two panes split at size (cells)', async () => {
    const size = ref<number | string>(10)
    const r = await render(app(size), { columns: 30, rows: 3 })
    expect(r.lastFrame().split('\n')[0]).toBe('left      ┃right')
  })

  it('accepts percentages and keeps the unit when resizing', async () => {
    const size = ref<number | string>('50%')
    const r = await render(app(size), { columns: 21, rows: 2 })
    expect(r.locate('┃')?.x).toBe(10)
    await r.press('right')
    expect(size.value).toBe('55%')
    expect(r.locate('┃')?.x).toBe(11)
  })

  it('resizes with the keyboard and clamps to min/max', async () => {
    const size = ref<number | string>(10)
    const r = await render(app(size, ':min="5" :max="15"'), { columns: 30, rows: 3 })
    await r.press('right', 'shift+right')
    expect(size.value).toBe(15)
    await r.press('left')
    expect(size.value).toBe(14)
    await r.press('home')
    expect(size.value).toBe(5)
    await r.press('end')
    expect(size.value).toBe(15)
  })

  it('drags the divider with the mouse', async () => {
    const size = ref<number | string>(10)
    const r = await render(app(size), { columns: 40, rows: 4 })
    await drag(r, 10, 1, 24, 2)
    expect(size.value).toBe(24)
    expect(r.lastFrame().split('\n')[0]).toBe('left                    ┃right')
  })

  it('collapses with enter when collapsible', async () => {
    const size = ref<number | string>(10)
    const collapsed = ref(false)
    const r = await render(
      tpl(`<SplitPane v-model:size="size" v-model:collapsed="collapsed" collapsible><template #first><Text>left</Text></template><template #second><Text>right</Text></template></SplitPane>`, () => ({ size, collapsed })),
      { columns: 30, rows: 3 },
    )
    await r.press('enter')
    expect(collapsed.value).toBe(true)
    expect(r.lastFrame()).not.toContain('left')
    expect(r.lastFrame().split('\n')[0]).toBe('┃right')
    await r.press('right')
    expect(collapsed.value).toBe(false)
    expect(r.lastFrame()).toContain('left')
  })

  it('splits vertically', async () => {
    const r = await render(
      tpl(`<SplitPane direction="vertical" size="50%"><template #first><Text>top</Text></template><template #second><Text>bottom</Text></template></SplitPane>`),
      { columns: 12, rows: 7 },
    )
    const lines = r.lastFrame().split('\n')
    expect(lines[0]).toBe('top')
    expect(lines[3]).toMatch(/^━+┅━+$/)
    expect(lines[4]).toBe('bottom')
  })
})
