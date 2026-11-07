import { describe, expect, it } from 'vitest'
import { render } from '../../src/testing.js'
import { containsRtl, reorderBidi, toGlyphs, wrapGlyphs } from '../../src/render/text.js'
import { tpl } from './helpers.js'

const visual = (text: string, width = 80, dir?: 'ltr' | 'rtl' | 'auto') => {
  const glyphs = toGlyphs(text, {})
  const lines = wrapGlyphs(glyphs, width, 'wrap')
  const res = reorderBidi(glyphs, lines, dir)
  return { lines: (res?.lines ?? lines).map((l) => l.map((g) => g.ch).join('')), rtl: res?.rtl ?? null }
}

describe('bidi reordering', () => {
  it('skips plain LTR text (fast path)', () => {
    const glyphs = toGlyphs('hello (world) 123', {})
    expect(reorderBidi(glyphs, wrapGlyphs(glyphs, 80))).toBeNull()
    expect(containsRtl('hello')).toBe(false)
    expect(containsRtl('שלום')).toBe(true)
    expect(containsRtl('مرحبا')).toBe(true)
  })

  it('reverses Hebrew and detects an RTL base direction', () => {
    expect(visual('שלום')).toEqual({ lines: ['םולש'], rtl: [true] })
    expect(visual('שלום world')).toEqual({ lines: ['world םולש'], rtl: [true] })
  })

  it('keeps numbers left-to-right inside RTL text', () => {
    expect(visual('מחיר 120 שקל').lines).toEqual(['לקש 120 ריחמ'])
    expect(visual('مرحبا بالعالم 2024!').lines).toEqual(['!2024 ملاعلاب ابحرم'])
  })

  it('embeds RTL runs in LTR paragraphs and mirrors brackets', () => {
    expect(visual('abc (שלום 123) def')).toEqual({ lines: ['abc (123 םולש) def'], rtl: [false] })
    // in an RTL paragraph the parentheses are mirrored
    expect(visual('שלום (עולם)').lines).toEqual(['(םלוע) םולש'])
  })

  it('reorders per line after wrapping (logical wrap order)', () => {
    // logical: אחת שתיים שלוש → first line holds the first words
    expect(visual('אחת שתיים שלוש', 9).lines).toEqual(['םייתש תחא', 'שולש'])
  })

  it('honors an explicit direction', () => {
    expect(visual('hello!', 80, 'rtl')).toEqual({ lines: ['!hello'], rtl: [true] })
    expect(visual('שלום!', 80, 'ltr')).toEqual({ lines: ['םולש!'], rtl: [false] })
  })
})

describe('bidi painting', () => {
  it('right-aligns RTL paragraphs and reorders mixed text', async () => {
    const r = await render(
      tpl(`<Box flex-direction="column" :width="20"><Text>שלום world</Text><Text>abc (שלום) def</Text><Text dir="rtl">hello!</Text><Text dir="ltr">שלום!</Text><Text text-align="left">שלום</Text></Box>`),
      { columns: 20, rows: 5 },
    )
    expect(r.lastFrame()).toBe(['          world םולש', 'abc (םולש) def', '              !hello', 'םולש!', 'םולש'].join('\n'))
  })

  it('applies to raw text nodes of a box with dir', async () => {
    const r = await render(tpl(`<Box :width="10" dir="rtl">abc</Box>`), { columns: 10, rows: 1 })
    expect(r.lastFrame()).toBe('abc')
  })
})
