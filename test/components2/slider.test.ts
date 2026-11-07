import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { render } from '../../src/testing.js'
import { drag, tpl } from './helpers.js'

describe('Slider', () => {
  const setup = async (value: number, attrs = '', columns = 30) => {
    const v = ref(value)
    const changes: number[] = []
    const r = await render(tpl(`<Box :width="${columns}"><Slider v-model="v" label="Vol" ${attrs} @change="c.push($event)" /></Box>`, () => ({ v, c: changes })), { columns, rows: 3 })
    return { r, v, changes }
  }

  it('renders the label, the track and the value', async () => {
    const { r } = await setup(30)
    expect(r.lastFrame()).toBe('Vol ━━━━━━◆───────────────  30')
  })

  it('steps with the keyboard', async () => {
    const { r, v, changes } = await setup(30, ':step="5"')
    await r.press('right')
    expect(v.value).toBe(35)
    await r.press('shift+left')
    expect(v.value).toBe(0)
    await r.press('pageup')
    expect(v.value).toBe(10)
    await r.press('end')
    expect(v.value).toBe(100)
    await r.press('home')
    expect(v.value).toBe(0)
    expect(changes).toEqual([35, 0, 10, 100, 0])
  })

  it('clamps and snaps to step with decimals', async () => {
    const { r, v } = await setup(0.5, ':min="0" :max="1" :step="0.1"')
    await r.press('right', 'right')
    expect(v.value).toBe(0.7)
    expect(r.lastFrame()).toContain('0.7')
    await r.press('end', 'right')
    expect(v.value).toBe(1)
  })

  it('jumps to a clicked position and follows drags', async () => {
    const { r, v } = await setup(30)
    // track spans x = 4..25 (22 cells) → x=4 is 0
    await r.click(4, 0)
    expect(v.value).toBe(0)
    await drag(r, 4, 0, 25, 0)
    expect(v.value).toBe(100)
    await drag(r, 25, 0, 15, 0)
    expect(v.value).toBe(Math.round((11 / 21) * 100))
  })

  it('renders vertically', async () => {
    const v = ref(50)
    const r = await render(tpl(`<Slider v-model="v" vertical :length="5" />`, () => ({ v })), { columns: 5, rows: 7 })
    expect(r.lastFrame()).toBe(' 50\n  │\n  │\n  ◆\n  ┃\n  ┃')
    await r.press('up')
    expect(v.value).toBe(51)
  })

  it('ignores input when disabled', async () => {
    const { r, v } = await setup(30, 'disabled')
    await r.press('right')
    await r.click(10, 0)
    expect(v.value).toBe(30)
  })
})
