import { describe, expect, it } from 'vitest'
import { InputParser, matchKey, formatKey, type KeyEvent, type MouseEvent } from '../src/input/keys.js'
import { parseClasses } from '../src/style/classes.js'
import { colorSgr, parseColor } from '../src/style/colors.js'
import { measureGlyphs, textWidth, toGlyphs, wrapGlyphs } from '../src/render/text.js'
import { CellBuffer, diffBuffers } from '../src/render/buffer.js'
import { terminalWhitespace } from '../src/compiler-options.js'

const lines = (s: string, w: number, mode?: Parameters<typeof wrapGlyphs>[2]) =>
  wrapGlyphs(toGlyphs(s, {}), w, mode).map((l) => l.map((g) => g.ch).join(''))

describe('text', () => {
  it('measures wide characters and emoji', () => {
    expect(textWidth('abc')).toBe(3)
    expect(textWidth('世界')).toBe(4)
    expect(textWidth('👍🏽')).toBe(2)
  })
  it('wraps on word boundaries', () => {
    expect(lines('hello wonderful world', 10)).toEqual(['hello', 'wonderful', 'world'])
    expect(lines('a b c', 3)).toEqual(['a b', 'c'])
  })
  it('hard-breaks long words', () => {
    expect(lines('abcdefgh', 3)).toEqual(['abc', 'def', 'gh'])
  })
  it('keeps explicit newlines', () => {
    expect(lines('one\ntwo', 10)).toEqual(['one', 'two'])
  })
  it('truncates', () => {
    expect(lines('hello world', 6, 'truncate')).toEqual(['hello…'])
    expect(lines('hello world', 6, 'truncate-start')).toEqual(['…world'])
    expect(lines('hello world', 7, 'truncate-middle')).toEqual(['hel…rld'])
  })
  it('measure returns the natural size', () => {
    const m = measureGlyphs(toGlyphs('ab\nabcd', {}), Infinity)
    expect([m.width, m.height]).toEqual([4, 2])
  })
})

describe('utility classes', () => {
  it('parses layout utilities', () => {
    expect(parseClasses('flex-col gap-2 p-1 px-3 items-center justify-between w-1/2 h-full')).toEqual({
      flexDirection: 'column',
      gap: 2,
      padding: 1,
      paddingX: 3,
      alignItems: 'center',
      justifyContent: 'space-between',
      width: '50%',
      height: '100%',
    })
  })
  it('parses colors and borders', () => {
    expect(parseClasses('border-round border-primary bg-[#112233] text-muted bold')).toEqual({
      border: 'round',
      borderColor: 'primary',
      bg: '#112233',
      color: 'muted',
      bold: true,
    })
  })
})

describe('colors', () => {
  it('parses hex, rgb and names', () => {
    expect(parseColor('#fff')).toEqual({ kind: 'rgb', r: 255, g: 255, b: 255 })
    expect(parseColor('rgb(1, 2, 3)')).toEqual({ kind: 'rgb', r: 1, g: 2, b: 3 })
    expect(parseColor('brightRed')).toEqual({ kind: 'ansi', code: 9 })
    expect(parseColor('nope')).toBeNull()
  })
  it('downsamples to the terminal depth', () => {
    const c = parseColor('#ff0000')!
    expect(colorSgr(c, 'fg', 'truecolor')).toBe('38;2;255;0;0')
    expect(colorSgr(c, 'fg', 256)).toBe('38;5;196')
    expect(colorSgr(c, 'bg', 16)).toBe('41')
  })
})

describe('input parser', () => {
  const parse = (s: string) => new InputParser().feed(s)
  const k = (s: string) => parse(s)[0] as KeyEvent
  it('parses printable and control keys', () => {
    expect(k('a')).toMatchObject({ name: 'a', char: 'a', ctrl: false })
    expect(k('\r').name).toBe('enter')
    expect(k('\x7f').name).toBe('backspace')
    expect(k('\x03')).toMatchObject({ name: 'c', ctrl: true })
    expect(k('\x1b[A').name).toBe('up')
    expect(k('\x1b[Z')).toMatchObject({ name: 'tab', shift: true })
    expect(k('\x1b[1;5C')).toMatchObject({ name: 'right', ctrl: true })
    expect(k('\x1b[3~').name).toBe('delete')
    expect(k('\x1bOP').name).toBe('f1')
    expect(k('\x1bb')).toMatchObject({ name: 'b', meta: true })
  })
  it('parses several keys in one chunk', () => {
    expect(parse('ab\x1b[B').map((e) => (e as KeyEvent).name)).toEqual(['a', 'b', 'down'])
  })
  it('waits for incomplete escape sequences', () => {
    const p = new InputParser()
    expect(p.feed('\x1b[')).toEqual([])
    expect((p.feed('A')[0] as KeyEvent).name).toBe('up')
    expect(p.feed('\x1b')).toEqual([])
    expect((p.flush()[0] as KeyEvent).name).toBe('escape')
  })
  it('parses bracketed paste', () => {
    const p = new InputParser()
    expect(p.feed('\x1b[200~hello ')).toEqual([])
    const [e] = p.feed('world\x1b[201~') as KeyEvent[]
    expect(e).toMatchObject({ name: 'paste', char: 'hello world', paste: true })
  })
  it('parses SGR mouse events', () => {
    const [down, up, wheel] = parse('\x1b[<0;10;5M\x1b[<0;10;5m\x1b[<65;3;4M') as MouseEvent[]
    expect(down).toMatchObject({ action: 'down', button: 'left', x: 9, y: 4 })
    expect(up).toMatchObject({ action: 'up' })
    expect(wheel).toMatchObject({ action: 'wheel', direction: 'down', x: 2, y: 3 })
  })
  it('matches key combos', () => {
    expect(matchKey(k('\x13'), 'ctrl+s')).toBe(true)
    expect(matchKey(k('q'), 'escape|q')).toBe(true)
    expect(matchKey(k('\t'), 'shift+tab')).toBe(false)
    expect(matchKey(k('\x1b[Z'), 'shift+tab')).toBe(true)
    expect(matchKey(k('\x1b[Z'), 'tab')).toBe(false)
    expect(formatKey('ctrl+k')).toBe('^K')
  })
})

describe('cell buffer diff', () => {
  it('only re-emits changed cells', () => {
    const a = new CellBuffer(10, 3)
    const b = new CellBuffer(10, 3)
    for (const [i, ch] of [...'hello'].entries()) {
      a.set(i, 1, ch, 1, '', null, 0)
      b.set(i, 1, ch, 1, '', null, 0)
    }
    b.set(4, 1, 'O', 1, '', null, 0)
    expect(diffBuffers(a, b)).toBe('\x1b[2;5H\x1b[0mO\x1b[0m')
    expect(diffBuffers(a, a)).toBe('')
  })
  it('handles wide glyphs', () => {
    const b = new CellBuffer(4, 1)
    b.set(0, 0, '世', 2, '', null, 0)
    b.set(1, 0, 'x', 1, '', null, 0) // overwrites the continuation half
    expect(b.toString()).toBe(' x')
  })
})

describe('template whitespace', () => {
  it('drops formatting whitespace but keeps spaces', () => {
    const node = {
      type: 1,
      children: [
        { type: 2, content: '\n    Status: ' },
        { type: 1, children: [] },
        { type: 2, content: '\n  ' },
        { type: 1, children: [] },
        { type: 2, content: '  ok\n' },
      ],
    }
    terminalWhitespace(node)
    expect(node.children.map((c) => (c as { content?: string }).content)).toEqual(['Status: ', undefined, undefined, '  ok'])
  })
})
