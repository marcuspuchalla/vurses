import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { render } from '../../src/testing.js'
import { formatTick, niceTicks } from '../../src/components/charts.js'
import { darkTheme } from '../../src/style/theme.js'
import { fgAt, rgb, tpl } from './helpers.js'

const isBraille = (ch: string) => ch.length === 1 && ch.charCodeAt(0) >= 0x2800 && ch.charCodeAt(0) <= 0x28ff

describe('chart helpers', () => {
  it('computes nice ticks', () => {
    expect(niceTicks(0, 100, 5)).toEqual([0, 20, 40, 60, 80, 100])
    expect(niceTicks(0.1, 0.9, 4)).toEqual([0.2, 0.4, 0.6, 0.8])
    expect(niceTicks(-10, 10, 4)).toEqual([-10, -5, 0, 5, 10])
  })
  it('formats ticks compactly', () => {
    expect(formatTick(12500)).toBe('12.5k')
    expect(formatTick(2_000_000)).toBe('2M')
    expect(formatTick(0.25)).toBe('0.25')
    expect(formatTick(42)).toBe('42')
  })
})

describe('LineChart', () => {
  it('plots a rising line in braille with axes', async () => {
    const data = Array.from({ length: 21 }, (_, i) => i * 5)
    const r = await render(tpl(`<LineChart :data="data" :height="7" :width="30" />`, () => ({ data })), { columns: 30, rows: 7 })
    const lines = r.lastFrame().split('\n')
    expect(lines[0]).toMatch(/^100┤/)
    expect(lines[4]).toMatch(/^  0┤⣀/)
    expect(lines[5]).toMatch(/^ {3}└┬─+┬/)
    expect(lines[6]).toMatch(/^ {4}0 +10 +20$/)
    // the line rises: top-right and bottom-left cells contain braille dots
    expect(isBraille(lines[0].at(-1)!)).toBe(true)
    expect(isBraille(lines[4][4])).toBe(true)
    expect(lines[0][4]).toBe(' ')
  })

  it('draws multiple series with their colors and a legend', async () => {
    const series = [
      { name: 'up', data: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] },
      { name: 'down', data: [9, 8, 7, 6, 5, 4, 3, 2, 1, 0], color: 'error' },
    ]
    const r = await render(tpl(`<LineChart :series="series" :height="8" :width="24" />`, () => ({ series })), { columns: 24, rows: 9 })
    const frame = r.lastFrame()
    expect(frame.split('\n').at(-1)).toBe('━━ up  ━━ down')
    // find a braille cell from each series by color
    const b = r.buffer()
    const colors = new Set<string>()
    for (let i = 0; i < b.chars.length; i++) if (isBraille(b.chars[i])) colors.add(b.fg[i])
    expect(colors).toEqual(new Set([rgb(darkTheme.primary), rgb(darkTheme.error)]))
    const leg = r.locate('━━ up')!
    expect(fgAt(r, leg.x, leg.y)).toBe(rgb(darkTheme.primary))
  })

  it('honors explicit min/max, x labels and hides axes', async () => {
    const r = await render(tpl(`<LineChart :data="[1, 2, 3]" :min="0" :max="10" :x-labels="['mon', 'tue', 'wed']" :height="5" :width="30" />`), { columns: 30, rows: 5 })
    const lines = r.lastFrame().split('\n')
    expect(lines[0]).toMatch(/^10┤/)
    expect(lines.at(-1)).toMatch(/mon .*wed/)
    const r2 = await render(tpl(`<LineChart :data="[1, 2, 3]" :axes="false" :height="2" :width="10" />`), { columns: 10, rows: 2 })
    expect(r2.lastFrame()).not.toMatch(/[│┤└]/)
    expect([...r2.lastFrame()].some(isBraille)).toBe(true)
  })

  it('re-renders when data changes', async () => {
    const data = ref([0, 0, 0, 0])
    const r = await render(tpl(`<LineChart :data="data" :min="0" :max="4" :height="4" :width="12" :axes="false" />`, () => ({ data })), { columns: 12, rows: 4 })
    const before = r.lastFrame()
    data.value = [4, 4, 4, 4]
    await r.settle()
    expect(r.lastFrame()).not.toBe(before)
    expect(isBraille(r.lastFrame().split('\n')[0][0])).toBe(true)
  })
})
