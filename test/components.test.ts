import { describe, expect, it } from 'vitest'
import { defineComponent, ref } from 'vue'
import { render } from '../src/testing.js'
import { useKeymap } from '../src/index.js'

const tpl = (template: string, setup: () => Record<string, unknown> = () => ({})) => defineComponent({ setup, template })

describe('TextInput', () => {
  it('edits with v-model and cursor keys', async () => {
    const value = ref('')
    const submitted: string[] = []
    const r = await render(tpl(`<TextInput v-model="v" @submit="s.push($event)" :width="20" />`, () => ({ v: value, s: submitted })), {
      columns: 30,
      rows: 3,
    })
    await r.type('helo')
    await r.press('left', 'l', 'end', '!')
    expect(value.value).toBe('hello!')
    await r.press('backspace', 'home', 'delete')
    expect(value.value).toBe('ello')
    await r.paste('Y ')
    expect(value.value).toBe('Y ello')
    await r.press('ctrl+e', 'ctrl+w')
    expect(value.value).toBe('Y ')
    await r.press('enter')
    expect(submitted).toEqual(['Y '])
    expect(r.lastFrame()).toContain('Y')
  })

  it('does not leak typed keys to global handlers', async () => {
    const quit = ref(false)
    const App = tpl(`<TextInput v-model="v" />`, () => ({ v: ref('') }))
    const Wrapper = defineComponent({
      components: { App },
      setup() {
        useKeymap({ q: () => (quit.value = true) })
        return {}
      },
      template: '<App />',
    })
    const r = await render(Wrapper)
    await r.type('q')
    expect(quit.value).toBe(false)
  })

  it('masks passwords', async () => {
    const r = await render(tpl(`<TextInput model-value="secret" password :auto-focus="false" />`), { columns: 30, rows: 3 })
    expect(r.lastFrame()).toContain('••••••')
    expect(r.lastFrame()).not.toContain('secret')
  })
})

describe('Checkbox / Switch / RadioGroup', () => {
  it('toggles a checkbox', async () => {
    const on = ref(false)
    const r = await render(tpl(`<Checkbox v-model="on" label="Accept" />`, () => ({ on })), { columns: 20, rows: 1 })
    expect(r.lastFrame()).toBe('[ ] Accept')
    await r.press('space')
    expect(on.value).toBe(true)
    expect(r.lastFrame()).toBe('[✓] Accept')
  })

  it('selects radio options', async () => {
    const v = ref('a')
    const r = await render(tpl(`<RadioGroup v-model="v" :options="['a', 'b', 'c']" />`, () => ({ v })), { columns: 20, rows: 3 })
    await r.press('down', 'down', 'enter')
    expect(v.value).toBe('c')
    expect(r.lastFrame()).toBe('○ a\n○ b\n◉ c')
  })

  it('switches', async () => {
    const v = ref(false)
    const r = await render(tpl(`<Switch v-model="v" label="Wifi" />`, () => ({ v })), { columns: 20, rows: 1 })
    await r.press('enter')
    expect(v.value).toBe(true)
    expect(r.lastFrame()).toContain('ON')
  })
})

describe('List / Select', () => {
  it('navigates and selects', async () => {
    const picked: string[] = []
    const r = await render(tpl(`<List :items="['one', 'two', 'three']" @select="(i) => p.push(i)" />`, () => ({ p: picked })), {
      columns: 20,
      rows: 3,
    })
    expect(r.lastFrame()).toBe('❯ one\n  two\n  three')
    await r.press('down', 'down', 'enter')
    expect(picked).toEqual(['three'])
    await r.press('up')
    expect(r.lastFrame()).toBe('  one\n❯ two\n  three')
  })

  it('scrolls when taller than its height', async () => {
    const items = Array.from({ length: 10 }, (_, i) => `item ${i}`)
    const r = await render(tpl(`<List :items="items" :height="3" />`, () => ({ items })), { columns: 20, rows: 5 })
    await r.press('end')
    const frame = r.lastFrame()
    expect(frame).toContain('❯ item 9')
    expect(frame).not.toContain('item 0')
  })

  it('selects by value', async () => {
    const v = ref('vue')
    const r = await render(
      tpl(`<Select v-model="v" :options="[{ label: 'Vue', value: 'vue' }, { label: 'Svelte', value: 'svelte' }]" />`, () => ({ v })),
      { columns: 20, rows: 3 },
    )
    await r.press('down', 'enter')
    expect(v.value).toBe('svelte')
  })
})

