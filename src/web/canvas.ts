/**
 * `<canvas>` elements in `vurses web` pages.
 *
 * Each canvas element gets a backing bitmap from tty-canvas (the full Canvas 2D API), sized
 * by its `width` / `height` attributes like in a browser (300 × 150 by default). The element
 * takes `width / 8` × `height / 16` cells, the same CSS-pixel mapping the rest of the page
 * uses, so `offsetX` / `getBoundingClientRect()` land on the right canvas pixel. The bitmap is
 * painted into those cells with quadrant blocks (2 × 2 pixels and two colors per cell).
 */
import { Canvas as PixelCanvas, encodeCells, type EncodedCells } from 'tty-canvas'
import type { TElement } from '../dom/nodes.js'
import type { CellPainter } from '../render/paint.js'

const backing = new WeakMap<TElement, PixelCanvas>()

/** A canvas dimension attribute: a non-negative integer, otherwise the default (HTML rules). */
function dimension(v: unknown, fallback: number): number {
  if (v === undefined || v === null || v === '') return fallback
  const n = Math.floor(Number(v))
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

/** The attribute size of a canvas element in canvas pixels. */
export function canvasSize(el: TElement): { width: number; height: number } {
  return { width: dimension(el.props.width, 300), height: dimension(el.props.height, 150) }
}

/** The bitmap behind a `<canvas>` element; resized (and cleared) when its attributes change. */
export function pixelCanvas(el: TElement): PixelCanvas {
  const { width, height } = canvasSize(el)
  let c = backing.get(el)
  if (!c) {
    c = new PixelCanvas(width || 1, height || 1)
    backing.set(el, c)
  } else if (c.width !== width || c.height !== height) {
    c.width = width || 1
    c.height = height || 1
  }
  return c
}

/** The cell size a canvas takes when CSS doesn't size it: its attribute size at 8 × 16 px per cell. */
export function canvasCells(el: TElement): { columns: number; rows: number } {
  const { width, height } = canvasSize(el)
  return { columns: Math.max(1, Math.round(width / 8)), rows: Math.max(1, Math.round(height / 16)) }
}

/**
 * A `paintCells` function for a canvas element. `background` is the page color behind it
 * (transparent canvas pixels show it); every change to the bitmap requests a new frame.
 */
export function canvasPainter(el: TElement, requestRender: () => void) {
  let cache: { key: string; cells: EncodedCells } | null = null
  let subscribed: PixelCanvas | null = null
  let unsubscribe: (() => void) | null = null
  const paint = (p: CellPainter) => {
    const c = pixelCanvas(el)
    if (subscribed !== c) {
      unsubscribe?.()
      subscribed = c
      unsubscribe = c.subscribe(() => requestRender())
    }
    if (!p.width || !p.height) return
    const key = `${c.version}|${c.width}x${c.height}|${p.width}x${p.height}|${paint.background ?? ''}`
    if (!cache || cache.key !== key) {
      cache = {
        key,
        cells: encodeCells(c._data, c.width, c.height, { mode: 'quadrant', columns: p.width, rows: p.height, background: paint.background ?? null }),
      }
    }
    const { cells } = cache
    for (let y = 0; y < cells.rows; y++) {
      for (let x = 0; x < cells.columns; x++) {
        const cell = cells.cells[y * cells.columns + x]
        p.set(x, y, cell.ch, cell.fg, cell.bg)
      }
    }
  }
  paint.background = undefined as string | undefined
  return paint
}
