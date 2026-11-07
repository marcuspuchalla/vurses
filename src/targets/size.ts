/**
 * Virtual screen sizing for browser pages: explicit options, then `?cols=` /
 * `?rows=` query parameters, then the window size (in approximate cells).
 */
export interface ScreenSizeOptions {
  columns?: number
  rows?: number
  /** Derive missing dimensions from the window size. Default: true. */
  fit?: boolean
  /** Approximate cell size in CSS pixels used for fitting. Default 8.4 x 17. */
  cell?: { width: number; height: number }
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

export function resolveScreenSize(o: ScreenSizeOptions = {}, win: any = globalThis): { columns: number; rows: number; fixed: boolean } {
  let q: URLSearchParams | null = null
  try {
    q = new URLSearchParams(win.location?.search ?? '')
  } catch {
    q = null
  }
  const qc = Number(q?.get('cols') ?? q?.get('columns'))
  const qr = Number(q?.get('rows'))
  let columns = o.columns ?? (qc > 0 ? qc : undefined)
  let rows = o.rows ?? (qr > 0 ? qr : undefined)
  const fixed = columns !== undefined && rows !== undefined
  const fit = o.fit ?? true
  const cell = o.cell ?? { width: 8.4, height: 17 }
  if (columns === undefined) columns = fit && win.innerWidth ? clamp(Math.floor(win.innerWidth / cell.width) - 2, 20, 400) : 80
  if (rows === undefined) rows = fit && win.innerHeight ? clamp(Math.floor(win.innerHeight / cell.height) - 2, 6, 200) : 24
  return { columns: Math.floor(columns), rows: Math.floor(rows), fixed }
}
