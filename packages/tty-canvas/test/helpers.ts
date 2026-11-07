import { Canvas } from '../src/index.js'

export function px(c: Canvas, x: number, y: number): [number, number, number, number] {
  const i = (y * c.width + x) * 4
  const d = c.data
  return [d[i], d[i + 1], d[i + 2], d[i + 3]]
}

export function make(w = 20, h = 20) {
  const c = new Canvas(w, h)
  return { c, ctx: c.getContext('2d') }
}

/** Sum of alpha over the canvas (0..255 per pixel). */
export function ink(c: Canvas) {
  let s = 0
  for (let i = 3; i < c.data.length; i += 4) s += c.data[i]
  return s
}
