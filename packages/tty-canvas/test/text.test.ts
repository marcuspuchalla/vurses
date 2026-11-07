import { describe, expect, it } from 'vitest'
import { parseFont } from '../src/index.js'
import { ink, make } from './helpers.js'

function bbox(c: { width: number; height: number; data: Uint8ClampedArray }) {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    if (c.data[(y * c.width + x) * 4 + 3] > 64) {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y)
    }
  }
  return { x0, y0, x1, y1 }
}

describe('fonts', () => {
  it('parses the CSS font shorthand', () => {
    expect(parseFont('bold 16px sans-serif')).toMatchObject({ weight: 700, size: 16, family: ['sans-serif'] })
    expect(parseFont('italic 600 12pt "Fira Code", monospace')).toMatchObject({ style: 'italic', weight: 600, size: 16, monospace: true })
    expect(parseFont('2em serif')!.size).toBe(20)
    expect(parseFont('16px')).toBeNull()
    const { ctx } = make()
    ctx.font = 'bold 16px  Arial, sans-serif'
    expect(ctx.font).toBe('bold 16px Arial, sans-serif')
  })
})

describe('text', () => {
  it('fillText produces ink with the fill color', () => {
    const { c, ctx } = make(80, 30)
    ctx.fillStyle = 'red'
    ctx.font = '20px sans-serif'
    ctx.fillText('Hello', 2, 22)
    expect(ink(c)).toBeGreaterThan(255 * 60)
    let reds = 0
    for (let i = 0; i < c.data.length; i += 4) if (c.data[i + 3] === 255) { expect(c.data[i]).toBe(255); reds++ }
    expect(reds).toBeGreaterThan(30)
  })

  it('scales with the font size and respects textBaseline / textAlign', () => {
    const { c, ctx } = make(100, 60)
    ctx.font = '40px sans-serif'
    ctx.textBaseline = 'top'
    ctx.fillText('H', 10, 10)
    const b = bbox(c)
    // cap height ≈ 0.667em ≈ 27px, starting near y = 10 + (1/12)·40
    expect(b.y1 - b.y0).toBeGreaterThan(24)
    expect(b.y1 - b.y0).toBeLessThan(32)
    expect(b.y0).toBeGreaterThan(10)
    expect(b.y0).toBeLessThan(18)
    const r = make(100, 30)
    r.ctx.font = '20px sans-serif'
    r.ctx.textAlign = 'right'
    r.ctx.fillText('abc', 90, 20)
    expect(bbox(r.c).x1).toBeLessThanOrEqual(90)
    expect(bbox(r.c).x1).toBeGreaterThan(84)
  })

  it('measureText reports width and bounding boxes', () => {
    const { ctx } = make()
    ctx.font = '20px sans-serif'
    const m = ctx.measureText('Hello')
    expect(m.width).toBeGreaterThan(40)
    expect(m.width).toBeLessThan(80)
    expect(ctx.measureText('Hello world').width).toBeGreaterThan(m.width)
    expect(m.actualBoundingBoxAscent).toBeGreaterThan(12)
    expect(m.actualBoundingBoxDescent).toBeLessThan(3)
    expect(ctx.measureText('g').actualBoundingBoxDescent).toBeGreaterThan(3)
    ctx.font = '20px monospace'
    expect(ctx.measureText('iiii').width).toBe(ctx.measureText('MMMM').width)
  })

  it('maxWidth compresses text', () => {
    const { c, ctx } = make(200, 30)
    ctx.font = '20px sans-serif'
    ctx.fillText('compressed text', 0, 20, 50)
    expect(bbox(c).x1).toBeLessThanOrEqual(51)
  })

  it('strokeText draws an outline ring', () => {
    const { c, ctx } = make(60, 60)
    ctx.font = 'bold 50px sans-serif'
    ctx.lineWidth = 1
    ctx.strokeText('I', 10, 50)
    expect(ink(c)).toBeGreaterThan(0)
  })

  it('renders accented characters via combining marks', () => {
    const a = make(40, 30)
    a.ctx.font = '20px sans-serif'
    a.ctx.fillText('e', 5, 25)
    const b = make(40, 30)
    b.ctx.font = '20px sans-serif'
    b.ctx.fillText('é', 5, 25)
    expect(ink(b.c)).toBeGreaterThan(ink(a.c))
  })
})
