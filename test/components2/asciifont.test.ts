import { describe, expect, it } from 'vitest'
import { render } from '../../src/testing.js'
import { figletFontNames, getFigletFont, loadFigletFont, registerFigletFont, renderFiglet, SM_SMUSH } from '../../src/fonts/index.js'
import { darkTheme } from '../../src/style/theme.js'
import { fgAt, rgb, tpl } from './helpers.js'

const standard = () => getFigletFont('standard')!

describe('FIGlet parser', () => {
  it('parses the header of standard.flf', () => {
    const f = standard()
    expect(f.hardblank).toBe('$')
    expect(f.height).toBe(6)
    expect(f.baseline).toBe(5)
    // full_layout 24463 → horizontal smushing with rules 1-4
    expect(f.smushMode).toBe(SM_SMUSH | 15)
    expect(f.comment).toContain('Glenn Chappell')
    expect(f.chars.get(65)).toHaveLength(6)
    // code-tagged characters (Latin-2 etc.)
    expect(f.chars.has(0x0104)).toBe(true)
    expect(figletFontNames()).toEqual(expect.arrayContaining(['standard', 'slant', 'small', 'mini']))
  })

  it('renders "Hello" in standard (smushing rules)', () => {
    expect(renderFiglet('Hello', standard())).toEqual([
      ' _   _      _ _       ',
      '| | | | ___| | | ___  ',
      "| |_| |/ _ \\ | |/ _ \\ ",
      '|  _  |  __/ | | (_) |',
      '|_| |_|\\___|_|_|\\___/ ',
      '                      ',
    ])
  })

  it('renders "Hi" in standard and slant', () => {
    expect(renderFiglet('Hi', standard(), { trimEnd: true })).toEqual([' _   _ _', '| | | (_)', '| |_| | |', '|  _  | |', '|_| |_|_|', ''])
    expect(renderFiglet('Hi', getFigletFont('slant')!, { trimEnd: true })).toEqual(['    __  ___', '   / / / (_)', '  / /_/ / /', ' / __  / /', '/_/ /_/_/', ''])
  })

  it('renders small and mini', () => {
    expect(renderFiglet('Hello', getFigletFont('small')!, { trimEnd: true })).toEqual([' _  _     _ _', '| || |___| | |___', '| __ / -_) | / _ \\', '|_||_\\___|_|_\\___/', ''])
    expect(renderFiglet('Hi', getFigletFont('mini')!, { trimEnd: true })).toEqual(['', '|_|o', '| ||', ''])
  })

  it('supports full width, fitting and universal smushing layouts', () => {
    const f = standard()
    expect(renderFiglet('Hi', f, { layout: 'full', trimEnd: true })[1]).toBe(' | | | | (_)')
    expect(renderFiglet('Hi', f, { layout: 'fitted', trimEnd: true })[1]).toBe('| | | |(_)')
    expect(renderFiglet('Hi', f, { layout: 'universal', trimEnd: true })[1]).toBe('| | | (_)')
  })

  it('applies the controlled smushing rules', () => {
    // a tiny font (height 1) to exercise each rule: two chars, each 2 wide
    const font = (rules: number, a: string, b: string) =>
      loadFigletFont(
        [`flf2a$ 1 1 4 ${rules} 0`, ...Array.from({ length: 95 }, (_, i) => (i === 33 ? `${a}@@` : i === 34 ? `${b}@@` : ' @@'))].join('\n'),
      )
    const run = (rules: number, a: string, b: string) => renderFiglet('AB', font(rules, a, b))[0]
    expect(run(1, 'x|', '|x')).toBe('x|x') // rule 1: equal character
    expect(run(2, 'x_', '/x')).toBe('x/x') // rule 2: underscore
    expect(run(4, 'x|', '/x')).toBe('x/x') // rule 3: hierarchy
    expect(run(4, 'x}', '(x')).toBe('x(x')
    expect(run(8, 'x[', ']x')).toBe('x|x') // rule 4: opposite pair
    expect(run(16, 'x/', '\\x')).toBe('x|x') // rule 5: big X
    expect(run(16, 'x\\', '/x')).toBe('xYx')
    expect(run(16, 'x>', '<x')).toBe('xXx')
    expect(run(32, 'x$', '$x')).toBe('x x') // rule 6: hardblank (rendered as space)
    expect(run(1, 'x|', '/x')).toBe('x|/x') // no applicable rule: fitting only
    expect(run(0, 'x|', '/x')).toBe('x|/x') // kerning (old layout 0)
    expect(run(-1, 'x ', ' x')).toBe('x  x') // full width
    // universal smushing (no rules): the later character wins
    const uni = loadFigletFont(['flf2a$ 1 1 4 0 0 0 128', ...Array.from({ length: 95 }, (_, i) => (i === 33 ? 'x|@@' : i === 34 ? '/x@@' : ' @@'))].join('\n'))
    expect(renderFiglet('AB', uni)[0]).toBe('x/x')
  })

  it('handles newlines, missing characters and invalid fonts', () => {
    expect(renderFiglet('a\nb', standard()).length).toBe(12)
    expect(renderFiglet('a一', standard())).toEqual(renderFiglet('a', standard()))
    expect(() => loadFigletFont('not a font')).toThrow(/flf2a/)
  })

  it('registers custom fonts', () => {
    registerFigletFont('tiny', ['flf2a$ 1 1 2 -1 1', 'comment', ...Array.from({ length: 95 }, (_, i) => `${String.fromCharCode(32 + i).toLowerCase()}@@`)].join('\n'))
    expect(renderFiglet('AB', getFigletFont('tiny')!)).toEqual(['ab'])
  })
})

describe('AsciiFont', () => {
  it('renders text with a named font', async () => {
    const r = await render(tpl(`<AsciiFont text="Hi" font="slant" />`), { columns: 20, rows: 6 })
    expect(r.lastFrame()).toBe('    __  ___\n   / / / (_)\n  / /_/ / /\n / __  / /\n/_/ /_/_/')
  })

  it('colors with a gradient', async () => {
    const r = await render(tpl(`<AsciiFont text="Hi" :gradient="['#000000', '#ffffff']" />`), { columns: 20, rows: 6 })
    expect(r.lastFrame().split('\n')[1]).toBe('| | | (_)')
    expect(fgAt(r, 0, 1)).toBe(rgb('#000000'))
    expect(fgAt(r, 8, 1)).toBe(rgb('#ffffff'))
  })

  it('uses a single color and reports unknown fonts', async () => {
    const r = await render(tpl(`<AsciiFont text="Hi" color="primary" /><AsciiFont text="x" font="nope" />`), { columns: 40, rows: 8 })
    expect(fgAt(r, 0, 1)).toBe(rgb(darkTheme.primary))
    expect(r.lastFrame()).toContain('[unknown font "nope"] x')
  })
})
