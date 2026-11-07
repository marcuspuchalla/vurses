import { describe, expect, it } from 'vitest'
import { Canvas, ImageData, parseColor } from '../src/index.js'
import { make, px } from './helpers.js'

describe('CSS colors', () => {
  it('parses hex, rgb(a), hsl(a), named and transparent', () => {
    expect(parseColor('#f00')).toEqual([255, 0, 0, 1])
    expect(parseColor('#ff000080')![3]).toBeCloseTo(0.502, 2)
    expect(parseColor('rgb(1, 2, 3)')).toEqual([1, 2, 3, 1])
    expect(parseColor('rgba(10,20,30,0.5)')).toEqual([10, 20, 30, 0.5])
    expect(parseColor('rgb(10 20 30 / 50%)')).toEqual([10, 20, 30, 0.5])
    expect(parseColor('hsl(120, 100%, 50%)')).toEqual([0, 255, 0, 1])
    expect(parseColor('hsla(240 100% 50% / 0.25)')).toEqual([0, 0, 255, 0.25])
    expect(parseColor('rebeccapurple')).toEqual([102, 51, 153, 1])
    expect(parseColor('transparent')).toEqual([0, 0, 0, 0])
    expect(parseColor('nope')).toBeNull()
  })

  it('serializes fillStyle like browsers', () => {
    const { ctx } = make()
    ctx.fillStyle = 'rgba(255, 0, 0, 0.5)'
    expect(ctx.fillStyle).toBe('rgba(255, 0, 0, 0.5)')
    ctx.fillStyle = 'hsl(0, 100%, 50%)'
    expect(ctx.fillStyle).toBe('#ff0000')
  })
})

describe('gradients', () => {
  it('linear gradient interpolates between stops', () => {
    const { c, ctx } = make(101, 1)
    const g = ctx.createLinearGradient(0, 0, 101, 0)
    g.addColorStop(0, '#000000')
    g.addColorStop(1, '#ffffff')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 101, 1)
    expect(px(c, 0, 0)[0]).toBeLessThan(5)
    expect(Math.abs(px(c, 50, 0)[0] - 128)).toBeLessThan(4)
    expect(px(c, 100, 0)[0]).toBeGreaterThan(250)
  })

  it('pads outside the gradient line and supports hard stops', () => {
    const { c, ctx } = make(20, 1)
    const g = ctx.createLinearGradient(5, 0, 15, 0)
    g.addColorStop(0, 'red')
    g.addColorStop(0.5, 'red')
    g.addColorStop(0.5, 'blue')
    g.addColorStop(1, 'blue')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 20, 1)
    expect(px(c, 0, 0)).toEqual([255, 0, 0, 255])
    expect(px(c, 8, 0)).toEqual([255, 0, 0, 255])
    expect(px(c, 11, 0)).toEqual([0, 0, 255, 255])
    expect(px(c, 19, 0)).toEqual([0, 0, 255, 255])
  })

  it('radial gradient: center color inside, edge color outside', () => {
    const { c, ctx } = make(21, 21)
    const g = ctx.createRadialGradient(10.5, 10.5, 0, 10.5, 10.5, 10)
    g.addColorStop(0, 'white')
    g.addColorStop(1, 'black')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 21, 21)
    expect(px(c, 10, 10)[0]).toBeGreaterThan(240)
    expect(px(c, 0, 0)[0]).toBe(0)
  })

  it('conic gradient sweeps around the center', () => {
    const { c, ctx } = make(20, 20)
    const g = ctx.createConicGradient(0, 10, 10)
    g.addColorStop(0, 'black')
    g.addColorStop(1, 'white')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 20, 20)
    // angle 0 = right (dark), angle π = left (mid gray)
    expect(px(c, 19, 10)[0]).toBeLessThan(30)
    expect(Math.abs(px(c, 0, 10)[0] - 128)).toBeLessThan(20)
    expect(px(c, 18, 9)[0]).toBeGreaterThan(220) // just above the start line: near the end
  })

  it('validates color stops', () => {
    const { ctx } = make()
    const g = ctx.createLinearGradient(0, 0, 1, 0)
    expect(() => g.addColorStop(1.5, 'red')).toThrowError(/outside the range/)
    expect(() => g.addColorStop(0.5, 'notacolor')).toThrowError(/could not be parsed/)
  })
})

