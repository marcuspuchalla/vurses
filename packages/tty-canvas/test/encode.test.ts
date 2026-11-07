import { describe, expect, it } from 'vitest'
import { Canvas, detectGraphics, diffCells, encodeCells, encodeIterm2, encodeKitty, encodeSixel, fitCells, toAnsi } from '../src/index.js'

function solid(w: number, h: number, draw: (ctx: ReturnType<Canvas['getContext']>) => void) {
  const c = new Canvas(w, h)
  draw(c.getContext('2d'))
  return c
}

describe('cell encoders', () => {
  it('halfblock: top/bottom colors as fg/bg', () => {
    const c = solid(2, 2, (ctx) => {
      ctx.fillStyle = 'red'
      ctx.fillRect(0, 0, 2, 1)
      ctx.fillStyle = 'blue'
      ctx.fillRect(0, 1, 2, 1)
    })
    const e = encodeCells(c.data, 2, 2, { mode: 'halfblock' })
    expect(e.columns).toBe(2)
    expect(e.rows).toBe(1)
    expect(e.cells[0]).toEqual({ ch: '▀', fg: 0xff0000, bg: 0x0000ff })
  })

  it('uniform cells become a background-colored space', () => {
    const c = solid(2, 2, (ctx) => {
      ctx.fillStyle = '#00ff00'
      ctx.fillRect(0, 0, 2, 2)
    })
    expect(encodeCells(c.data, 2, 2, { mode: 'halfblock' }).cells[0]).toEqual({ ch: ' ', fg: null, bg: 0x00ff00 })
    expect(encodeCells(c.data, 2, 2, { mode: 'quadrant' }).cells[0]).toEqual({ ch: ' ', fg: null, bg: 0x00ff00 })
  })

  it('transparent pixels keep a null background (or use the given background)', () => {
    const c = solid(1, 2, (ctx) => {
      ctx.fillStyle = 'white'
      ctx.fillRect(0, 1, 1, 1)
    })
    expect(encodeCells(c.data, 1, 2, { mode: 'halfblock' }).cells[0]).toEqual({ ch: '▄', fg: 0xffffff, bg: null })
    expect(encodeCells(c.data, 1, 2, { mode: 'halfblock', background: '#000' }).cells[0]).toEqual({ ch: '▀', fg: 0x000000, bg: 0xffffff })
    expect(encodeCells(new Uint8ClampedArray(8), 1, 2).cells[0]).toEqual({ ch: ' ', fg: null, bg: null })
  })

  it('quadrant picks the two dominant colors', () => {
    const c = solid(2, 2, (ctx) => {
      ctx.fillStyle = 'black'
      ctx.fillRect(0, 0, 2, 2)
      ctx.fillStyle = 'yellow'
      ctx.fillRect(1, 0, 1, 2) // right column
    })
    expect(encodeCells(c.data, 2, 2, { mode: 'quadrant' }).cells[0]).toEqual({ ch: '▌', fg: 0x000000, bg: 0xffff00 })
  })

  it('sextant uses U+1FB00 block characters', () => {
    const c = solid(2, 3, (ctx) => {
      ctx.fillStyle = 'white'
      ctx.fillRect(0, 0, 2, 3)
      ctx.fillStyle = 'black'
      ctx.fillRect(1, 1, 1, 2)
    })
    const cell = encodeCells(c.data, 2, 3, { mode: 'sextant' }).cells[0]
    // mask: (0,0) (1,0) (0,1) (0,2) = bits 0,1,2,4 = 23
    expect(cell.ch).toBe(String.fromCodePoint(0x1fb00 + 23 - 2))
    expect(cell.fg).toBe(0xffffff)
    expect(cell.bg).toBe(0x000000)
  })

  it('braille: dots for pixels that stand out from the background', () => {
    const c = solid(2, 4, (ctx) => {
      ctx.fillStyle = 'cyan'
      ctx.fillRect(0, 0, 1, 4) // left column
    })
    const cell = encodeCells(c.data, 2, 4, { mode: 'braille' }).cells[0]
    expect(cell.ch).toBe(String.fromCharCode(0x2800 | 0x01 | 0x02 | 0x04 | 0x40))
    expect(cell.fg).toBe(0x00ffff)
    expect(cell.bg).toBeNull()
  })

  it('ascii: luminance ramp', () => {
    const c = solid(2, 2, (ctx) => {
      ctx.fillStyle = 'white'
      ctx.fillRect(0, 0, 1, 2)
      ctx.fillStyle = '#333'
      ctx.fillRect(1, 0, 1, 2)
    })
    const e = encodeCells(c.data, 2, 2, { mode: 'ascii' })
    expect(e.cells[0].ch).toBe('@')
    expect(e.cells[1].ch).not.toBe('@')
  })

  it('resamples to the requested cell grid', () => {
    const c = solid(40, 40, (ctx) => {
      ctx.fillStyle = 'red'
      ctx.fillRect(0, 0, 20, 40)
    })
    const e = encodeCells(c.data, 40, 40, { mode: 'halfblock', columns: 4, rows: 2 })
    expect(e.cells).toHaveLength(8)
    expect(e.cells[0]).toEqual({ ch: ' ', fg: null, bg: 0xff0000 })
    expect(e.cells[3]).toEqual({ ch: ' ', fg: null, bg: null })
  })

  it('fitCells keeps the aspect ratio', () => {
    expect(fitCells(100, 100, 80, 24, 'contain', 'halfblock')).toEqual({ x: 16, y: 0, columns: 48, rows: 24 })
    expect(fitCells(100, 100, 80, 24, 'fill')).toEqual({ x: 0, y: 0, columns: 80, rows: 24 })
  })
})

