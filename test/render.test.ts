import { describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { render } from '../src/testing.js'
import { Box, Text, useInput } from '../src/index.js'

const tpl = (template: string, setup: () => Record<string, unknown> = () => ({})) => defineComponent({ setup, template })

describe('layout & painting', () => {
  it('renders text inside a bordered box', async () => {
    const r = await render(tpl(`<Box border="round" class="self-start" :padding-x="1"><Text>Hello</Text></Box>`), { columns: 20, rows: 5 })
    expect(r.lastFrame()).toBe(['╭───────╮', '│ Hello │', '╰───────╯'].join('\n'))
  })

  it('lays out rows and columns with gaps', async () => {
    const r = await render(
      tpl(`<Box class="flex-col gap-1"><Box class="gap-2"><Text>a</Text><Text>b</Text></Box><Text>c</Text></Box>`),
      { columns: 10, rows: 5 },
    )
    expect(r.lastFrame()).toBe('a  b\n\nc')
  })

  it('grows, aligns and justifies', async () => {
    const r = await render(tpl(`<Box :width="11" justify-content="space-between"><Text>L</Text><Text>M</Text><Text>R</Text></Box>`), {
      columns: 20,
      rows: 1,
    })
    expect(r.lastFrame()).toBe('L    M    R')
  })

  it('wraps text to the available width', async () => {
    const r = await render(tpl(`<Box :width="8"><Text>one two three</Text></Box>`), { columns: 20, rows: 4 })
    expect(r.lastFrame()).toBe('one two\nthree')
  })

  it('draws border titles', async () => {
    const r = await render(tpl(`<Box border :width="14" :height="3" title="Title" />`), { columns: 20, rows: 3 })
    expect(r.lastFrame().split('\n')[0]).toBe('┌─ Title ────┐')
  })

  it('supports nested styled spans', async () => {
    const r = await render(tpl(`<Text>a <Text bold color="red">b</Text> c</Text>`), { columns: 10, rows: 1 })
    expect(r.lastFrame()).toBe('a b c')
    const buf = r.buffer()
    expect(buf.flags[2] & 1).toBe(1) // bold
    expect(buf.fg[2]).toBe('31')
    expect(buf.flags[0] & 1).toBe(0)
  })

  it('fills backgrounds and clips overflow', async () => {
    const r = await render(tpl(`<Box :width="4" :height="1" bg="#000000" overflow="hidden"><Text wrap="none">abcdefgh</Text></Box>`), {
      columns: 10,
      rows: 1,
    })
    expect(r.lastFrame()).toBe('abcd')
    expect(r.buffer().bg[0]).toBe('48;2;0;0;0')
  })

  it('positions absolute children on top', async () => {
    const r = await render(
      tpl(`<Box :width="6" :height="1"><Text>xxxxxx</Text><Box position="absolute" :left="2" :top="0"><Text>OK</Text></Box></Box>`),
      { columns: 10, rows: 1 },
    )
    expect(r.lastFrame()).toBe('xxOKxx')
  })

  it('updates reactively with v-if / v-for / v-show', async () => {
    const show = ref(true)
    const items = ref(['a', 'b'])
    const r = await render(
      tpl(`<Box class="flex-col"><Text v-if="show">if</Text><Text v-show="show">show</Text><Text v-for="i in items" :key="i">{{ i }}</Text></Box>`, () => ({ show, items })),
      { columns: 10, rows: 6 },
    )
    expect(r.lastFrame()).toBe('if\nshow\na\nb')
    show.value = false
    items.value = ['c']
    await r.settle()
    expect(r.lastFrame()).toBe('c')
  })

  it('works with render functions', async () => {
    const App = defineComponent({ setup: () => () => h(Box, { flexDirection: 'column' }, () => [h(Text, null, () => 'x'), h(Text, null, () => 'y')]) })
    const r = await render(App, { columns: 4, rows: 2 })
    expect(r.lastFrame()).toBe('x\ny')
  })

  it('applies themes to tokens', async () => {
    const r = await render(tpl(`<Text color="primary">x</Text>`), { columns: 2, rows: 1, theme: 'dracula' })
    expect(r.buffer().fg[0]).toBe('38;2;189;147;249')
    r.app.runtime!.ctx.setTheme('light')
    await r.settle()
    expect(r.buffer().fg[0]).toBe('38;2;47;143;98')
  })
})

describe('input & focus', () => {
  it('delivers keys to useInput handlers', async () => {
    const seen: string[] = []
    const App = defineComponent({
      setup() {
        useInput((e) => seen.push(e.name))
        return () => h(Text, null, () => 'x')
      },
    })
    const r = await render(App)
    await r.press('a', 'enter', 'ctrl+s')
    expect(seen).toEqual(['a', 'enter', 's'])
  })

  it('tabs between focusable components and activates buttons', async () => {
    const clicks: string[] = []
    const r = await render(
      tpl(`<Box class="gap-1"><Button label="One" @click="c.push('one')" /><Button label="Two" @click="c.push('two')" /></Box>`, () => ({ c: clicks })),
      { columns: 30, rows: 3 },
    )
    await r.press('enter') // first button is auto-focused
    await r.press('tab', 'space')
    await r.press('shift+tab', 'enter')
    expect(clicks).toEqual(['one', 'two', 'one'])
  })

  it('handles mouse clicks', async () => {
    const clicks = ref(0)
    const r = await render(tpl(`<Box class="flex-col"><Button label="Hit me" @click="n++" /><Text>{{ n }}</Text></Box>`, () => ({ n: clicks })), {
      columns: 20,
      rows: 5,
    })
    const pos = r.locate('Hit me')!
    await r.click(pos.x, pos.y)
    expect(clicks.value).toBe(1)
    expect(r.lastFrame()).toContain('1')
  })
})