describe('patterns and images', () => {
  const checker = () => {
    const src = new Canvas(2, 2)
    const s = src.getContext('2d')
    s.fillStyle = 'red'
    s.fillRect(0, 0, 1, 1)
    s.fillRect(1, 1, 1, 1)
    s.fillStyle = 'blue'
    s.fillRect(1, 0, 1, 1)
    s.fillRect(0, 1, 1, 1)
    return src
  }

  it('createPattern repeats the image', () => {
    const { c, ctx } = make(6, 6)
    ctx.fillStyle = ctx.createPattern(checker(), 'repeat')!
    ctx.fillRect(0, 0, 6, 6)
    expect(px(c, 0, 0)).toEqual([255, 0, 0, 255])
    expect(px(c, 3, 0)).toEqual([0, 0, 255, 255])
    expect(px(c, 4, 4)).toEqual([255, 0, 0, 255])
  })

  it('no-repeat patterns are transparent outside', () => {
    const { c, ctx } = make(6, 6)
    ctx.fillStyle = ctx.createPattern(checker(), 'no-repeat')!
    ctx.fillRect(0, 0, 6, 6)
    expect(px(c, 1, 1)).toEqual([255, 0, 0, 255])
    expect(px(c, 4, 4)[3]).toBe(0)
    expect(() => ctx.createPattern(checker(), 'diagonal')).toThrowError(/not one of/)
  })

  it('drawImage: 3, 5 and 9 argument forms', () => {
    const src = checker()
    const a = make(4, 4)
    a.ctx.drawImage(src, 1, 1)
    expect(px(a.c, 1, 1)).toEqual([255, 0, 0, 255])
    expect(px(a.c, 2, 1)).toEqual([0, 0, 255, 255])
    const b = make(4, 4)
    b.ctx.imageSmoothingEnabled = false
    b.ctx.drawImage(src, 0, 0, 4, 4)
    expect(px(b.c, 1, 1)).toEqual([255, 0, 0, 255])
    expect(px(b.c, 2, 1)).toEqual([0, 0, 255, 255])
    const d = make(4, 4)
    d.ctx.drawImage(src, 1, 0, 1, 1, 0, 0, 4, 4)
    expect(px(d.c, 3, 3)).toEqual([0, 0, 255, 255])
    expect(() => d.ctx.drawImage({} as Canvas, 0, 0)).toThrowError(TypeError)
  })

  it('drawImage accepts ImageData-backed sources', () => {
    const img = new ImageData(new Uint8ClampedArray([0, 255, 0, 255]), 1, 1)
    const { c, ctx } = make(2, 2)
    ctx.drawImage(img as unknown as Canvas, 1, 1)
    expect(px(c, 1, 1)).toEqual([0, 255, 0, 255])
  })

  it('getImageData / putImageData with dirty rect', () => {
    const { c, ctx } = make(4, 4)
    ctx.fillStyle = '#123456'
    ctx.fillRect(0, 0, 2, 2)
    const d = ctx.getImageData(-1, -1, 3, 3)
    expect(d.width).toBe(3)
    expect(Array.from(d.data.slice(0, 4))).toEqual([0, 0, 0, 0])
    expect(Array.from(d.data.slice(16, 20))).toEqual([0x12, 0x34, 0x56, 255])
    const out = ctx.createImageData(2, 2)
    out.data.fill(255)
    ctx.putImageData(out, 2, 2, 1, 1, 1, 1) // only the bottom-right pixel
    expect(px(c, 3, 3)).toEqual([255, 255, 255, 255])
    expect(px(c, 2, 2)).toEqual([0, 0, 0, 0])
  })
})

describe('compositing', () => {
  const comp = (op: GlobalCompositeOperation) => {
    const { c, ctx } = make(4, 1)
    ctx.fillStyle = 'blue'
    ctx.fillRect(0, 0, 2, 1) // destination: pixels 0,1
    ctx.globalCompositeOperation = op
    ctx.fillStyle = 'red'
    ctx.fillRect(1, 0, 2, 1) // source: pixels 1,2
    return [px(c, 0, 0), px(c, 1, 0), px(c, 2, 0)]
  }
  const R = [255, 0, 0, 255], B = [0, 0, 255, 255], T = [0, 0, 0, 0]

  it.each([
    ['source-over', [B, R, R]],
    ['destination-over', [B, B, R]],
    ['source-in', [T, R, T]],
    ['source-out', [T, T, R]],
    ['source-atop', [B, R, T]],
    ['destination-in', [T, B, T]],
    ['destination-out', [B, T, T]],
    ['destination-atop', [T, B, R]],
    ['copy', [T, R, R]],
    ['xor', [B, T, R]],
    ['lighter', [B, [255, 0, 255, 255], R]],
  ] as const)('%s', (op, expected) => {
    expect(comp(op as GlobalCompositeOperation)).toEqual(expected)
  })

  it('multiply and screen blend modes', () => {
    const run = (op: GlobalCompositeOperation) => {
      const { c, ctx } = make(1, 1)
      ctx.fillStyle = '#808080'
      ctx.fillRect(0, 0, 1, 1)
      ctx.globalCompositeOperation = op
      ctx.fillStyle = '#808080'
      ctx.fillRect(0, 0, 1, 1)
      return px(c, 0, 0)[0]
    }
    expect(Math.abs(run('multiply') - 64)).toBeLessThanOrEqual(1)
    expect(Math.abs(run('screen') - 192)).toBeLessThanOrEqual(1)
  })
})

describe('shadows', () => {
  it('draws an offset shadow', () => {
    const { c, ctx } = make(20, 20)
    ctx.shadowColor = 'black'
    ctx.shadowOffsetX = 5
    ctx.shadowOffsetY = 5
    ctx.fillStyle = 'red'
    ctx.fillRect(2, 2, 6, 6)
    expect(px(c, 4, 4)).toEqual([255, 0, 0, 255])
    expect(px(c, 11, 11)).toEqual([0, 0, 0, 255])
  })

  it('blurs the shadow', () => {
    const { c, ctx } = make(30, 30)
    ctx.shadowColor = 'black'
    ctx.shadowBlur = 6
    ctx.fillStyle = 'red'
    ctx.fillRect(10, 10, 10, 10)
    const outside = px(c, 8, 15)[3]
    expect(outside).toBeGreaterThan(20)
    expect(outside).toBeLessThan(255)
    expect(px(c, 0, 0)[3]).toBe(0)
  })
})
