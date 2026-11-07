import { describe, expect, it } from 'vitest'
import { render } from '../../src/testing.js'
import { contrastColor, gradientStops, resolveColorHex } from '../../src/components/gradient.js'
import { darkTheme } from '../../src/style/theme.js'
import { bgAt, fgAt, rgb, tpl } from './helpers.js'

describe('gradient helpers', () => {
  it('resolves theme tokens, names and hex', () => {
    expect(resolveColorHex('primary', darkTheme)).toBe(darkTheme.primary)
    expect(resolveColorHex('#abc')).toBe('#aabbcc')
    expect(resolveColorHex('red')).toBe('#cd3131')
    expect(resolveColorHex('nope')).toBeNull()
  })
  it('interpolates multi-stop gradients', () => {
    expect(gradientStops(['#000000', '#ffffff'], 3)).toEqual(['#000000', '#808080', '#ffffff'])
    expect(gradientStops(['#ff0000', '#00ff00', '#0000ff'], 5)).toEqual(['#ff0000', '#808000', '#00ff00', '#008080', '#0000ff'])
    expect(gradientStops('rainbow', 2)[0]).toBe('#ff5f6d')
    expect(gradientStops(['#123456'], 2)).toEqual(['#123456', '#123456'])
  })
  it('picks a contrasting text color', () => {
    expect(contrastColor('#ffffff')).toBe('#000000')
    expect(contrastColor('#101010')).toBe('#ffffff')
  })
})

describe('Gradient', () => {
  it('colors each character along the gradient', async () => {
    const r = await render(tpl(`<Gradient text="abcde" :colors="['#000000', '#ffffff']" />`), { columns: 10, rows: 1 })
    expect(r.lastFrame()).toBe('abcde')
    expect(fgAt(r, 0, 0)).toBe(rgb('#000000'))
    expect(fgAt(r, 2, 0)).toBe(rgb('#808080'))
    expect(fgAt(r, 4, 0)).toBe(rgb('#ffffff'))
  })

  it('supports vertical gradients over multiple lines and theme tokens', async () => {
    const r = await render(tpl(`<Gradient :text="'ab\\ncd'" :colors="['primary', 'error']" direction="vertical" />`), { columns: 10, rows: 2 })
    expect(r.lastFrame()).toBe('ab\ncd')
    expect(fgAt(r, 1, 0)).toBe(rgb(darkTheme.primary))
    expect(fgAt(r, 1, 1)).toBe(rgb(darkTheme.error))
  })

  it('takes text from the default slot', async () => {
    const r = await render(tpl(`<Gradient colors="vue">slot text</Gradient>`), { columns: 20, rows: 1 })
    expect(r.lastFrame()).toBe('slot text')
  })

  it('renders a background bar with centered text', async () => {
    const r = await render(tpl(`<Gradient bar :width="10" text="hi" :colors="['#000000', '#ffffff']" />`), { columns: 10, rows: 1 })
    expect(r.lastFrame()).toBe('    hi')
    expect(bgAt(r, 0, 0)).toBe(rgb('#000000', 'bg'))
    expect(bgAt(r, 9, 0)).toBe(rgb('#ffffff', 'bg'))
    // text on the dark half is white, on the light half black
    expect(fgAt(r, 4, 0)).toBe(rgb('#ffffff'))
  })
})