describe('ANSI output', () => {
  it('toAnsi prints truecolor SGR', () => {
    const c = solid(2, 2, (ctx) => {
      ctx.fillStyle = 'red'
      ctx.fillRect(0, 0, 2, 1)
    })
    const s = toAnsi(c)
    expect(s).toContain('38;2;255;0;0')
    expect(s).toContain('▀')
    expect(toAnsi(c, { colorDepth: 256 })).toContain('38;5;196')
  })

  it('diffCells only rewrites changed cells', () => {
    const a = encodeCells(new Uint8ClampedArray(4 * 4 * 4), 4, 4)
    const c = solid(4, 4, (ctx) => {
      ctx.fillStyle = 'white'
      ctx.fillRect(2, 2, 1, 2)
    })
    const b = encodeCells(c.data, 4, 4)
    const d = diffCells(a, b, { x: 10, y: 5 })
    expect(d).toContain('\x1b[7;13H') // row 1 + 5 + 1, col 2 + 10 + 1
    expect(d.match(/H/g)).toHaveLength(1)
    expect(diffCells(b, b)).toBe('')
  })
})

describe('pixel protocols', () => {
  const c = solid(4, 4, (ctx) => {
    ctx.fillStyle = 'red'
    ctx.fillRect(0, 0, 4, 2)
  })

  it('kitty', () => {
    const s = encodeKitty(c.data, 4, 4, { id: 7, columns: 2, rows: 1, compress: false })
    expect(s.startsWith('\x1b_Ga=T,f=32,i=7,q=2,s=4,v=4,c=2,r=1,C=1,m=0;')).toBe(true)
    expect(s.endsWith('\x1b\\')).toBe(true)
    const payload = Buffer.from(s.slice(s.indexOf(';') + 1, -2), 'base64')
    expect(Array.from(payload.subarray(0, 4))).toEqual([255, 0, 0, 255])
  })

  it('sixel', () => {
    const s = encodeSixel(c.data, 4, 4)
    expect(s.startsWith('\x1bP0;1;0q"1;1;4;4')).toBe(true)
    expect(s).toMatch(/#\d;2;100;0;0/)
    expect(s.endsWith('-\x1b\\')).toBe(true)
  })

  it('iterm2', () => {
    const s = encodeIterm2(c.data, 4, 4, { columns: 2 })
    expect(s).toMatch(/^\x1b\]1337;File=inline=1;size=\d+;width=2:iVBORw0KGgo/)
    expect(s.endsWith('\x07')).toBe(true)
  })

  it('detectGraphics', () => {
    expect(detectGraphics({ TERM: 'xterm-kitty' }).best).toBe('kitty')
    expect(detectGraphics({ TERM_PROGRAM: 'iTerm.app' }).best).toBe('iterm2')
    expect(detectGraphics({ TERM: 'foot' }).best).toBe('sixel')
    expect(detectGraphics({ TERM: 'xterm-256color' }).best).toBeNull()
    expect(detectGraphics({ TERM: 'xterm-kitty', TMUX: '/tmp/x' }).best).toBeNull()
    expect(detectGraphics({ COLORTERM: 'truecolor' }).truecolor).toBe(true)
  })
})
