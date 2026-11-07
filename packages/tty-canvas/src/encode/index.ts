import { encodeCells, MODE_RESOLUTION, type CellMode, type EncodeOptions, type EncodedCells } from './cells.js'
import { cellsToAnsi, type ColorDepth } from './ansi.js'
import { encodeIterm2, encodeKitty, encodeSixel, type GraphicsProtocol } from './protocols.js'
import type { PixelSource } from '../image-data.js'

export * from './cells.js'
export * from './ansi.js'
export * from './protocols.js'

export type RenderMode = CellMode | GraphicsProtocol

export interface ToAnsiOptions extends Omit<EncodeOptions, 'mode'> {
  mode?: RenderMode
  colorDepth?: ColorDepth
}

export function isCellMode(mode: string): mode is CellMode {
  return mode in MODE_RESOLUTION
}

/** Encodes any RGBA pixel source (Canvas, ImageData, decoded Image) into cells. */
export function encodeSource(source: PixelSource | { width: number; height: number; data: ArrayLike<number> | null }, opts: EncodeOptions = {}): EncodedCells {
  if (!source.data) throw new TypeError('encodeSource: the image has no pixel data (still loading?)')
  return encodeCells(source.data, source.width, source.height, opts)
}

/**
 * Renders a canvas (or any `{ width, height, data }` RGBA source) as a string
 * you can write to a terminal: ANSI cell art for cell modes, or the escape
 * sequence of a pixel protocol (kitty / sixel / iterm2).
 */
export function toAnsi(source: { width: number; height: number; data: ArrayLike<number> | null }, opts: ToAnsiOptions = {}): string {
  const mode = opts.mode ?? 'halfblock'
  if (!source.data) throw new TypeError('toAnsi: the image has no pixel data (still loading?)')
  const { width, height, data } = source
  if (mode === 'kitty') return encodeKitty(data, width, height, { columns: opts.columns, rows: opts.rows })
  if (mode === 'iterm2') return encodeIterm2(data, width, height, { columns: opts.columns, rows: opts.rows })
  if (mode === 'sixel') return encodeSixel(data, width, height, { background: opts.background === undefined || opts.background === null ? null : typeof opts.background === 'number' ? opts.background : null })
  return cellsToAnsi(encodeCells(data, width, height, { ...opts, mode }), { colorDepth: opts.colorDepth })
}