describe('Tabs', () => {
  it('switches content with keys and clicks', async () => {
    const r = await render(
      tpl(`<Tabs :tabs="['A', 'B']"><template #A><Text>content A</Text></template><template #B><Text>content B</Text></template></Tabs>`),
      { columns: 30, rows: 6 },
    )
    expect(r.lastFrame()).toContain('content A')
    await r.press('right')
    expect(r.lastFrame()).toContain('content B')
    const pos = r.locate(' A ')!
    await r.click(pos.x + 1, pos.y)
    expect(r.lastFrame()).toContain('content A')
  })
})

describe('ScrollBox', () => {
  it('scrolls with keys and wheel', async () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i}`)
    const r = await render(
      tpl(`<Box :height="5" class="flex-col"><ScrollBox><Text v-for="l in lines" :key="l">{{ l }}</Text></ScrollBox></Box>`, () => ({ lines })),
      { columns: 20, rows: 6 },
    )
    expect(r.lastFrame()).toContain('line 0')
    await r.press('end')
    expect(r.lastFrame()).toContain('line 19')
    expect(r.lastFrame()).not.toContain('line 0')
    await r.wheel(1, 1, 'up')
    expect(r.lastFrame()).toContain('line 14')
    expect(r.lastFrame()).not.toContain('line 19')
  })

  it('sticks to the bottom', async () => {
    const lines = ref(['a'])
    const r = await render(
      tpl(`<Box :height="3" class="flex-col"><ScrollBox stick-to-bottom><Text v-for="l in lines" :key="l">{{ l }}</Text></ScrollBox></Box>`, () => ({ lines })),
      { columns: 20, rows: 4 },
    )
    lines.value = Array.from({ length: 10 }, (_, i) => `row ${i}`)
    await r.settle()
    expect(r.lastFrame()).toContain('row 9')
  })
})

describe('Dialog', () => {
  it('traps focus and closes on escape', async () => {
    const open = ref(false)
    const clicks: string[] = []
    const r = await render(
      tpl(
        `<Box class="flex-col">
           <Button label="Open" @click="open = true" />
           <Dialog v-model:open="open" title="Hi" :width="30">
             <Text>Inside</Text>
             <template #footer>
               <Button label="A" @click="c.push('a')" />
               <Button label="B" @click="c.push('b')" />
             </template>
           </Dialog>
         </Box>`,
        () => ({ open, c: clicks }),
      ),
      { columns: 40, rows: 12 },
    )
    await r.press('enter')
    expect(open.value).toBe(true)
    expect(r.lastFrame()).toContain('Inside')
    // focus cycles only inside the dialog
    await r.press('enter', 'tab', 'enter', 'tab', 'enter')
    expect(clicks).toEqual(['a', 'b', 'a'])
    await r.press('escape')
    expect(open.value).toBe(false)
    expect(r.lastFrame()).not.toContain('Inside')
  })
})

describe('Table', () => {
  it('renders columns and selects rows', async () => {
    const sel = ref(0)
    const rows = [
      { name: 'web', cpu: 12 },
      { name: 'worker', cpu: 7 },
    ]
    const r = await render(
      tpl(`<Table :rows="rows" :columns="[{ key: 'name', title: 'Name' }, { key: 'cpu', title: 'CPU', align: 'right' }]" selectable v-model="sel" />`, () => ({ rows, sel })),
      { columns: 30, rows: 8 },
    )
    const f = r.lastFrame()
    expect(f).toContain('Name    CPU')
    expect(f).toContain('worker    7')
    await r.press('down')
    expect(sel.value).toBe(1)
  })
})

describe('display components', () => {
  it('renders progress bars, sparklines and big text', async () => {
    const r = await render(
      tpl(`<Box class="flex-col"><ProgressBar :value="0.5" :width="10" show-percent /><Sparkline :data="[0, 7]" :min="0" :max="7" /><BigText text="HI" /></Box>`),
      { columns: 30, rows: 6 },
    )
    const [bar, spark, ...big] = r.lastFrame().split('\n')
    expect(bar).toBe('█████░░░░░  50%')
    expect(spark).toBe('▁█')
    expect(big.join('\n')).toBe('█ █ ▀█▀\n█▀█  █\n▀ ▀ ▀▀▀')
  })

  it('renders markdown', async () => {
    const r = await render(tpl(`<Markdown source="# Title\n\n- **one**\n- two" />`), { columns: 30, rows: 6 })
    expect(r.lastFrame()).toBe('Title\n\n• one\n• two')
  })
})
