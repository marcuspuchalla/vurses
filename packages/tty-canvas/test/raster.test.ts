import { describe, expect, it } from 'vitest'
import { Canvas, DOMMatrix, Path2D } from '../src/index.js'
import { ink, make, px } from './helpers.js'

describe('rectangles', () => {
  it('fillRect fills exact pixels with the fill color', () => {
    const { c, ctx } = make(10, 10)
    ctx.fillStyle = 'red'
    ctx.fillRect(2, 3, 4, 5)
    expect(px(c, 2, 3)).toEqual([255, 0, 0, 255])
    expect(px(c, 5, 7)).toEqual([255, 0, 0, 255])
    expect(px(c, 6, 3)).toEqual([0, 0, 0, 0])
    expect(px(c, 2, 8)).toEqual([0, 0, 0, 0])
    expect(ink(c)).toBe(4 * 5 * 255)
  })

  it('anti-aliases fractional edges by coverage', () => {
    const { c, ctx } = make(10, 10)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(2.5, 2, 5, 5)
    expect(px(c, 2, 4)[3]).toBeGreaterThan(120)
    expect(px(c, 2, 4)[3]).toBeLessThan(136)
    expect(px(c, 3, 4)[3]).toBe(255)
    expect(px(c, 7, 4)[3]).toBeGreaterThan(120)
    expect(px(c, 7, 4)[3]).toBeLessThan(136)
  })

  it('handles negative width/height', () => {
    const { c, ctx } = make(10, 10)
    ctx.fillRect(8, 8, -4, -4)
    expect(px(c, 5, 5)[3]).toBe(255)
    expect(px(c, 8, 8)[3]).toBe(0)
  })

  it('clearRect clears to transparent black', () => {
    const { c, ctx } = make(10, 10)
    ctx.fillStyle = 'blue'
    ctx.fillRect(0, 0, 10, 10)
    ctx.clearRect(2, 2, 3, 3)
    expect(px(c, 3, 3)).toEqual([0, 0, 0, 0])
    expect(px(c, 5, 5)).toEqual([0, 0, 255, 255])
  })

  it('strokeRect draws a centered 1px outline (half-pixel coverage on integer coords)', () => {
    const { c, ctx } = make(10, 10)
    ctx.strokeStyle = 'black'
    ctx.strokeRect(2.5, 2.5, 5, 5)
    expect(px(c, 2, 2)[3]).toBe(255)
    expect(px(c, 2, 5)[3]).toBe(255)
    expect(px(c, 4, 4)[3]).toBe(0)
  })

  it('globalAlpha blends source-over', () => {
    const { c, ctx } = make(4, 4)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, 4, 4)
    ctx.globalAlpha = 0.5
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, 4, 4)
    const [r, , , a] = px(c, 1, 1)
    expect(a).toBe(255)
    expect(r).toBeGreaterThanOrEqual(127)
    expect(r).toBeLessThanOrEqual(128)
  })
})

