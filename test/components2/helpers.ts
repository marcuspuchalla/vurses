import { defineComponent } from 'vue'
import type { RenderResult } from '../../src/testing.js'

export const tpl = (template: string, setup: () => Record<string, unknown> = () => ({})) => defineComponent({ setup, template })

const base = { type: 'mouse' as const, ctrl: false, meta: false, shift: false, sequence: '' }

/** Mouse drag from (x1, y1) to (x2, y2) (down, drag, up). */
export async function drag(r: RenderResult, x1: number, y1: number, x2: number, y2: number) {
  const rt = r.app.runtime!
  rt.dispatchMouse({ ...base, x: x1, y: y1, action: 'down', button: 'left' })
  rt.dispatchMouse({ ...base, x: x2, y: y2, action: 'drag', button: 'left' })
  rt.dispatchMouse({ ...base, x: x2, y: y2, action: 'up', button: 'left' })
  await r.settle()
}

/** Foreground SGR of the cell at (x, y). */
export const fgAt = (r: RenderResult, x: number, y: number) => {
  const b = r.buffer()
  return b.fg[y * b.width + x]
}
export const bgAt = (r: RenderResult, x: number, y: number) => {
  const b = r.buffer()
  return b.bg[y * b.width + x]
}
export const rgb = (hex: string, layer: 'fg' | 'bg' = 'fg') => {
  const n = parseInt(hex.slice(1), 16)
  return `${layer === 'fg' ? 38 : 48};2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}`
}
