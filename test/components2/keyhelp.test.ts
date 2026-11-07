import { describe, expect, it } from 'vitest'
import { defineComponent, ref } from 'vue'
import { render } from '../../src/testing.js'
import { useKeymap, useKeyBindings } from '../../src/composables.js'
import { formatCombo, groupBindings } from '../../src/components/keyhelp.js'

describe('useKeymap with descriptions', () => {
  it('keeps the plain-function form and supports binding objects', async () => {
    const calls: string[] = []
    const App = defineComponent({
      setup() {
        useKeymap({
          q: () => calls.push('q'),
          'ctrl+s': { handler: () => calls.push('save'), description: 'Save', group: 'File' },
        })
        return {}
      },
      template: '<Text>app</Text>',
    })
    const r = await render(App, { columns: 10, rows: 1 })
    await r.press('q', 'ctrl+s')
    expect(calls).toEqual(['q', 'save'])
  })

  it('respects `when` and keeps a reactive registry of active bindings', async () => {
    const enabled = ref(false)
    const calls: string[] = []
    let list: ReturnType<typeof useKeyBindings> | null = null
    const Child = defineComponent({
      setup() {
        useKeymap({ x: { handler: () => calls.push('x'), description: 'Child X', when: enabled } }, { group: 'Child' })
        return {}
      },
      template: '<Text>child</Text>',
    })
    const show = ref(true)
    const App = defineComponent({
      components: { Child },
      setup() {
        useKeymap({ a: { handler: () => {}, description: 'A' } })
        list = useKeyBindings()
        return { show }
      },
      template: '<Child v-if="show" />',
    })
    const r = await render(App, { columns: 10, rows: 1 })
    expect(list!.value.map((b) => b.keys)).toEqual(['a'])
    await r.press('x')
    expect(calls).toEqual([])
    enabled.value = true
    await r.settle()
    expect(list!.value).toEqual(expect.arrayContaining([{ keys: 'x', description: 'Child X', group: 'Child' }]))
    await r.press('x')
    expect(calls).toEqual(['x'])
    show.value = false
    await r.settle()
    expect(list!.value.map((b) => b.keys)).toEqual(['a'])
  })

  it('formats combos and groups bindings', () => {
    expect(formatCombo('ctrl+s|ctrl+x')).toBe('^S / ^X')
    expect(groupBindings([{ keys: 'a', group: 'X' }, { keys: 'b' }, { keys: 'c', group: 'X' }]).map((g) => [g.group, g.items.length])).toEqual([
      ['X', 2],
      ['General', 1],
    ])
  })
})

describe('KeyHelp', () => {
  const App = defineComponent({
    setup() {
      useKeymap({
        'ctrl+s': { handler: () => {}, description: 'Save', group: 'File' },
        'ctrl+o|o': { handler: () => {}, description: 'Open', group: 'File' },
        q: { handler: () => {}, description: 'Quit' },
        z: () => {},
      })
      return {}
    },
    template: '<Box flex-direction="column"><Text>main</Text><KeyHelp /></Box>',
  })

  it('opens with ? and lists bindings grouped with descriptions', async () => {
    const r = await render(App, { columns: 70, rows: 20 })
    expect(r.lastFrame()).not.toContain('Keyboard shortcuts')
    await r.press('?')
    const f = r.lastFrame()
    expect(f).toContain('Keyboard shortcuts')
    expect(f).toMatch(/\^S\s+Save/)
    expect(f).toMatch(/\^O \/ o\s+Open/)
    expect(f).toMatch(/q\s+Quit/)
    expect(f).toContain('File')
    expect(f).toContain('General')
    expect(f).not.toMatch(/\bz\b/)
    expect(f.indexOf('File')).toBeLessThan(f.indexOf('Save'))
  })

  it('closes with ? again and with escape', async () => {
    const r = await render(App, { columns: 70, rows: 20 })
    await r.press('?')
    await r.press('?')
    expect(r.lastFrame()).not.toContain('Keyboard shortcuts')
    await r.press('?')
    await r.press('escape')
    expect(r.lastFrame()).not.toContain('Keyboard shortcuts')
  })

  it('renders inline with extra entries', async () => {
    const r = await render(
      defineComponent({ template: `<KeyHelp inline title="Keys" :extra="[{ keys: 'tab', description: 'Next field', group: 'Navigation' }]" />` }),
      { columns: 40, rows: 6 },
    )
    expect(r.lastFrame()).toBe(['╭─ Keys ───────────────────────────────╮', '│ Navigation                           │', '│ tab   Next field                     │', '╰──────────────────────────────────────╯'].join('\n'))
  })
})