describe('paths', () => {
  it('fills a circle with the right area', () => {
    const { c, ctx } = make(40, 40)
    ctx.beginPath()
    ctx.arc(20, 20, 10, 0, Math.PI * 2)
    ctx.fill()
    const area = ink(c) / 255
    expect(area).toBeGreaterThan(Math.PI * 100 * 0.98)
    expect(area).toBeLessThan(Math.PI * 100 * 1.02)
    expect(px(c, 20, 20)[3]).toBe(255)
    expect(px(c, 2, 2)[3]).toBe(0)
  })

  it('supports nonzero and evenodd fill rules', () => {
    const p = new Path2D()
    p.rect(0, 0, 10, 10)
    p.rect(3, 3, 4, 4)
    const a = make(10, 10)
    a.ctx.fill(p, 'nonzero')
    expect(px(a.c, 5, 5)[3]).toBe(255)
    const b = make(10, 10)
    b.ctx.fill(p, 'evenodd')
    expect(px(b.c, 5, 5)[3]).toBe(0)
    expect(px(b.c, 1, 1)[3]).toBe(255)
  })

  it('draws bezier and quadratic curves', () => {
    const { c, ctx } = make(30, 30)
    ctx.beginPath()
    ctx.moveTo(0, 30)
    ctx.quadraticCurveTo(15, -10, 30, 30)
    ctx.fill()
    expect(px(c, 15, 15)[3]).toBe(255)
    expect(px(c, 1, 5)[3]).toBe(0)
    const d = make(30, 30)
    d.ctx.beginPath()
    d.ctx.moveTo(0, 0)
    d.ctx.bezierCurveTo(30, 0, 30, 30, 0, 30)
    d.ctx.fill()
    expect(px(d.c, 10, 15)[3]).toBe(255)
    expect(px(d.c, 28, 2)[3]).toBe(0)
  })

  it('roundRect rounds the corners', () => {
    const { c, ctx } = make(20, 20)
    ctx.beginPath()
    ctx.roundRect(0, 0, 20, 20, 8)
    ctx.fill()
    expect(px(c, 0, 0)[3]).toBe(0)
    expect(px(c, 10, 10)[3]).toBe(255)
    expect(px(c, 10, 0)[3]).toBe(255)
  })

  it('ellipse with rotation', () => {
    const { c, ctx } = make(40, 40)
    ctx.beginPath()
    ctx.ellipse(20, 20, 18, 4, Math.PI / 2, 0, Math.PI * 2)
    ctx.fill()
    expect(px(c, 20, 5)[3]).toBe(255) // rotated: tall
    expect(px(c, 5, 20)[3]).toBe(0)
  })

  it('arcTo produces a rounded corner', () => {
    const { ctx } = make(20, 20)
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.arcTo(10, 0, 10, 10, 5)
    ctx.lineTo(10, 10)
    // the corner itself is cut off
    ctx.lineTo(0, 10)
    ctx.closePath()
    expect(ctx.isPointInPath(9.5, 0.5)).toBe(false)
    expect(ctx.isPointInPath(4, 1)).toBe(true)
    expect(ctx.isPointInPath(9, 8)).toBe(true)
  })

  it('throws IndexSizeError for negative radii', () => {
    const { ctx } = make()
    expect(() => ctx.arc(0, 0, -1, 0, 1)).toThrowError(/negative/)
  })

  it('Path2D parses SVG path data and addPath applies transforms', () => {
    const p = new Path2D('M 1 1 h 8 v 8 h -8 Z')
    const { c, ctx } = make(20, 20)
    const q = new Path2D()
    q.addPath(p, new DOMMatrix().translate(10, 10))
    ctx.fill(q)
    expect(px(c, 15, 15)[3]).toBe(255)
    expect(px(c, 5, 5)[3]).toBe(0)
    const arc = new Path2D('M2 10 A8 8 0 0 1 18 10 Z')
    const { c: c2, ctx: ctx2 } = make(20, 20)
    ctx2.fill(arc)
    expect(px(c2, 10, 5)[3]).toBe(255)
    expect(px(c2, 10, 15)[3]).toBe(0)
  })

  it('isPointInPath / isPointInStroke', () => {
    const { ctx } = make(50, 50)
    ctx.rect(10, 10, 20, 20)
    expect(ctx.isPointInPath(15, 15)).toBe(true)
    expect(ctx.isPointInPath(5, 5)).toBe(false)
    ctx.lineWidth = 4
    expect(ctx.isPointInStroke(10, 20)).toBe(true)
    expect(ctx.isPointInStroke(11.5, 20)).toBe(true)
    expect(ctx.isPointInStroke(20, 20)).toBe(false)
  })
})

describe('strokes', () => {
  it('lineWidth, caps and joins', () => {
    const butt = make(20, 20)
    butt.ctx.lineWidth = 4
    butt.ctx.beginPath()
    butt.ctx.moveTo(5, 10)
    butt.ctx.lineTo(15, 10)
    butt.ctx.stroke()
    expect(px(butt.c, 10, 8)[3]).toBe(255)
    expect(px(butt.c, 10, 12)[3]).toBe(0)
    expect(px(butt.c, 3, 10)[3]).toBe(0)
    const sq = make(20, 20)
    sq.ctx.lineWidth = 4
    sq.ctx.lineCap = 'square'
    sq.ctx.beginPath()
    sq.ctx.moveTo(5, 10)
    sq.ctx.lineTo(15, 10)
    sq.ctx.stroke()
    expect(px(sq.c, 3, 10)[3]).toBe(255)
    // miter join fills the outer corner, bevel doesn't
    const join = (j: CanvasLineJoin) => {
      const m = make(20, 20)
      m.ctx.lineWidth = 6
      m.ctx.lineJoin = j
      m.ctx.beginPath()
      m.ctx.moveTo(4, 16)
      m.ctx.lineTo(10, 10)
      m.ctx.lineTo(16, 16)
      m.ctx.stroke()
      return px(m.c, 10, 7)[3]
    }
    expect(join('miter')).toBe(255)
    expect(join('bevel')).toBeLessThan(80)
  })

  it('round caps produce dots for zero-length subpaths', () => {
    const { c, ctx } = make(20, 20)
    ctx.lineWidth = 6
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(10, 10)
    ctx.lineTo(10, 10)
    ctx.stroke()
    expect(px(c, 10, 10)[3]).toBe(255)
    expect(px(c, 10, 8)[3]).toBe(255)
  })

  it('setLineDash creates gaps', () => {
    const { c, ctx } = make(40, 4)
    ctx.setLineDash([4, 4])
    expect(ctx.getLineDash()).toEqual([4, 4])
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(0, 2)
    ctx.lineTo(40, 2)
    ctx.stroke()
    expect(px(c, 1, 2)[3]).toBe(255)
    expect(px(c, 5, 2)[3]).toBe(0)
    expect(px(c, 9, 2)[3]).toBe(255)
    ctx.setLineDash([1, 2, 3])
    expect(ctx.getLineDash()).toEqual([1, 2, 3, 1, 2, 3])
    ctx.setLineDash([1, -1])
    expect(ctx.getLineDash()).toEqual([1, 2, 3, 1, 2, 3])
  })

  it('strokes are transformed (non-uniform scale makes thick lines)', () => {
    const { c, ctx } = make(40, 40)
    ctx.scale(1, 8)
    ctx.beginPath()
    ctx.moveTo(0, 2.5)
    ctx.lineTo(40, 2.5)
    ctx.stroke() // 1 unit wide → 8px tall
    expect(px(c, 20, 17)[3]).toBe(255)
    expect(px(c, 20, 23)[3]).toBe(255)
    expect(px(c, 20, 26)[3]).toBe(0)
  })
})

