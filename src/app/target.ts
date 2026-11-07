import type { CellBuffer } from '../render/buffer.js'
import type { Graphic } from '../render/paint.js'
import type { Runtime } from './app.js'

/**
 * Where frames go and where input comes from. The runtime is target-agnostic:
 *
 *  - `ttyTarget`         (default) a real terminal: stdin/stdout, ANSI diffs
 *  - headless            no target (tests, MCP, server-side sessions)
 *  - browser console     `console.log` frames (see src/targets/browser)
 *  - remote stream       SSE row deltas to a frame player (see src/server)
 *
 * A target feeds input back with `runtime.handleInput(raw)` (raw terminal
 * sequences) or `runtime.dispatch(event)` (parsed events), and reports size
 * changes with `runtime.resize(columns, rows)`.
 */
export interface RenderTarget {
  /** Initial size in cells. */
  readonly columns: number
  readonly rows: number
  /** Called once before the first frame. */
  start?(runtime: Runtime): void
  /**
   * Present a frame. `prev` is null for the first frame and after a resize
   * (a full repaint is expected). `graphics` are out-of-band pixel images
   * (kitty / sixel / iTerm2) positioned in cell coordinates.
   */
  frame(next: CellBuffer, prev: CellBuffer | null, info: FrameInfo): number | void
  /** Called on exit; restore whatever `start` changed. */
  stop?(runtime: Runtime): void
  /** Color depth the target supports. */
  readonly colorDepth?: 16 | 256 | 'truecolor'
}

export interface FrameInfo {
  graphics: Graphic[]
  /** Graphics present in the previous frame (to clear/replace). */
  prevGraphics: Graphic[]
}

export type RuntimeEvents = {
  /** After every presented frame. */
  frame: { buffer: CellBuffer; prev: CellBuffer | null; ms: number; bytes: number; frame: number }
  resize: { columns: number; rows: number }
  input: unknown
  exit: { error?: unknown }
  pause: boolean
}


type Handler<T> = (payload: T) => void

/** Minimal typed event emitter (browser-safe, no node:events). */
export class Emitter<E extends object> {
  private handlers = new Map<keyof E, Set<Handler<any>>>()
  on<K extends keyof E>(event: K, fn: Handler<E[K]>): () => void {
    let set = this.handlers.get(event)
    if (!set) this.handlers.set(event, (set = new Set()))
    set.add(fn)
    return () => set!.delete(fn)
  }
  emit<K extends keyof E>(event: K, payload: E[K]) {
    const set = this.handlers.get(event)
    if (set) for (const fn of [...set]) fn(payload)
  }
}