describe('transforms & state', () => {
  it('translate / rotate / scale / setTransform / getTransform', () => {
    const { c, ctx } = make(20, 20)
    ctx.translate(10, 10)
    ctx.rotate(Math.PI / 2)
    ctx.fillRect(0, 0, 5, 2) // rotated → extends down from (10,10), to the left
    expect(px(c, 9, 12)[3]).toBe(255)
    expect(px(c, 12, 9)[3]).toBe(0)
    const m = ctx.getTransform()
    expect(m.e).toBe(10)
    expect(m.f).toBe(10)
    expect(Math.abs(m.b - 1)).toBeLessThan(1e-12)
    ctx.setTransform({ a: 2, d: 2 })
    expect(ctx.getTransform().a).toBe(2)
    ctx.resetTransform()
    expect(ctx.getTransform().isIdentity).toBe(true)
  })

  it('save/restore restores styles, transform and clip', () => {
    const { c, ctx } = make(10, 10)
    ctx.fillStyle = 'red'
    ctx.save()
    ctx.fillStyle = 'blue'
    ctx.translate(5, 5)
    ctx.beginPath()
    ctx.rect(0, 0, 2, 2)
    ctx.clip()
    ctx.restore()
    expect(ctx.fillStyle).toBe('#ff0000')
    ctx.fillRect(0, 0, 1, 1)
    expect(px(c, 0, 0)).toEqual([255, 0, 0, 255])
  })

  it('clip() restricts drawing, including evenodd', () => {
    const { c, ctx } = make(20, 20)
    ctx.beginPath()
    ctx.rect(5, 5, 10, 10)
    ctx.clip()
    ctx.fillRect(0, 0, 20, 20)
    expect(px(c, 2, 2)[3]).toBe(0)
    expect(px(c, 10, 10)[3]).toBe(255)
    const e = make(20, 20)
    const p = new Path2D()
    p.rect(0, 0, 20, 20)
    p.rect(5, 5, 10, 10)
    e.ctx.clip(p, 'evenodd')
    e.ctx.fillRect(0, 0, 20, 20)
    expect(px(e.c, 10, 10)[3]).toBe(0)
    expect(px(e.c, 2, 2)[3]).toBe(255)
  })

  it('ignores invalid values like browsers', () => {
    const { ctx } = make()
    ctx.lineWidth = -1
    ctx.lineWidth = NaN
    expect(ctx.lineWidth).toBe(1)
    ctx.fillStyle = 'not a color'
    expect(ctx.fillStyle).toBe('#000000')
    ctx.globalAlpha = 2
    expect(ctx.globalAlpha).toBe(1)
    ctx.globalCompositeOperation = 'bogus' as GlobalCompositeOperation
    expect(ctx.globalCompositeOperation).toBe('source-over')
    ctx.font = 'nonsense'
    expect(ctx.font).toBe('10px sans-serif')
  })

  it('resizing the canvas clears it and resets the context', () => {
    const c = new Canvas(10, 10)
    const ctx = c.getContext('2d')
    ctx.fillStyle = 'red'
    ctx.fillRect(0, 0, 10, 10)
    c.width = 10
    expect(c.data[3]).toBe(0)
    expect(ctx.fillStyle).toBe('#000000')
    expect(c.getContext('2d')).toBe(ctx)
    expect(c.getContext('webgl')).toBeNull()
  })
})
